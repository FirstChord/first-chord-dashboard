/** @fileoverview Pure, provider-safe projection for detailed lesson-mirror non-observation evidence. */

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function date(value = '') {
  const candidate = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : '';
}

function tutorView(tutor) {
  return tutor ? {
    fcTutorId: text(tutor.fcTutorId),
    shortName: text(tutor.shortName) || 'Unnamed tutor',
    displayName: text(tutor.fullName),
  } : null;
}

function studentView(student) {
  return student ? {
    fcStudentId: text(student.fcStudentId),
    displayName: text(student.fullName) || 'Unnamed student',
    instrument: text(student.instrument),
    isTestStudent: student.isTestStudent === true,
  } : null;
}

export function lessonExceptionEvidenceKind(detail = {}) {
  const candidates = Array.isArray(detail.nearbyCandidates) ? detail.nearbyCandidates : [];
  if (candidates.some((candidate) => candidate.sameSlot === true)) return 'same_slot';
  if (candidates.some((candidate) => date(candidate.localDate) === date(detail.localDate))) return 'same_day';
  if (candidates.length) return 'nearby';
  return 'no_nearby';
}

export function buildLessonExceptionDetailsView({
  details = [],
  students = [],
  tutors = [],
  source = {},
  totalCount = 0,
} = {}) {
  const studentsByExternalId = new Map(
    students.filter((student) => text(student.mmsId)).map((student) => [text(student.mmsId), student]),
  );
  const tutorsByExternalId = new Map(
    tutors.filter((tutor) => text(tutor.teacherId)).map((tutor) => [text(tutor.teacherId), tutor]),
  );

  const events = details.map((detail) => {
    const participants = (detail.participations || []).map((participation) => {
      const student = studentsByExternalId.get(text(participation.studentExternalId)) || null;
      return {
        fcParticipationId: text(participation.fcParticipationId),
        student: studentView(student),
        displayName: student ? (text(student.fullName) || 'Unnamed student') : 'Unmatched student',
        rawAttendanceStatus: text(participation.rawAttendanceStatus),
        lastObservedAt: participation.lastObservedAt || null,
      };
    });
    const nearbyCandidates = (detail.nearbyCandidates || []).map((candidate) => ({
      fcEventId: text(candidate.fcEventId),
      fcSeriesId: text(candidate.fcSeriesId),
      localDate: date(candidate.localDate),
      localTime: text(candidate.localTime).slice(0, 5),
      durationMinutes: candidate.durationMinutes === null || candidate.durationMinutes === undefined
        ? null
        : Number(candidate.durationMinutes),
      tutor: tutorView(tutorsByExternalId.get(text(candidate.tutorExternalId)) || null),
      categoryName: text(candidate.categoryName) || 'Uncategorised',
      daysOffset: Number(candidate.daysOffset) || 0,
      sameSeries: candidate.sameSeries === true,
      sameSlot: candidate.sameSlot === true,
      matchedStudents: (candidate.matchedStudentExternalIds || []).map((externalId) => {
        const student = studentsByExternalId.get(text(externalId)) || null;
        return studentView(student);
      }).filter(Boolean),
      unmatchedStudentCount: (candidate.matchedStudentExternalIds || [])
        .filter((externalId) => !studentsByExternalId.has(text(externalId))).length,
    }));
    const evidenceKind = lessonExceptionEvidenceKind({ ...detail, nearbyCandidates });

    return {
      fcEventId: text(detail.fcEventId),
      fcSeriesId: text(detail.fcSeriesId),
      localDate: date(detail.localDate),
      localTime: text(detail.localTime).slice(0, 5),
      durationMinutes: detail.durationMinutes === null || detail.durationMinutes === undefined
        ? null
        : Number(detail.durationMinutes),
      tutor: tutorView(tutorsByExternalId.get(text(detail.tutorExternalId)) || null),
      originalTutor: tutorView(tutorsByExternalId.get(text(detail.originalTutorExternalId)) || null),
      categoryName: text(detail.categoryName) || 'Uncategorised',
      locationName: text(detail.locationName),
      sourceStatus: text(detail.sourceStatus),
      sourceRecurring: detail.sourceRecurring === true,
      firstObservedAt: detail.firstObservedAt || null,
      lastObservedAt: detail.lastObservedAt || null,
      currentSameSeriesCount: Number(detail.currentSameSeriesCount) || 0,
      seriesContinuing: Number(detail.currentSameSeriesCount) > 0,
      participants,
      unmatchedParticipantCount: participants.filter((participant) => !participant.student).length,
      nearbyCandidates,
      evidenceKind,
    };
  });
  const summary = ['same_slot', 'same_day', 'nearby', 'no_nearby'].reduce((counts, kind) => ({
    ...counts,
    [kind]: events.filter((event) => event.evidenceKind === kind).length,
  }), {});

  return {
    source: {
      state: text(source.state),
      verified: source.verified === true,
      lastVerifiedAt: source.lastVerifiedAt || null,
      windowStart: date(source.windowStart),
      windowEndExclusive: date(source.windowEndExclusive),
    },
    totalCount: Number(totalCount) || events.length,
    displayedCount: events.length,
    summary,
    events,
  };
}
