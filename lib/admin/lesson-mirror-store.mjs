/** @fileoverview Transactional PostgreSQL persistence and status reads for the rebuildable lesson mirror. */
import { Pool } from 'pg';

const SYNC_LOCK_NAME = 'first_chord_lesson_mirror_sync_v1';
let sharedPool = null;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function iso(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function getLessonMirrorDatabaseConfig(env = process.env) {
  const connectionString = clean(env.DATABASE_URL);
  return { connectionString, configured: Boolean(connectionString) };
}

function getPool(env = process.env) {
  const { connectionString } = getLessonMirrorDatabaseConfig(env);
  if (!connectionString) throw new Error('Lesson mirror database is not configured');
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
      max: 2,
      application_name: 'first-chord-lesson-mirror',
    });
  }
  return sharedPool;
}

export function getLessonMirrorDatabase(env = process.env) {
  return getPool(env);
}

function db(database, env) {
  return database || getPool(env);
}

export async function beginLessonMirrorSync({
  syncRunId,
  source = 'mms',
  triggerKind = 'manual',
  startDate,
  endDateExclusive,
  startedAt,
  database = null,
  env = process.env,
} = {}) {
  if (!clean(syncRunId) || !clean(startDate) || !clean(endDateExclusive) || !clean(startedAt)) {
    throw new Error('Lesson mirror sync ID, window, and start time are required');
  }
  const result = await db(database, env).query(`
    INSERT INTO fc_lesson_sync_runs (
      sync_run_id, source, trigger_kind, window_start, window_end_exclusive, status, started_at
    ) VALUES ($1::uuid, $2, $3, $4::date, $5::date, 'running', $6::timestamptz)
    RETURNING sync_run_id
  `, [syncRunId, source, triggerKind, startDate, endDateExclusive, startedAt]);
  if (!result.rows?.[0]) throw new Error('Lesson mirror sync run could not be started');
  return result.rows[0];
}

export function lessonMirrorFailureCode(error) {
  const message = clean(error?.message).toLowerCase();
  if (message.includes('total changed')) return 'provider_snapshot_changed';
  if (message.includes('reported') || message.includes('valid total') || message.includes('unverified') || message.includes('possibly-truncated')) {
    return 'provider_result_incomplete';
  }
  if (message.includes('event id') || message.includes('student id') || message.includes('wall-clock')) return 'provider_row_invalid';
  if (message.includes('database') || message.includes('relation') || message.includes('postgres')) return 'database_failed';
  if (message.includes('mms') || message.includes('fetch')) return 'provider_read_failed';
  return 'sync_failed';
}

export async function failLessonMirrorSync({
  syncRunId,
  error,
  completedAt,
  database = null,
  env = process.env,
} = {}) {
  const failureCode = lessonMirrorFailureCode(error);
  const result = await db(database, env).query(`
    UPDATE fc_lesson_sync_runs
    SET status = 'failed',
        failure_code = $2,
        failure_summary = 'Sync failed; inspect the operator command output for this run ID.',
        completed_at = $3::timestamptz
    WHERE sync_run_id = $1::uuid AND status = 'running'
    RETURNING sync_run_id, status, failure_code
  `, [syncRunId, failureCode, completedAt]);
  return result.rows?.[0] || null;
}

function seriesRecordset(parameter = '$1') {
  return `
  SELECT * FROM jsonb_to_recordset(${parameter}::jsonb) AS i(
    "fcSeriesId" TEXT,
    "observedRecurrence" JSONB,
    "stateHash" TEXT
  )
`;
}

function eventRecordset(parameter = '$1') {
  return `
  SELECT * FROM jsonb_to_recordset(${parameter}::jsonb) AS i(
    "fcEventId" TEXT,
    "fcSeriesId" TEXT,
    "localDate" DATE,
    "localTime" TIME,
    "timeZone" TEXT,
    "sourceStart" TEXT,
    "durationMinutes" INTEGER,
    "tutorExternalId" TEXT,
    "originalTutorExternalId" TEXT,
    "locationExternalId" TEXT,
    "locationName" TEXT,
    "categoryExternalId" TEXT,
    "categoryName" TEXT,
    "allDay" BOOLEAN,
    "sourceStatus" TEXT,
    "sourceRecurring" BOOLEAN,
    "sourceRecurrence" JSONB,
    "calendarObserved" BOOLEAN,
    "attendanceObserved" BOOLEAN,
    "stateHash" TEXT
  )
`;
}

function participationRecordset(parameter = '$1') {
  return `
  SELECT * FROM jsonb_to_recordset(${parameter}::jsonb) AS i(
    "fcParticipationId" TEXT,
    "fcEventId" TEXT,
    "studentExternalId" TEXT,
    "attendanceExternalId" TEXT,
    "rawAttendanceStatus" TEXT,
    "stateHash" TEXT
  )
`;
}

const EXTERNAL_REF_RECORDSET = `
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(
    "provider" TEXT,
    "referenceKind" TEXT,
    "externalId" TEXT,
    "entityKind" TEXT,
    "fcEntityId" TEXT
  )
`;

async function insertSeries(client, { syncRunId, observedAt, rows }) {
  const params = [syncRunId, JSON.stringify(rows), observedAt];
  await client.query(`
    WITH incoming AS (${seriesRecordset('$2')})
    INSERT INTO fc_lesson_revisions (
      sync_run_id, entity_kind, fc_entity_id, revision_kind, state_hash, snapshot, observed_at
    )
    SELECT $1::uuid, 'series', i."fcSeriesId",
           CASE WHEN current.fc_series_id IS NULL THEN 'created' ELSE 'changed' END,
           i."stateHash",
           jsonb_build_object('observedRecurrence', i."observedRecurrence"),
           $3::timestamptz
    FROM incoming i
    LEFT JOIN fc_lesson_series current ON current.fc_series_id = i."fcSeriesId"
    WHERE current.state_hash IS DISTINCT FROM i."stateHash"
  `, params);
  await client.query(`
    WITH incoming AS (${seriesRecordset()})
    INSERT INTO fc_lesson_series (
      fc_series_id, source, observed_recurrence, state_hash, first_observed_at, last_observed_at
    )
    SELECT i."fcSeriesId", 'mms', i."observedRecurrence", i."stateHash", $2::timestamptz, $2::timestamptz
    FROM incoming i
    ON CONFLICT (fc_series_id) DO UPDATE SET
      observed_recurrence = EXCLUDED.observed_recurrence,
      state_hash = EXCLUDED.state_hash,
      last_observed_at = EXCLUDED.last_observed_at
  `, [JSON.stringify(rows), observedAt]);
}

