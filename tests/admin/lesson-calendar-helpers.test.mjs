import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLessonCalendarView,
  buildLessonCalendarWindow,
  lessonCalendarEventKind,
} from '../../lib/admin/lesson-calendar-helpers.mjs';

test('lesson calendar week uses London-written dates without timezone drift', () => {
  assert.deepEqual(buildLessonCalendarWindow({
    requestedWeek: '2026-09-02',
    today: '2026-09-02',
  }), {
    weekStart: '2026-08-31',
    endDateExclusive: '2026-09-07',
    previousWeek: '2026-08-24',
    nextWeek: '2026-09-07',
    todayWeek: '2026-08-31',
    days: [
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ],
  });
});

test('calendar event classification separates student lessons from availability, holds, and breaks', () => {
  assert.equal(lessonCalendarEventKind({ categoryName: 'Free', participantCount: 0 }), 'availability');
  assert.equal(lessonCalendarEventKind({ categoryName: 'Potential (No piano)', participantCount: 0 }), 'potential');
  assert.equal(lessonCalendarEventKind({ categoryName: 'BREAK', participantCount: 0 }), 'break');
  assert.equal(lessonCalendarEventKind({ categoryName: 'Free', participantCount: 1 }), 'lesson');
  assert.equal(lessonCalendarEventKind({ categoryName: 'Staff meeting', participantCount: 0 }), 'other');
});

test('calendar view resolves names server-side and removes all provider aliases', () => {
  const window = buildLessonCalendarWindow({ requestedWeek: '2026-09-02', today: '2026-09-02' });
  const view = buildLessonCalendarView({
    window,
    source: {
      state: 'fresh',
      verified: true,
      lastVerifiedAt: '2026-09-02T05:48:00Z',
      windowStart: '2026-08-19',
      windowEndExclusive: '2026-10-15',
      coversRequestedWindow: true,
    },
    students: [{
      mmsId: 'sdt_private',
      fcStudentId: 'fc_stu_1',
      fullName: 'Jamie Example',
      instrument: 'piano',
      isTestStudent: false,
    }],
    tutors: [{
      teacherId: 'tch_private',
      fcTutorId: 'fc_tut_1',
      shortName: 'Tutor',
      fullName: 'Tutor Example',
    }],
    observations: [{
      fcEventId: 'fc_lev_1',
      fcSeriesId: 'fc_lsr_1',
      localDate: '2026-09-03',
      localTime: '16:00:00',
      durationMinutes: 30,
      categoryName: 'Free',
      locationName: 'Room 1',
      tutorExternalId: 'tch_private',
      originalTutorExternalId: '',
      participations: [{
        fcParticipationId: 'fc_lpt_1',
        studentExternalId: 'sdt_private',
        rawAttendanceStatus: 'Unrecorded',
      }],
    }],
  });

  const event = view.days.find((day) => day.date === '2026-09-03').events[0];
  assert.equal(event.kind, 'lesson');
  assert.equal(event.categoryConflict, true);
  assert.equal(event.tutor.shortName, 'Tutor');
  assert.equal(event.participants[0].displayName, 'Jamie Example');
  assert.deepEqual(event.attendanceStatuses, [{ status: 'Unrecorded', count: 1 }]);
  assert.equal(event.unmatchedParticipantCount, 0);
  const serialised = JSON.stringify(view);
  assert.doesNotMatch(serialised, /sdt_private|tch_private/u);
  assert.match(serialised, /fc_lev_1|fc_lpt_1|fc_stu_1|fc_tut_1/u);
});

test('calendar view keeps unmatched participations visible without leaking their provider identity', () => {
  const window = buildLessonCalendarWindow({ requestedWeek: '2026-09-02', today: '2026-09-02' });
  const view = buildLessonCalendarView({
    window,
    source: { state: 'fresh', verified: true },
    observations: [{
      fcEventId: 'fc_lev_2',
      localDate: '2026-09-04',
      localTime: '17:00:00',
      categoryName: 'Lesson',
      tutorExternalId: 'tch_unknown',
      participations: [{
        fcParticipationId: 'fc_lpt_2',
        studentExternalId: 'sdt_unknown',
        rawAttendanceStatus: '',
      }],
    }],
  });

  const event = view.events[0];
  assert.equal(event.tutor, null);
  assert.equal(event.participants[0].displayName, 'Unmatched student');
  assert.equal(event.unmatchedParticipantCount, 1);
  assert.doesNotMatch(JSON.stringify(view), /sdt_unknown|tch_unknown/u);
});
