import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCOMING_REVIEW_BATCH_LIMIT,
  normaliseIncomingReviewIds, normaliseIncomingUndoSnapshots,
  buildIncomingQueueExpectation, assertIncomingQueueExpectations,
  toggleIncomingQueueSelection, retainIncomingQueueSelection,
  resolveIncomingQueueSwipe,
} from '../../lib/admin/incoming-queue-helpers.mjs';
import {
  applyIncomingMessageReview, buildIncomingUndoSnapshot, restoreIncomingMessageWorkflowState,
} from '../../lib/admin/incoming-message-helpers.mjs';

const message = (incomingId, extra = {}) => ({ incomingId, status: 'inbox', reviewedAt: '', ...extra });

test('bulk selection freezes the messages chosen, even when another message joins that row', () => {
  const first = message('first');
  const second = message('second');
  const selection = toggleIncomingQueueSelection({}, [first]);
  const afterArrival = retainIncomingQueueSelection(selection, [first, second]);
  assert.deepEqual(Object.keys(afterArrival), ['first']);
  assert.equal(afterArrival, selection);
  // Explicitly selecting the now-partial row adds the new arrival; selecting again clears it.
  const both = toggleIncomingQueueSelection(afterArrival, [first, second]);
  assert.deepEqual(Object.keys(both), ['first', 'second']);
  assert.deepEqual(toggleIncomingQueueSelection(both, [first, second]), {});
});

test('selection preserves its original review evidence, and drops hidden or Planning-linked items', () => {
  const selected = message('first');
  const selection = toggleIncomingQueueSelection({}, [selected]);
  const changed = { ...selected, reviewedAt: 'later' };
  assert.equal(retainIncomingQueueSelection(selection, [changed]).first.reviewedAt, '');
  assert.deepEqual(retainIncomingQueueSelection(selection, []), {});
  assert.deepEqual(retainIncomingQueueSelection(selection, [{ ...selected, createdPlanningId: 'plan' }]), {});
});

test('a newer review, snooze or Planning link rejects the complete selected batch', () => {
  const rows = [message('first'), message('second')];
  const expectations = rows.map(buildIncomingQueueExpectation);
  assert.doesNotThrow(() => assertIncomingQueueExpectations(rows, expectations));
  for (const extra of [
    { status: 'converted' }, { reviewedAt: 'later' },
    { snoozedUntil: '2026-10-10T09:00:00Z' }, { createdPlanningId: 'plan' },
  ]) {
    assert.throws(() => assertIncomingQueueExpectations([rows[0], { ...rows[1], ...extra }], expectations), { status: 409 });
  }
  assert.throws(() => assertIncomingQueueExpectations(rows, [expectations[0]]), { status: 400 });
  assert.throws(() => assertIncomingQueueExpectations(rows, [expectations[0], expectations[0]]), { status: 400 });
});

test('all 100 messages survive batch Undo, including classification and snooze state', () => {
  const original = Array.from({ length: INCOMING_REVIEW_BATCH_LIMIT }, (_, i) => message(`msg_${i}`, {
    status: i % 2 ? 'needs_review' : 'inbox',
    classificationActionability: 'reply_needed', classificationDecision: 'corrected',
    snoozedUntil: '2026-10-10T09:00:00.000Z', reviewNote: `Note ${i}`,
  }));
  const now = new Date('2026-10-01T09:00:00Z');
  const done = original.map((entry) => applyIncomingMessageReview(entry, { status: 'converted', now }));
  const snapshots = normaliseIncomingUndoSnapshots(original.map(buildIncomingUndoSnapshot));
  assert.equal(snapshots.length, 100);
  const restored = done.map((entry, i) => restoreIncomingMessageWorkflowState(entry, snapshots[i], { now }));
  for (let i = 0; i < restored.length; i += 1) {
    for (const key of ['status', 'snoozedUntil', 'classificationActionability', 'classificationDecision', 'reviewNote']) {
      assert.equal(restored[i][key], original[i][key]);
    }
  }
});

test('reopening Done is explicit and refuses a newer Planning link or review', () => {
  const row = message('done', { status: 'converted', reviewedAt: '2026-10-01T09:00:00Z' });
  const expected = [buildIncomingQueueExpectation(row)];
  assert.throws(() => assertIncomingQueueExpectations([row], expected), { status: 409 });
  assert.doesNotThrow(() => assertIncomingQueueExpectations([row], expected, { allowResolved: true }));
  assert.throws(() => assertIncomingQueueExpectations([{ ...row, createdPlanningId: 'new_plan' }], expected, { allowResolved: true }), { status: 409 });
  assert.throws(() => assertIncomingQueueExpectations([{ ...row, reviewedAt: 'new_review' }], expected, { allowResolved: true }), { status: 409 });
});

test('review and Undo share a cap and reject oversize or malformed batches without truncation', () => {
  const ids = Array.from({ length: 101 }, (_, i) => `msg_${i}`);
  assert.deepEqual(normaliseIncomingReviewIds(['a', 'a', 'b']), ['a', 'b']);
  assert.throws(() => normaliseIncomingReviewIds(ids), { status: 400 });
  assert.throws(() => normaliseIncomingUndoSnapshots(ids.map((incomingId) => ({ incomingId }))), { status: 400 });
  assert.throws(() => normaliseIncomingUndoSnapshots([{ incomingId: 'a' }, {}]), { status: 400 });
  assert.throws(() => normaliseIncomingUndoSnapshots([{ incomingId: 'a' }, { incomingId: 'a' }]), { status: 400 });
  assert.throws(() => normaliseIncomingUndoSnapshots([]), { status: 400 });
});

test('handling preserves an existing Planning link rather than erasing it', () => {
  const handled = applyIncomingMessageReview(message('a', { createdPlanningId: 'plan_a' }), { status: 'converted' });
  assert.equal(handled.createdPlanningId, 'plan_a');
  assert.equal(handled.resolutionType, 'planning_task');
  assert.throws(() => restoreIncomingMessageWorkflowState(handled, buildIncomingUndoSnapshot(message('a'))), /linked to Planning/);
});

test('touch clearing requires a deliberate left swipe; scrolling, taps and short swipes do nothing', () => {
  assert.equal(resolveIncomingQueueSwipe({ dx: -100, dy: 5, width: 320 }).handled, true);
  assert.equal(resolveIncomingQueueSwipe({ dx: 100, dy: 5 }).handled, false);
  assert.equal(resolveIncomingQueueSwipe({ dx: -30, dy: 0 }).handled, false);
  assert.equal(resolveIncomingQueueSwipe({ dx: -3, dy: 2 }).axis, '');
  assert.equal(resolveIncomingQueueSwipe({ dx: -80, dy: 100 }).axis, 'vertical');
  assert.equal(resolveIncomingQueueSwipe({ dx: -160, dy: 110, axis: 'vertical' }).handled, false);
});
