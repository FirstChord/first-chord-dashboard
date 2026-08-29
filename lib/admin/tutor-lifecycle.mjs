/** @fileoverview Server reads and writes for tutor lifecycle state and the offboarding context assembled from students, schedules, payroll, and absences. */
import {
  appendEventLogRows,
  getPayrollRunRows,
  getPlanningItemRows,
  getScheduleContextRows,
  getTutorAbsenceStateRows,
  upsertTutorLifecycleRow,
} from './sheets.js';
import { getOperationalAdminStudents } from './students.js';
import { getTeachingRelationshipDashboard } from './teaching-relationships.js';
import { getTutorOptionsWithLifecycle, normaliseTutorLifecycleStatus } from './tutors.js';
import { buildTutorLifecycleEvent, normaliseTutorLifecycleDate, tutorMatchesIdentity } from './tutor-lifecycle-helpers.mjs';

function text(value = '') {
  return `${value || ''}`.trim();
}

export { buildTutorLifecycleEvent, normaliseTutorLifecycleDate, tutorMatchesIdentity } from './tutor-lifecycle-helpers.mjs';

export async function getTutorLifecycleDashboard() {
  return getTeachingRelationshipDashboard();
}

export async function getTutorOffboardingContext({ teacherId = '' } = {}) {
  const tutors = await getTutorOptionsWithLifecycle();
  const tutor = tutors.find((entry) => entry.teacherId === teacherId) || null;
  if (!tutor) return null;

  const [students, payrollRows, planningRows, absenceRows, scheduleRows] = await Promise.all([
    getOperationalAdminStudents(),
    getPayrollRunRows(),
    getPlanningItemRows(),
    getTutorAbsenceStateRows(),
    getScheduleContextRows(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const assignedStudents = students.filter((student) => tutorMatchesIdentity(student.tutor || student.registryTutor, tutor));
  const unpaidPayroll = payrollRows.filter((row) => (
    tutorMatchesIdentity(row.tutor_short_name || row.tutorShortName || row.tutor, tutor)
    && text(row.status).toLowerCase() !== 'paid'
  ));
  const openPlanning = planningRows.filter((row) => (
    tutorMatchesIdentity(row.linkedTutorId, tutor)
    && !['done', 'parked'].includes(text(row.status).toLowerCase())
  ));
  const openAbsences = absenceRows.filter((row) => (
    (text(row.tutorShortName) === tutor.shortName || text(row.tutorName) === tutor.fullName)
    && !['resolved'].includes(text(row.status).toLowerCase())
  ));
  const upcomingLessons = scheduleRows.filter((row) => (
    text(row.teacherId) === tutor.teacherId
    && text(row.nextLessonAt).slice(0, 10) >= today
  ));

  return {
    tutor,
    warnings: {
      assignedStudents: assignedStudents.map((student) => ({ mmsId: student.mmsId, fullName: student.fullName })),
      unpaidPayroll: unpaidPayroll.map((row) => ({ payrollId: row.payroll_id || row.payrollId, status: row.status, periodEnd: row.period_end || row.periodEnd })),
      openPlanning: openPlanning.map((row) => ({ planningId: row.planningId, title: row.title })),
      openAbsences: openAbsences.map((row) => ({ absenceId: row.absenceId, absenceDate: row.absenceDate })),
      upcomingLessons: upcomingLessons.map((row) => ({ mmsId: row.mmsId, studentName: row.studentName, nextLessonAt: row.nextLessonAt })),
    },
  };
}

export async function saveTutorLifecycle({
  teacherId = '',
  action = '',
  finalTeachingDate = '',
  replacementTutorShortName = '',
  note = '',
  actorEmail = '',
} = {}) {
  const tutors = await getTutorOptionsWithLifecycle();
  const tutor = tutors.find((entry) => entry.teacherId === text(teacherId));
  if (!tutor) throw new Error('Tutor was not found in the shared tutor list');

  const cleanAction = text(action);
  const now = new Date().toISOString();
  let nextStatus;
  if (cleanAction === 'mark_leaving') nextStatus = 'leaving';
  if (cleanAction === 'retire') nextStatus = 'retired';
  if (cleanAction === 'restore_active') nextStatus = 'active';
  if (!nextStatus) throw new Error('Unsupported tutor lifecycle action');

  const date = normaliseTutorLifecycleDate(finalTeachingDate) || tutor.finalTeachingDate;
  if (nextStatus === 'leaving' && !date) {
    throw new Error('Choose the tutor’s final teaching date before marking them as leaving.');
  }
  if (nextStatus === 'retired') {
    const today = new Date().toISOString().slice(0, 10);
    if (!date || date > today) {
      throw new Error('A tutor can be retired on or after their final teaching date.');
    }
  }
  const replacement = text(replacementTutorShortName);
  if (replacement && !tutors.some((entry) => entry.shortName === replacement && entry.teacherId !== tutor.teacherId)) {
    throw new Error('Choose a different tutor as the replacement.');
  }

  const nextTutor = {
    ...tutor,
    lifecycleStatus: nextStatus,
    finalTeachingDate: nextStatus === 'active' ? '' : date,
    retiredAt: nextStatus === 'retired' ? now : '',
    replacementTutorShortName: nextStatus === 'active' ? '' : replacement,
    lifecycleNote: text(note),
  };
  await upsertTutorLifecycleRow({
    teacherId: nextTutor.teacherId,
    tutorShortName: nextTutor.shortName,
    tutorName: nextTutor.fullName,
    status: nextStatus,
    finalTeachingDate: nextTutor.finalTeachingDate,
    retiredAt: nextTutor.retiredAt,
    replacementTutorShortName: nextTutor.replacementTutorShortName,
    note: nextTutor.lifecycleNote,
    createdAt: tutor.lifecycleCreatedAt || now,
    updatedAt: now,
    updatedBy: actorEmail,
  });
  await appendEventLogRows([
    buildTutorLifecycleEvent({
      tutor: nextTutor,
      previousStatus: normaliseTutorLifecycleStatus(tutor.lifecycleStatus),
      nextStatus: normaliseTutorLifecycleStatus(nextStatus),
      actorEmail,
      occurredAt: now,
      note,
    }),
  ]);
  return nextTutor;
}
