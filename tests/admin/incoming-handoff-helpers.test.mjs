import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcknowledgementProgressPayload } from '../../lib/admin/incoming-handoff-helpers.mjs';
import { buildIncomingPlanningDraft } from '../../lib/admin/incoming-message-helpers.mjs';
import { extractIncomingPlanningReply, buildPauseConfirmationMessage, hasPausePaymentConfirmation } from '../../lib/admin/planning-client-helpers.mjs';

test('a human-recorded acknowledgement only adds progress to the exact linked plan', () => {
  const payload = buildAcknowledgementProgressPayload({
    alreadyResolved: true, planningId: 'planning_incoming_1', openedAt: '2026-10-05T10:00:00Z', reply: 'Thanks, we will sort it.',
  });
  assert.equal(payload.mode, 'progress');
  assert.equal(payload.planningId, 'planning_incoming_1');
  assert.equal(payload.progressType, 'note');
  assert.match(payload.progressNote, /final confirmation remain/u);
  for (const field of ['status', 'nextAction', 'targetDate', 'item', 'paymentExpectation']) {
    assert.equal(Object.hasOwn(payload, field), false, field);
  }
  assert.equal(hasPausePaymentConfirmation({ progress: [{ progressNote: payload.progressNote }] }), false);
});

test('a copied but unopened acknowledgement cannot be recorded sent, and reply-only is separate', () => {
  assert.equal(buildAcknowledgementProgressPayload({ alreadyResolved: true, planningId: 'plan', reply: 'Thanks' }), null);
  assert.equal(buildAcknowledgementProgressPayload({ alreadyResolved: false, openedAt: '2026-10-05', reply: 'Thanks' }), null);
  assert.equal(buildAcknowledgementProgressPayload({ alreadyResolved: true, openedAt: '2026-10-05', planningId: 'plan', reply: ' ' }), null);
});

test('the reviewed acknowledgement round-trips separately from the later pause confirmation', () => {
  const acknowledgement = 'Thanks for letting us know.\nWe will sort it and confirm later.';
  const student = { mmsId: 'student_1', fullName: 'Alex Morgan', parentFirstName: 'Jamie', tutor: 'Taylor' };
  const draft = buildIncomingPlanningDraft({
    record: { suspectedCategory: 'one_off_absence', matchedMmsId: student.mmsId, matchedStudentName: student.fullName,
      messageAt: '2026-10-05T10:00:00Z', messageText: 'Please cancel the lesson on 14 October.' },
    student, replyTemplate: acknowledgement,
  });
  assert.equal(extractIncomingPlanningReply(draft), acknowledgement);
  assert.match(draft.notes, /Planning follow-up: Complete the work/u);
  assert.equal(draft.status, 'active');
  assert.match(draft.notes, /Lesson date: 2026-10-14/u);
  const finalConfirmation = buildPauseConfirmationMessage({ item: draft, student });
  assert.match(finalConfirmation, /have paused payment/u);
  assert.match(finalConfirmation, /14 October/u);
  assert.notEqual(finalConfirmation, acknowledgement);
});

test('legacy saved reply notes remain acknowledgement context without requiring a data migration', () => {
  const item = { notes: 'Original message\nSuggested reply (send manually in WhatsApp):\nThanks, we will sort it.' };
  assert.equal(extractIncomingPlanningReply(item), 'Thanks, we will sort it.');
});