function eventSnapshotSql(alias = 'i') {
  return `jsonb_build_object(
    'fcSeriesId', ${alias}."fcSeriesId",
    'localDate', ${alias}."localDate",
    'localTime', ${alias}."localTime",
    'timeZone', ${alias}."timeZone",
    'sourceStart', ${alias}."sourceStart",
    'durationMinutes', ${alias}."durationMinutes",
    'tutorExternalId', ${alias}."tutorExternalId",
    'originalTutorExternalId', ${alias}."originalTutorExternalId",
    'locationExternalId', ${alias}."locationExternalId",
    'locationName', ${alias}."locationName",
    'categoryExternalId', ${alias}."categoryExternalId",
    'categoryName', ${alias}."categoryName",
    'allDay', ${alias}."allDay",
    'sourceStatus', ${alias}."sourceStatus",
    'sourceRecurring', ${alias}."sourceRecurring",
    'sourceRecurrence', ${alias}."sourceRecurrence",
    'calendarObserved', ${alias}."calendarObserved",
    'attendanceObserved', ${alias}."attendanceObserved"
  )`;
}

async function insertEvents(client, { syncRunId, observedAt, rows }) {
  const params = [syncRunId, JSON.stringify(rows), observedAt];
  await client.query(`
    WITH incoming AS (${eventRecordset('$2')})
    INSERT INTO fc_lesson_revisions (
      sync_run_id, entity_kind, fc_entity_id, revision_kind, state_hash, snapshot, observed_at
    )
    SELECT $1::uuid, 'event', i."fcEventId",
           CASE WHEN current.fc_event_id IS NULL THEN 'created' ELSE 'changed' END,
           i."stateHash", ${eventSnapshotSql('i')}, $3::timestamptz
    FROM incoming i
    LEFT JOIN fc_lesson_events current ON current.fc_event_id = i."fcEventId"
    WHERE current.state_hash IS DISTINCT FROM i."stateHash"
      AND (current.fc_event_id IS NULL OR i."calendarObserved")
  `, params);
  const insertParams = [JSON.stringify(rows), observedAt];
  await client.query(`
    WITH incoming AS (${eventRecordset()})
    INSERT INTO fc_lesson_events (
      fc_event_id, fc_series_id, source, local_date, local_time, time_zone, source_start,
      duration_minutes, tutor_external_id, original_tutor_external_id,
      location_external_id, location_name, category_external_id, category_name,
      all_day, source_status, source_recurring, source_recurrence,
      calendar_observed, attendance_observed, state_hash,
      first_observed_at, last_observed_at
    )
    SELECT i."fcEventId", i."fcSeriesId", 'mms', i."localDate", i."localTime", i."timeZone", i."sourceStart",
           i."durationMinutes", i."tutorExternalId", i."originalTutorExternalId",
           i."locationExternalId", i."locationName", i."categoryExternalId", i."categoryName",
           i."allDay", i."sourceStatus", i."sourceRecurring", i."sourceRecurrence",
           i."calendarObserved", i."attendanceObserved", i."stateHash",
           $2::timestamptz, $2::timestamptz
    FROM incoming i
    WHERE i."calendarObserved"
    ON CONFLICT (fc_event_id) DO UPDATE SET
      fc_series_id = EXCLUDED.fc_series_id,
      local_date = EXCLUDED.local_date,
      local_time = EXCLUDED.local_time,
      time_zone = EXCLUDED.time_zone,
      source_start = EXCLUDED.source_start,
      duration_minutes = EXCLUDED.duration_minutes,
      tutor_external_id = EXCLUDED.tutor_external_id,
      original_tutor_external_id = EXCLUDED.original_tutor_external_id,
      location_external_id = EXCLUDED.location_external_id,
      location_name = EXCLUDED.location_name,
      category_external_id = EXCLUDED.category_external_id,
      category_name = EXCLUDED.category_name,
      all_day = EXCLUDED.all_day,
      source_status = EXCLUDED.source_status,
      source_recurring = EXCLUDED.source_recurring,
      source_recurrence = EXCLUDED.source_recurrence,
      calendar_observed = TRUE,
      attendance_observed = fc_lesson_events.attendance_observed OR EXCLUDED.attendance_observed,
      state_hash = EXCLUDED.state_hash,
      last_observed_at = EXCLUDED.last_observed_at
  `, insertParams);
  await client.query(`
    WITH incoming AS (${eventRecordset()})
    INSERT INTO fc_lesson_events (
      fc_event_id, fc_series_id, source, local_date, local_time, time_zone, source_start,
      duration_minutes, tutor_external_id, original_tutor_external_id,
      location_external_id, location_name, category_external_id, category_name,
      all_day, source_status, source_recurring, source_recurrence,
      calendar_observed, attendance_observed, state_hash,
      first_observed_at, last_observed_at
    )
    SELECT i."fcEventId", i."fcSeriesId", 'mms', i."localDate", i."localTime", i."timeZone", i."sourceStart",
           i."durationMinutes", i."tutorExternalId", i."originalTutorExternalId",
           i."locationExternalId", i."locationName", i."categoryExternalId", i."categoryName",
           i."allDay", i."sourceStatus", i."sourceRecurring", i."sourceRecurrence",
           FALSE, TRUE, i."stateHash", $2::timestamptz, $2::timestamptz
    FROM incoming i
    WHERE NOT i."calendarObserved"
    ON CONFLICT (fc_event_id) DO UPDATE SET
      attendance_observed = TRUE,
      last_observed_at = EXCLUDED.last_observed_at
  `, insertParams);
}

