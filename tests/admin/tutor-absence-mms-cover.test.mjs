import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMmsCoverTargets, validateMmsCoverEvent } from '../../lib/admin/tutor-absence-mms-cover-helpers.mjs';
import { createMmsCoverApplier } from '../../lib/admin/tutor-absence-mms-cover.mjs';

const absent = { shortName: 'finn', teacherId: 'tch_Finn' };
const cover = { shortName: 'arion', teacherId: 'tch_Arion' };
const startAt = '2026-09-30T10:00:00';
function state(lessons = [{ eventId: 'evt_One', studentMmsId: 'sdt_One', lessonDate: '2026-09-30', startAt, durationMinutes: '30' }]) {
  return {
    absenceId: 'absence_finn_2026-09-30', tutorShortName: 'finn', coverTutorShortName: 'arion',
    absenceDate: '2026-09-30', decision: 'cover', status: 'in_progress', updatedAt: 'version-1',
    affectedLessons: lessons, messageState: { __workflow: { coverTutorConfirmed: true } },
  };
}
function event(id = 'evt_One', students = ['sdt_One']) {
  return {
    ID: id, StartDate: startAt, Duration: 30, Recurring: false, TeacherID: absent.teacherId,
    OriginalTeacherID: absent.teacherId, Attendances: students.map((StudentID) => ({ StudentID })),
  };
}

test('group bookings become one exact event target and require the complete student set', () => {
  const lessons = ['sdt_One', 'sdt_Two'].map((studentMmsId) => ({ eventId: 'evt_One', studentMmsId, lessonDate: '2026-09-30', startAt, durationMinutes: '30' }));
  const [target] = buildMmsCoverTargets({ state: state(lessons), absentTutor: absent, coverTutor: cover });
  assert.deepEqual(target.studentIds, ['sdt_One', 'sdt_Two']);
  assert.equal(validateMmsCoverEvent({ event: event('evt_One', ['sdt_Two', 'sdt_One']), target, absentTeacherId: absent.teacherId, coverTeacherId: cover.teacherId }), 'needs_update');
  assert.throws(() => validateMmsCoverEvent({ event: event(), target, absentTeacherId: absent.teacherId, coverTeacherId: cover.teacherId }), /students.*changed/);
});

test('refuses recurring, moved and differently covered events', () => {
  const [target] = buildMmsCoverTargets({ state: state(), absentTutor: absent, coverTutor: cover });
  for (const changed of [{ Recurring: true }, { StartDate: '2026-09-30T11:00:00' }, { Duration: 45 }, { TeacherID: 'tch_Other' }]) {
    assert.throws(() => validateMmsCoverEvent({ event: { ...event(), ...changed }, target, absentTeacherId: absent.teacherId, coverTeacherId: cover.teacherId }));
  }
});

test('checks all events before writing and retries only outstanding changes', async () => {
  const lessons = ['evt_One', 'evt_Two'].map((eventId) => ({ eventId, studentMmsId: 'sdt_One', lessonDate: '2026-09-30', startAt, durationMinutes: '30' }));
  let saved = state(lessons);
  const events = new Map([['evt_One', event('evt_One')], ['evt_Two', event('evt_Two')]]);
  const writes = [];
  const logs = [];
  const apply = createMmsCoverApplier({
    loadState: async () => saved,
    loadTutors: async () => [absent, cover],
    readEvent: async (id) => ({ ...events.get(id) }),
    writeEvent: async ({ event: item, teacherId }) => {
      writes.push(item.ID);
      if (item.ID === 'evt_Two' && writes.length === 2) throw new Error('MMS unavailable');
      events.set(item.ID, { ...item, TeacherID: teacherId });
    },
    appendEvent: async (row) => logs.push(row.eventType),
    saveState: async (next) => { saved = next; },
  });
  const first = await apply({ absenceId: saved.absenceId, expectedUpdatedAt: saved.updatedAt, actorEmail: 'admin@example.test' });
  assert.equal(first.complete, false);
  assert.deepEqual(writes, ['evt_One', 'evt_Two']);
  assert.equal(saved.messageState.__workflow.calendarUpdated, undefined);
  const retry = await apply({ absenceId: saved.absenceId, expectedUpdatedAt: saved.updatedAt, actorEmail: 'admin@example.test' });
  assert.equal(retry.complete, true);
  assert.deepEqual(writes, ['evt_One', 'evt_Two', 'evt_Two']);
  assert.equal(saved.messageState.__workflow.calendarUpdated, true);
  assert.equal(logs.filter((type) => type === 'tutor_absence_substitute_applied').length, 2);
});

test('a stale save or preflight conflict sends no MMS writes', async () => {
  let writes = 0;
  const apply = createMmsCoverApplier({
    loadState: async () => state([{ eventId: 'evt_One', studentMmsId: 'sdt_One', lessonDate: '2026-09-30', startAt, durationMinutes: '30' }]),
    loadTutors: async () => [absent, cover],
    readEvent: async () => ({ ...event(), Recurring: true }),
    writeEvent: async () => { writes += 1; },
    appendEvent: async () => {}, saveState: async () => {},
  });
  await assert.rejects(() => apply({ absenceId: 'x', expectedUpdatedAt: 'older' }), /changed/);
  await assert.rejects(() => apply({ absenceId: 'x', expectedUpdatedAt: 'version-1' }), /Recurring/);
  assert.equal(writes, 0);
});

test('a conflict on the second event blocks the entire day before the first PUT', async () => {
  const lessons = ['evt_One', 'evt_Two'].map((eventId) => ({ eventId, studentMmsId: 'sdt_One', lessonDate: '2026-09-30', startAt, durationMinutes: '30' }));
  let writes = 0;
  const apply = createMmsCoverApplier({
    loadState: async () => state(lessons), loadTutors: async () => [absent, cover],
    readEvent: async (id) => ({ ...event(id), TeacherID: id === 'evt_Two' ? 'tch_Other' : absent.teacherId }),
    writeEvent: async () => { writes += 1; }, appendEvent: async () => {}, saveState: async () => {},
  });
  await assert.rejects(() => apply({ absenceId: 'x', expectedUpdatedAt: 'version-1' }), /different tutor/);
  assert.equal(writes, 0);
});
