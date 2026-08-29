/** @fileoverview Pure resolution and summarisation of provider-neutral student–tutor teaching relationship observations. */

const PHASES = {
  planned: { label: 'Planned', order: 2 },
  starting: { label: 'Starting', order: 1 },
  established: { label: 'Established', order: 3 },
  winding_down: { label: 'Winding down', order: 0 },
  ended: { label: 'Ended', order: 5 },
  uncertain: { label: 'Needs review', order: 4 },
};

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function validIso(value = '') {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? '' : text(value);
}

function phaseResult(code, confidence, reason) {
  return {
    code,
    label: PHASES[code]?.label || PHASES.uncertain.label,
    confidence,
    reason,
  };
}

function condition(code, label, severity = 'info') {
  return { code, label, severity };
}

function latestPracticeNote(notes = []) {
  return [...notes]
    .filter((note) => note?.noteId || note?.lessonDate || note?.observedAt)
    .sort((left, right) => {
      const leftTime = new Date(left.observedAt || left.lessonDate || '').getTime();
      const rightTime = new Date(right.observedAt || right.lessonDate || '').getTime();
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })[0] || null;
}

function derivePhase({ assignment = {}, student = {}, tutor = {}, schedule = {}, identityConflict = false } = {}) {
  if (assignment.status === 'ended' || student.lifecycleStatus === 'stopped') {
    return phaseResult('ended', 'high', 'The current student record says this teaching relationship has ended.');
  }

  if (tutor.lifecycleStatus === 'leaving') {
    return phaseResult(
      'winding_down',
      identityConflict ? 'low' : 'high',
      'The tutor is marked as leaving, so this relationship needs a handover.',
    );
  }

  if (tutor.lifecycleStatus === 'retired') {
    return phaseResult(
      'uncertain',
      'low',
      'The tutor is retired but this student still has a current assignment to them.',
    );
  }

  if (student.lifecycleStatus === 'waiting') {
    return phaseResult('planned', identityConflict ? 'low' : 'medium', 'The student is still in the waiting process.');
  }

  if (['onboarding', 'setup_pending'].includes(student.lifecycleStatus)) {
    return phaseResult('starting', identityConflict ? 'low' : 'high', 'The student is currently being set up.');
  }

  const confirmedSchedule = (
    schedule.status === 'found'
    && schedule.matchesAssignedTutor === true
    && schedule.freshness === 'fresh'
  );

  if (['active', 'paused'].includes(student.lifecycleStatus) && confirmedSchedule && !identityConflict) {
    return phaseResult(
      'established',
      schedule.confidence === 'high' ? 'high' : 'medium',
      'The active assignment agrees with a current cached lesson schedule.',
    );
  }

  return phaseResult(
    'uncertain',
    'low',
    identityConflict
      ? 'The assignment or schedule points to different tutors.'
      : 'The current sources do not confirm a fresh teaching relationship.',
  );
}

