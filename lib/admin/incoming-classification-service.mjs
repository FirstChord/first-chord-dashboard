/** @fileoverview Manual and bounded automatic Jev inbox proposals, with human-only detail updates. */
import { randomUUID } from 'node:crypto';
import { buildProposalRecord, parseProposalEvidence } from './proposal-helpers.mjs';
import { isJevConfigured } from './jev-provider.mjs';
import { isIncomingResolutionConfigured } from './incoming-resolution-service.mjs';
import { RESOLUTION_LANE, RESOLUTION_VERSION, RESOLUTION_QUESTION, projectResolutionContext,
  publicResolutionProposal, resolutionDecision } from './incoming-resolution-helpers.mjs';
import { CLASSIFICATION_LANE, CLASSIFICATION_VERSION, CLASSIFICATION_QUESTIONS, CLASSIFICATION_FALLBACK,
  projectClassificationContext, publicClassificationProposal, classificationDecision, validateClassification } from './incoming-classification-helpers.mjs';
import { automaticCheckTargets, AUTO_CHECK_BATCH_LIMIT } from './incoming-attention-helpers.mjs';

export function isIncomingClassificationConfigured(env = process.env) {
  return env.ADMIN_AI_INBOX_CLASSIFICATION_ENABLED === 'true' && isJevConfigured(env);
}

export function isIncomingAutoCheckConfigured(env = process.env) {
  return env.ADMIN_AI_INBOX_AUTO_CHECK_ENABLED === 'true' && isIncomingClassificationConfigured(env);
}

