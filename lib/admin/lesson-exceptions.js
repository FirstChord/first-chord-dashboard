/** @fileoverview Composes authenticated lesson-mirror exception details while stripping provider aliases before rendering. */
import { getStudentsSheetRows } from './sheets.js';
import { normaliseStudentSheetRow } from './student-context-helpers.mjs';
import { getAllTutorOptions } from './tutors.js';
import { getLessonMirrorExceptionDetails } from './lesson-mirror-store.mjs';
import { buildLessonExceptionDetailsView } from './lesson-exception-helpers.mjs';

export async function getLessonExceptionDashboard({ currentDate = new Date(), limit = 250 } = {}) {
  const [detailResult, studentResult] = await Promise.allSettled([
    getLessonMirrorExceptionDetails({ now: currentDate, limit }),
    getStudentsSheetRows(),
  ]);
  const detailRead = detailResult.status === 'fulfilled'
    ? detailResult.value
    : {
        source: {
          state: 'unavailable',
          verified: false,
          lastVerifiedAt: null,
          windowStart: '',
          windowEndExclusive: '',
        },
        totalCount: 0,
        details: [],
      };
  const students = studentResult.status === 'fulfilled'
    ? studentResult.value.map(normaliseStudentSheetRow)
    : [];
  const view = buildLessonExceptionDetailsView({
    details: detailRead.details,
    students,
    tutors: getAllTutorOptions(),
    source: detailRead.source,
    totalCount: detailRead.totalCount,
  });

  return {
    ...view,
    warnings: [
      ...(detailResult.status === 'rejected'
        ? ['The verified exception detail could not be loaded. No older snapshot was substituted.']
        : []),
      ...(studentResult.status === 'rejected'
        ? ['Student names could not be joined. Exceptions remain visible without provider identifiers.']
        : []),
      ...(view.events.some((event) => event.unmatchedParticipantCount > 0)
        ? ['Some historical participations do not match a current Students row and remain visibly unmatched.']
        : []),
    ],
  };
}