async function insertParticipations(client, { syncRunId, observedAt, rows }) {
  const params = [syncRunId, JSON.stringify(rows), observedAt];
  await client.query(`
    WITH incoming AS (${participationRecordset('$2')})
    INSERT INTO fc_lesson_revisions (
      sync_run_id, entity_kind, fc_entity_id, revision_kind, state_hash, snapshot, observed_at
    )
    SELECT $1::uuid, 'participation', i."fcParticipationId",
           CASE WHEN current.fc_participation_id IS NULL THEN 'created' ELSE 'changed' END,
           i."stateHash",
           jsonb_build_object(
             'fcEventId', i."fcEventId",
             'studentExternalId', i."studentExternalId",
             'rawAttendanceStatus', i."rawAttendanceStatus"
           ),
           $3::timestamptz
    FROM incoming i
    LEFT JOIN fc_lesson_participations current
      ON current.fc_participation_id = i."fcParticipationId"
    WHERE current.state_hash IS DISTINCT FROM i."stateHash"
  `, params);
  await client.query(`
    WITH incoming AS (${participationRecordset()})
    INSERT INTO fc_lesson_participations (
      fc_participation_id, fc_event_id, student_external_id, attendance_external_id,
      raw_attendance_status, state_hash, first_observed_at, last_observed_at
    )
    SELECT i."fcParticipationId", i."fcEventId", i."studentExternalId", i."attendanceExternalId",
           i."rawAttendanceStatus", i."stateHash", $2::timestamptz, $2::timestamptz
    FROM incoming i
    ON CONFLICT (fc_participation_id) DO UPDATE SET
      attendance_external_id = COALESCE(EXCLUDED.attendance_external_id, fc_lesson_participations.attendance_external_id),
      raw_attendance_status = EXCLUDED.raw_attendance_status,
      state_hash = EXCLUDED.state_hash,
      last_observed_at = EXCLUDED.last_observed_at
  `, [JSON.stringify(rows), observedAt]);
}

async function insertExternalRefs(client, { observedAt, rows }) {
  const rowsJson = JSON.stringify(rows);
  const conflicts = await client.query(`
    WITH incoming AS (${EXTERNAL_REF_RECORDSET})
    SELECT i."provider", i."referenceKind", i."externalId"
    FROM incoming i
    JOIN fc_lesson_external_refs current
      ON current.provider = i."provider"
     AND current.reference_kind = i."referenceKind"
     AND current.external_id = i."externalId"
    WHERE current.entity_kind <> i."entityKind"
       OR current.fc_entity_id <> i."fcEntityId"
    LIMIT 1
  `, [rowsJson]);
  if (conflicts.rows?.[0]) {
    throw new Error('An external lesson reference is already attached to a different First Chord entity');
  }
  await client.query(`
    WITH incoming AS (${EXTERNAL_REF_RECORDSET})
    INSERT INTO fc_lesson_external_refs (
      provider, reference_kind, external_id, entity_kind, fc_entity_id,
      first_observed_at, last_observed_at
    )
    SELECT i."provider", i."referenceKind", i."externalId", i."entityKind", i."fcEntityId",
           $2::timestamptz, $2::timestamptz
    FROM incoming i
    ON CONFLICT (provider, reference_kind, external_id) DO UPDATE SET
      last_observed_at = EXCLUDED.last_observed_at
  `, [rowsJson, observedAt]);
}

export async function persistLessonMirrorSnapshot({
  syncRunId,
  observedAt,
  calendarExpectedCount,
  calendarReceivedCount,
  attendanceExpectedCount,
  attendanceReceivedCount,
  snapshot,
  database = null,
  env = process.env,
} = {}) {
  const pool = db(database, env);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SYNC_LOCK_NAME]);
    await insertSeries(client, { syncRunId, observedAt, rows: snapshot.series || [] });
    await insertEvents(client, { syncRunId, observedAt, rows: snapshot.events || [] });
    await insertParticipations(client, { syncRunId, observedAt, rows: snapshot.participations || [] });
    await insertExternalRefs(client, { observedAt, rows: snapshot.externalRefs || [] });
    const completed = await client.query(`
      UPDATE fc_lesson_sync_runs
      SET status = 'succeeded',
          calendar_expected_count = $2,
          calendar_received_count = $3,
          attendance_expected_count = $4,
          attendance_received_count = $5,
          series_count = $6,
          event_count = $7,
          participation_count = $8,
          completed_at = $9::timestamptz
      WHERE sync_run_id = $1::uuid AND status = 'running'
      RETURNING sync_run_id, status
    `, [
      syncRunId,
      calendarExpectedCount,
      calendarReceivedCount,
      attendanceExpectedCount,
      attendanceReceivedCount,
      snapshot.series?.length || 0,
      snapshot.events?.length || 0,
      snapshot.participations?.length || 0,
      observedAt,
    ]);
    if (!completed.rows?.[0]) throw new Error('Lesson mirror sync run was not in a completable state');
    await client.query('COMMIT');
    return {
      syncRunId,
      status: 'succeeded',
      seriesCount: snapshot.series?.length || 0,
      eventCount: snapshot.events?.length || 0,
      participationCount: snapshot.participations?.length || 0,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the first error; the pool will discard a broken connection.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getLessonMirrorStatus({ database = null, env = process.env } = {}) {
  const result = await db(database, env).query(`
    SELECT
      latest.sync_run_id,
      latest.source,
      latest.trigger_kind,
      latest.window_start::text AS window_start,
      latest.window_end_exclusive::text AS window_end_exclusive,
      latest.status,
      latest.calendar_expected_count,
      latest.calendar_received_count,
      latest.attendance_expected_count,
      latest.attendance_received_count,
      latest.series_count,
      latest.event_count,
      latest.participation_count,
      latest.failure_code,
      latest.started_at,
      latest.completed_at,
      (SELECT COUNT(*)::integer FROM fc_lesson_series) AS stored_series_count,
      (SELECT COUNT(*)::integer FROM fc_lesson_events) AS stored_event_count,
      (SELECT COUNT(*)::integer FROM fc_lesson_participations) AS stored_participation_count,
      (SELECT COUNT(*)::integer FROM fc_lesson_revisions) AS stored_revision_count
    FROM fc_lesson_sync_runs latest
    ORDER BY latest.started_at DESC, latest.sync_run_id DESC
    LIMIT 1
  `);
  return result.rows?.[0] || null;
}

async function getLatestSuccessfulLessonMirrorStatus({ database = null, env = process.env } = {}) {
  const result = await db(database, env).query(`
    SELECT
      latest.sync_run_id,
      latest.source,
      latest.trigger_kind,
      latest.window_start::text AS window_start,
      latest.window_end_exclusive::text AS window_end_exclusive,
      latest.status,
      latest.calendar_expected_count,
      latest.calendar_received_count,
      latest.attendance_expected_count,
      latest.attendance_received_count,
      latest.series_count,
      latest.event_count,
      latest.participation_count,
      latest.failure_code,
      latest.started_at,
      latest.completed_at
    FROM fc_lesson_sync_runs latest
    WHERE latest.status = 'succeeded'
    ORDER BY latest.started_at DESC, latest.sync_run_id DESC
    LIMIT 1
  `);
  return result.rows?.[0] || null;
}

function lessonOccurrenceDate(value, label) {
  const candidate = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) {
    throw new Error(`A valid ${label} date is required`);
  }
  const parsed = new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new Error(`A valid ${label} date is required`);
  }
  return candidate;
}