export function createIncomingClassificationService({ readInbox, readProposals, readStudents, saveProposal,
  patchClassification, evaluate, env = process.env, now = () => new Date(), uuid = randomUUID }) {
  let autoRunning = false;
  let autoStarts = [];
  async function sources(force = false) {
    const [rows, proposals, students] = await Promise.all([readInbox({ force }), readProposals({ force }), readStudents()]);
    return { rows, proposals, students };
  }
  const project = (source, id) => projectClassificationContext(source.rows, id, { students: source.students, now: now() });
  const projectReplies = (source, id) => projectResolutionContext(source.rows, id, { students: source.students, now: now() });
  async function list() {
    const source = await sources();
    const byIncomingId = {};
    for (const proposal of [...source.proposals].sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`))) {
      if (proposal.lane !== CLASSIFICATION_LANE) continue;
      let context;
      try { context = project(source, proposal.linkedId); } catch { continue; }
      const key = context.cluster.lead.incomingId;
      if (!byIncomingId[key]) {
        const visible = publicClassificationProposal(proposal, context, now());
        if (visible) byIncomingId[key] = visible;
      }
    }
    return { byIncomingId, available: isIncomingClassificationConfigured(env) };
  }
  async function assess({ incomingId, actorEmail = '', automatic = false, expectedSourceHash = '' }) {
    if (!isIncomingClassificationConfigured(env)) throw new Error('Message checking is not connected yet');
    const first = await sources(true);
    const context = project(first, incomingId);
    if (automatic && (!isIncomingAutoCheckConfigured(env) || context.sourceHash !== expectedSourceHash
      || !automaticCheckTargets({ ...first, now: now() }).targets.some(target => target.incomingId === context.cluster.lead.incomingId))) {
      throw new Error('Automatic check is no longer eligible');
    }
    const hasReceipt = context.cluster.entries.some(row => row.schoolRepliedAt || row.schoolReplyEvidence?.length);
    const replies = !automatic && isIncomingResolutionConfigured(env) && hasReceipt ? projectReplies(first, incomingId) : null;
    const questions = { ...(!context.guard ? CLASSIFICATION_QUESTIONS : {}),
      ...(replies && !replies.guard ? { resolution: RESOLUTION_QUESTION } : {}) };
    const state = { ...(context.state || {}), ...(replies?.state || {}) };
    // A single bounded request; no provider call for missing/oversized evidence.
    const proposalId = `cls_${uuid()}`;
    const createdAt = now();
    const reservation = automatic ? buildProposalRecord({ proposalId, lane: CLASSIFICATION_LANE,
      linkedId: context.cluster.lead.incomingId, createdBy: 'automatic_inbox_check', now: createdAt,
      proposalBody: JSON.stringify(CLASSIFICATION_FALLBACK), evidence: { version: CLASSIFICATION_VERSION,
        sourceHash: context.sourceHash, queueHash: context.queueHash, automatic: true, guard: 'automatic_pending' } }) : null;
    if (reservation) await saveProposal(reservation);
    let result;
    try { result = Object.keys(questions).length ? await evaluate({ state, questions }) : null; }
    catch (error) {
      if (reservation) await saveProposal({ ...reservation, evidenceJson: JSON.stringify({ ...parseProposalEvidence(reservation), guard: 'automatic_failed' }) }).catch(() => {});
      throw error;
    }
    const decision = context.guard ? { classification: { ...CLASSIFICATION_FALLBACK }, guard: context.guard }
      : classificationDecision(result.answers);
    const fresh = await sources(true);
    const current = project(fresh, incomingId);
    const currentReplies = replies ? projectReplies(fresh, incomingId) : null;
    if (current.sourceHash !== context.sourceHash || (replies && currentReplies.sourceHash !== replies.sourceHash)
      || (automatic && fresh.proposals.some(row => row.lane === CLASSIFICATION_LANE
        && ['approved', 'rejected'].includes(row.status) && parseProposalEvidence(row).sourceHash === context.sourceHash))) {
      throw new Error('The conversation changed. Refresh before checking it again');
    }
    const metadata = result ? { model: result.model, usage: result.usage, latencyMs: result.latencyMs } : {};
    const proposal = buildProposalRecord({ proposalId, lane: CLASSIFICATION_LANE,
      linkedId: current.cluster.lead.incomingId, createdBy: automatic ? 'automatic_inbox_check' : actorEmail, now: createdAt,
      proposalBody: JSON.stringify(decision.classification), evidence: { version: CLASSIFICATION_VERSION,
        sourceHash: context.sourceHash, queueHash: context.queueHash, guard: decision.guard, automatic, ...metadata,
        answers: context.guard ? {} : Object.fromEntries(Object.keys(CLASSIFICATION_QUESTIONS).map(key => [key, result.answers[key]])) } });
    await saveProposal(proposal);
    let resolutionProposal = null, warning = '';
    if (replies) {
      const label = replies.guard ? 'unclear' : resolutionDecision(result.answers.resolution);
      const record = buildProposalRecord({ proposalId: `res_${uuid()}`, lane: RESOLUTION_LANE,
        linkedId: proposal.linkedId, createdBy: actorEmail, now: now(), proposalBody: label,
        evidence: { version: RESOLUTION_VERSION, sourceHash: replies.sourceHash, queueHash: replies.queueHash,
          guard: replies.guard, ...metadata, ...(replies.guard ? {} : { confidence: result.answers.resolution.confidence,
            probabilities: result.answers.resolution.probabilities }) } });
      try { await saveProposal(record); resolutionProposal = publicResolutionProposal(record, currentReplies, now()); }
      catch { warning = 'Message suggestions saved, but the reply assessment could not be saved. Check again if useful'; }
    }
    return { proposal: publicClassificationProposal(proposal, current, now()), resolutionProposal,
      incomingId: proposal.linkedId, warning };
  }
  async function autoCheck() {
    if (!isIncomingAutoCheckConfigured(env)) return { processed: 0, failed: 0, remaining: 0, disabled: true };
    if (autoRunning) return { processed: 0, failed: 0, remaining: 0, busy: true };
    autoRunning = true;
    try {
      const source = await sources(true);
      const { targets, budgetRemaining } = automaticCheckTargets({ ...source, now: now() });
      autoStarts = autoStarts.filter(start => now().getTime() - start < 60_000);
      const batch = targets.slice(0, Math.min(AUTO_CHECK_BATCH_LIMIT, budgetRemaining, 10 - autoStarts.length));
      let processed = 0, failed = 0;
      for (const target of batch) {
        autoStarts.push(now().getTime());
        try { await assess({ ...target, expectedSourceHash: target.sourceHash, automatic: true }); processed++; }
        catch { failed++; }
      }
      return { processed, failed, remaining: Math.max(0, targets.length - batch.length), limited: batch.length < Math.min(AUTO_CHECK_BATCH_LIMIT, targets.length) };
    } finally { autoRunning = false; }
  }
  async function review({ proposalId, mode, classification, actorEmail = '' }) {
    if (!['apply', 'discard'].includes(mode) || (mode === 'apply' && !validateClassification(classification))) {
      throw new Error('Choose valid message details');
    }
    const source = await sources(true);
    const proposal = source.proposals.find(row => row.proposalId === proposalId && row.lane === CLASSIFICATION_LANE);
    if (!proposal || proposal.status !== 'proposed') throw new Error('This suggestion is no longer open');
    const context = project(source, proposal.linkedId);
    if (!publicClassificationProposal(proposal, context, now())) throw new Error('The message changed. Check it again');
    const decidedAt = now().toISOString();
    if (mode === 'discard') {
      const discarded = { ...proposal, status: 'rejected', decidedBy: actorEmail, decidedAt };
      await saveProposal(discarded);
      return { proposal: publicClassificationProposal(discarded, context, now()), incomingId: proposal.linkedId };
    }
    // The adapter reads again, checks the whole burst, and patches only approved detail cells.
    const updatedMessages = await patchClassification({ incomingId: proposal.linkedId, expectedQueueHash: context.queueHash,
      classification, actorEmail, now: now() });
    const after = project({ ...source, rows: source.rows.map(row => updatedMessages.find(updated => updated.incomingId === row.incomingId) || row) }, proposal.linkedId);
    const decided = { ...proposal, status: 'approved', appliedBody: JSON.stringify(classification),
      decidedBy: actorEmail, decidedAt, appliedAt: decidedAt, evidenceJson: JSON.stringify({ ...parseProposalEvidence(proposal),
        generatedSourceHash: context.sourceHash, sourceHash: after.sourceHash, queueHash: after.queueHash }) };
    let warning = '';
    try { await saveProposal(decided); }
    catch { warning = 'Message details were applied, but the suggestion review could not be saved. Refresh to see the saved details'; }
    return { proposal: warning ? null : publicClassificationProposal(decided, after, now()),
      incomingId: proposal.linkedId, updatedMessages, warning };
  }
  return { list, assess, review, autoCheck };
}
