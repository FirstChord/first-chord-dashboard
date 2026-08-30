/** @fileoverview Pure provider-neutral lesson-occurrence context, evidence matching, parity, and bounded timeline selection. */

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function validDate(value = '') {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? '' : candidate;
}

function validTime(value = '') {
  const match = text(value).match(/^(\d{2}):(\d{2})/u);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${match[1]}:${match[2]}` : '';
}

function validIso(value = '') {
  const candidate = value instanceof Date ? value.toISOString() : text(value);
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? '' : candidate;
}

function timingForDate(date, today) {
  if (!date || !today) return 'unknown';
  if (date < today) return 'past';
  if (date === today) return 'today';
  return 'upcoming';
}

function occurrenceState(timing) {
  return {
    past: { code: 'past', label: 'Past observation' },
    today: { code: 'today', label: 'Today' },
    upcoming: { code: 'upcoming', label: 'Upcoming' },
    unknown: { code: 'unknown', label: 'Date needs review' },
  }[timing];
}

function noteProjection(note, matchKind, confidence) {
  if (!note) return null;
  return {
    noteId: text(note.noteId),
    lessonDate: validDate(note.lessonDate),
    deliveryStatus: text(note.deliveryStatus) || 'unknown',
    observedAt: validIso(note.observedAt),
    manualFollowUpNeeded: note.manualFollowUpNeeded === true,
    matchKind,
    matchConfidence: confidence,
  };
}

/**
 * Links a practice note at the strongest available grain. Older notes may lack
 * provider references, so a unique same-student/date/tutor match is retained as
 * medium-confidence context; ambiguity remains explicit and attaches no note.
 */
export function matchPracticeNoteToLessonOccurrence({
  notes = [],
  studentExternalId = '',
  eventExternalId = '',
  attendanceExternalId = '',
  localDate = '',
  tutorShortName = '',
} = {}) {
  const studentNotes = notes.filter((note) => text(note.studentMmsId) === text(studentExternalId));
  const attendanceMatches = attendanceExternalId
    ? studentNotes.filter((note) => text(note.mmsAttendanceId) === text(attendanceExternalId))
    : [];
  if (attendanceMatches.length === 1) {
    return { note: noteProjection(attendanceMatches[0], 'attendance_reference', 'high'), warnings: [] };
  }
  if (attendanceMatches.length > 1) {
    return {
      note: null,
      warnings: [{ code: 'practice_note_attendance_ambiguous', detail: 'More than one practice note names this attendance reference.' }],
    };
  }

  const eventMatches = eventExternalId
    ? studentNotes.filter((note) => text(note.mmsEventId) === text(eventExternalId))
    : [];
  if (eventMatches.length === 1) {
    return { note: noteProjection(eventMatches[0], 'event_reference', 'high'), warnings: [] };
  }
  if (eventMatches.length > 1) {
    return {
      note: null,
      warnings: [{ code: 'practice_note_event_ambiguous', detail: 'More than one practice note names this lesson event.' }],
    };
  }

  const dateTutorMatches = studentNotes.filter((note) => (
    validDate(note.lessonDate) === validDate(localDate)
    && (!text(tutorShortName) || text(note.tutorShortName) === text(tutorShortName))
  ));
  if (dateTutorMatches.length === 1) {
    return { note: noteProjection(dateTutorMatches[0], 'unique_date_tutor', 'medium'), warnings: [] };
  }
  if (dateTutorMatches.length > 1) {
    return {
      note: null,
      warnings: [{ code: 'practice_note_date_ambiguous', detail: 'Several practice notes could belong to this lesson date.' }],
    };
  }
  return { note: null, warnings: [] };
}

function evidence(code, label, value, sourceSystem, observedAt = '') {
  return {
    code,
    label,
    value: text(value),
    sourceSystem,
    observedAt: validIso(observedAt),
  };
}

function tutorProjection(tutor = {}) {
  const hasTutor = text(tutor.fcTutorId) || text(tutor.shortName) || text(tutor.displayName);
  if (!hasTutor) return null;
  return {
    fcTutorId: text(tutor.fcTutorId),
    shortName: text(tutor.shortName),
    displayName: text(tutor.displayName),
  };
}

export function resolveLessonOccurrenceContext({
  observation = {},
  student = {},
  relationship = {},
  scheduledTutor = {},
  originalTutor = {},
  practiceNote = null,
  absence = null,
  coverTutor = {},
  source = {},
  today = '',
  warnings = [],
} = {}) {
  const date = validDate(observation.localDate);
  const time = validTime(observation.localTime);
  const currentDate = validDate(today);
  const timing = timingForDate(date, currentDate);
  const state = occurrenceState(timing);
  const scheduledTutorProjection = tutorProjection(scheduledTutor);
  const originalTutorProjection = tutorProjection(originalTutor);
  const coverTutorProjection = tutorProjection(coverTutor);
  const conflicts = [];
  const conditions = [];
  const attentionItems = [];
  const stableIdentityMissing = !text(observation.fcEventId)
    || !text(observation.fcParticipationId)
    || !text(student.fcStudentId);

  if (stableIdentityMissing) {
    conflicts.push({
      code: 'missing_first_chord_lesson_identity',
      detail: 'A stable First Chord event, participation or student identity is missing.',
    });
  }
  if (!source.verified) {
    conditions.push({
      code: 'lesson_snapshot_not_current',
      label: 'Last verified lesson snapshot only',
      severity: 'review',
    });
  }

  const relationshipTutorId = text(relationship.tutor?.fcTutorId);
  const scheduledTutorId = text(scheduledTutorProjection?.fcTutorId);
  const tutorDiffersFromRelationship = Boolean(
    relationshipTutorId
    && scheduledTutorId
    && relationshipTutorId !== scheduledTutorId
  );
  if (tutorDiffersFromRelationship && text(absence?.decision) !== 'cover') {
    conditions.push({
      code: 'scheduled_tutor_differs',
      label: 'Scheduled tutor differs from assignment',
      severity: 'review',
    });
  }
  if (
    originalTutorProjection?.fcTutorId
    && scheduledTutorProjection?.fcTutorId
    && originalTutorProjection.fcTutorId !== scheduledTutorProjection.fcTutorId
  ) {
    conditions.push({ code: 'substitute_observed', label: 'Substitute tutor observed', severity: 'info' });
  }

  const absenceDecision = text(absence?.decision);
  const exception = ['cover', 'cancel'].includes(absenceDecision) ? {
    code: absenceDecision,
    label: absenceDecision === 'cover' ? 'Tutor cover' : 'Tutor absence cancellation',
    workflowStatus: text(absence?.status) || 'unknown',
    workflowId: text(absence?.absenceId),
    coverTutor: absenceDecision === 'cover' ? coverTutorProjection : null,
  } : null;

  const workflowState = absence?.messageState?.__workflow || {};
  if (
    absenceDecision === 'cover'
    && workflowState.calendarUpdated === true
    && source.verified
    && coverTutorProjection?.fcTutorId
    && scheduledTutorProjection?.fcTutorId
    && coverTutorProjection.fcTutorId !== scheduledTutorProjection.fcTutorId
  ) {
    attentionItems.push({
      code: 'cover_calendar_mismatch',
      severity: 'review',
      title: 'Cover calendar needs checking',
      detail: `${coverTutorProjection.displayName || coverTutorProjection.shortName} is recorded as cover, but the verified lesson snapshot still names ${scheduledTutorProjection.displayName || scheduledTutorProjection.shortName}.`,
      dueDate: date,
      clearsWhen: 'The verified lesson snapshot names the cover tutor, or the tutor-absence record is corrected.',
      evidence: [
        evidence('cover_tutor', 'Recorded cover tutor', coverTutorProjection.displayName || coverTutorProjection.shortName, 'tutor_absence_state', absence?.updatedAt),
        evidence('scheduled_tutor', 'Tutor on verified lesson', scheduledTutorProjection.displayName || scheduledTutorProjection.shortName, 'lesson_mirror', source.lastVerifiedAt),
      ],
      recommendedWorkflow: { code: 'tutor_absence_review', label: 'Open cover workflow' },
    });
  }

  if (practiceNote?.manualFollowUpNeeded) {
    conditions.push({ code: 'practice_note_follow_up', label: 'Practice note follow-up', severity: 'review' });
    attentionItems.push({
      code: 'practice_note_follow_up',
      severity: 'review',
      title: 'Practice note delivery needs review',
      detail: 'The linked practice-note record is explicitly marked for manual follow-up.',
      dueDate: date,
      clearsWhen: 'The existing Practice Delivery issue is reviewed and its follow-up flag is cleared.',
      evidence: [
        evidence('practice_note_delivery', 'Delivery status', practiceNote.deliveryStatus, 'practice_notes_log', practiceNote.observedAt),
      ],
      recommendedWorkflow: { code: 'practice_delivery_review', label: 'Review practice delivery' },
    });
  }

  return {
    schemaVersion: 1,
    occurrenceId: stableIdentityMissing ? '' : `lesson:${text(observation.fcParticipationId)}`,
    eventId: text(observation.fcEventId),
    seriesId: text(observation.fcSeriesId),
    participationId: text(observation.fcParticipationId),
    relationshipId: text(relationship.relationshipId),
    student: {
      fcStudentId: text(student.fcStudentId),
      displayName: text(student.displayName),
      instrument: text(student.instrument),
    },
    scheduledTutor: scheduledTutorProjection,
    originalTutor: originalTutorProjection,
    lesson: {
      date,
      time,
      timeZone: text(observation.timeZone) || 'Europe/London',
      durationMinutes: Number.isInteger(observation.durationMinutes) ? observation.durationMinutes : null,
      rawSourceStatus: text(observation.sourceStatus),
    },
    state: {
      ...state,
      confidence: source.verified && !stableIdentityMissing ? 'high' : 'low',
    },
    attendance: {
      observed: observation.attendanceObserved === true,
      rawStatus: text(observation.rawAttendanceStatus),
      observedAt: validIso(observation.participationObservedAt || observation.mirrorObservedAt),
    },
    practiceNote,
    exception,
    conditions,
    attentionItems,
    provenance: {
      sourceSystem: 'lesson_mirror',
      sourceState: text(source.state) || 'unknown',
      verified: source.verified === true,
      observedAt: validIso(source.lastVerifiedAt || observation.mirrorObservedAt),
      conflicts,
      warnings: warnings.filter(Boolean),
    },
  };
}

function occurrenceKey(occurrence = {}) {
  return `${occurrence.lesson?.date || ''}T${occurrence.lesson?.time || ''}:${occurrence.participationId || occurrence.occurrenceId || ''}`;
}

export function sortLessonOccurrences(occurrences = []) {
  return [...occurrences].sort((left, right) => occurrenceKey(left).localeCompare(occurrenceKey(right)));
}

export function selectLessonOccurrenceHighlights(occurrences = [], { today = '', limit = 4 } = {}) {
  const currentDate = validDate(today);
  const ordered = sortLessonOccurrences(occurrences);
  const past = ordered.filter((item) => item.lesson?.date < currentDate);
  const todayRows = ordered.filter((item) => item.lesson?.date === currentDate);
  const future = ordered.filter((item) => item.lesson?.date > currentDate);
  const preferred = [
    ...ordered.filter((item) => item.attentionItems?.length),
    past.at(-1),
    ...todayRows,
    ...future.slice(0, 2),
  ].filter(Boolean);
  const selected = [];
  const seen = new Set();
  for (const occurrence of preferred) {
    const key = occurrence.occurrenceId || occurrence.participationId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(occurrence);
  }
  return sortLessonOccurrences(selected.slice(0, Math.max(1, Math.min(limit, 8))));
}

export function summariseLessonOccurrences(occurrences = [], { today = '' } = {}) {
  const currentDate = validDate(today);
  return occurrences.reduce((summary, occurrence) => {
    summary.total += 1;
    const timing = timingForDate(occurrence.lesson?.date, currentDate);
    summary[timing] = (summary[timing] || 0) + 1;
    if (occurrence.exception?.code === 'cover') summary.cover += 1;
    if (occurrence.exception?.code === 'cancel') summary.cancel += 1;
    if (occurrence.attentionItems?.length) summary.attention += 1;
    return summary;
  }, { total: 0, past: 0, today: 0, upcoming: 0, unknown: 0, cover: 0, cancel: 0, attention: 0 });
}

export function compareNextOccurrenceToSchedule({ occurrence = null, schedule = {}, today = '' } = {}) {
  if (!occurrence || !occurrence.provenance?.verified || schedule.freshness !== 'fresh' || schedule.status !== 'found') {
    return {
      status: 'not_checked',
      label: 'Dual-read comparison unavailable',
      reasons: [],
    };
  }
  const scheduleDate = validDate(schedule.nextLessonAt);
  const currentDate = validDate(today);
  // Schedule_Context stores the lesson that was next when it was refreshed. A
  // fresh cache can therefore legitimately point to yesterday after that
  // lesson passes; comparing it with today's next occurrence would manufacture
  // a disagreement where the two sources are simply answering different times.
  if (!scheduleDate || (currentDate && scheduleDate < currentDate)) {
    return {
      status: 'not_checked',
      label: 'Schedule cache needs a new next-lesson observation before comparison',
      reasons: [],
    };
  }
  const scheduleTime = validTime(text(schedule.nextLessonAt).slice(11));
  const occurrenceDate = validDate(occurrence.lesson?.date);
  const occurrenceTime = validTime(occurrence.lesson?.time);
  const reasons = [];
  if (scheduleDate !== occurrenceDate) reasons.push('The next lesson date differs between the schedule cache and lesson ledger.');
  if (scheduleTime && occurrenceTime && scheduleTime !== occurrenceTime) reasons.push('The next lesson time differs between the schedule cache and lesson ledger.');
  if (schedule.matchesAssignedTutor === false) reasons.push('The schedule cache does not agree with the assigned tutor.');
  if (
    occurrence.relationshipId
    && occurrence.scheduledTutor?.fcTutorId
    && schedule.assignedTutorId
    && occurrence.scheduledTutor.fcTutorId !== schedule.assignedTutorId
  ) reasons.push('The verified lesson tutor differs from the assigned tutor.');
  return reasons.length ? {
    status: 'different',
    label: 'Lesson sources need review',
    reasons,
  } : {
    status: 'matched',
    label: 'Schedule cache and lesson ledger agree',
    reasons: [],
  };
}