function lessonOccurrenceWindowDays(startDate, endDateExclusive) {
  return Math.round((
    new Date(`${endDateExclusive}T12:00:00Z`).getTime()
    - new Date(`${startDate}T12:00:00Z`).getTime()
  ) / 86_400_000);
}

/**
 * Reads one bounded calendar window from observations re-seen by the latest
 * successful, exactly-counted mirror run. Provider aliases are adapter-only;
 * callers must resolve and remove them before rendering a view model.
 */
export async function getLessonMirrorCalendarObservations({
  startDate,
  endDateExclusive,
  limit = 2500,
  database = null,
  env = process.env,
  now = new Date(),
} = {}) {
  const start = lessonOccurrenceDate(startDate, 'lesson-calendar start');
  const end = lessonOccurrenceDate(endDateExclusive, 'lesson-calendar end');
  const windowDays = lessonOccurrenceWindowDays(start, end);
  if (windowDays <= 0 || windowDays > 31) {
    throw new Error('Lesson-calendar window must be between 1 and 31 days');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('Lesson-calendar limit must be between 1 and 5000');
  }

  const databaseClient = db(database, env);
  const [latest, latestSuccessful] = await Promise.all([
    getLessonMirrorStatus({ database: databaseClient }),
    getLatestSuccessfulLessonMirrorStatus({ database: databaseClient }),
  ]);
  const assessment = assessLessonMirrorStatus(latest, { now });
  const coversRequestedWindow = Boolean(
    latestSuccessful
    && latestSuccessful.window_start <= start
    && latestSuccessful.window_end_exclusive >= end
  );
  const source = {
    state: assessment.state,
    verified: Boolean(
      latestSuccessful
      && latest?.status === 'succeeded'
      && latest.sync_run_id === latestSuccessful.sync_run_id
      && assessment.state === 'fresh'
      && coversRequestedWindow
    ),
    latestStatus: clean(latest?.status),
    latestFailureCode: clean(latest?.failure_code),
    lastVerifiedAt: iso(latestSuccessful?.completed_at),
    windowStart: clean(latestSuccessful?.window_start),
    windowEndExclusive: clean(latestSuccessful?.window_end_exclusive),
    requestedStart: start,
    requestedEndExclusive: end,
    coversRequestedWindow,
  };
  if (!latestSuccessful || !source.verified) return { source, observations: [] };

  const result = await databaseClient.query(`
    WITH verified_run AS (
      SELECT sync_run_id, window_start, window_end_exclusive, started_at, completed_at
      FROM fc_lesson_sync_runs
      WHERE sync_run_id = $1::uuid AND status = 'succeeded'
    )
    SELECT
      event.fc_event_id,
      event.fc_series_id,
      event.local_date::text AS local_date,
      TO_CHAR(event.local_time, 'HH24:MI:SS') AS local_time,
      event.duration_minutes,
      event.tutor_external_id,
      event.original_tutor_external_id,
      event.location_name,
      event.category_name,
      event.last_observed_at AS event_observed_at,
      run.completed_at AS mirror_observed_at,
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'fcParticipationId', participation.fc_participation_id,
            'studentExternalId', participation.student_external_id,
            'rawAttendanceStatus', participation.raw_attendance_status
          )
          ORDER BY participation.fc_participation_id
        ) FILTER (WHERE participation.fc_participation_id IS NOT NULL),
        '[]'::jsonb
      ) AS participations
    FROM fc_lesson_events event
    CROSS JOIN verified_run run
    LEFT JOIN fc_lesson_participations participation
      ON participation.fc_event_id = event.fc_event_id
     AND participation.last_observed_at >= run.started_at
    WHERE event.local_date >= $2::date
      AND event.local_date < $3::date
      AND event.local_date >= run.window_start
      AND event.local_date < run.window_end_exclusive
      AND event.last_observed_at >= run.started_at
      AND event.calendar_observed = TRUE
    GROUP BY
      event.fc_event_id,
      event.fc_series_id,
      event.local_date,
      event.local_time,
      event.duration_minutes,
      event.tutor_external_id,
      event.original_tutor_external_id,
      event.location_name,
      event.category_name,
      event.last_observed_at,
      run.completed_at
    ORDER BY event.local_date ASC, event.local_time ASC, event.fc_event_id ASC
    LIMIT $4::integer
  `, [latestSuccessful.sync_run_id, start, end, limit + 1]);
  const rows = result.rows || [];
  if (rows.length > limit) throw new Error('Lesson-calendar observation limit exceeded');

  return {
    source,
    observations: rows.map((row) => ({
      fcEventId: clean(row.fc_event_id),
      fcSeriesId: clean(row.fc_series_id),
      localDate: clean(row.local_date),
      localTime: clean(row.local_time),
      durationMinutes: row.duration_minutes === null || row.duration_minutes === undefined
        ? null
        : Number(row.duration_minutes),
      locationName: clean(row.location_name),
      categoryName: clean(row.category_name),
      eventObservedAt: iso(row.event_observed_at),
      mirrorObservedAt: iso(row.mirror_observed_at),
      tutorExternalId: clean(row.tutor_external_id),
      originalTutorExternalId: clean(row.original_tutor_external_id),
      participations: Array.isArray(row.participations) ? row.participations.map((participation) => ({
        fcParticipationId: clean(participation.fcParticipationId),
        studentExternalId: clean(participation.studentExternalId),
        rawAttendanceStatus: clean(participation.rawAttendanceStatus),
      })) : [],
    })),
  };
}

