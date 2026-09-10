import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorAbsenceWorkflowSaver } from '../../lib/admin/tutor-absence-save.mjs';
import { createPlanningItemSaver } from '../../lib/admin/planning-save.mjs';
import { buildTutorAbsencePlanningId, buildTutorAbsencePlanningItem } from '../../lib/admin/planning-helpers.mjs';

const tutor = { shortName: 'TutorA', fullName: 'Tutor A' };
const date = '2026-09-11';
const planningId = buildTutorAbsencePlanningId(tutor.shortName, date);
const lessons = Array.from({ length: 5 }, (_, i) => ({ eventId: 'lesson_' + i }));
const input = {
  absenceId: 'tutor_absence:TutorA:' + date,
  tutorShortName: tutor.shortName,
  tutorName: tutor.fullName,
  absenceDate: date,
  status: 'resolved',
  decision: 'cover',
  coverTutorName: 'Cover Tutor',
  affectedLessons: lessons,
  messageState: {
    ...Object.fromEntries(lessons.map(l => [l.eventId, { messaged: true }])),
    __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true, calendarUpdated: true },
  },
  updatedBy: 'admin@example.test',
};
const capture = {
  ...buildTutorAbsencePlanningItem({ tutor, absenceDate: date }),
  planningId,
  status: 'waiting',
  notes: 'Original captured context',
  owner: 'Finn',
};

function harness(initialCards = [capture]) {
  const state = {
    cards: structuredClone(initialCards), absences: [], progress: [], reads: [],
    failPlanningWrite: false, failRead: false, failAbsenceWrite: false,
    pauseCalls: 0, noticeCalls: 0,
  };
  const getPlanningItemRows = async options => {
    state.reads.push(options);
    if (state.failRead) throw new Error('Sheets unavailable');
    return structuredClone(state.cards);
  };
  const savePlanningItem = createPlanningItemSaver({
    getPlanningItemRows,
    upsertPlanningItemRow: async row => {
      if (state.failPlanningWrite) throw new Error('Planning unavailable');
      state.cards = state.cards.filter(c => c.planningId !== row.planningId).concat(row);
    },
    addPlanningProgress: async row => { state.progress.push(row); },
  });
  const save = createTutorAbsenceWorkflowSaver({
    getTutorAbsenceStateRows: async id => state.absences.filter(r => r.absenceId === id),
    upsertTutorAbsenceStateRow: async row => {
      if (state.failAbsenceWrite) throw new Error('Absence unavailable');
      state.absences = state.absences.filter(r => r.absenceId !== row.absenceId).concat(row);
    },
    createStructuredPausePlanningFromCancellation: async () => {
      state.pauseCalls++;
      if (state.pauseError) throw state.pauseError;
      return [];
    },
    syncTutorAbsenceEarlyNoticePlanning: async () => {
      state.noticeCalls++;
      return { createdPlanningIds: [], createdFinalConfirmationIds: [] };
    },
    getPlanningItemRows, savePlanningItem,
  });
  return { save, state };
}

test('resolving completed cover closes only its existing dated capture and appends actor history', async () => {
  const other = { ...capture, planningId: buildTutorAbsencePlanningId(tutor.shortName, '2026-09-12') };
  const { save, state } = harness([capture, other]);
  const result = await save(input);
  const closed = state.cards.find(c => c.planningId === planningId);
  assert.equal(result.resolvedPlanningId, planningId);
  assert.equal(state.absences[0].status, 'resolved');
  assert.equal(closed.status, 'done');
  assert.equal(closed.isPause, 'false');
  assert.equal(closed.notes, capture.notes);
  assert.equal(closed.owner, 'Finn');
  assert.equal(state.cards.find(c => c.planningId === other.planningId).status, 'waiting');
  assert.match(closed.outcome, /Covered/);
  assert.equal(state.progress.length, 1);
  assert.equal(state.progress[0].actorEmail, input.updatedBy);
  assert.ok(state.reads.every(options => options.force === true));
  assert.equal(state.noticeCalls, 0);
});

test('saving complete cover progress alone does not resolve the card', async () => {
  const { save, state } = harness();
  await save({ ...input, status: 'in_progress' });
  assert.equal(state.cards[0].status, 'waiting');
  assert.equal(state.reads.length, 0);
});

