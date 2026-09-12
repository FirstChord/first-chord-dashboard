/** @fileoverview Pure normalisation, deduplication, and grouping for the record-only parent Communication Log. */
// Pure helpers for the Communication Log (record-only). No sending, no approval —
// this is a passive logbook of parent messages that were copied to send.

export const COMMUNICATION_CATEGORIES = ['pause', 'parent', 'onboarding', 'waiting', 'tutor_absence', 'newsletter', 'general'];
export const COMMUNICATION_CHANNELS = ['whatsapp', 'email', 'other'];

// How close together two identical messages to the same student count as the same
// send (so clicking Copy twice doesn't create two rows).
export const COMMUNICATION_DEDUP_WINDOW_MS = 10 * 60 * 1000;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function normaliseEnum(value, allowed, fallback) {
  const candidate = clean(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
}

export function normaliseCommunicationLogEntry(entry = {}) {
  return {
    messageId: clean(entry.messageId),
    loggedAt: clean(entry.loggedAt),
    category: normaliseEnum(entry.category, COMMUNICATION_CATEGORIES, 'general'),
    channel: normaliseEnum(entry.channel, COMMUNICATION_CHANNELS, 'whatsapp'),
    mmsId: clean(entry.mmsId),
    studentName: clean(entry.studentName),
    body: clean(entry.body),
    source: clean(entry.source),
    actorEmail: clean(entry.actorEmail),
  };
}

// Stable identity for a message: same student + same body text. Used to suppress
// duplicate rows from repeated copies of the same message.
export function communicationFingerprint(mmsId = '', body = '') {
  return `${clean(mmsId).toLowerCase()}::${clean(body).replace(/\s+/gu, ' ').toLowerCase()}`;
}

// True if `entry` is a duplicate of something already logged within the dedup
// window (same fingerprint, logged recently). `existingRows` are normalised log
// entries; `now` is the proposed log time.
export function isDuplicateCommunication(entry, existingRows = [], { now = new Date(), windowMs = COMMUNICATION_DEDUP_WINDOW_MS } = {}) {
  const fingerprint = communicationFingerprint(entry.mmsId, entry.body);
  if (!clean(entry.body)) return false;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  return existingRows.some((row) => {
    if (communicationFingerprint(row.mmsId, row.body) !== fingerprint) return false;
    const loggedMs = new Date(row.loggedAt || '').getTime();
    return Number.isFinite(loggedMs) && nowMs - loggedMs <= windowMs;
  });
}

// Newest-first list for the read view.
export function groupCommunicationLog(rows = []) {
  return [...rows]
    .map(normaliseCommunicationLogEntry)
    .filter((row) => row.body)
    .sort((a, b) => {
      const aMs = new Date(a.loggedAt || '').getTime();
      const bMs = new Date(b.loggedAt || '').getTime();
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    });
}

export function labelCommunicationCategory(value) {
  const map = {
    pause: 'Pause',
    parent: 'Parent update',
    onboarding: 'Onboarding',
    waiting: 'Waiting list',
    tutor_absence: 'Tutor absence',
    newsletter: 'Newsletter',
    general: 'General',
  };
  return map[normaliseEnum(value, COMMUNICATION_CATEGORIES, 'general')];
}