/**
 * Reads only observations re-seen by the latest successful, exactly-counted
 * mirror run. Provider aliases are returned for server-side joins and must not
 * be passed through an admin or assistant response.
 */
export async function getLessonOccurrenceObservations({
  startDate,
  endDateExclusive,
  studentExternalIds = [],
  limit = 3000,
  database = null,
  env = process.env,
  now = new Date(),
} = {}) {
  const start = lessonOccurrenceDate(startDate, 'lesson-occurrence start');
  const end = lessonOccurrenceDate(endDateExclusive, 'lesson-occurrence end');
  const windowDays = lessonOccurrenceWindowDays(start, end);
  if (windowDays <= 0 || windowDays > 90) {
    throw new Error('Lesson-occurrence window must be between 1 and 90 days');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('Lesson-occurrence limit must be between 1 and 5000');
  }
  if (!Array.isArray(studentExternalIds) || studentExternalIds.length > 100) {
    throw new Error('Lesson-occurrence student filter must contain at most 100 identifiers');
  }
  const studentIds = [...new Set(studentExternalIds.map(clean).filter(Boolean))];
  if (studentIds.some((value) => value.length > 200)) {
    throw new Error('Lesson-occurrence student identifiers must be at most 200 characters');
  }

  const databaseClient = db(database, env);
  const [latest, latestSuccessful] = await Promise.all([
    getLessonMirrorStatus({ database: databaseClient }),
    getLatestSuccessfulLessonMirrorStatus({ database: databaseClient }),
  ]);
  const assessment = assessLessonMirrorStatus(latest, { now });
  const coversRequestedWindow = Boolean(
    latestSuccessful
    && latestSuccessful.window_start <= start
    && latestSuccessful.window_end_exclusive >= end
  );
  const source = {
    state: assessment.state,
    verified: Boolean(
      latestSuccessful
      && latest?.status === 'succeeded'
      && latest.sync_run_id === latestSuccessful.sync_run_id
      && assessment.state === 'fresh'
      && coversRequestedWindow
    ),
    latestStatus: clean(latest?.status),
    latestFailureCode: clean(latest?.failure_code),
    lastVerifiedAt: iso(latestSuccessful?.completed_at),
    windowStart: clean(latestSuccessful?.window_start),
    windowEndExclusive: clean(latestSuccessful?.window_end_exclusive),
    requestedStart: start,
    requestedEndExclusive: end,
    coversRequestedWindow,
  };
  // This operational read model is deliberately stricter than the parity page:
  // a previous successful snapshot remains useful diagnostic evidence, but it
  // must not appear as current lesson context after a newer failure or once it
  // is stale/outside the requested window.
  if (!latestSuccessful || !source.verified) return { source, observations: [] };

  const studentFilterClause = studentIds.length
    ? 'AND participation.student_external_id = ANY($4::text[])'
    : '';
  const limitPosition = studentIds.length ? 5 : 4;
  const result = await databaseClient.query(`
    WITH verified_run AS (
      SELECT sync_run_id, window_start, window_end_exclusive, started_at, completed_at
      FROM fc_lesson_sync_runs
      WHERE sync_run_id = $1::uuid AND status = 'succeeded'
    )
    SELECT
      event.fc_event_id,
      event.fc_series_id,
      event.local_date::text AS local_date,
      TO_CHAR(event.local_time, 'HH24:MI:SS') AS local_time,
      event.time_zone,
      event.duration_minutes,
      event.tutor_external_id,
      event.original_tutor_external_id,
      event.source_status,
      event.calendar_observed,
      event.attendance_observed,
      event.last_observed_at AS event_observed_at,
      participation.fc_participation_id,
      participation.student_external_id,
      participation.attendance_external_id,
      participation.raw_attendance_status,
      participation.last_observed_at AS participation_observed_at,
      event_ref.external_id AS event_external_id,
      run.sync_run_id,
      run.completed_at AS mirror_observed_at
    FROM fc_lesson_participations participation
    JOIN fc_lesson_events event ON event.fc_event_id = participation.fc_event_id
    CROSS JOIN verified_run run
    LEFT JOIN fc_lesson_external_refs event_ref
      ON event_ref.entity_kind = 'event'
     AND event_ref.fc_entity_id = event.fc_event_id
     AND event_ref.reference_kind = 'event'
     AND event_ref.provider = 'mms'
    WHERE event.local_date >= $2::date
      AND event.local_date < $3::date
      AND event.local_date >= run.window_start
      AND event.local_date < run.window_end_exclusive
      AND event.last_observed_at >= run.started_at
      AND participation.last_observed_at >= run.started_at
      ${studentFilterClause}
    ORDER BY event.local_date ASC, event.local_time ASC, participation.fc_participation_id ASC
    LIMIT $${limitPosition}::integer
  `, studentIds.length
    ? [latestSuccessful.sync_run_id, start, end, studentIds, limit + 1]
    : [latestSuccessful.sync_run_id, start, end, limit + 1]);
  const rows = result.rows || [];
  if (rows.length > limit) {
    throw new Error('Lesson-occurrence observation limit exceeded');
  }

  return {
    source,
    observations: rows.map((row) => ({
      fcEventId: clean(row.fc_event_id),
      fcSeriesId: clean(row.fc_series_id),
      fcParticipationId: clean(row.fc_participation_id),
      localDate: clean(row.local_date),
      localTime: clean(row.local_time),
      timeZone: clean(row.time_zone),
      durationMinutes: row.duration_minutes === null || row.duration_minutes === undefined
        ? null
        : Number(row.duration_minutes),
      sourceStatus: clean(row.source_status),
      calendarObserved: row.calendar_observed === true,
      attendanceObserved: row.attendance_observed === true,
      rawAttendanceStatus: clean(row.raw_attendance_status),
      eventObservedAt: iso(row.event_observed_at),
      participationObservedAt: iso(row.participation_observed_at),
      mirrorObservedAt: iso(row.mirror_observed_at),
      // Adapter-only aliases. The provider-neutral resolver deliberately omits them.
      eventExternalId: clean(row.event_external_id),
      attendanceExternalId: clean(row.attendance_external_id),
      studentExternalId: clean(row.student_external_id),
      tutorExternalId: clean(row.tutor_external_id),
      originalTutorExternalId: clean(row.original_tutor_external_id),
    })),
  };
}

