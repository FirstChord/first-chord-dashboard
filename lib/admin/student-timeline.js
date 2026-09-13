/** @fileoverview Composes one read-only student timeline from existing logs, caches, and verified lesson observations. */
import { getCommunicationLogForStudent } from './communications.js';
import { getLessonOccurrenceObservations } from './lesson-mirror-store.mjs';
import { buildScheduledLessonMirrorWindow } from './lesson-window-helpers.mjs';
import { matchPauseHistoryRows } from './pause-helpers.mjs';
import {
  getEventLogRows,
  getPauseHistoryRows,
  getPracticeNoteLogRows,
} from './sheets.js';
import { getStudentLifecycleRow } from './sheets/student-lifecycle.mjs';
import { buildStudentTimeline } from './student-timeline-helpers.mjs';
import { getAllTutorOptions } from './tutors.js';

function fulfilled(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function readState(key, label, result, observedAt = '') {
  return {
    key,
    label,
    status: result.status === 'fulfilled' ? 'available' : 'unavailable',
    observedAt,
  };
}

async function getMmsBackedLessonHistory(mmsId, currentDate) {
  const window = buildScheduledLessonMirrorWindow({
    at: currentDate,
    futureDays: 0,
  });
  const read = await getLessonOccurrenceObservations({
    startDate: window.startDate,
    // Recent activity is historical. Excluding today avoids presenting a
    // merely scheduled lesson later today as something that already happened.
    endDateExclusive: window.today,
    studentExternalIds: [mmsId],
    now: currentDate,
  });
  const tutorsByProviderId = new Map(
    getAllTutorOptions()
      .filter((tutor) => tutor.teacherId)
      .map((tutor) => [tutor.teacherId, tutor]),
  );
  const rows = read.source?.verified
    ? (read.observations || []).map((observation) => ({
        lessonId: observation.fcEventId,
        participationId: observation.fcParticipationId,
        localDate: observation.localDate,
        localTime: observation.localTime,
        timeZone: observation.timeZone,
        durationMinutes: observation.durationMinutes,
        tutorName: tutorsByProviderId.get(observation.tutorExternalId)?.fullName || '',
        attendanceLabel: observation.rawAttendanceStatus,
        observedAt: observation.mirrorObservedAt || observation.participationObservedAt,
      }))
    : [];

  return {
    source: {
      key: 'lesson_ledger',
      label: 'Lesson ledger',
      provider: 'MMS-backed',
      observedAt: read.source?.lastVerifiedAt || '',
      status: read.source?.verified ? 'available' : read.source?.state || 'unavailable',
    },
    // Provider aliases end here. Only stable First Chord identities and
    // resolved display context cross into the timeline contract.
    // At most three recent observations: enough continuity for the compact
    // timeline without turning an ordinary weekly register into activity noise.
    rows: rows.slice(-3),
  };
}

export async function getStudentTimelineProjection({
  student = {},
  currentDate = new Date(),
  limit = 12,
} = {}) {
  const mmsId = `${student.mmsId || ''}`.trim();
  if (!mmsId) {
    return {
      timeline: buildStudentTimeline({ limit }),
      practiceNotes: [],
      recentPracticeNotes: [],
      recentCommunications: [],
      lifecycleRow: null,
    };
  }

  const [eventLogResult, pauseResult, practiceResult, communicationResult, lifecycleResult, lessonResult] = await Promise.allSettled([
    getEventLogRows(),
    getPauseHistoryRows(),
    getPracticeNoteLogRows(mmsId),
    getCommunicationLogForStudent(mmsId, { limit: 20 }),
    getStudentLifecycleRow(mmsId),
    getMmsBackedLessonHistory(mmsId, currentDate),
  ]);

  const eventLogRows = fulfilled(eventLogResult, []);
  const pauseRows = fulfilled(pauseResult, []);
  const practiceNoteRows = fulfilled(practiceResult, []);
  const communicationRows = fulfilled(communicationResult, []);
  const lifecycleRow = fulfilled(lifecycleResult, null);
  const lessonHistory = fulfilled(lessonResult, {
    rows: [],
    source: {
      key: 'lesson_ledger',
      label: 'Lesson ledger',
      provider: 'MMS-backed',
      observedAt: '',
      status: 'unavailable',
    },
  });
  const matchedPauseRows = matchPauseHistoryRows({
    studentEmail: student.email,
    studentName: student.fullName,
    stripeSubscriptionId: student.stripeSubscriptionId,
    pauseRows,
  });
  const sourceStates = [
    readState('event_log', 'Event Log', eventLogResult),
    readState('pause_history', 'Pause History', pauseResult),
    readState('practice_notes_log', 'Practice Notes Log', practiceResult),
    readState('communication_log', 'Communication Log', communicationResult),
    readState('student_lifecycle', 'Student Lifecycle', lifecycleResult, lifecycleRow?.refreshedAt),
    {
      key: lessonHistory.source.key,
      label: lessonHistory.source.label,
      status: lessonResult.status === 'fulfilled' ? lessonHistory.source.status : 'unavailable',
      observedAt: lessonHistory.source.observedAt,
    },
  ];

  return {
    timeline: buildStudentTimeline({
      eventLogRows,
      pauseHistoryRows: matchedPauseRows,
      practiceNoteRows: practiceNoteRows.slice(0, 3),
      communicationRows: communicationRows.slice(0, 5),
      lessonHistoryRows: lessonHistory.rows,
      lessonSource: lessonHistory.source,
      lifecycleRow,
      sourceStates,
      mmsId,
      limit,
    }),
    practiceNotes: practiceNoteRows,
    recentPracticeNotes: practiceNoteRows.slice(0, 5),
    recentCommunications: communicationRows.slice(0, 5),
    lifecycleRow,
  };
}
