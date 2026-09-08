import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanningItemSaver } from '../../lib/admin/planning-save.mjs';
import { buildStructuredPausePlanningDraft } from '../../lib/admin/planning-helpers.mjs';
import {
  structuredPauseIdentity, planningSaveErrorBody, planningSaveClientError,
} from '../../lib/admin/planning-duplicate-helpers.mjs';
import { buildTutorAbsencePausePlanningItems } from '../../lib/admin/tutor-absence-helpers.mjs';
import { buildIncomingPlanningDraft } from '../../lib/admin/incoming-message-helpers.mjs';
import { persistIncomingPlanningConversion } from '../../lib/admin/incoming-conversion.mjs';

function pause(overrides = {}, dates = {}) {
  return {
    ...buildStructuredPausePlanningDraft({
      studentName: 'Example Student', lessonDate: '2026-09-15', ...dates,
    }),
    itemType: 'action', status: 'active', linkedStudentId: 'student_1',
    isPause: true, ...overrides,
  };
}

function harness(initial = []) {
  let rows = structuredClone(initial);
  const writes = [];
  const progress = [];
  const reads = [];
  let readError = null;
  const save = createPlanningItemSaver({
    getPlanningItemRows: async (options) => {
      reads.push(options);
      if (readError) throw readError;
      return structuredClone(rows);
    },
    upsertPlanningItemRow: async (row) => {
      writes.push(row);
      rows = [...rows.filter((entry) => entry.planningId !== row.planningId), row];
    },
    addPlanningProgress: async (entry) => progress.push(entry),
  });
  return { save, writes, progress, reads, setReadError: (error) => { readError = error; } };
}

test('shared save blocks an exact pause from another source before item or progress writes', async () => {
  const original = pause({ planningId: 'existing', linkedWorkflowId: 'tutor-absence' });
  const h = harness([original]);
  await assert.rejects(h.save({
    planningId: 'incoming_new',
    item: pause({ title: 'Different wording', linkedWorkflowId: 'incoming-message', owner: 'Tom' }),
    progressNote: 'Created from message',
  }), (error) => {
    assert.equal(error.status, 409);
    const body = planningSaveErrorBody(error);
    assert.deepEqual(body, {
      error: 'This pause already has a planning card.',
      code: 'DUPLICATE_PAUSE', duplicatePlanningId: 'existing',
    });
    assert.equal(planningSaveClientError(body).duplicatePlanningId, 'existing');
    return true;
  });
  assert.deepEqual(h.reads, [{ force: true }]);
  assert.equal(h.writes.length, 0);
  assert.equal(h.progress.length, 0);
});

