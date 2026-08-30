import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessLessonMirrorStatus,
  getLessonOccurrenceObservations,
  getLessonMirrorParityReport,
  getLessonMirrorStatus,
  lessonMirrorFailureCode,
  persistLessonMirrorSnapshot,
} from '../../lib/admin/lesson-mirror-store.mjs';
import { normaliseMmsLessonMirror } from '../../lib/admin/lesson-mirror-helpers.mjs';

function fakeDatabase({ failPattern = null } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      const text = `${sql}`;
      calls.push({ sql: text, params });
      const placeholders = [...text.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
      assert.equal(params.length, placeholders.length ? Math.max(...placeholders) : 0,
        'every PostgreSQL bind parameter must be used and typed by the statement');
      if (failPattern && text.includes(failPattern)) throw new Error('injected database failure');
      if (text.includes('SELECT i."provider"')) return { rows: [] };
      if (text.includes("SET status = 'succeeded'")) return { rows: [{ sync_run_id: params[0], status: 'succeeded' }] };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  return {
    calls,
    get released() { return released; },
    connect: async () => client,
  };
}

function snapshot() {
  return normaliseMmsLessonMirror({
    calendarRows: [{
      ID: 'evt_1',
      SeriesID: 'ser_1',
      StartDate: '2026-08-10T16:00:00',
      Duration: 30,
      Attendances: [{ ID: 'att_1', StudentID: 'sdt_1', AttendanceStatus: 'Present' }],
    }],
  });
}

test('lesson mirror persistence locks and commits all current rows, revisions, refs, and run outcome together', async () => {
  const database = fakeDatabase();
  const result = await persistLessonMirrorSnapshot({
    syncRunId: '00000000-0000-4000-8000-000000000003',
    observedAt: '2026-08-10T09:00:02Z',
    calendarExpectedCount: 1,
    calendarReceivedCount: 1,
    attendanceExpectedCount: 1,
    attendanceReceivedCount: 1,
    snapshot: snapshot(),
    database,
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(database.calls[0].sql, 'BEGIN');
  assert.match(database.calls[1].sql, /pg_advisory_xact_lock/u);
  assert.ok(database.calls.some((call) => call.sql.includes('INSERT INTO fc_lesson_series')));
  assert.ok(database.calls.some((call) => call.sql.includes('INSERT INTO fc_lesson_events')));
  assert.ok(database.calls.some((call) => call.sql.includes('INSERT INTO fc_lesson_participations')));
  assert.ok(database.calls.some((call) => call.sql.includes('INSERT INTO fc_lesson_external_refs')));
  assert.ok(database.calls.some((call) => call.sql.includes('INSERT INTO fc_lesson_revisions')));
  assert.equal(database.calls.at(-1).sql, 'COMMIT');
  assert.equal(database.released, true);

  const revisionQueries = database.calls.filter((call) => call.sql.includes('INSERT INTO fc_lesson_revisions'));
  assert.ok(revisionQueries.every((call) => call.sql.includes('IS DISTINCT FROM')),
    'repeated identical observations must not append revisions');
});

test('lesson mirror persistence rolls back the whole snapshot on any row failure', async () => {
  const database = fakeDatabase({ failPattern: 'INSERT INTO fc_lesson_participations' });
  await assert.rejects(
    persistLessonMirrorSnapshot({
      syncRunId: '00000000-0000-4000-8000-000000000004',
      observedAt: '2026-08-10T09:00:02Z',
      calendarExpectedCount: 1,
      calendarReceivedCount: 1,
      attendanceExpectedCount: 1,
      attendanceReceivedCount: 1,
      snapshot: snapshot(),
      database,
    }),
    /injected database failure/u,
  );
  assert.equal(database.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(database.calls.some((call) => call.sql === 'COMMIT'), false);
  assert.equal(database.released, true);
});

test('lesson mirror failures are stored as bounded categories rather than raw provider text', () => {
  assert.equal(lessonMirrorFailureCode(new Error('endpoint total changed from 10 to 11')), 'provider_snapshot_changed');
  assert.equal(lessonMirrorFailureCode(new Error('MMS did not report a valid total')), 'provider_result_incomplete');
  assert.equal(lessonMirrorFailureCode(new Error('MMS event has no wall-clock')), 'provider_row_invalid');
  assert.equal(lessonMirrorFailureCode(new Error('surprise')), 'sync_failed');
});

test('status keeps DATE values as written and chooses a deterministic latest run', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(`${sql}`);
      return { rows: [{ window_start: '2026-08-01', window_end_exclusive: '2026-08-29' }] };
    },
  };
  const status = await getLessonMirrorStatus({ database });
  assert.equal(status.window_start, '2026-08-01');
  assert.match(calls[0], /window_start::text AS window_start/u);
  assert.match(calls[0], /ORDER BY latest\.started_at DESC, latest\.sync_run_id DESC/u);
});

test('status assessment distinguishes never-run, failed, running, stuck, fresh, and stale', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  assert.equal(assessLessonMirrorStatus(null, { now }).state, 'never_run');
  assert.deepEqual(
    assessLessonMirrorStatus({ status: 'failed', completed_at: '2026-08-10T11:00:00Z', failure_code: 'provider_read_failed' }, { now }),
    { state: 'failed', ageMinutes: 60, failureCode: 'provider_read_failed' },
  );
  assert.equal(assessLessonMirrorStatus({ status: 'running', started_at: '2026-08-10T11:45:00Z' }, { now }).state, 'running');
  assert.equal(assessLessonMirrorStatus({ status: 'running', started_at: '2026-08-10T10:00:00Z' }, { now }).state, 'stuck');
  assert.equal(assessLessonMirrorStatus({ status: 'succeeded', completed_at: '2026-08-10T10:00:00Z' }, { now }).state, 'fresh');
  assert.equal(assessLessonMirrorStatus({ status: 'succeeded', completed_at: '2026-08-08T10:00:00Z' }, { now }).state, 'stale');
});

