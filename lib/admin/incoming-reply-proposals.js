/** @fileoverview Server service producing and recording decisions on suggested replies to open inbox rows; it never sends anything itself. */
// Server service for the proposals-inbox reply lane: produce a suggested
// reply for one open Incoming_Message_Inbox row (deterministic policy context
// + one tool-free model call, or the deterministic neutral draft when the
// evidence is ambiguous), and record the human decision. The dashboard still
// never sends anything — approving copies to the clipboard client-side and
// logs to Communication_Log here.
import { randomUUID } from 'node:crypto';
import {
  getIncomingMessageInboxRows,
  getProposalRows,
  getScheduleContextRows,
  upsertProposalRow,
} from '@/lib/admin/sheets';
import { getOperationalAdminStudents } from './students';
import { logCommunication } from './communications';
import { isIncomingMessageSnoozed, isIncomingPlaceholderText } from './incoming-message-helpers.mjs';
import {
  buildNeutralAcknowledgementDraft,
  buildReplyPolicyContext,
  materialiseReplyDraft,
  validateIncomingReplyDraft,
} from './incoming-reply-policy.mjs';
import {
  INCOMING_REPLY_PROMPT_VERSION,
  INCOMING_REPLY_SCHEMA_VERSION,
  IncomingReplyAiError,
  buildStoredReplyModelContext,
  redactIncomingMessageText,
} from './incoming-reply-ai-contract.mjs';
import { generateIncomingReplyDraft } from './incoming-reply-ai-provider.mjs';
import {
  applyProposalDecision,
  buildProposalRecord,
  deriveEffectiveProposalStatus,
  hashProposalSourceText,
  selectOpenProposalForLinkedId,
  summariseProposalTelemetry,
} from './proposal-helpers.mjs';

const REPLY_LANE = 'incoming_reply';

function isOpenInboxRow(row = {}) {
  return ['inbox', 'needs_review'].includes(row.status)
    && !isIncomingMessageSnoozed(row)
    && row.messageText
    && !isIncomingPlaceholderText(row.messageText);
}

// Open reply proposals joined to their inbox rows, plus lane telemetry.
export async function getIncomingReplyProposals() {
  const [proposals, inboxRows] = await Promise.all([
    getProposalRows(),
    getIncomingMessageInboxRows(),
  ]);

  const textByIncomingId = new Map(inboxRows.map((row) => [row.incomingId, row.messageText || '']));
  const laneProposals = proposals.filter((proposal) => proposal.lane === REPLY_LANE);
  const now = new Date();

  const open = {};
  for (const row of inboxRows) {
    if (!isOpenInboxRow(row)) continue;
    const proposal = selectOpenProposalForLinkedId(laneProposals, row.incomingId, {
      sourceText: row.messageText || '',
      now,
    });
    if (proposal) {
      open[row.incomingId] = {
        proposalId: proposal.proposalId,
        proposalBody: proposal.proposalBody,
        createdAt: proposal.createdAt,
        createdBy: proposal.createdBy,
      };
    }
  }

  return {
    openByIncomingId: open,
    telemetry: summariseProposalTelemetry(
      laneProposals.map((proposal) => ({
        ...proposal,
        status: deriveEffectiveProposalStatus(proposal, {
          sourceText: textByIncomingId.get(proposal.linkedId) || '',
          now,
        }),
      })),
    ),
  };
}

