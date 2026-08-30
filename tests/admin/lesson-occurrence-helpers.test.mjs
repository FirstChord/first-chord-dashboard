import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareNextOccurrenceToSchedule,
  matchPracticeNoteToLessonOccurrence,
  resolveLessonOccurrenceContext,
  selectLessonOccurrenceHighlights,
  summariseLessonOccurrences,
} from '../../lib/admin/lesson-occurrence-helpers.mjs';

const STUDENT = {
  fcStudentId: 'fc_std_12345678',
  displayName: 'Nina Example',
  instrument: 'Piano',
};

const PRIMARY_TUTOR = {
  fcTutorId: 'fc_tut_primary',
  shortName: 'Tom',
  displayName: 'Tom Walters',
};

const COVER_TUTOR = {
  fcTutorId: 'fc_tut_cover',
  shortName: 'Finn',
  displayName: 'Finn Le Marinel',
};

const OBSERVATION = {
  fcEventId: 'fc_lev_12345678',
  fcSeriesId: 'fc_lsr_12345678',
  fcParticipationId: 'fc_lpt_12345678',
  localDate: '2026-08-27',
  localTime: '16:00:00',
  timeZone: 'Europe/London',
  durationMinutes: 30,
  sourceStatus: 'Active',
  calendarObserved: true,
  attendanceObserved: true,
  rawAttendanceStatus: 'Unrecorded',
  participationObservedAt: '2026-08-30T05:48:00.000Z',
  mirrorObservedAt: '2026-08-30T05:48:00.000Z',
  eventExternalId: 'evt_provider_only',
  attendanceExternalId: 'att_provider_only',
  studentExternalId: 'sdt_provider_only',
  tutorExternalId: 'tch_provider_only',
};

const SOURCE = {
  state: 'fresh',
  verified: true,
  lastVerifiedAt: '2026-08-30T05:48:00.000Z',
};

function occurrence(overrides = {}) {
  return resolveLessonOccurrenceContext({
    observation: { ...OBSERVATION, ...(overrides.observation || {}) },
    student: STUDENT,
    relationship: {
      relationshipId: 'teaching:fc_std_12345678:fc_tut_primary',
      tutor: PRIMARY_TUTOR,
    },
    scheduledTutor: overrides.scheduledTutor || PRIMARY_TUTOR,
    originalTutor: overrides.originalTutor || {},
    practiceNote: overrides.practiceNote || null,
    absence: overrides.absence || null,
    coverTutor: overrides.coverTutor || {},
    source: overrides.source || SOURCE,
    today: overrides.today || '2026-08-30',
  });
}

test('a lesson occurrence retains stable First Chord identities and raw attendance without interpreting completion', () => {
  const result = occurrence();

  assert.equal(result.occurrenceId, 'lesson:fc_lpt_12345678');
  assert.equal(result.state.code, 'past');
  assert.equal(result.state.label, 'Past observation');
  assert.deepEqual(result.attendance, {
    observed: true,
    rawStatus: 'Unrecorded',
    observedAt: '2026-08-30T05:48:00.000Z',
  });
  assert.deepEqual(result.attentionItems, []);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes('evt_provider_only'), false);
  assert.equal(serialised.includes('att_provider_only'), false);
  assert.equal(serialised.includes('sdt_provider_only'), false);
  assert.equal(serialised.includes('tch_provider_only'), false);
});

test('practice notes prefer exact attendance and event references, with ambiguity left unattached', () => {
  const notes = [
    {
      noteId: 'note_exact',
      studentMmsId: 'sdt_1',
      tutorShortName: 'Tom',
      lessonDate: '2026-08-27',
      mmsAttendanceId: 'att_1',
      deliveryStatus: 'sent',
    },
    {
      noteId: 'note_other',
      studentMmsId: 'sdt_1',
      tutorShortName: 'Tom',
      lessonDate: '2026-08-27',
      mmsEventId: 'evt_1',
      deliveryStatus: 'completed',
    },
  ];
  const exact = matchPracticeNoteToLessonOccurrence({
    notes,
    studentExternalId: 'sdt_1',
    attendanceExternalId: 'att_1',
    eventExternalId: 'evt_1',
    localDate: '2026-08-27',
    tutorShortName: 'Tom',
  });
  const ambiguous = matchPracticeNoteToLessonOccurrence({
    notes: notes.map((note) => ({ ...note, mmsAttendanceId: '', mmsEventId: '' })),
    studentExternalId: 'sdt_1',
    localDate: '2026-08-27',
    tutorShortName: 'Tom',
  });

  assert.equal(exact.note.noteId, 'note_exact');
  assert.equal(exact.note.matchKind, 'attendance_reference');
  assert.equal(exact.note.matchConfidence, 'high');
  assert.equal(ambiguous.note, null);
  assert.equal(ambiguous.warnings[0].code, 'practice_note_date_ambiguous');
});

