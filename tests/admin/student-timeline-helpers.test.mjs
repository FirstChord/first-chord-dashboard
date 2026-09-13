import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptLessonHistoryRows,
  adaptPauseHistoryRows,
  buildStudentTimeline,
} from '../../lib/admin/student-timeline-helpers.mjs';

test('timeline orders known dates newest first and leaves unknown dates visible at the end', () => {
  const timeline = buildStudentTimeline({
    mmsId: 'sdt_1',
    communicationRows: [
      { messageId: 'comm_new', mmsId: 'sdt_1', loggedAt: '2026-09-12T09:00:00Z', category: 'parent', channel: 'whatsapp', body: 'Newer' },
      { messageId: 'comm_unknown', mmsId: 'sdt_1', loggedAt: '', category: 'parent', channel: 'whatsapp', body: 'Undated but retained' },
    ],
    practiceNoteRows: [
      { noteId: 'note_mid', studentMmsId: 'sdt_1', lessonDate: '2026-09-10', tutorName: 'Dean', practiceGoals: 'Middle' },
    ],
    lifecycleRow: { firstLesson: '2024-01-08', refreshedAt: '2026-09-01' },
  });

  assert.deepEqual(timeline.events.map((entry) => entry.id), [
    'communication:comm_new',
    'practice-note:note_mid',
    'student-lifecycle:first-lesson:2024-01-08',
    'communication:comm_unknown',
  ]);
  assert.equal(timeline.events.at(-1).date.certainty, 'unknown');
});

test('timeline deduplicates source snapshots and paired audit rows without losing the richer action', () => {
  const occurredAt = '2026-09-11T10:00:00.000Z';
  const timeline = buildStudentTimeline({
    mmsId: 'sdt_1',
    eventLogRows: [
      {
        eventId: 'event_field',
        mmsId: 'sdt_1',
        eventType: 'payment_expectation_changed',
        occurredAt,
        payloadJson: JSON.stringify({
          source: 'admin_pause_workflow_action',
          previous_value: 'stripe_active_expected',
          next_value: 'stripe_paused_expected',
        }),
      },
      {
        eventId: 'event_action',
        mmsId: 'sdt_1',
        eventType: 'pause_workflow_action_taken',
        occurredAt,
        payloadJson: JSON.stringify({
          source: 'admin_pause_workflow_action',
          action_label: 'Confirm pause',
          note: 'Parent confirmed the pause.',
        }),
      },
    ],
    practiceNoteRows: [
      { noteId: 'note_1', studentMmsId: 'sdt_1', lessonDate: '', createdAt: '', practiceGoals: 'Older snapshot' },
      { noteId: 'note_1', studentMmsId: 'sdt_1', lessonDate: '2026-09-09', practiceGoals: 'Dated snapshot' },
    ],
  });

  assert.equal(timeline.totalCount, 2);
  assert.equal(timeline.events.find((entry) => entry.kind === 'state_change').title, 'Pause workflow action recorded');
  assert.match(timeline.events.find((entry) => entry.kind === 'state_change').summary, /Parent confirmed/);
  assert.equal(timeline.events.find((entry) => entry.kind === 'practice_note').date.value, '2026-09-09');
});

test('each adapter keeps its source attribution and lesson provider IDs do not enter the UI contract', () => {
  const [lesson] = adaptLessonHistoryRows([
    {
      lessonId: 'fc_evt_1',
      participationId: 'fc_part_1',
      localDate: '2026-09-08',
      localTime: '16:30',
      timeZone: 'Europe/London',
      durationMinutes: 30,
      tutorName: 'Dean Clark',
      attendanceLabel: 'Present',
      observedAt: '2026-09-09T05:45:00Z',
      eventExternalId: 'mms_event_must_not_escape',
      studentExternalId: 'sdt_must_not_escape',
    },
  ], {
    key: 'lesson_ledger',
    label: 'Lesson ledger',
    provider: 'MMS-backed',
  });

  assert.equal(lesson.source.key, 'lesson_ledger');
  assert.equal(lesson.source.provider, 'MMS-backed');
  assert.equal(lesson.source.recordId, 'fc_part_1');
  assert.equal(lesson.date.timeZone, 'Europe/London');
  assert.equal(JSON.stringify(lesson).includes('mms_event_must_not_escape'), false);
  assert.equal(JSON.stringify(lesson).includes('sdt_must_not_escape'), false);
});

test('pause history preserves identity uncertainty and missing start dates', () => {
  const [pause] = adaptPauseHistoryRows([
    {
      studentName: 'Ada Lovelace',
      endDate: '2026-09-14',
      match: { confidence: 'low', evidence: 'Matched by email only.' },
    },
  ]);

  assert.equal(pause.certainty, 'uncertain');
  assert.equal(pause.date.value, '2026-09-14');
  assert.equal(pause.date.certainty, 'approximate');
  assert.match(pause.summary, /Start date unknown/);
  assert.equal(pause.source.label, 'Pause History');
});

test('source health and result limits stay deterministic', () => {
  const timeline = buildStudentTimeline({
    mmsId: 'sdt_1',
    limit: 1,
    communicationRows: [
      { messageId: 'comm_1', mmsId: 'sdt_1', loggedAt: '2026-09-12T09:00:00Z', body: 'One' },
      { messageId: 'comm_2', mmsId: 'sdt_1', loggedAt: '2026-09-11T09:00:00Z', body: 'Two' },
    ],
    sourceStates: [
      { key: 'event_log', label: 'Event Log', status: 'available' },
      { key: 'lesson_ledger', label: 'Lesson ledger', status: 'stale', observedAt: '2026-09-10T05:45:00Z' },
    ],
  });

  assert.equal(timeline.events.length, 1);
  assert.equal(timeline.totalCount, 2);
  assert.equal(timeline.hasMore, true);
  assert.deepEqual(timeline.sourceStates[1], {
    key: 'lesson_ledger',
    label: 'Lesson ledger',
    status: 'stale',
    observedAt: '2026-09-10T05:45:00Z',
  });
});