test('lesson occurrence reads are bounded to observations re-seen by the latest successful run', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      const text = `${sql}`;
      calls.push({ text, params });
      if (text.includes("WHERE latest.status = 'succeeded'")) {
        return { rows: [{
          sync_run_id: '00000000-0000-4000-8000-000000000021',
          status: 'succeeded',
          window_start: '2026-08-16',
          window_end_exclusive: '2026-10-12',
          started_at: '2026-08-30T05:45:00Z',
          completed_at: '2026-08-30T05:48:00Z',
        }] };
      }
      if (text.includes('FROM fc_lesson_sync_runs latest')) {
        return { rows: [{
          sync_run_id: '00000000-0000-4000-8000-000000000021',
          status: 'succeeded',
          window_start: '2026-08-16',
          window_end_exclusive: '2026-10-12',
          started_at: '2026-08-30T05:45:00Z',
          completed_at: '2026-08-30T05:48:00Z',
        }] };
      }
      if (text.includes('WITH verified_run AS')) {
        return { rows: [{
          fc_event_id: 'fc_lev_1',
          fc_series_id: 'fc_lsr_1',
          fc_participation_id: 'fc_lpt_1',
          local_date: '2026-09-03',
          local_time: '16:00:00',
          time_zone: 'Europe/London',
          duration_minutes: 30,
          source_status: 'Active',
          calendar_observed: true,
          attendance_observed: true,
          raw_attendance_status: 'Unrecorded',
          event_observed_at: '2026-08-30T05:48:00Z',
          participation_observed_at: '2026-08-30T05:48:00Z',
          mirror_observed_at: '2026-08-30T05:48:00Z',
          event_external_id: 'evt_1',
          attendance_external_id: 'att_1',
          student_external_id: 'sdt_1',
          tutor_external_id: 'tch_1',
          original_tutor_external_id: null,
        }] };
      }
      throw new Error('unexpected occurrence query');
    },
  };

  const read = await getLessonOccurrenceObservations({
    startDate: '2026-08-16',
    endDateExclusive: '2026-10-12',
    limit: 2000,
    database,
    now: new Date('2026-08-30T12:00:00Z'),
  });

  assert.equal(read.source.verified, true);
  assert.equal(read.source.coversRequestedWindow, true);
  assert.equal(read.observations[0].fcParticipationId, 'fc_lpt_1');
  assert.equal(read.observations[0].rawAttendanceStatus, 'Unrecorded');
  assert.equal(read.observations[0].eventExternalId, 'evt_1');
  const observationQuery = calls.find((call) => call.text.includes('WITH verified_run AS'));
  assert.deepEqual(observationQuery.params, [
    '00000000-0000-4000-8000-000000000021',
    '2026-08-16',
    '2026-10-12',
    2001,
  ]);
  assert.match(observationQuery.text, /event\.last_observed_at >= run\.started_at/u);
  assert.match(observationQuery.text, /participation\.last_observed_at >= run\.started_at/u);
  assert.match(observationQuery.text, /ORDER BY event\.local_date ASC, event\.local_time ASC/u);
  assert.doesNotMatch(observationQuery.text, /student_name|student_full_name|parent|email|phone/u);
});

