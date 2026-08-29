import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTeachingCoverEpisode,
  sortTeachingCoverEpisodes,
} from '../../lib/admin/teaching-cover-helpers.mjs';

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

const ABSENT_TUTOR = PRIMARY_TUTOR;
const COVER_TUTOR = {
  fcTutorId: 'fc_tut_cover',
  shortName: 'Finn',
  displayName: 'Finn Le Marinel',
};

const LESSON = {
  eventId: 'evt_provider_only',
  lessonDate: '2026-09-03',
  lessonTime: '16:00',
  durationMinutes: '30',
  instrument: 'Piano',
};

const ABSENCE = {
  absenceId: 'tutor_absence:Tom:2026-09-03',
  status: 'in_progress',
  decision: 'cover',
  absenceDate: '2026-09-03',
  tutorName: 'Tom Walters',
  coverTutorName: 'Finn Le Marinel',
  coverTutorShortName: 'Finn',
  updatedAt: '2026-08-29T10:00:00.000Z',
  messageState: {},
};

test('cover episodes identify the next incomplete step without exposing provider event IDs', () => {
  const episode = resolveTeachingCoverEpisode({
    student: STUDENT,
    primaryTutor: PRIMARY_TUTOR,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: ABSENCE,
    lesson: LESSON,
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(episode.state.code, 'awaiting_confirmation');
  assert.equal(episode.attentionItems[0].code, 'cover_cover_confirmed_open');
  assert.equal(episode.attentionItems[0].severity, 'review');
  assert.equal(episode.attentionItems[0].recommendedWorkflow.code, 'tutor_absence_review');
  assert.equal(episode.episodeId, 'cover:tutor_absence:Tom:2026-09-03:fc_std_12345678:2026-09-03:16:00');
  assert.equal(JSON.stringify(episode).includes('evt_provider_only'), false);
});

test('cover milestones progress through briefing, calendar and parent message in order', () => {
  const briefing = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: {
      ...ABSENCE,
      messageState: { __workflow: { coverTutorConfirmed: true } },
    },
    lesson: LESSON,
  });
  const calendar = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: {
      ...ABSENCE,
      messageState: { __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true } },
    },
    lesson: LESSON,
  });
  const parent = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: {
      ...ABSENCE,
      messageState: { __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true, calendarUpdated: true } },
    },
    lesson: LESSON,
  });

  assert.equal(briefing.state.code, 'awaiting_briefing');
  assert.equal(calendar.state.code, 'awaiting_calendar');
  assert.equal(parent.state.code, 'awaiting_parent_message');
});

test('a fully prepared future cover is quiet and ready', () => {
  const episode = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: {
      ...ABSENCE,
      messageState: {
        __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true, calendarUpdated: true },
        evt_provider_only: { messaged: true },
      },
    },
    lesson: LESSON,
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(episode.state.code, 'ready');
  assert.deepEqual(episode.attentionItems, []);
  assert.equal(episode.milestones.every((item) => item.status === 'complete'), true);
});

test('missing steps become urgent on the cover date and resolved absences disappear', () => {
  const due = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: ABSENCE,
    lesson: LESSON,
    derivedAt: '2026-09-03T08:00:00.000Z',
  });
  const resolved = resolveTeachingCoverEpisode({
    student: STUDENT,
    absence: { ...ABSENCE, status: 'resolved' },
    lesson: LESSON,
  });

  assert.equal(due.attentionItems[0].severity, 'urgent');
  assert.equal(resolved, null);
});

test('sorting keeps cover work in date, time and student order', () => {
  const later = resolveTeachingCoverEpisode({
    student: { ...STUDENT, displayName: 'Zed Example' },
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: { ...ABSENCE, absenceDate: '2026-09-10' },
    lesson: { ...LESSON, lessonDate: '2026-09-10' },
  });
  const earlier = resolveTeachingCoverEpisode({
    student: STUDENT,
    absentTutor: ABSENT_TUTOR,
    coverTutor: COVER_TUTOR,
    absence: ABSENCE,
    lesson: LESSON,
  });

  assert.deepEqual(sortTeachingCoverEpisodes([later, earlier]).map((item) => item.student.displayName), [
    'Nina Example',
    'Zed Example',
  ]);
});