test('simultaneous new IDs are serialized; only one exact card saves', async () => {
  const h = harness();
  const results = await Promise.allSettled([
    h.save({ item: pause() }), h.save({ item: pause() }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.duplicatePlanningId, results[0].value.planningId);
  assert.equal(h.writes.length, 1);
  // A rejected save does not poison subsequent work.
  await h.save({ item: pause({ linkedStudentId: 'student_2' }) });
  assert.equal(h.writes.length, 2);
});

test('the full linked-student set is compared without order, duplicates or whitespace', async () => {
  const h = harness([pause({ planningId: 'group', linkedStudentId: 'student_1,student_2' })]);
  await assert.rejects(h.save({
    item: pause({ linkedStudentIds: [' student_2 ', 'student_1', 'student_1'] }),
  }), { code: 'DUPLICATE_PAUSE' });
  await h.save({ item: pause() });
  await h.save({ item: pause({ linkedStudentIds: ['student_1', 'student_3'] }) });
  assert.equal(h.writes.length, 2);
});

test('range pauses require exact first and return dates; nearby dates and single lessons differ', async () => {
  const dates = { pauseType: 'range', firstPauseDate: '2026-09-15', returnDate: '2026-09-29' };
  const h = harness([pause({ planningId: 'range' }, dates)]);
  await assert.rejects(h.save({ item: pause({}, dates) }), { code: 'DUPLICATE_PAUSE' });
  await h.save({ item: pause({}, { ...dates, returnDate: '2026-10-06' }) });
  await h.save({ item: pause({}, { ...dates, firstPauseDate: '2026-09-22' }) });
  await h.save({ item: pause() });
  assert.equal(h.writes.length, 3);
});

test('done and parked history is neither matched nor rewritten; open inbox/waiting still count', async () => {
  for (const status of ['done', 'parked']) {
    const h = harness([pause({ planningId: 'history', status })]);
    await h.save({ item: pause() });
    assert.equal(h.writes.length, 1);
    assert.notEqual(h.writes[0].planningId, 'history');
    const open = harness([pause({ planningId: 'open' })]);
    await open.save({ item: pause({ status }) });
  }
  for (const status of ['inbox', 'waiting']) {
    const h = harness([pause({ planningId: 'open', status })]);
    await assert.rejects(h.save({ item: pause() }), { code: 'DUPLICATE_PAUSE' });
  }
});

test('same-card retries and note edits remain usable beside historical duplicates', async () => {
  const original = pause({ planningId: 'same', createdBy: 'original@example.com', createdAt: '2026-09-01T12:00:00Z' });
  const h = harness([original, pause({ planningId: 'old_duplicate' })]);
  const result = await h.save({
    planningId: 'same', item: { title: original.title, owner: 'Tom', notes: original.notes + '\nExtra note: review' },
    actorEmail: 'editor@example.com', progressNote: 'Updated owner',
  });
  assert.equal(result.createdBy, original.createdBy);
  assert.equal(result.createdAt, original.createdAt);
  assert.equal(result.linkedStudentId, original.linkedStudentId);
  assert.equal(result.owner, 'Tom');
  assert.equal(h.writes.length, 1);
  assert.equal(h.progress[0].progressType, 'note');
});

test('edits that introduce an exact duplicate are blocked, while parking an existing duplicate works', async () => {
  const original = pause({ planningId: 'edit' }, { lessonDate: '2026-09-22' });
  const h = harness([original, pause({ planningId: 'existing' })]);
  await assert.rejects(h.save({ planningId: 'edit', item: pause() }), { code: 'DUPLICATE_PAUSE' });
  await h.save({ planningId: 'existing', item: { title: 'Parked', status: 'parked' } });
  assert.equal(h.writes.length, 1);
});

test('missing, malformed, conflicting and general-card evidence does not establish exact identity', () => {
  for (const item of [
    pause({ isPause: false }),
    pause({ linkedStudentId: '' }),
    pause({ notes: 'Pause next Tuesday' }),
    pause({ notes: 'Pause type: single lesson.\nLesson date: 2026-02-30.' }),
    pause({ notes: 'Pause type: single lesson.\nLesson date: 2026-09-15.\nLesson date: 2026-09-22.' }),
    pause({ notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-09-15.' }),
    pause({ notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-09-15.\nReturning from date: 2026-09-01.' }),
    pause({ notes: 'Pause type: single lesson.\nLesson date: 2026-09-15.\nReturning from date: 2026-09-29.' }),
  ]) assert.equal(structuredPauseIdentity(item), '');
  assert.ok(structuredPauseIdentity(pause({ isPause: '' })), 'legacy inferred structured pauses remain covered');
});

test('a fresh-read failure prevents writes and the saver can recover', async () => {
  const h = harness();
  h.setReadError(new Error('Fresh Sheets evidence unavailable'));
  await assert.rejects(h.save({ item: pause() }), /Fresh Sheets evidence unavailable/);
  assert.equal(h.writes.length, 0);
  h.setReadError(null);
  await h.save({ item: pause() });
  assert.equal(h.writes.length, 1);
});

test('duplicate incoming conversion leaves the inbox open and preserves the existing plan', async () => {
  const h = harness([pause({ planningId: 'manual_existing' })]);
  let inboxWrites = 0;
  await assert.rejects(persistIncomingPlanningConversion({
    corrected: { incomingId: 'second_message', status: 'needs_review' },
    planningId: 'incoming_second_message',
    draft: buildIncomingPlanningDraft({
      record: {
        suspectedCategory: 'one_off_absence', matchedMmsId: 'student_1',
        matchedStudentName: 'Example Student', messageText: 'Cannot attend on 15 September 2026.',
        messageAt: '2026-09-08T12:00:00Z',
      },
    }),
  }, {
    savePlanningItem: h.save,
    upsertIncomingMessage: async () => { inboxWrites += 1; },
  }), { code: 'DUPLICATE_PAUSE', duplicatePlanningId: 'manual_existing' });
  assert.equal(inboxWrites, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.progress.length, 0);
});

test('ordinary non-pause cards and successful progress retain existing save behavior', async () => {
  const h = harness();
  for (let i = 0; i < 2; i += 1) {
    await h.save({ item: { title: 'Review next term', linkedStudentId: 'student_1' }, progressNote: 'Captured' });
  }
  assert.equal(h.writes.length, 2);
  assert.equal(h.progress.length, 2);
  assert.equal(h.progress[0].skipItemTouch, true);
});

test('a real generated tutor-absence draft collides with the same manually captured pause', async () => {
  const [plan] = buildTutorAbsencePausePlanningItems({
    absenceId: 'absence_fixture', tutorShortName: 'Tutor', tutorName: 'Example Tutor',
    absenceDate: '2026-09-15',
    lessons: [{
      eventId: 'event_fixture', studentMmsId: 'student_1', studentName: 'Example Student',
      lessonDate: '2026-09-15', paymentExpectation: 'stripe_active_expected',
    }],
  });
  const h = harness([pause({ planningId: 'manual' })]);
  await assert.rejects(h.save(plan), { code: 'DUPLICATE_PAUSE', duplicatePlanningId: 'manual' });
  assert.equal(h.writes.length, 0);
});

test('separate route module instances share the process queue', async () => {
  const otherModule = await import('../../lib/admin/planning-save.mjs?second-route');
  const rows = [];
  const dependencies = {
    getPlanningItemRows: async () => structuredClone(rows),
    upsertPlanningItemRow: async (row) => { rows.push(row); },
    addPlanningProgress: async () => {},
  };
  const first = createPlanningItemSaver(dependencies);
  const second = otherModule.createPlanningItemSaver(dependencies);
  const results = await Promise.allSettled([
    first({ item: pause() }), second({ item: pause() }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(results[1].reason.code, 'DUPLICATE_PAUSE');
});