export function assessLessonMirrorStatus(status, {
  now = new Date(),
  freshForHours = 36,
  runningForMinutes = 30,
} = {}) {
  if (!status) return { state: 'never_run', ageMinutes: null };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const reference = status.completed_at || status.started_at;
  const referenceMs = new Date(reference || '').getTime();
  const ageMinutes = Number.isFinite(nowMs) && Number.isFinite(referenceMs)
    ? Math.max(0, Math.floor((nowMs - referenceMs) / 60_000))
    : null;
  if (status.status === 'failed') return { state: 'failed', ageMinutes, failureCode: status.failure_code || null };
  if (status.status === 'running') {
    return { state: ageMinutes !== null && ageMinutes > runningForMinutes ? 'stuck' : 'running', ageMinutes };
  }
  if (status.status !== 'succeeded' || ageMinutes === null) return { state: 'unknown', ageMinutes };
  return { state: ageMinutes <= freshForHours * 60 ? 'fresh' : 'stale', ageMinutes };
}

export async function getLessonMirrorExceptionInvestigation({
  database = null,
  env = process.env,
  now = new Date(),
} = {}) {
  const databaseClient = db(database, env);
  const [latest, latestSuccessful] = await Promise.all([
    getLessonMirrorStatus({ database: databaseClient }),
    getLatestSuccessfulLessonMirrorStatus({ database: databaseClient }),
  ]);
  const assessment = assessLessonMirrorStatus(latest, { now });
  const verified = Boolean(
    latestSuccessful
    && latest?.status === 'succeeded'
    && latest.sync_run_id === latestSuccessful.sync_run_id
    && assessment.state === 'fresh'
  );
  const source = {
    state: assessment.state,
    verified,
    lastVerifiedAt: iso(latestSuccessful?.completed_at),
    windowStart: clean(latestSuccessful?.window_start),
    windowEndExclusive: clean(latestSuccessful?.window_end_exclusive),
  };
  if (!verified) return { source, groups: [], metrics: {} };

  const result = await databaseClient.query(`
    WITH latest AS (
      SELECT *
      FROM fc_lesson_sync_runs
      WHERE sync_run_id = $1::uuid AND status = 'succeeded'
    ), window_events AS (
      SELECT event.*
      FROM fc_lesson_events event
      CROSS JOIN latest
      WHERE event.local_date >= latest.window_start
        AND event.local_date < latest.window_end_exclusive
    ), participation_counts AS (
      SELECT
        participation.fc_event_id,
        COUNT(*)::integer AS stored_participant_count,
        COUNT(*) FILTER (WHERE participation.last_observed_at >= latest.started_at)::integer AS current_participant_count
      FROM fc_lesson_participations participation
      JOIN window_events event ON event.fc_event_id = participation.fc_event_id
      CROSS JOIN latest
      GROUP BY participation.fc_event_id, latest.started_at
    ), classified AS (
      SELECT
        event.*,
        COALESCE(counts.stored_participant_count, 0)::integer AS stored_participant_count,
        COALESCE(counts.current_participant_count, 0)::integer AS current_participant_count,
        CASE
          WHEN event.last_observed_at >= latest.started_at
            THEN COALESCE(counts.current_participant_count, 0)
          ELSE COALESCE(counts.stored_participant_count, 0)
        END::integer AS participant_count,
        CASE
          WHEN LOWER(BTRIM(COALESCE(event.category_name, ''))) = 'break' THEN 'break'
          WHEN (
            CASE
              WHEN event.last_observed_at >= latest.started_at
                THEN COALESCE(counts.current_participant_count, 0)
              ELSE COALESCE(counts.stored_participant_count, 0)
            END
          ) > 0 THEN 'lesson'
          WHEN LOWER(BTRIM(COALESCE(event.category_name, ''))) = 'free' THEN 'availability'
          WHEN LOWER(BTRIM(COALESCE(event.category_name, ''))) LIKE 'potential%' THEN 'potential'
          ELSE 'other'
        END AS event_kind,
        CASE WHEN event.last_observed_at >= latest.started_at THEN 'current' ELSE 'not_observed' END AS observation
      FROM window_events event
      CROSS JOIN latest
      LEFT JOIN participation_counts counts ON counts.fc_event_id = event.fc_event_id
    ), grouped AS (
      SELECT observation, event_kind, COUNT(*)::integer AS event_count
      FROM classified
      GROUP BY observation, event_kind
    ), current_events AS (
      SELECT * FROM classified WHERE observation = 'current'
    ), stale_lessons AS (
      SELECT * FROM classified WHERE observation = 'not_observed' AND participant_count > 0
    ), replacement_shape AS (
      SELECT
        stale.fc_event_id,
        EXISTS (
          SELECT 1
          FROM fc_lesson_participations stale_participation
          JOIN fc_lesson_participations current_participation
            ON current_participation.student_external_id = stale_participation.student_external_id
          JOIN current_events current_event
            ON current_event.fc_event_id = current_participation.fc_event_id
          CROSS JOIN latest
          WHERE stale_participation.fc_event_id = stale.fc_event_id
            AND current_participation.last_observed_at >= latest.started_at
            AND current_event.local_date = stale.local_date
            AND current_event.local_time = stale.local_time
            AND current_event.tutor_external_id IS NOT DISTINCT FROM stale.tutor_external_id
        ) AS same_slot_student,
        EXISTS (
          SELECT 1
          FROM fc_lesson_participations stale_participation
          JOIN fc_lesson_participations current_participation
            ON current_participation.student_external_id = stale_participation.student_external_id
          JOIN current_events current_event
            ON current_event.fc_event_id = current_participation.fc_event_id
          CROSS JOIN latest
          WHERE stale_participation.fc_event_id = stale.fc_event_id
            AND current_participation.last_observed_at >= latest.started_at
            AND current_event.local_date = stale.local_date
        ) AS same_date_student
      FROM stale_lessons stale
    ), attendance_change_lag AS (
      SELECT
        ((run.started_at AT TIME ZONE 'Europe/London')::date - event.local_date)::integer AS days_lag
      FROM fc_lesson_revisions revision
      JOIN fc_lesson_sync_runs run ON run.sync_run_id = revision.sync_run_id
      JOIN fc_lesson_participations participation
        ON participation.fc_participation_id = revision.fc_entity_id
      JOIN fc_lesson_events event ON event.fc_event_id = participation.fc_event_id
      CROSS JOIN latest
      WHERE revision.entity_kind = 'participation'
        AND revision.revision_kind = 'changed'
        AND run.trigger_kind = 'scheduled'
        AND run.started_at >= latest.started_at - INTERVAL '30 days'
    )
    SELECT
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'observation', observation,
            'eventKind', event_kind,
            'eventCount', event_count
          ) ORDER BY observation ASC, event_kind ASC
        )
        FROM grouped
      ), '[]'::jsonb) AS groups,
      (SELECT COUNT(*)::integer FROM classified WHERE observation = 'not_observed') AS not_observed_events,
      (SELECT COUNT(*)::integer FROM stale_lessons) AS not_observed_lessons,
      (SELECT COUNT(*)::integer FROM replacement_shape WHERE same_slot_student) AS replacement_same_slot,
      (SELECT COUNT(*)::integer FROM replacement_shape WHERE NOT same_slot_student AND same_date_student) AS replacement_changed_slot,
      (SELECT COUNT(*)::integer FROM replacement_shape WHERE NOT same_date_student) AS no_same_date_replacement,
      (SELECT COUNT(*)::integer FROM current_events WHERE event_kind = 'lesson' AND tutor_external_id IS NULL) AS lesson_events_without_tutor,
      (SELECT COUNT(*)::integer FROM current_events WHERE event_kind <> 'lesson' AND tutor_external_id IS NULL) AS non_lesson_events_without_tutor,
      (
        SELECT COUNT(*)::integer
        FROM current_events
        WHERE participant_count > 0
          AND (
            LOWER(BTRIM(COALESCE(category_name, ''))) = 'free'
            OR LOWER(BTRIM(COALESCE(category_name, ''))) LIKE 'potential%'
          )
      ) AS availability_labels_with_students,
      (
        SELECT COUNT(*)::integer
        FROM current_events
        WHERE current_participant_count = 0
          AND stored_participant_count > 0
          AND (
            LOWER(BTRIM(COALESCE(category_name, ''))) = 'free'
            OR LOWER(BTRIM(COALESCE(category_name, ''))) LIKE 'potential%'
          )
      ) AS availability_labels_with_retained_students,
      (SELECT COUNT(*)::integer FROM current_events WHERE NULLIF(BTRIM(COALESCE(source_status, '')), '') IS NULL) AS events_without_source_status,
      (SELECT COUNT(*)::integer FROM attendance_change_lag WHERE days_lag BETWEEN 8 AND 14) AS attendance_changes_days_8_to_14,
      (SELECT MAX(days_lag)::integer FROM attendance_change_lag WHERE days_lag >= 0) AS latest_attendance_change_days
  `, [latestSuccessful.sync_run_id]);
  const row = result.rows?.[0] || {};

  return {
    source,
    groups: Array.isArray(row.groups) ? row.groups.map((group) => ({
      observation: clean(group.observation),
      eventKind: clean(group.eventKind),
      eventCount: Number(group.eventCount) || 0,
    })) : [],
    metrics: {
      notObservedEvents: Number(row.not_observed_events) || 0,
      notObservedLessons: Number(row.not_observed_lessons) || 0,
      replacementSameSlot: Number(row.replacement_same_slot) || 0,
      replacementChangedSlot: Number(row.replacement_changed_slot) || 0,
      noSameDateReplacement: Number(row.no_same_date_replacement) || 0,
      lessonEventsWithoutTutor: Number(row.lesson_events_without_tutor) || 0,
      nonLessonEventsWithoutTutor: Number(row.non_lesson_events_without_tutor) || 0,
      availabilityLabelsWithStudents: Number(row.availability_labels_with_students) || 0,
      availabilityLabelsWithRetainedStudents: Number(row.availability_labels_with_retained_students) || 0,
      eventsWithoutSourceStatus: Number(row.events_without_source_status) || 0,
      attendanceChangesDays8To14: Number(row.attendance_changes_days_8_to_14) || 0,
      latestAttendanceChangeDays: row.latest_attendance_change_days === null || row.latest_attendance_change_days === undefined
        ? null
        : Number(row.latest_attendance_change_days),
    },
  };
}