export async function draftIncomingReplyProposal({ incomingId = '', actorEmail = '', requestId = '' } = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  const [inboxRows, students, scheduleRows, proposals] = await Promise.all([
    getIncomingMessageInboxRows(),
    getOperationalAdminStudents(),
    getScheduleContextRows().catch(() => []),
    getProposalRows(),
  ]);

  const row = inboxRows.find((entry) => entry.incomingId === incomingKey);
  if (!row) {
    throw new Error(`Incoming message ${incomingKey} was not found`);
  }
  if (!isOpenInboxRow(row)) {
    throw new Error('Only open messages with real text can get a suggested reply');
  }

  const student = students.find((entry) => entry.mmsId === row.matchedMmsId) || {};
  const scheduleContext = row.matchedMmsId
    ? scheduleRows.find((entry) => entry.mmsId === row.matchedMmsId) || null
    : null;

  const policyContext = buildReplyPolicyContext({ record: row, scheduleContext });

  const parentName = [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim();
  const names = {
    studentNames: [row.matchedStudentName, student.fullName].filter(Boolean),
    parentNames: [parentName, row.senderName].filter(Boolean),
  };

  let draftTemplate;
  let usedFactIds = [];
  let createdBy = '';
  let modelMeta = null;

  if (policyContext.neutralFallback) {
    // The ambiguity rule: no model call, a warm acknowledgement that commits
    // to nothing.
    draftTemplate = buildNeutralAcknowledgementDraft();
    createdBy = 'policy_fallback';
  } else {
    const redactedMessage = redactIncomingMessageText(row.messageText, names);
    const generated = await generateIncomingReplyDraft(policyContext, {
      redactedMessage,
      requestId,
    });
    draftTemplate = generated.draft;
    usedFactIds = generated.usedFactIds;
    createdBy = `model:${generated.model}`;
    modelMeta = {
      model: generated.model,
      usage: generated.usage,
      latencyMs: generated.latencyMs,
      modelInput: generated.modelInput,
    };
  }

  // Belt and braces: the provider already validated model output, and the
  // neutral template is fixed — but nothing unvalidated may reach the tab.
  const validation = validateIncomingReplyDraft(draftTemplate, policyContext);
  if (!validation.valid) {
    throw new IncomingReplyAiError('invalid_draft', 'The drafted reply failed policy validation', validation.errors);
  }

  const proposalBody = materialiseReplyDraft(draftTemplate, {
    parentName: row.senderName || parentName,
    studentName: row.matchedStudentName || student.fullName || '',
  });
  // Validate again after name substitution. Sender/display names are raw
  // contact data, so they must not be able to inject a phone, link, provider
  // identifier, action claim, or policy wording that the template passed.
  const materialisedValidation = validateIncomingReplyDraft(proposalBody, policyContext);
  if (!materialisedValidation.valid) {
    throw new IncomingReplyAiError(
      'invalid_draft',
      'The drafted reply failed policy validation after name substitution',
      materialisedValidation.errors,
    );
  }

  // One open proposal per message: a redraft supersedes, never duplicates.
  const laneProposals = proposals.filter((proposal) => proposal.lane === REPLY_LANE && proposal.linkedId === incomingKey);
  for (const existing of laneProposals) {
    if (existing.status === 'proposed') {
      await upsertProposalRow({ ...existing, status: 'superseded' });
    }
  }

  const record = buildProposalRecord({
    proposalId: `prop_${randomUUID()}`,
    lane: REPLY_LANE,
    createdBy: createdBy || actorEmail,
    linkedId: incomingKey,
    mmsId: row.matchedMmsId || '',
    evidence: {
      sourceTextHash: hashProposalSourceText(row.messageText || ''),
      promptVersion: INCOMING_REPLY_PROMPT_VERSION,
      schemaVersion: INCOMING_REPLY_SCHEMA_VERSION,
      policyCase: policyContext.policyCase,
      noticeWindow: policyContext.noticeWindow,
      lessonDateIso: policyContext.lessonDateIso,
      lessonDateSource: policyContext.lessonDateSource,
      messageDateIso: policyContext.messageDateIso,
      ambiguityFlags: policyContext.ambiguityFlags,
      acknowledgementOnly: policyContext.acknowledgementOnly,
      allowedFactIds: (policyContext.allowedFacts || []).map((fact) => fact.id),
      usedFactIds,
      draftTemplate,
      // Retain the bounded rules behind the suggestion, not another copy of
      // the parent's message. The source hash points back to the inbox row.
      modelContext: buildStoredReplyModelContext(modelMeta?.modelInput),
    },
    proposalBody,
  });

  await upsertProposalRow(record);

  return {
    proposal: record,
    policyCase: policyContext.policyCase,
    noticeWindow: policyContext.noticeWindow,
    acknowledgementOnly: policyContext.acknowledgementOnly,
    neutralFallback: policyContext.neutralFallback,
    modelMeta: modelMeta ? { model: modelMeta.model, usage: modelMeta.usage, latencyMs: modelMeta.latencyMs } : null,
  };
}

export async function decideIncomingReplyProposal({
  proposalId = '',
  decision = '',
  finalBody = '',
  rejectionReason = '',
  actorEmail = '',
} = {}) {
  const proposalKey = `${proposalId || ''}`.trim();
  if (!proposalKey) {
    throw new Error('proposalId is required');
  }

  const [proposals, inboxRows] = await Promise.all([
    getProposalRows(),
    getIncomingMessageInboxRows(),
  ]);
  const proposal = proposals.find((entry) => entry.proposalId === proposalKey);
  if (!proposal) {
    throw new Error(`Proposal ${proposalKey} was not found`);
  }
  if (proposal.lane !== REPLY_LANE) {
    throw new Error('This is not a reply suggestion');
  }

  const inboxRow = inboxRows.find((entry) => entry.incomingId === proposal.linkedId) || null;
  const effectiveStatus = deriveEffectiveProposalStatus(proposal, {
    sourceText: inboxRow?.messageText || '',
  });
  if (effectiveStatus !== 'proposed') {
    // Persist the lazily-derived state so the tab reflects why the decision
    // was refused.
    await upsertProposalRow({ ...proposal, status: effectiveStatus });
    throw new Error(`This suggestion is ${effectiveStatus} — draft a fresh one`);
  }

  const decided = applyProposalDecision(proposal, {
    decision,
    finalBody,
    rejectionReason,
    actorEmail,
  });
  await upsertProposalRow(decided);

  // Approving means "I'm sending this by hand" — record it the same way every
  // Copy-message button does. Fire-and-forget: the log is a passive record.
  if (decided.status === 'approved') {
    try {
      await logCommunication({
        category: 'parent',
        channel: 'whatsapp',
        mmsId: decided.mmsId,
        studentName: inboxRow?.matchedStudentName || '',
        body: decided.appliedBody,
        source: 'incoming_reply_proposal',
        actorEmail,
      });
    } catch (error) {
      console.warn('Communication log write failed for approved reply proposal:', error?.message || error);
    }
  }

  return { proposal: decided };
}