for (const missing of ['coverTutorName', 'coverTutorConfirmed', 'coverTutorBriefed', 'calendarUpdated', 'messaged']) {
  test('resolution refuses missing ' + missing + ' before any writes', async () => {
    const { save, state } = harness();
    const incomplete = structuredClone(input);
    if (missing === 'coverTutorName') incomplete.coverTutorName = '';
    else if (missing === 'messaged') incomplete.messageState.lesson_4.messaged = false;
    else incomplete.messageState.__workflow[missing] = false;
    await assert.rejects(save(incomplete), { code: 'TUTOR_ABSENCE_NOT_READY' });
    assert.equal(state.absences.length, 0);
    assert.equal(state.cards[0].status, 'waiting');
    assert.equal(state.progress.length, 0);
    assert.equal(state.pauseCalls, 0);
  });
}

for (const status of ['inbox', 'active', 'waiting']) {
  test('explicit resolve completes an open ' + status + ' capture', async () => {
    const { save, state } = harness([{ ...capture, status }]);
    await save(input);
    assert.equal(state.cards[0].status, 'done');
  });
}

for (const [label, cards] of [
  ['missing', []],
  ['parked', [{ ...capture, status: 'parked' }]],
  ['done', [{ ...capture, status: 'done' }]],
  ['unknown status', [{ ...capture, status: 'deferred' }]],
  ['different workflow', [{ ...capture, linkedWorkflowId: 'other' }]],
  ['different tutor', [{ ...capture, linkedTutorId: 'TutorB' }]],
]) {
  test('preserves ' + label + ' capture without creating a replacement', async () => {
    const { save, state } = harness(cards);
    await save(input);
    assert.deepEqual(state.cards, cards);
    assert.equal(state.progress.length, 0);
  });
}

test('a failed Planning write reports partial success and retries even when absence is already resolved', async () => {
  const { save, state } = harness();
  state.failPlanningWrite = true;
  await assert.rejects(save(input), error =>
    error.code === 'TUTOR_ABSENCE_PLANNING_SYNC_FAILED'
    && error.status === 503 && /saved as resolved.*retry/.test(error.message));
  assert.equal(state.absences[0].status, 'resolved');
  assert.equal(state.cards[0].status, 'waiting');
  const resolvedAt = state.absences[0].resolvedAt;
  state.failPlanningWrite = false;
  await save(input);
  await save(input);
  assert.equal(state.absences[0].resolvedAt, resolvedAt);
  assert.equal(state.cards[0].status, 'done');
  assert.equal(state.progress.length, 1);
});

test('failed fresh Planning read does not guess completion and can be retried', async () => {
  const { save, state } = harness();
  state.failRead = true;
  await assert.rejects(save(input), { code: 'TUTOR_ABSENCE_PLANNING_SYNC_FAILED' });
  assert.equal(state.cards[0].status, 'waiting');
  assert.equal(state.progress.length, 0);
  state.failRead = false;
  await save(input);
  assert.equal(state.cards[0].status, 'done');
});

test('failed absence write never closes the card', async () => {
  const { save, state } = harness();
  state.failAbsenceWrite = true;
  await assert.rejects(save(input), /Absence unavailable/);
  assert.equal(state.cards[0].status, 'waiting');
  assert.equal(state.reads.length, 0);
});

test('explicit cancellation resolution also closes capture only after payment and message guard', async () => {
  const { save, state } = harness();
  const cancelled = { ...input, decision: 'cancel_day' };
  await assert.rejects(save(cancelled), { code: 'TUTOR_ABSENCE_NOT_READY' });
  await save({
    ...cancelled,
    messageState: Object.fromEntries(lessons.map(l => [l.eventId, { messaged: true, pauseSkipped: true }])),
  });
  assert.equal(state.cards[0].status, 'done');
  assert.match(state.cards[0].outcome, /Cancelled/);
  assert.equal(state.noticeCalls, 1);
});

test('duplicate pause partial-success response survives the saver extraction', async () => {
  const { save, state } = harness();
  state.pauseError = Object.assign(new Error('Duplicate'), {
    code: 'DUPLICATE_PAUSE', status: 409, duplicatePlanningId: 'existing_pause',
  });
  await assert.rejects(save({ ...input, decision: 'cancel_day', status: 'pause_handoff' }), error =>
    error.code === 'DUPLICATE_PAUSE' && error.duplicatePlanningId === 'existing_pause'
    && /decision saved/.test(error.message));
  assert.equal(state.absences[0].status, 'pause_handoff');
  assert.equal(state.cards[0].status, 'waiting');
});
