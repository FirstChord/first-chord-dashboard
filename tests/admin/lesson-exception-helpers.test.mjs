import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLessonExceptionDetailsView,
  lessonExceptionEvidenceKind,
} from '../../lib/admin/lesson-exception-helpers.mjs';

test('exception evidence prefers exact slot, then same day, nearby, and no-nearby buckets', () => {
  assert.equal(lessonExceptionEvidenceKind({
    localDate: '2026-09-01',
    nearbyCandidates: [{ localDate: '2026-09-01', sameSlot: true }],
  }), 'same_slot');
  assert.equal(lessonExceptionEvidenceKind({
    localDate: '2026-09-01',
    nearbyCandidates: [{ localDate: '2026-09-01', sameSlot: false }],
  }), 'same_day');
  assert.equal(lessonExceptionEvidenceKind({
    localDate: '2026-09-01',
    nearbyCandidates: [{ localDate: '2026-09-04', sameSlot: false }],
  }), 'nearby');
  assert.equal(lessonExceptionEvidenceKind({ localDate: '2026-09-01' }), 'no_nearby');
});

test('exception detail resolves display context and strips every provider alias', () => {
  const view = buildLessonExceptionDetailsView({
    source: {
      state: 'fresh',
      verified: true,
      lastVerifiedAt: '2026-09-02T05:48:00Z',
      windowStart: '2026-08-19',
      windowEndExclusive: '2026-10-15',
    },
    totalCount: 1,
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
    details: [{
      fcEventId: 'fc_lev_old',
      fcSeriesId: 'fc_lsr_1',
      localDate: '2026-09-01',
      localTime: '16:00:00',
      durationMinutes: 30,
      tutorExternalId: 'tch_private',
      categoryName: 'Lesson',
      currentSameSeriesCount: 2,
      participations: [{
        fcParticipationId: 'fc_lpt_old',
        studentExternalId: 'sdt_private',
        rawAttendanceStatus: 'Unrecorded',
      }],
      nearbyCandidates: [{
        fcEventId: 'fc_lev_new',
        fcSeriesId: 'fc_lsr_1',
        localDate: '2026-09-01',
        localTime: '17:00:00',
        durationMinutes: 30,
        tutorExternalId: 'tch_private',
        categoryName: 'Lesson',
        daysOffset: 0,
        sameSeries: true,
        sameSlot: false,
        matchedStudentExternalIds: ['sdt_private'],
      }],
    }],
  });

  assert.equal(view.summary.same_day, 1);
  assert.equal(view.events[0].participants[0].displayName, 'Jamie Example');
  assert.equal(view.events[0].tutor.shortName, 'Tutor');
  assert.equal(view.events[0].seriesContinuing, true);
  assert.equal(view.events[0].nearbyCandidates[0].matchedStudents[0].displayName, 'Jamie Example');
  const serialised = JSON.stringify(view);
  assert.doesNotMatch(serialised, /sdt_private|tch_private/u);
  assert.match(serialised, /fc_lev_old|fc_lev_new|fc_stu_1|fc_tut_1/u);
});

test('unmatched historical identities remain visible without leaking aliases', () => {
  const view = buildLessonExceptionDetailsView({
    source: { state: 'fresh', verified: true },
    details: [{
      fcEventId: 'fc_lev_old',
      localDate: '2026-09-01',
      tutorExternalId: 'tch_unknown',
      participations: [{
        fcParticipationId: 'fc_lpt_old',
        studentExternalId: 'sdt_unknown',
      }],
      nearbyCandidates: [{
        fcEventId: 'fc_lev_current',
        localDate: '2026-09-04',
        tutorExternalId: 'tch_unknown',
        matchedStudentExternalIds: ['sdt_unknown'],
      }],
    }],
  });

  assert.equal(view.events[0].participants[0].displayName, 'Unmatched student');
  assert.equal(view.events[0].unmatchedParticipantCount, 1);
  assert.equal(view.events[0].nearbyCandidates[0].unmatchedStudentCount, 1);
  assert.doesNotMatch(JSON.stringify(view), /sdt_unknown|tch_unknown/u);
});
