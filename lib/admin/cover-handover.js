/** @fileoverview Admin-only read orchestration for a saved, checked tutor-cover teaching handover. */
import mmsClient from '../mms-client-cached.js';
import { getMmsCalendarEvent } from './mms.js';
import { getTutorOptionsWithLifecycle } from './tutors.js';
import { getPracticeNoteLogRows, getTutorAbsenceStateRows } from './sheets.js';
import { parseTutorAbsenceStateRow } from './tutor-absence-helpers.mjs';
import { buildMmsCoverTargets } from './tutor-absence-mms-cover-helpers.mjs';
import { buildCoverHandoverContext, buildCoverHandoverSummary, validateCoverHandoverEvent } from './cover-handover-helpers.mjs';

export async function createCoverHandover({ absenceId = '', expectedUpdatedAt = '' } = {}) {
  if (!/^tutor_absence:[^:]+:\d{4}-\d{2}-\d{2}$/u.test(absenceId) || !expectedUpdatedAt) {
    throw Object.assign(new Error('Save and confirm the cover decision first.'), { status: 400 });
  }
  const rows = await getTutorAbsenceStateRows(absenceId);
  const state = rows[0] ? parseTutorAbsenceStateRow(rows[0]) : null;
  if (!state || state.updatedAt !== expectedUpdatedAt) {
    throw Object.assign(new Error('The cover decision changed. Refresh the page and try again.'), { status: 409 });
  }
  const tutors = await getTutorOptionsWithLifecycle();
  const absentTutor = tutors.find((tutor) => tutor.shortName === state.tutorShortName);
  const coverTutor = tutors.find((tutor) => tutor.shortName === state.coverTutorShortName);
  const targets = buildMmsCoverTargets({ state, absentTutor, coverTutor });
  if (targets.length > 12 || state.affectedLessons.length > 12) {
    throw Object.assign(new Error('This cover group is too large for a short handover. Brief the tutor directly.'), { status: 400 });
  }
  for (const target of targets) {
    const event = await getMmsCalendarEvent(target.eventId);
    validateCoverHandoverEvent({ event, target, absentTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId });
  }
  const studentIds = [...new Set(state.affectedLessons.map((lesson) => lesson.studentMmsId))];
  const [practiceRows, histories] = await Promise.all([
    getPracticeNoteLogRows(),
    Promise.all(studentIds.map(async (studentId) => {
      const result = await mmsClient.getStudentLessonHistory(studentId, 12);
      if (!result?.success) throw new Error('MMS teaching notes could not be checked. Try again later.');
      return [studentId, result.lessons || []];
    })),
  ]);
  const students = buildCoverHandoverContext({ state, practiceRows, mmsHistories: Object.fromEntries(histories) });
  const latestRows = await getTutorAbsenceStateRows(absenceId);
  const latestState = latestRows[0] ? parseTutorAbsenceStateRow(latestRows[0]) : null;
  if (latestState?.updatedAt !== expectedUpdatedAt) {
    throw Object.assign(new Error('The cover decision changed while notes were gathered. Refresh and try again.'), { status: 409 });
  }
  return {
    sourceUpdatedAt: state.updatedAt,
    coverDate: state.absenceDate,
    coverTutorName: coverTutor.fullName,
    students: students.map((student) => ({
      studentName: student.studentName,
      lessonTime: student.lessonTime,
      instrument: student.instrument,
      summary: buildCoverHandoverSummary(student),
      evidence: student.notes.map(({ date, source }) => ({ date, source })),
    })),
  };
}
