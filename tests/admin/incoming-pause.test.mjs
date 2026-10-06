import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenIncomingPause, selectIncomingPauseSource, buildReviewedIncomingPauseDraft } from '../../lib/admin/incoming-pause-helpers.mjs';
import { extractIncomingPlanningReply } from '../../lib/admin/planning-client-helpers.mjs';
import { createIncomingPauseSaver } from '../../lib/admin/incoming-pause-save.mjs';

const row = { incomingId: 'incoming_a', status: 'inbox', groupType: 'student', chatId: 'chat', senderPhone: 'synthetic',
  senderName: 'Jamie', matchedMmsId: 'student-a', suspectedCategory: 'general', messageAt: '2026-10-05T10:00:00Z',
  messageText: 'Alex is off for the half term break next week. Thanks', chatName: 'Alex lessons' };
const student = { mmsId: 'student-a', fullName: 'Alex Morgan' };
const acknowledgement = 'Thanks for letting us know. We’ll take a look and confirm once it’s sorted.';
const acknowledgementConfirmation = { mode: 'sent', reply: acknowledgement, openedAt: '2026-10-05T10:00:00Z', confirmedAt: '2026-10-05T10:01:00Z' };
const pauseDetails = { pauseType: 'single', lessonDate: '2026-10-15' };

function harness(rows = [row], overrides = {}) {
  const calls = [];
  const saver = createIncomingPauseSaver({
    getIncomingMessageInboxRows: async input => { calls.push(['read', input]); return rows; },
    getOperationalAdminStudents: async () => [student],
    savePlanningItem: async input => { calls.push(['plan', input]); return { ...input.item, planningId: input.planningId }; },
    upsertIncomingMessageInboxRow: async value => { calls.push(['source', value]); },
    batchUpsertIncomingMessageInboxRows: async value => { calls.push(['siblings', value]); },
    ...overrides,
  });
  return { calls, saver, input: { incomingId: row.incomingId, snapshots: selectIncomingPauseSource(rows, row.incomingId).snapshots,
    studentId: student.mmsId, pauseDetails, acknowledgement, acknowledgementConfirmation, actorEmail: 'admin@example.com' } };
}

test('all stored parent absence types and clear absence wording open the pause builder without changing classification', () => {
  for (const category of ['one_off_absence', 'extended_absence', 'summer_break', 'absence_pause']) assert.equal(shouldOpenIncomingPause({ ...row, suspectedCategory: category }), true);
  for (const messageText of [row.messageText, 'Nico will be away next week.', 'Alma is off next week.', 'Please cancel his lesson on Friday.']) assert.equal(shouldOpenIncomingPause({ ...row, messageText }), true);
  assert.equal(shouldOpenIncomingPause({ ...row, messageText: 'I cannot make payment this month.' }), false);
  assert.equal(shouldOpenIncomingPause({ ...row, messageText: 'Please stop lessons. He cannot attend any more.' }), false);
  assert.equal(row.suspectedCategory, 'general');
  assert.equal(shouldOpenIncomingPause({ ...row, messageText: 'Can we change to Tuesday?' }), false);
  assert.equal(shouldOpenIncomingPause({ ...row, groupType: 'tutor', suspectedCategory: 'extended_absence' }), false);
});

test('opening only returns the original evidence and builder defaults; an away boundary is not silently made a lesson date', () => {
  const context = selectIncomingPauseSource([row], row.incomingId);
  assert.equal(context.source.messageText, row.messageText);
  assert.equal(context.options.showPauseBuilder, true);
  assert.equal(context.options.pauseLessonDate, '');
  assert.equal(context.options.pauseFirstPauseDate, '2026-10-12');
  assert.equal(row.status, 'inbox');
  const exact = selectIncomingPauseSource([{ ...row, suspectedCategory: 'one_off_absence', messageText: 'Alex will miss his lesson on 15 October.' }], row.incomingId);
  assert.equal(exact.options.pauseLessonDate, '2026-10-15');
});

test('a linked or settled message never opens a new creation draft', () => {
  assert.deepEqual(selectIncomingPauseSource([{ ...row, createdPlanningId: 'existing', status: 'converted' }], row.incomingId), { linkedPlanningId: 'existing' });
  assert.throws(() => selectIncomingPauseSource([{ ...row, status: 'ignored' }], row.incomingId), /no longer open/);
});