test('lesson occurrence reads reject backwards, oversized, and unbounded requests before querying', async () => {
  const database = { async query() { throw new Error('must not query'); } };
  await assert.rejects(
    getLessonOccurrenceObservations({ startDate: '2026-09-01', endDateExclusive: '2026-08-31', database }),
    /between 1 and 90 days/u,
  );
  await assert.rejects(
    getLessonOccurrenceObservations({ startDate: '2026-01-01', endDateExclusive: '2026-08-31', database }),
    /between 1 and 90 days/u,
  );
  await assert.rejects(
    getLessonOccurrenceObservations({ startDate: '2026-08-01', endDateExclusive: '2026-08-31', limit: 5001, database }),
    /limit must be between 1 and 5000/u,
  );
  await assert.rejects(
    getLessonOccurrenceObservations({
      startDate: '2026-08-01',
      endDateExclusive: '2026-08-31',
      studentExternalIds: Array.from({ length: 101 }, (_, index) => `sdt_${index}`),
      database,
    }),
    /at most 100 identifiers/u,
  );
});

test('lesson occurrence reads can narrow the bounded window to named students', async () => {
  const calls = [];
  const run = {
    sync_run_id: '00000000-0000-4000-8000-000000000041',
    status: 'succeeded',
    window_start: '2026-08-01',
    window_end_exclusive: '2026-08-31',
    started_at: '2026-08-30T05:45:00Z',
    completed_at: '2026-08-30T05:48:00Z',
  };
  const database = {
    async query(sql, params = []) {
      const text = `${sql}`;
      calls.push({ text, params });
      if (text.includes("WHERE latest.status = 'succeeded'")) return { rows: [run] };
      if (text.includes('FROM fc_lesson_sync_runs latest')) return { rows: [run] };
      if (text.includes('WITH verified_run AS')) return { rows: [] };
      throw new Error('unexpected student-filter query');
    },
  };
  await getLessonOccurrenceObservations({
    startDate: '2026-08-01',
    endDateExclusive: '2026-08-31',
    studentExternalIds: ['sdt_1', 'sdt_1', 'sdt_2'],
    limit: 20,
    database,
    now: new Date('2026-08-30T12:00:00Z'),
  });
  const observationQuery = calls.find((call) => call.text.includes('WITH verified_run AS'));
  assert.match(observationQuery.text, /student_external_id = ANY\(\$4::text\[\]\)/u);
  assert.match(observationQuery.text, /LIMIT \$5::integer/u);
  assert.deepEqual(observationQuery.params, [run.sync_run_id, '2026-08-01', '2026-08-31', ['sdt_1', 'sdt_2'], 21]);
});

