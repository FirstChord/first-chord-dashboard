/** @fileoverview Conservative inbox attention grouping and bounded automatic-check eligibility; no workflow writes. */
import { clusterIncomingMessages, groupIncomingMessages, isIncomingMessageSnoozed } from './incoming-message-helpers.mjs';
import { currentClassificationSuggestion, projectClassificationContext, publicClassificationProposal, CLASSIFICATION_LANE } from './incoming-classification-helpers.mjs';
import { parseProposalEvidence } from './proposal-helpers.mjs';

export const AUTO_CHECK_BATCH_LIMIT = 3;
export const AUTO_CHECK_DAILY_LIMIT = 100;
export const AUTO_CHECK_QUIET_MS = 5 * 60_000;
const time = row => new Date(row.messageAt || row.capturedAt || '').getTime();

export function isProbablyNothing(proposal, entries, { now = new Date(), rows = [] } = {}) {
  const current = currentClassificationSuggestion(proposal, entries, now);
  if (!current || current.status === 'rejected' || current.guard || !entries.length
    || entries.some(row => row.createdPlanningId || !['inbox', 'needs_review'].includes(row.status)
      || isIncomingMessageSnoozed(row, { now })
      || (['accepted', 'corrected'].includes(row.classificationDecision) && row.classificationActionability !== 'no_action'))) return false;
  const details = current.applied || current.classification;
  if (details?.actionability !== 'no_action' || !['acknowledgement', 'social', 'notification'].includes(details.intent)) return false;
  // A later inbound conversation boundary returns the older cue to attention.
  const ids = new Set(entries.map(row => row.incomingId));
  return !rows.some(row => row.chatId && row.chatId === entries[0].chatId && !ids.has(row.incomingId)
    && time(row) > Math.max(...entries.map(time)));
}

export function automaticCheckTargets({ rows, proposals, students = [], now = new Date() }) {
  const clusters = clusterIncomingMessages(groupIncomingMessages(rows.filter(row =>
    ['inbox', 'needs_review'].includes(row.status) && !isIncomingMessageSnoozed(row, { now }))));
  const recent = proposals.filter(row => row.lane === CLASSIFICATION_LANE && parseProposalEvidence(row).automatic
    && now - new Date(row.createdAt) >= 0 && now - new Date(row.createdAt) < 24 * 60 * 60_000).length;
  const targets = [];
  for (const cluster of clusters) {
    if (cluster.entries.some(row => row.createdPlanningId)) continue;
    const latest = Math.max(...cluster.entries.map(row => new Date(row.capturedAt || row.messageAt || '').getTime()));
    if (!Number.isFinite(latest) || now - latest < AUTO_CHECK_QUIET_MS) continue;
    const context = projectClassificationContext(rows, cluster.lead.incomingId, { students, now });
    const matching = proposals.filter(row => row.lane === CLASSIFICATION_LANE
      && parseProposalEvidence(row).sourceHash === context.sourceHash)
      .sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`));
    if (matching.some(row => ['approved', 'rejected'].includes(row.status))) continue;
    const latestProposal = matching[0];
    const evidence = parseProposalEvidence(latestProposal);
    const age = now - new Date(latestProposal?.createdAt);
    if (latestProposal && ((evidence.guard === 'automatic_pending' && age < 15 * 60_000)
      || (evidence.guard === 'automatic_failed' && age < 60 * 60_000)
      || (!['automatic_pending', 'automatic_failed'].includes(evidence.guard)
        && publicClassificationProposal(latestProposal, context, now)))) continue;
    targets.push({ incomingId: cluster.lead.incomingId, sourceHash: context.sourceHash });
  }
  return { targets, budgetRemaining: Math.max(0, AUTO_CHECK_DAILY_LIMIT - recent) };
}
