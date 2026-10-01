/** @fileoverview Bounds inbox review/Undo batches, snapshots explicit queue selections, and distinguishes a left swipe from scrolling. */
export const INCOMING_REVIEW_BATCH_LIMIT = 100;

function invalidBatch(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normaliseIncomingReviewIds(incomingIds = []) {
  if (!Array.isArray(incomingIds)) throw invalidBatch('Message selection must be a list');
  const ids = [...new Set(incomingIds.map((id) => `${id || ''}`.trim()).filter(Boolean))];
  if (!ids.length) throw invalidBatch('Select at least one message');
  if (ids.length > INCOMING_REVIEW_BATCH_LIMIT) {
    throw invalidBatch(`Select up to ${INCOMING_REVIEW_BATCH_LIMIT} messages at a time`);
  }
  return ids;
}

export function normaliseIncomingUndoSnapshots(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.some((snapshot) => !snapshot?.incomingId)) {
    throw invalidBatch('Every message needs an Undo snapshot');
  }
  const ids = normaliseIncomingReviewIds(snapshots.map((snapshot) => snapshot.incomingId));
  if (ids.length !== snapshots.length) throw invalidBatch('Undo contains duplicate messages');
  // Never silently truncate: the complete batch must be validated before any write.
  return snapshots;
}

export function buildIncomingQueueExpectation(entry = {}) {
  return {
    incomingId: entry.incomingId,
    status: entry.status || '',
    reviewedAt: entry.reviewedAt || '',
    snoozedUntil: entry.snoozedUntil || '',
    createdPlanningId: entry.createdPlanningId || '',
  };
}

export function assertIncomingQueueExpectations(rows = [], expectations = [], { allowResolved = false } = {}) {
  if (!Array.isArray(expectations) || expectations.length !== rows.length) {
    throw invalidBatch('Every selected message needs its current review state');
  }
  const byId = new Map(expectations.map((entry) => [entry?.incomingId, entry]));
  if (byId.size !== rows.length) throw invalidBatch('Message selection contains duplicates');
  for (const row of rows) {
    const expected = byId.get(row.incomingId);
    if (!expected || row.createdPlanningId
      || !(allowResolved ? ['converted', 'ignored'] : ['inbox', 'needs_review']).includes(row.status)
      || Object.entries(buildIncomingQueueExpectation(row)).some(([key, value]) => expected[key] !== value)) {
      throw invalidBatch('A selected message changed. Refresh the inbox and select it again.', 409);
    }
  }
}

export function toggleIncomingQueueSelection(selection = {}, entries = []) {
  const next = { ...selection };
  const allSelected = entries.every((entry) => Object.hasOwn(selection, entry.incomingId));
  for (const entry of entries) {
    if (allSelected) delete next[entry.incomingId];
    else if (!Object.hasOwn(next, entry.incomingId)) {
      next[entry.incomingId] = buildIncomingQueueExpectation(entry);
    }
  }
  return next;
}

export function retainIncomingQueueSelection(selection = {}, visibleEntries = []) {
  const visibleIds = new Set(visibleEntries.filter((entry) => !entry.createdPlanningId).map((entry) => entry.incomingId));
  const remaining = Object.entries(selection).filter(([id]) => visibleIds.has(id));
  return remaining.length === Object.keys(selection).length ? selection : Object.fromEntries(remaining);
}

export function resolveIncomingQueueSwipe({ dx = 0, dy = 0, width = 320, axis = '' } = {}) {
  let nextAxis = axis;
  if (!nextAxis && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
    nextAxis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'horizontal' : 'vertical';
  }
  const offset = nextAxis === 'horizontal' ? Math.max(-width * 0.85, Math.min(0, dx)) : 0;
  const threshold = Math.max(72, Math.min(112, width * 0.28));
  return { axis: nextAxis, offset, handled: offset <= -threshold };
}