test('a unique older date-and-tutor note remains bounded medium-confidence context', () => {
  const match = matchPracticeNoteToLessonOccurrence({
    notes: [{
      noteId: 'note_legacy',
      studentMmsId: 'sdt_1',
      tutorShortName: 'Tom',
      lessonDate: '2026-08-27',
      deliveryStatus: 'sent',
    }],
    studentExternalId: 'sdt_1',
    localDate: '2026-08-27',
    tutorShortName: 'Tom',
  });

  assert.equal(match.note.noteId, 'note_legacy');
  assert.equal(match.note.matchKind, 'unique_date_tutor');
  assert.equal(match.note.matchConfidence, 'medium');
});

test('verified cover mismatch attention self-clears when the observed tutor agrees', () => {
  const absence = {
    absenceId: 'tutor_absence:Tom:2026-09-03',
    decision: 'cover',
    status: 'in_progress',
    updatedAt: '2026-08-29T10:00:00.000Z',
    messageState: { __workflow: { calendarUpdated: true } },
  };
  const mismatch = occurrence({
    observation: { localDate: '2026-09-03' },
    absence,
    coverTutor: COVER_TUTOR,
    scheduledTutor: PRIMARY_TUTOR,
  });
  const aligned = occurrence({
    observation: { localDate: '2026-09-03' },
    absence,
    coverTutor: COVER_TUTOR,
    scheduledTutor: COVER_TUTOR,
    originalTutor: PRIMARY_TUTOR,
  });

  assert.equal(mismatch.exception.code, 'cover');
  assert.equal(mismatch.attentionItems[0].code, 'cover_calendar_mismatch');
  assert.deepEqual(aligned.attentionItems, []);
  assert.ok(aligned.conditions.some((item) => item.code === 'substitute_observed'));
});

test('a cancellation remains a workflow fact and does not rewrite the raw provider status', () => {
  const result = occurrence({
    absence: {
      absenceId: 'tutor_absence:Tom:2026-08-27',
      decision: 'cancel',
      status: 'resolved',
    },
  });

  assert.equal(result.exception.code, 'cancel');
  assert.equal(result.exception.workflowStatus, 'resolved');
  assert.equal(result.lesson.rawSourceStatus, 'Active');
  assert.equal(result.state.code, 'past');
});

test('explicit practice-delivery follow-up becomes bounded attention and source staleness lowers confidence', () => {
  const result = occurrence({
    practiceNote: {
      noteId: 'note_follow_up',
      lessonDate: '2026-08-27',
      deliveryStatus: 'follow_up',
      observedAt: '2026-08-27T18:00:00.000Z',
      manualFollowUpNeeded: true,
      matchKind: 'attendance_reference',
      matchConfidence: 'high',
    },
    source: { ...SOURCE, state: 'stale', verified: false },
  });

  assert.equal(result.state.confidence, 'low');
  assert.equal(result.attentionItems[0].code, 'practice_note_follow_up');
  assert.ok(result.conditions.some((item) => item.code === 'lesson_snapshot_not_current'));
});

test('timeline highlights stay bounded around today while preserving attention', () => {
  const rows = [
    occurrence({ observation: { fcParticipationId: 'fc_lpt_old', localDate: '2026-08-20' } }),
    occurrence({ observation: { fcParticipationId: 'fc_lpt_recent', localDate: '2026-08-27' } }),
    occurrence({ observation: { fcParticipationId: 'fc_lpt_today', localDate: '2026-08-30' } }),
    occurrence({ observation: { fcParticipationId: 'fc_lpt_next', localDate: '2026-09-03' } }),
    occurrence({ observation: { fcParticipationId: 'fc_lpt_later', localDate: '2026-09-10' } }),
  ];
  const highlights = selectLessonOccurrenceHighlights(rows, { today: '2026-08-30', limit: 4 });
  const summary = summariseLessonOccurrences(rows, { today: '2026-08-30' });

  assert.deepEqual(highlights.map((item) => item.participationId), [
    'fc_lpt_recent',
    'fc_lpt_today',
    'fc_lpt_next',
    'fc_lpt_later',
  ]);
  assert.deepEqual(summary, { total: 5, past: 2, today: 1, upcoming: 2, unknown: 0, cover: 0, cancel: 0, attention: 0 });
});

test('dual-read comparison reports agreement, difference, and unavailable evidence without choosing a winner', () => {
  const next = occurrence({ observation: { localDate: '2026-09-03', localTime: '16:00:00' } });
  const schedule = {
    status: 'found',
    freshness: 'fresh',
    nextLessonAt: '2026-09-03T16:00:00',
    matchesAssignedTutor: true,
    assignedTutorId: PRIMARY_TUTOR.fcTutorId,
  };

  assert.equal(compareNextOccurrenceToSchedule({ occurrence: next, schedule }).status, 'matched');
  assert.equal(compareNextOccurrenceToSchedule({
    occurrence: next,
    schedule: { ...schedule, nextLessonAt: '2026-09-04T16:00:00' },
  }).status, 'different');
  assert.equal(compareNextOccurrenceToSchedule({
    occurrence: next,
    schedule: { ...schedule, freshness: 'stale' },
  }).status, 'not_checked');
  assert.equal(compareNextOccurrenceToSchedule({
    occurrence: next,
    today: '2026-09-04',
    schedule,
  }).status, 'not_checked');
});