test('lesson occurrence reads hide an older successful snapshot after a newer failed run', async () => {
  let observationQueryRan = false;
  const database = {
    async query(sql) {
      const text = `${sql}`;
      if (text.includes("WHERE latest.status = 'succeeded'")) {
        return { rows: [{
          sync_run_id: '00000000-0000-4000-8000-000000000031',
          status: 'succeeded',
          window_start: '2026-08-16',
          window_end_exclusive: '2026-10-12',
          started_at: '2026-08-30T05:45:00Z',
          completed_at: '2026-08-30T05:48:00Z',
        }] };
      }
      if (text.includes('FROM fc_lesson_sync_runs latest')) {
        return { rows: [{
          sync_run_id: '00000000-0000-4000-8000-000000000032',
          status: 'failed',
          failure_code: 'attendance_total_mismatch',
          started_at: '2026-08-30T06:45:00Z',
          completed_at: '2026-08-30T06:48:00Z',
        }] };
      }
      if (text.includes('WITH verified_run AS')) observationQueryRan = true;
      throw new Error('unexpected stale occurrence query');
    },
  };

  const read = await getLessonOccurrenceObservations({
    startDate: '2026-08-16',
    endDateExclusive: '2026-10-12',
    database,
    now: new Date('2026-08-30T12:00:00Z'),
  });

  assert.equal(read.source.state, 'failed');
  assert.equal(read.source.verified, false);
  assert.equal(read.source.lastVerifiedAt, '2026-08-30T05:48:00.000Z');
  assert.deepEqual(read.observations, []);
  assert.equal(observationQueryRan, false);
});

test('parity report exposes bounded counts, revisions, raw statuses, and non-observation uncertainty', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      const text = `${sql}`;
      calls.push({ text, params });
      if (text.includes("WHERE latest.status = 'succeeded'")) {
        return { rows: [{
          sync_run_id: 'run-verified',
          status: 'succeeded',
          completed_at: '2026-08-11T05:00:00Z',
          calendar_expected_count: 10,
          calendar_received_count: 10,
          attendance_expected_count: 9,
          attendance_received_count: 9,
        }] };
      }
      if (text.includes('FROM fc_lesson_sync_runs latest')) {
        return { rows: [{
          sync_run_id: 'run-latest',
          status: 'failed',
          completed_at: '2026-08-11T06:00:00Z',
          failure_code: 'provider_read_failed',
        }] };
      }
      if (text.includes('WITH recent_runs AS')) {
        return { rows: [{ sync_run_id: 'run-1', events_changed: 2 }] };
      }
      if (text.includes('window_events AS')) {
        return { rows: [{ events_not_observed_latest: 1, participations_not_observed_latest: 2 }] };
      }
      if (text.includes('raw_attendance_status')) {
        return { rows: [{ status: 'Present', count: 7 }, { status: '(blank)', count: 2 }] };
      }
      throw new Error('unexpected parity query');
    },
  };
  const report = await getLessonMirrorParityReport({
    database,
    runLimit: 7,
    now: new Date('2026-08-11T12:00:00Z'),
  });

  assert.equal(report.assessment.state, 'failed');
  assert.equal(report.latestSuccessful.sync_run_id, 'run-verified');
  assert.equal(report.runs[0].events_changed, 2);
  assert.equal(report.metrics.events_not_observed_latest, 1);
  assert.deepEqual(report.attendanceStatuses, [{ status: 'Present', count: 7 }, { status: '(blank)', count: 2 }]);
  assert.deepEqual(calls.find((call) => call.text.includes('WITH recent_runs AS')).params, [7]);
  const sql = calls.map((call) => call.text).join('\n');
  assert.match(sql, /last_observed_at < latest\.started_at/u);
  assert.match(sql, /JOIN window_events event ON event\.fc_event_id = participation\.fc_event_id/u);
  assert.equal((sql.match(/WHERE status = 'succeeded'/gu) || []).length, 2);
  assert.doesNotMatch(sql, /student_name|student_full_name|parent/u);
});