export async function getLessonMirrorParityReport({
  database = null,
  env = process.env,
  runLimit = 14,
  now = new Date(),
} = {}) {
  const limit = Number.isInteger(runLimit) && runLimit > 0 && runLimit <= 100 ? runLimit : 14;
  const databaseClient = db(database, env);
  const [latest, latestSuccessful, runsResult, metricsResult, statusesResult] = await Promise.all([
    getLessonMirrorStatus({ database: databaseClient }),
    getLatestSuccessfulLessonMirrorStatus({ database: databaseClient }),
    databaseClient.query(`
      WITH recent_runs AS (
        SELECT *
        FROM fc_lesson_sync_runs
        ORDER BY started_at DESC, sync_run_id DESC
        LIMIT $1::integer
      ), revision_counts AS (
        SELECT
          revision.sync_run_id,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'series' AND revision.revision_kind = 'created')::integer AS series_created,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'series' AND revision.revision_kind = 'changed')::integer AS series_changed,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'event' AND revision.revision_kind = 'created')::integer AS events_created,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'event' AND revision.revision_kind = 'changed')::integer AS events_changed,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'participation' AND revision.revision_kind = 'created')::integer AS participations_created,
          COUNT(revision.revision_id) FILTER (WHERE revision.entity_kind = 'participation' AND revision.revision_kind = 'changed')::integer AS participations_changed
        FROM fc_lesson_revisions revision
        JOIN recent_runs run ON run.sync_run_id = revision.sync_run_id
        GROUP BY revision.sync_run_id
      )
      SELECT
        run.sync_run_id,
        run.trigger_kind,
        run.window_start::text AS window_start,
        run.window_end_exclusive::text AS window_end_exclusive,
        run.status,
        run.calendar_expected_count,
        run.calendar_received_count,
        run.attendance_expected_count,
        run.attendance_received_count,
        run.series_count,
        run.event_count,
        run.participation_count,
        run.failure_code,
        run.started_at,
        run.completed_at,
        COALESCE(revision.series_created, 0) AS series_created,
        COALESCE(revision.series_changed, 0) AS series_changed,
        COALESCE(revision.events_created, 0) AS events_created,
        COALESCE(revision.events_changed, 0) AS events_changed,
        COALESCE(revision.participations_created, 0) AS participations_created,
        COALESCE(revision.participations_changed, 0) AS participations_changed
      FROM recent_runs run
      LEFT JOIN revision_counts revision ON revision.sync_run_id = run.sync_run_id
      ORDER BY run.started_at DESC, run.sync_run_id DESC
    `, [limit]),
    databaseClient.query(`
      WITH latest AS (
        SELECT *
        FROM fc_lesson_sync_runs
        WHERE status = 'succeeded'
        ORDER BY started_at DESC, sync_run_id DESC
        LIMIT 1
      ), window_events AS (
        SELECT event.*
        FROM fc_lesson_events event
        CROSS JOIN latest
        WHERE event.local_date >= latest.window_start
          AND event.local_date < latest.window_end_exclusive
      ), participation_counts AS (
        SELECT participation.fc_event_id, COUNT(*)::integer AS participation_count
        FROM fc_lesson_participations participation
        JOIN window_events event ON event.fc_event_id = participation.fc_event_id
        GROUP BY participation.fc_event_id
      )
      SELECT
        (SELECT COUNT(*)::integer FROM fc_lesson_series) AS stored_series,
        (SELECT COUNT(*)::integer FROM fc_lesson_events) AS stored_events,
        (SELECT COUNT(*)::integer FROM fc_lesson_participations) AS stored_participations,
        (SELECT COUNT(*)::integer FROM fc_lesson_external_refs) AS stored_external_refs,
        (SELECT COUNT(*)::integer FROM fc_lesson_revisions) AS stored_revisions,
        (SELECT COUNT(*)::integer FROM window_events) AS window_events,
        (SELECT COUNT(*)::integer FROM window_events WHERE NOT calendar_observed) AS attendance_only_events,
        (SELECT COUNT(*)::integer FROM window_events WHERE fc_series_id IS NULL) AS events_without_series,
        (SELECT COUNT(*)::integer FROM window_events WHERE tutor_external_id IS NULL) AS events_without_tutor,
        (SELECT COUNT(*)::integer FROM window_events WHERE duration_minutes IS NULL) AS events_without_duration,
        (SELECT COUNT(*)::integer FROM window_events WHERE location_external_id IS NULL AND location_name IS NULL) AS events_without_location,
        (SELECT COUNT(*)::integer FROM window_events WHERE original_tutor_external_id IS NOT NULL AND tutor_external_id IS NOT NULL AND original_tutor_external_id <> tutor_external_id) AS substitute_events,
        (SELECT COUNT(*)::integer FROM participation_counts count_row JOIN window_events event ON event.fc_event_id = count_row.fc_event_id WHERE count_row.participation_count > 1) AS group_events,
        (SELECT COUNT(*)::integer FROM window_events event CROSS JOIN latest WHERE event.last_observed_at < latest.started_at) AS events_not_observed_latest,
        (
          SELECT COUNT(*)::integer
          FROM fc_lesson_participations participation
          JOIN window_events event ON event.fc_event_id = participation.fc_event_id
          CROSS JOIN latest
          WHERE participation.last_observed_at < latest.started_at
        ) AS participations_not_observed_latest
    `),
    databaseClient.query(`
      WITH latest AS (
        SELECT *
        FROM fc_lesson_sync_runs
        WHERE status = 'succeeded'
        ORDER BY started_at DESC, sync_run_id DESC
        LIMIT 1
      )
      SELECT
        COALESCE(NULLIF(BTRIM(participation.raw_attendance_status), ''), '(blank)') AS status,
        COUNT(*)::integer AS count
      FROM fc_lesson_participations participation
      JOIN fc_lesson_events event ON event.fc_event_id = participation.fc_event_id
      CROSS JOIN latest
      WHERE event.local_date >= latest.window_start
        AND event.local_date < latest.window_end_exclusive
        AND participation.last_observed_at >= latest.started_at
      GROUP BY COALESCE(NULLIF(BTRIM(participation.raw_attendance_status), ''), '(blank)')
      ORDER BY count DESC, status ASC
    `),
  ]);
  return {
    latest,
    latestSuccessful,
    assessment: assessLessonMirrorStatus(latest, { now }),
    runs: runsResult.rows || [],
    metrics: metricsResult.rows?.[0] || {},
    attendanceStatuses: statusesResult.rows || [],
  };
}