export function resolveTeachingRelationshipContext({
  student = {},
  tutor = {},
  assignment = {},
  schedule = {},
  practiceNotes = [],
  derivedAt = new Date().toISOString(),
} = {}) {
  const conflicts = [...(assignment.conflicts || [])];
  const warnings = [...(assignment.warnings || []), ...(schedule.warnings || [])];
  const conditions = [];
  const missingStableIdentity = !text(student.fcStudentId) || !text(tutor.fcTutorId);

  if (missingStableIdentity) {
    conflicts.push({
      code: 'missing_first_chord_identity',
      detail: 'A stable First Chord student or tutor ID is missing.',
    });
  }
  if (schedule.status === 'found' && schedule.matchesAssignedTutor === false) {
    conflicts.push({
      code: 'schedule_tutor_mismatch',
      detail: 'The cached next lesson belongs to a different tutor.',
    });
  }
  if (schedule.freshness === 'stale') {
    conditions.push(condition('schedule_stale', 'Schedule needs refreshing', 'review'));
  }
  if (!schedule.status || schedule.status === 'missing' || schedule.status === 'not_found') {
    conditions.push(condition('schedule_unconfirmed', 'No current lesson confirmed', 'review'));
  }
  if (student.lifecycleStatus === 'paused') {
    conditions.push(condition('student_paused', 'Student paused'));
  }
  if (tutor.lifecycleStatus === 'leaving') {
    conditions.push(condition('tutor_leaving', 'Tutor leaving', 'review'));
  }
  if (tutor.lifecycleStatus === 'retired' && assignment.status !== 'ended') {
    conditions.push(condition('tutor_retired', 'Retired tutor still assigned', 'review'));
  }

  const note = latestPracticeNote(practiceNotes);
  if (note?.manualFollowUpNeeded) {
    conditions.push(condition('practice_note_follow_up', 'Practice note follow-up', 'review'));
  }

  const identityConflict = conflicts.length > 0;
  const phase = derivePhase({ assignment, student, tutor, schedule, identityConflict });
  const stableRelationshipId = !missingStableIdentity
    ? `teaching:${student.fcStudentId}:${tutor.fcTutorId}`
    : '';

  return {
    schemaVersion: 1,
    relationshipId: stableRelationshipId,
    student: {
      fcStudentId: text(student.fcStudentId),
      displayName: text(student.displayName),
      firstName: text(student.firstName),
      instrument: text(student.instrument),
      lifecycleStatus: text(student.lifecycleStatus),
    },
    tutor: {
      fcTutorId: text(tutor.fcTutorId),
      shortName: text(tutor.shortName),
      displayName: text(tutor.displayName),
      lifecycleStatus: text(tutor.lifecycleStatus),
    },
    phase,
    conditions,
    schedule: {
      status: text(schedule.status) || 'missing',
      nextLessonAt: validIso(schedule.nextLessonAt),
      usualWeekday: text(schedule.usualWeekday),
      usualTime: text(schedule.usualTime),
      durationMinutes: text(schedule.durationMinutes),
      confidence: text(schedule.confidence) || 'none',
      freshness: text(schedule.freshness) || 'unknown',
      observedAt: validIso(schedule.observedAt),
      sourceSystem: text(schedule.sourceSystem),
      matchesAssignedTutor: schedule.matchesAssignedTutor ?? null,
    },
    latestPracticeNote: note ? {
      noteId: text(note.noteId),
      lessonDate: text(note.lessonDate),
      deliveryStatus: text(note.deliveryStatus) || 'unknown',
      observedAt: validIso(note.observedAt),
      manualFollowUpNeeded: Boolean(note.manualFollowUpNeeded),
      sourceSystem: text(note.sourceSystem),
    } : null,
    provenance: {
      derivedAt: validIso(derivedAt),
      assignmentSource: text(assignment.source),
      assignmentObservedAt: validIso(assignment.observedAt),
      conflicts,
      warnings,
    },
  };
}

export function summariseTeachingRelationships(relationships = []) {
  const current = relationships.filter((relationship) => relationship.phase.code !== 'ended');
  const byPhase = Object.fromEntries(Object.keys(PHASES).map((phase) => [phase, 0]));

  for (const relationship of current) {
    const phase = PHASES[relationship.phase.code] ? relationship.phase.code : 'uncertain';
    byPhase[phase] += 1;
  }

  return {
    total: current.length,
    byPhase,
    paused: current.filter((relationship) => relationship.conditions.some((item) => item.code === 'student_paused')).length,
    followUp: current.filter((relationship) => relationship.conditions.some((item) => item.code === 'practice_note_follow_up')).length,
    needsReview: current.filter((relationship) => (
      relationship.phase.code === 'uncertain'
      || relationship.provenance.conflicts.length > 0
    )).length,
  };
}

export function sortTeachingRelationships(relationships = []) {
  return [...relationships].sort((left, right) => {
    const phaseDifference = (PHASES[left.phase.code]?.order ?? 99) - (PHASES[right.phase.code]?.order ?? 99);
    if (phaseDifference !== 0) return phaseDifference;
    return left.student.displayName.localeCompare(right.student.displayName, 'en');
  });
}
