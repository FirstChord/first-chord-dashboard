/** @fileoverview Pure state rules for the generic Proposals tab: record building, TTL and effective status, decisions, and telemetry. */
// Pure state rules for the generic Proposals tab ("machine prepares, human
// commits"). Reply wording and resolution assessments occupy separate lanes.
// Nothing here reads Sheets or calls a model — the producer service and
// routes own those seams.

export const PROPOSAL_LANES = ['incoming_reply', 'incoming_resolution'];
export const PROPOSAL_STATUSES = ['proposed', 'approved', 'rejected', 'expired', 'superseded'];
export const PROPOSAL_TTL_DAYS = 7;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

// Same FNV-1a used for incoming ids: stable, dependency-free, good enough to
// notice the underlying message changing under a proposal.
export function hashProposalSourceText(value = '') {
  const text = clean(value).replace(/\s+/gu, ' ');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildProposalRecord({
  proposalId = '',
  lane = 'incoming_reply',
  createdBy = '',
  linkedId = '',
  mmsId = '',
  evidence = {},
  proposalBody = '',
  now = new Date(),
} = {}) {
  if (!PROPOSAL_LANES.includes(lane)) {
    throw new Error(`Unknown proposal lane: ${lane}`);
  }
  if (!clean(proposalId)) {
    throw new Error('proposalId is required');
  }
  if (!clean(linkedId)) {
    throw new Error('linkedId is required');
  }
  if (!clean(proposalBody)) {
    throw new Error('proposalBody is required');
  }

  return {
    proposalId: clean(proposalId),
    lane,
    createdAt: now.toISOString(),
    createdBy: clean(createdBy),
    status: 'proposed',
    linkedId: clean(linkedId),
    mmsId: clean(mmsId),
    evidenceJson: JSON.stringify(evidence ?? {}),
    proposalBody: clean(proposalBody),
    appliedBody: '',
    decidedBy: '',
    decidedAt: '',
    rejectionReason: '',
    appliedAt: '',
  };
}

export function parseProposalEvidence(proposal = {}) {
  try {
    const parsed = JSON.parse(proposal.evidenceJson || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// What an open proposal's status *should* be right now, without writing it:
// expired after the TTL, superseded when the message text under it changed.
// Callers persist the derived status lazily (on the next decision/draft write)
// so a page load never mutates the tab.
export function deriveEffectiveProposalStatus(proposal = {}, { sourceText = '', now = new Date() } = {}) {
  const status = clean(proposal.status);
  if (status !== 'proposed') return status || 'proposed';

  const createdMs = new Date(proposal.createdAt || '').getTime();
  if (Number.isFinite(createdMs) && now.getTime() - createdMs > PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return 'expired';
  }

  const evidence = parseProposalEvidence(proposal);
  if (evidence.sourceTextHash && sourceText && evidence.sourceTextHash !== hashProposalSourceText(sourceText)) {
    return 'superseded';
  }

  return 'proposed';
}

// The open proposal to show for one linked row (newest wins), or null.
export function selectOpenProposalForLinkedId(proposals = [], linkedId = '', { sourceText = '', now = new Date() } = {}) {
  const key = clean(linkedId);
  if (!key) return null;

  const open = proposals
    .filter((proposal) => proposal.linkedId === key
      && deriveEffectiveProposalStatus(proposal, { sourceText, now }) === 'proposed')
    .sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`));

  return open[0] || null;
}

export const PROPOSAL_DECISIONS = ['use', 'edit', 'discard'];

export function applyProposalDecision(proposal = {}, {
  decision = '',
  finalBody = '',
  rejectionReason = '',
  actorEmail = '',
  now = new Date(),
} = {}) {
  if (!PROPOSAL_DECISIONS.includes(decision)) {
    throw new Error(`Unknown proposal decision: ${decision}`);
  }
  if (clean(proposal.status) !== 'proposed') {
    throw new Error(`Proposal ${proposal.proposalId || ''} is not open (status: ${proposal.status || 'unknown'})`);
  }

  const decidedAt = now.toISOString();
  if (decision === 'discard') {
    return {
      ...proposal,
      status: 'rejected',
      decidedBy: clean(actorEmail),
      decidedAt,
      rejectionReason: clean(rejectionReason).slice(0, 300),
    };
  }

  const body = decision === 'edit' ? clean(finalBody) : clean(proposal.proposalBody);
  if (!body) {
    throw new Error('An approved reply needs text');
  }

  return {
    ...proposal,
    status: 'approved',
    decidedBy: clean(actorEmail),
    decidedAt,
    appliedAt: decidedAt,
    appliedBody: body,
  };
}

// Day-one telemetry, derived rather than stored: an approved proposal whose
// applied body matches the proposed body was used unmodified.
export function summariseProposalTelemetry(proposals = [], { lane = 'incoming_reply' } = {}) {
  const summary = {
    proposed: 0,
    usedUnmodified: 0,
    edited: 0,
    discarded: 0,
    expired: 0,
    superseded: 0,
  };

  for (const proposal of proposals) {
    if (lane && proposal.lane !== lane) continue;
    const status = clean(proposal.status);
    if (status === 'proposed') summary.proposed += 1;
    else if (status === 'rejected') summary.discarded += 1;
    else if (status === 'expired') summary.expired += 1;
    else if (status === 'superseded') summary.superseded += 1;
    else if (status === 'approved') {
      if (clean(proposal.appliedBody) === clean(proposal.proposalBody)) summary.usedUnmodified += 1;
      else summary.edited += 1;
    }
  }

  const decided = summary.usedUnmodified + summary.edited + summary.discarded;
  summary.usedUnmodifiedRate = decided ? summary.usedUnmodified / decided : null;
  return summary;
}
