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

function validDateOnly(value = '') {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : candidate;
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

function evidence(code, label, value, {
  sourceSystem = '',
  observedAt = '',
  freshness = '',
} = {}) {
  return {
    code,
    label,
    value: text(value),
    sourceSystem: text(sourceSystem),
    observedAt: validIso(observedAt),
    freshness: text(freshness),
  };
}

function attentionItem({
  code,
  severity,
  title,
  detail,
  dueDate = '',
  clearsWhen,
  evidenceItems = [],
}) {
  return {
    code,
    severity,
    title,
    detail,
    dueDate: validDateOnly(dueDate),
    clearsWhen,
    evidence: evidenceItems,
    recommendedWorkflow: {
      code: 'student_assignment_review',
      label: 'Review student assignment',
    },
  };
}

function handoverAttention({ tutor = {}, assignment = {}, schedule = {}, derivedAt = '' } = {}) {
  const attentionItems = [];
  const today = validDateOnly(derivedAt);
  const finalTeachingDate = validDateOnly(tutor.finalTeachingDate);
  const tutorName = text(tutor.displayName || tutor.shortName) || 'This tutor';
  const replacementName = text(tutor.replacementTutor?.displayName || tutor.replacementTutor?.shortName);
  const nextLessonDate = validDateOnly(schedule.nextLessonAt);
  const finalDateReached = Boolean(today && finalTeachingDate && finalTeachingDate <= today);
  const lessonAfterFinalDate = Boolean(nextLessonDate && finalTeachingDate && nextLessonDate > finalTeachingDate);
  const confirmedLessonAfterFinalDate = lessonAfterFinalDate && schedule.freshness === 'fresh';

  if (tutor.lifecycleStatus === 'leaving' && assignment.status !== 'ended') {
    const severity = finalDateReached || confirmedLessonAfterFinalDate ? 'urgent' : 'review';
    const evidenceItems = [
      evidence('current_assignment', 'Current assignment', tutorName, {
        sourceSystem: assignment.source,
        observedAt: assignment.observedAt,
      }),
      evidence('tutor_departure', 'Final teaching date', finalTeachingDate || 'Not recorded', {
        sourceSystem: 'tutor_lifecycle',
        observedAt: tutor.lifecycleUpdatedAt,
      }),
    ];
    if (schedule.nextLessonAt) {
      evidenceItems.push(evidence('cached_next_lesson', 'Cached next lesson', schedule.nextLessonAt, {
        sourceSystem: schedule.sourceSystem,
        observedAt: schedule.observedAt,
        freshness: schedule.freshness,
      }));
    }

    if (!replacementName) {
      attentionItems.push(attentionItem({
        code: finalDateReached ? 'handover_tutor_overdue' : 'handover_tutor_missing',
        severity,
        title: finalDateReached ? 'Handover tutor is overdue' : 'Choose a handover tutor',
        detail: finalTeachingDate
          ? `${tutorName} is leaving on ${finalTeachingDate}, but no handover tutor is recorded.`
          : `${tutorName} is marked as leaving, but no handover tutor or usable final date is recorded.`,
        dueDate: finalTeachingDate,
        clearsWhen: 'A handover tutor is recorded, then the student assignment and cached lesson agree with the new tutor.',
        evidenceItems,
      }));
    } else {
      const code = finalDateReached
        ? 'handover_assignment_overdue'
        : confirmedLessonAfterFinalDate
          ? 'lesson_after_tutor_final_date'
          : 'handover_assignment_open';
      const timing = finalDateReached
        ? `${tutorName}'s final teaching date has passed.`
        : confirmedLessonAfterFinalDate
          ? `The cached next lesson is after ${tutorName}'s final teaching date.`
          : `${tutorName} is leaving on ${finalTeachingDate}.`;
      attentionItems.push(attentionItem({
        code,
        severity,
        title: `Move this relationship to ${replacementName}`,
        detail: `${timing} The current student assignment still points to ${tutorName}.`,
        dueDate: finalTeachingDate,
        clearsWhen: `The student assignment no longer points to ${tutorName}, and the cached next lesson agrees with the new tutor.`,
        evidenceItems: [
          ...evidenceItems,
          evidence('planned_replacement', 'Planned handover tutor', replacementName, {
            sourceSystem: 'tutor_lifecycle',
            observedAt: tutor.lifecycleUpdatedAt,
          }),
        ],
      }));
    }
  }

  const scheduledTutor = schedule.scheduledTutor || {};
  const scheduledTutorIsDeparting = ['leaving', 'retired'].includes(text(scheduledTutor.lifecycleStatus));
  if (
    assignment.status !== 'ended'
    && schedule.status === 'found'
    && schedule.matchesAssignedTutor === false
    && scheduledTutorIsDeparting
  ) {
    const scheduledTutorName = text(scheduledTutor.displayName || scheduledTutor.shortName) || 'The previous tutor';
    const scheduledFinalDate = validDateOnly(scheduledTutor.finalTeachingDate);
    const scheduleAfterDeparture = Boolean(nextLessonDate && scheduledFinalDate && nextLessonDate > scheduledFinalDate);
    const scheduleIsFresh = schedule.freshness === 'fresh';
    attentionItems.push(attentionItem({
      code: !scheduleIsFresh
        ? 'departing_tutor_schedule_needs_refresh'
        : scheduleAfterDeparture
          ? 'departing_tutor_lesson_after_final_date'
          : 'departing_tutor_still_scheduled',
      severity: scheduleIsFresh && (scheduleAfterDeparture || scheduledTutor.lifecycleStatus === 'retired') ? 'urgent' : 'review',
      title: `${scheduledTutorName} still has the next lesson`,
      detail: `The assignment points to ${tutorName}, but the cached next lesson still belongs to the departing tutor.`,
      dueDate: scheduledFinalDate,
      clearsWhen: `The cached next lesson agrees with ${tutorName}, or a fresh schedule check confirms there is no current lesson.`,
      evidenceItems: [
        evidence('current_assignment', 'Current assignment', tutorName, {
          sourceSystem: assignment.source,
          observedAt: assignment.observedAt,
        }),
        evidence('departing_scheduled_tutor', 'Tutor on cached lesson', scheduledTutorName, {
          sourceSystem: schedule.sourceSystem,
          observedAt: schedule.observedAt,
          freshness: schedule.freshness,
        }),
        evidence('cached_next_lesson', 'Cached next lesson', schedule.nextLessonAt, {
          sourceSystem: schedule.sourceSystem,
          observedAt: schedule.observedAt,
          freshness: schedule.freshness,
        }),
      ],
    }));
  }

  return attentionItems;
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
  const attentionItems = handoverAttention({ tutor, assignment, schedule, derivedAt });

  return {
    schemaVersion: 2,
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
      finalTeachingDate: validDateOnly(tutor.finalTeachingDate),
      replacementTutor: tutor.replacementTutor ? {
        fcTutorId: text(tutor.replacementTutor.fcTutorId),
        shortName: text(tutor.replacementTutor.shortName),
        displayName: text(tutor.replacementTutor.displayName),
      } : null,
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
      scheduledTutor: schedule.scheduledTutor ? {
        fcTutorId: text(schedule.scheduledTutor.fcTutorId),
        shortName: text(schedule.scheduledTutor.shortName),
        displayName: text(schedule.scheduledTutor.displayName),
        lifecycleStatus: text(schedule.scheduledTutor.lifecycleStatus),
        finalTeachingDate: validDateOnly(schedule.scheduledTutor.finalTeachingDate),
      } : null,
    },
    attentionItems,
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
    attention: current.filter((relationship) => relationship.attentionItems?.length > 0).length,
    urgentAttention: current.filter((relationship) => relationship.attentionItems?.some((item) => item.severity === 'urgent')).length,
    handoversOpen: current.filter((relationship) => relationship.attentionItems?.some((item) => (
      item.code.startsWith('handover_')
      || item.code.startsWith('lesson_after_')
      || item.code.startsWith('departing_tutor_')
    ))).length,
    needsReview: current.filter((relationship) => (
      relationship.phase.code === 'uncertain'
      || relationship.provenance.conflicts.length > 0
    )).length,
  };
}

export function sortTeachingRelationships(relationships = []) {
  return [...relationships].sort((left, right) => {
    const attentionOrder = { urgent: 0, review: 1 };
    const leftAttention = Math.min(...(left.attentionItems || []).map((item) => attentionOrder[item.severity] ?? 2), 3);
    const rightAttention = Math.min(...(right.attentionItems || []).map((item) => attentionOrder[item.severity] ?? 2), 3);
    if (leftAttention !== rightAttention) return leftAttention - rightAttention;
    const phaseDifference = (PHASES[left.phase.code]?.order ?? 99) - (PHASES[right.phase.code]?.order ?? 99);
    if (phaseDifference !== 0) return phaseDifference;
    return left.student.displayName.localeCompare(right.student.displayName, 'en');
  });
}
