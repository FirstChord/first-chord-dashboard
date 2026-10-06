/** @fileoverview Human acknowledgement gates and source-scoped browser drafts for the guided inbox-to-pause sequence; never sends or saves a plan. */
import { hashProposalSourceText } from './proposal-helpers.mjs';

export const INCOMING_PAUSE_DRAFT_PREFIX = 'first-chord-incoming-pause-v1:';
const MAX_DRAFT_AGE = 7 * 24 * 60 * 60 * 1000;

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function validateIncomingPauseAcknowledgement(confirmation, { now = new Date() } = {}) {
  if (!confirmation || !['sent', 'already_acknowledged'].includes(confirmation.mode)) {
    invalid('Confirm the acknowledgement first. Reopen Reply + Plan if this screen has not updated.');
  }
  if (typeof confirmation.confirmedAt !== 'string') invalid('Confirm the acknowledgement again.');
  const confirmedAt = new Date(confirmation.confirmedAt || '').getTime();
  if (!Number.isFinite(confirmedAt) || confirmedAt > now.getTime() + 300_000) invalid('Confirm the acknowledgement again.');
  const reply = typeof confirmation.reply === 'string' ? confirmation.reply.trim() : '';
  if (reply.length > 1200) invalid('Review an acknowledgement of up to 1,200 characters.');
  if (confirmation.mode === 'sent') {
    if (typeof confirmation.openedAt !== 'string') invalid('Copy and send the acknowledgement, then confirm it was sent.');
    const openedAt = new Date(confirmation.openedAt || '').getTime();
    if (!reply || !Number.isFinite(openedAt) || openedAt > confirmedAt) invalid('Copy and send the acknowledgement, then confirm it was sent.');
  }
  return {
    mode: confirmation.mode, confirmedAt: new Date(confirmedAt).toISOString(),
    openedAt: confirmation.mode === 'sent' ? new Date(confirmation.openedAt).toISOString() : '',
    reply: confirmation.mode === 'sent' ? reply : '',
  };
}

export function confirmIncomingPauseAcknowledgement({ mode, reply = '', openedAt = '', now = new Date() }) {
  return validateIncomingPauseAcknowledgement({ mode, reply, openedAt, confirmedAt: now.toISOString() }, { now });
}

export function incomingPauseDraftKey(context = {}) {
  return context.source?.incomingId ? `${INCOMING_PAUSE_DRAFT_PREFIX}${context.source.incomingId}` : '';
}

function sourceFingerprint(context) {
  // A change detector, not a security token. Do not duplicate source text in storage.
  return hashProposalSourceText(JSON.stringify({ chat: context.source?.chatId, snapshots: context.snapshots }));
}

export function buildIncomingPauseBrowserDraft(context, { acknowledgement = '', confirmation = null, openedAt = '', options = {} }, now = new Date()) {
  return { version: 1, fingerprint: sourceFingerprint(context), updatedAt: now.toISOString(), acknowledgement, confirmation, openedAt, options };
}

export function restoreIncomingPauseBrowserDraft(context, stored, now = new Date()) {
  if (!stored || stored.version !== 1 || stored.fingerprint !== sourceFingerprint(context)
    || typeof stored.acknowledgement !== 'string' || stored.acknowledgement.length > 1200
    || !stored.options || typeof stored.options !== 'object' || Array.isArray(stored.options)) return null;
  const age = now.getTime() - new Date(stored.updatedAt || '').getTime();
  if (!Number.isFinite(age) || age < -300_000 || age > MAX_DRAFT_AGE) return null;
  try {
    const confirmation = stored.confirmation ? validateIncomingPauseAcknowledgement(stored.confirmation, { now }) : null;
    if (confirmation?.mode === 'sent' && confirmation.reply !== stored.acknowledgement.trim()) return null;
    const openedMs = new Date(stored.openedAt || '').getTime();
    const openedAt = Number.isFinite(openedMs) && openedMs <= new Date(stored.updatedAt).getTime() ? new Date(openedMs).toISOString() : '';
    return { acknowledgement: stored.acknowledgement, confirmation, openedAt, options: stored.options };
  } catch { return null; }
}
