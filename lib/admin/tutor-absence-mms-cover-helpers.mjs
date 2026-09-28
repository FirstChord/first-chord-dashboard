/** @fileoverview Validate saved tutor-cover lessons against exact MMS event occurrences before a substitute edit. */

function fail(message) {
  throw Object.assign(new Error(message), { status: 409, code: 'MMS_COVER_CONFLICT' });
}

export function buildMmsCoverTargets({ state, absentTutor, coverTutor } = {}) {
  if (!state?.absenceId || state.decision !== 'cover' || state.status === 'resolved') fail('Save an open cover decision first.');
  if (!state.messageState?.__workflow?.coverTutorConfirmed) fail('Confirm the cover tutor and save progress first.');
  if (!absentTutor?.teacherId || !coverTutor?.teacherId || absentTutor.teacherId === coverTutor.teacherId) {
    fail('Both tutors must have different MMS teacher IDs.');
  }
  if (state.tutorShortName !== absentTutor.shortName || state.coverTutorShortName !== coverTutor.shortName) {
    fail('The saved tutor choice has changed. Save progress and try again.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.absenceDate || '')) fail('The saved absence date is invalid.');
  const byId = new Map();
  for (const lesson of state.affectedLessons || []) {
    if (!/^evt_[A-Za-z0-9_-]+$/.test(lesson.eventId || '') || !/^sdt_[A-Za-z0-9_-]+$/.test(lesson.studentMmsId || '')) {
      fail('A saved lesson lacks an MMS event or student ID.');
    }
    if (lesson.lessonDate !== state.absenceDate || !lesson.startAt?.startsWith(`${state.absenceDate}T`)) {
      fail('A saved lesson date differs from the absence date.');
    }
    const target = byId.get(lesson.eventId) || { eventId: lesson.eventId, startAt: lesson.startAt, durationMinutes: Number(lesson.durationMinutes), studentIds: [] };
    if (target.startAt !== lesson.startAt || target.durationMinutes !== Number(lesson.durationMinutes)) fail('Saved students on one event have conflicting lesson times.');
    if (!Number.isFinite(target.durationMinutes) || target.durationMinutes <= 0) fail('A saved lesson has no valid duration.');
    target.studentIds.push(lesson.studentMmsId);
    byId.set(lesson.eventId, target);
  }
  if (!byId.size) fail('No saved lessons are available for this cover date.');
  return [...byId.values()].map((target) => ({
    ...target, studentIds: [...new Set(target.studentIds)].sort(),
  }));
}

export function validateMmsCoverEvent({ event, target, absentTeacherId, coverTeacherId } = {}) {
  if (!event || event.ID !== target.eventId || event.StartDate !== target.startAt || Number(event.Duration) !== target.durationMinutes) fail('An MMS lesson moved or could not be matched.');
  // This PUT shape has been verified on a one-off event. Recurring occurrences
  // need their own contract test before we risk changing an entire series.
  if (event.Recurring !== false) fail('Recurring MMS lessons need manual cover for now; no edit was sent.');
  if (event.OriginalTeacherID !== absentTeacherId) fail('The original MMS tutor differs from the saved absence.');
  const students = (event.Attendances || []).map((attendance) => attendance.StudentID).filter(Boolean).sort();
  if (students.length !== target.studentIds.length || students.some((id, index) => id !== target.studentIds[index])) {
    fail('The students on the MMS lesson have changed.');
  }
  if (event.TeacherID === coverTeacherId) return 'already_updated';
  if (event.TeacherID !== absentTeacherId) fail('A different tutor is already assigned to this MMS lesson.');
  return 'needs_update';
}
