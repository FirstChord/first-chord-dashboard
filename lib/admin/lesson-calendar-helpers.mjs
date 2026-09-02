/** @fileoverview Pure weekly calendar projection over fresh verified lesson-mirror observations. */

const DAY_MS = 86_400_000;

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function validDate(value = '') {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : '';
}

export function shiftLessonCalendarDate(value, days) {
  const date = validDate(value);
  if (!date || !Number.isInteger(days)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Date(parsed.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function lessonCalendarWeekStart(value) {
  const date = validDate(value);
  if (!date) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  const mondayOffset = (parsed.getUTCDay() + 6) % 7;
  return shiftLessonCalendarDate(date, -mondayOffset);
}

export function buildLessonCalendarWindow({ requestedWeek = '', today = '' } = {}) {
  const currentDate = validDate(today);
  if (!currentDate) throw new Error('A valid lesson calendar date is required');
  const weekStart = lessonCalendarWeekStart(requestedWeek) || lessonCalendarWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, index) => shiftLessonCalendarDate(weekStart, index));
  return {
    weekStart,
    endDateExclusive: shiftLessonCalendarDate(weekStart, 7),
    previousWeek: shiftLessonCalendarDate(weekStart, -7),
    nextWeek: shiftLessonCalendarDate(weekStart, 7),
    todayWeek: lessonCalendarWeekStart(currentDate),
    days,
  };
}

export function lessonCalendarEventKind({ categoryName = '', participantCount = 0 } = {}) {
  const category = text(categoryName).toLowerCase();
  const participants = Number(participantCount) || 0;
  if (category === 'break') return 'break';
  if (participants > 0) return 'lesson';
  if (category === 'free') return 'availability';
  if (category.startsWith('potential')) return 'potential';
  return 'other';
}

function attendanceSummary(participants = []) {
  const counts = new Map();
  for (const participant of participants) {
    const status = text(participant.rawAttendanceStatus) || 'Blank';
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}

export function buildLessonCalendarView({
  observations = [],
  students = [],
  tutors = [],
  source = {},
  window = {},
} = {}) {
  const studentsByExternalId = new Map(
    students.filter((student) => text(student.mmsId)).map((student) => [text(student.mmsId), student]),
  );
  const tutorsByExternalId = new Map(
    tutors.filter((tutor) => text(tutor.teacherId)).map((tutor) => [text(tutor.teacherId), tutor]),
  );
  const days = (window.days || []).map((date) => ({ date, events: [] }));
  const dayByDate = new Map(days.map((day) => [day.date, day]));

  for (const observation of observations) {
    const day = dayByDate.get(validDate(observation.localDate));
    if (!day) continue;
    const participants = (observation.participations || []).map((participation) => {
      const student = studentsByExternalId.get(text(participation.studentExternalId)) || null;
      return {
        fcParticipationId: text(participation.fcParticipationId),
        student: student ? {
          fcStudentId: text(student.fcStudentId),
          displayName: text(student.fullName) || 'Unnamed student',
          instrument: text(student.instrument),
          isTestStudent: student.isTestStudent === true,
        } : null,
        displayName: student ? (text(student.fullName) || 'Unnamed student') : 'Unmatched student',
        rawAttendanceStatus: text(participation.rawAttendanceStatus),
      };
    });
    const tutor = tutorsByExternalId.get(text(observation.tutorExternalId)) || null;
    const originalTutor = tutorsByExternalId.get(text(observation.originalTutorExternalId)) || null;
    const kind = lessonCalendarEventKind({
      categoryName: observation.categoryName,
      participantCount: participants.length,
    });
    const normalisedCategory = text(observation.categoryName).toLowerCase();
    const categoryConflict = participants.length > 0
      && (normalisedCategory === 'free' || normalisedCategory.startsWith('potential'));
    day.events.push({
      fcEventId: text(observation.fcEventId),
      fcSeriesId: text(observation.fcSeriesId),
      localDate: validDate(observation.localDate),
      localTime: text(observation.localTime).slice(0, 5),
      durationMinutes: observation.durationMinutes === null || observation.durationMinutes === undefined
        ? null
        : Number(observation.durationMinutes),
      categoryName: text(observation.categoryName) || 'Uncategorised',
      locationName: text(observation.locationName),
      kind,
      categoryConflict,
      tutor: tutor ? {
        fcTutorId: text(tutor.fcTutorId),
        shortName: text(tutor.shortName),
        displayName: text(tutor.fullName),
      } : null,
      originalTutor: originalTutor ? {
        fcTutorId: text(originalTutor.fcTutorId),
        shortName: text(originalTutor.shortName),
        displayName: text(originalTutor.fullName),
      } : null,
      participants,
      participantCount: participants.length,
      unmatchedParticipantCount: participants.filter((participant) => !participant.student).length,
      attendanceStatuses: attendanceSummary(participants),
    });
  }

  for (const day of days) {
    day.events.sort((left, right) => (
      left.localTime.localeCompare(right.localTime)
      || left.categoryName.localeCompare(right.categoryName)
      || left.fcEventId.localeCompare(right.fcEventId)
    ));
  }

  return {
    source: {
      state: text(source.state),
      verified: source.verified === true,
      lastVerifiedAt: source.lastVerifiedAt || null,
      windowStart: validDate(source.windowStart),
      windowEndExclusive: validDate(source.windowEndExclusive),
      coversRequestedWindow: source.coversRequestedWindow === true,
    },
    window,
    days,
    events: days.flatMap((day) => day.events),
  };
}