test('the reviewed draft is always a dated structured pause, retaining source and distinct acknowledgement', () => {
  const draft = buildReviewedIncomingPauseDraft({ source: row, student, pauseDetails, acknowledgement, acknowledgementConfirmation });
  assert.equal(draft.isPause, true); assert.equal(draft.status, 'active'); assert.equal(draft.linkedStudentId, student.mmsId);
  assert.match(draft.title, /Pause Alex Morgan lesson/);
  assert.match(draft.notes, /Lesson date: 2026-10-15/);
  assert.ok(draft.notes.includes(row.messageText)); assert.ok(draft.notes.includes(acknowledgement));
  assert.equal(extractIncomingPlanningReply(draft), acknowledgement);
  assert.throws(() => buildReviewedIncomingPauseDraft({ source: row, pauseDetails, acknowledgement, acknowledgementConfirmation }), /Choose a student/);
  for (const invalid of [{ pauseType: 'single' }, { pauseType: 'single', lessonDate: '2026-02-30' }, { pauseType: 'range', firstPauseDate: '2026-10-15', returnDate: '2026-10-12' }]) {
    assert.throws(() => buildReviewedIncomingPauseDraft({ source: row, student, pauseDetails: invalid, acknowledgement, acknowledgementConfirmation }));
  }
});

test('only a successful reviewed save links/removes the source; no provider or final-completion action occurs', async () => {
  const { calls, saver, input } = harness();
  const result = await saver(input);
  assert.equal(result.planningId, 'planning_incoming_a');
  assert.deepEqual(calls.map(([type]) => type), ['read', 'plan', 'source']);
  assert.equal(calls[0][1].force, true);
  assert.equal(calls[2][1].createdPlanningId, result.planningId); assert.equal(calls[2][1].status, 'converted');
  assert.equal(calls[1][1].item.status, 'active');
  assert.equal(calls[1][1].item.paymentExpectation, undefined);
});

test('failed pause saves and stale source edits leave messages open and create no generic fallback', async () => {
  const { calls, saver, input } = harness([row], { savePlanningItem: async () => { throw new Error('Sheets unavailable'); } });
  await assert.rejects(saver(input), /Sheets unavailable/);
  assert.deepEqual(calls.map(([type]) => type), ['read']); assert.equal(row.status, 'inbox');
  const changed = harness(); changed.input.snapshots[0].messageText = 'Old text';
  await assert.rejects(changed.saver(changed.input), /message or student changed/);
  assert.deepEqual(changed.calls.map(([type]) => type), ['read']);
});

test('retry of an already linked source returns the exact card without recreating or editing it', async () => {
  const linked = { ...row, status: 'converted', createdPlanningId: 'planning_incoming_a' };
  const { calls, saver } = harness([linked]);
  const result = await saver({ incomingId: row.incomingId });
  assert.equal(result.planningId, linked.createdPlanningId); assert.equal(result.alreadyCreated, true);
  assert.deepEqual(calls.map(([type]) => type), ['read']);
});

test('burst linking handles only reviewed source messages and reports partial success explicitly', async () => {
  const sibling = { ...row, incomingId: 'incoming_b', messageText: 'Thanks!', messageAt: '2026-10-05T10:01:00Z' };
  const { calls, saver, input } = harness([sibling, row]);
  await saver(input);
  const written = calls.find(([type]) => type === 'siblings')[1];
  assert.deepEqual(written.map(entry => entry.incomingId), ['incoming_b']);
  assert.equal(written[0].createdPlanningId, 'planning_incoming_a');
  const partial = harness([sibling, row], { batchUpsertIncomingMessageInboxRows: async () => { throw new Error('write failed'); } });
  const result = await partial.saver(partial.input);
  assert.equal(result.planningId, 'planning_incoming_a'); assert.match(result.warning, /pause is saved/);
});


test('the server rejects unconfirmed or changed acknowledgements before any pause or inbox write', async () => {
  for (const confirmation of [undefined, {mode: 'copied'}, {...acknowledgementConfirmation, reply: 'Different draft'}]) {
    const { calls, saver, input } = harness();
    input.acknowledgementConfirmation = confirmation;
    await assert.rejects(saver(input), /acknowledgement|Confirm/u);
    assert.deepEqual(calls.map(([type]) => type), ['read']);
  }
});

test('already acknowledged saves the human decision without claiming the unsent template was delivered', async () => {
  const { calls, saver, input } = harness();
  input.acknowledgementConfirmation = {mode: 'already_acknowledged', confirmedAt: '2026-10-05T10:01:00Z'};
  await saver(input);
  const draft = calls.find(([type]) => type === 'plan')[1].item;
  assert.match(draft.notes, /Already acknowledged in WhatsApp/u);
  assert.doesNotMatch(draft.notes, /We’ll take a look and confirm/u);
  assert.match(draft.notes, /admin@example.com/u);
  assert.equal(draft.status, 'active');
  assert.equal(draft.paymentExpectation, undefined);
});


test('malformed source snapshots fail before any write', async () => {
  const {calls,saver,input}=harness();
  input.snapshots=[null];
  await assert.rejects(saver(input), error=>error.status===400);
  assert.deepEqual(calls.map(([type])=>type), ['read']);
});
