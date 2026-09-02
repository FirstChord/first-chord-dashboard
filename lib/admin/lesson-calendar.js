/** @fileoverview Composes an authenticated weekly calendar from fresh verified lesson-mirror observations. */
import { getStudentsSheetRows } from './sheets.js';
import { normaliseStudentSheetRow } from './student-context-helpers.mjs';
import { getAllTutorOptions } from './tutors.js';
import { getLessonMirrorCalendarObservations } from './lesson-mirror-store.mjs';
import { buildScheduledLessonMirrorWindow } from './lesson-window-helpers.mjs';
import {
  buildLessonCalendarView,
  buildLessonCalendarWindow,
} from './lesson-calendar-helpers.mjs';

export async function getLessonCalendarDashboard({ requestedWeek = '', currentDate = new Date() } = {}) {
  const scheduledWindow = buildScheduledLessonMirrorWindow({ at: currentDate });
  const window = buildLessonCalendarWindow({
    requestedWeek,
    today: scheduledWindow.today,
  });
  const [observationResult, studentResult] = await Promise.allSettled([
    getLessonMirrorCalendarObservations({
      startDate: window.weekStart,
      endDateExclusive: window.endDateExclusive,
      now: currentDate,
    }),
    getStudentsSheetRows(),
  ]);
  const observationRead = observationResult.status === 'fulfilled'
    ? observationResult.value
    : {
        source: {
          state: 'unavailable',
          verified: false,
          lastVerifiedAt: null,
          windowStart: '',
          windowEndExclusive: '',
          coversRequestedWindow: false,
        },
        observations: [],
      };
  const students = studentResult.status === 'fulfilled'
    ? studentResult.value.map(normaliseStudentSheetRow)
    : [];
  const view = buildLessonCalendarView({
    observations: observationRead.observations,
    students,
    tutors: getAllTutorOptions(),
    source: observationRead.source,
    window,
  });

  return {
    ...view,
    warnings: [
      ...(observationResult.status === 'rejected'
        ? ['The verified lesson calendar could not be loaded. No fallback source was substituted.']
        : []),
      ...(studentResult.status === 'rejected'
        ? ['Student names could not be joined. Lesson counts remain available without provider identifiers.']
        : []),
      ...(view.events.some((event) => event.unmatchedParticipantCount > 0)
        ? ['Some mirrored participations do not match a current Students row. They remain visibly unmatched.']
        : []),
    ],
  };
}
