/** @fileoverview Pure resolution of temporary tutor-cover episodes and their next deterministic attention step. */

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function validDate(value = '') {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : candidate;
}

function validIso(value = '') {
  const candidate = text(value);
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? '' : candidate;
}

function milestone(code, label, complete) {
  return { code, label, status: complete ? 'complete' : 'open' };
}

function evidence(code, label, value, observedAt = '') {
  return {
    code,
    label,
    value: text(value),
    sourceSystem: 'tutor_absence_state',
    observedAt: validIso(observedAt),
  };
}

const NEXT_STEPS = {
  cover_selected: {
    stateCode: 'awaiting_cover',
    stateLabel: 'Cover tutor needed',
    title: 'Choose a cover tutor',
    clearsWhen: 'A cover tutor is recorded for this absence.',
  },
  cover_confirmed: {
    stateCode: 'awaiting_confirmation',
    stateLabel: 'Awaiting confirmation',
    title: 'Confirm the cover tutor',
    clearsWhen: 'The chosen cover tutor has confirmed they can teach this lesson.',
  },
  context_passed: {
    stateCode: 'awaiting_briefing',
    stateLabel: 'Briefing needed',
    title: 'Pass on lesson context',
    clearsWhen: 'The cover tutor has the notes and context needed for the lesson.',
  },
  calendar_aligned: {
    stateCode: 'awaiting_calendar',
    stateLabel: 'Calendar check needed',
    title: 'Confirm the calendar',
    clearsWhen: 'MMS/calendar is updated for the cover, or a human confirms no calendar change is needed.',
  },
  parent_informed: {
    stateCode: 'awaiting_parent_message',
    stateLabel: 'Parent message needed',
    title: 'Tell the parent about the cover',
    clearsWhen: 'The parent message is marked as sent for this lesson.',
  },
};

export function resolveTeachingCoverEpisode({
  student = {},
  primaryTutor = {},
  absentTutor = {},
  coverTutor = {},
  absence = {},
  lesson = {},
  derivedAt = new Date().toISOString(),
} = {}) {
  if (text(absence.decision) !== 'cover' || text(absence.status) === 'resolved') return null;

  const absenceDate = validDate(absence.absenceDate || lesson.lessonDate);
  const today = validDate(derivedAt);
  const workflowState = absence.messageState?.__workflow || {};
  const lessonState = absence.messageState?.[lesson.eventId] || {};
  const coverName = text(coverTutor.displayName || coverTutor.shortName || absence.coverTutorName);
  const absentName = text(absentTutor.displayName || absentTutor.shortName || absence.tutorName);
  const studentName = text(student.displayName || student.firstName);
  const milestones = [
    milestone('cover_selected', 'Cover tutor chosen', Boolean(coverName)),
    milestone('cover_confirmed', 'Cover tutor confirmed', Boolean(workflowState.coverTutorConfirmed)),
    milestone('context_passed', 'Notes and context passed on', Boolean(workflowState.coverTutorBriefed)),
    milestone('calendar_aligned', 'Calendar updated or checked', Boolean(workflowState.calendarUpdated)),
    milestone('parent_informed', 'Parent informed', Boolean(lessonState.messaged)),
  ];
  const nextOpen = milestones.find((item) => item.status === 'open') || null;
  const nextStep = nextOpen ? NEXT_STEPS[nextOpen.code] : null;
  const stableIdentityMissing = !text(student.fcStudentId) || !text(absence.absenceId);
  const episodeId = stableIdentityMissing
    ? ''
    : `cover:${text(absence.absenceId)}:${text(student.fcStudentId)}:${absenceDate}:${text(lesson.lessonTime)}`;
  const dueNow = Boolean(today && absenceDate && absenceDate <= today);
  const attentionItems = [];

  if (nextStep) {
    const detail = nextOpen.code === 'cover_selected'
      ? `${studentName || 'This student'} needs temporary cover for ${absentName || 'the usual tutor'} on ${absenceDate || 'the recorded date'}.`
      : `${coverName} is due to cover ${studentName || 'this student'} for ${absentName || 'the usual tutor'} on ${absenceDate || 'the recorded date'}.`;
    attentionItems.push({
      code: `cover_${nextOpen.code}_open`,
      severity: dueNow ? 'urgent' : 'review',
      title: nextStep.title,
      detail,
      dueDate: absenceDate,
      clearsWhen: nextStep.clearsWhen,
      evidence: [
        evidence('cover_date', 'Cover date', absenceDate || 'Not recorded', absence.updatedAt),
        evidence('absent_tutor', 'Usual tutor away', absentName || 'Not resolved', absence.updatedAt),
        evidence('cover_tutor', 'Cover tutor', coverName || 'Not chosen', absence.updatedAt),
        evidence('next_milestone', 'Next incomplete step', nextOpen.label, absence.updatedAt),
      ],
      recommendedWorkflow: {
        code: 'tutor_absence_review',
        label: 'Open cover workflow',
      },
    });
  } else if (today && absenceDate && absenceDate < today) {
    attentionItems.push({
      code: 'cover_record_open_after_date',
      severity: 'review',
      title: 'Close the completed cover record',
      detail: `Every cover preparation step is complete, but the ${absenceDate} absence is still open.`,
      dueDate: absenceDate,
      clearsWhen: 'The existing tutor-absence workflow is marked resolved.',
      evidence: [
        evidence('cover_date', 'Cover date', absenceDate, absence.updatedAt),
        evidence('cover_tutor', 'Cover tutor', coverName, absence.updatedAt),
        evidence('cover_checks', 'Preparation checks', '5 of 5 complete', absence.updatedAt),
      ],
      recommendedWorkflow: {
        code: 'tutor_absence_review',
        label: 'Open cover workflow',
      },
    });
  }

  return {
    schemaVersion: 1,
    episodeId,
    student: {
      fcStudentId: text(student.fcStudentId),
      displayName: studentName,
      instrument: text(student.instrument || lesson.instrument),
    },
    primaryTutor: {
      fcTutorId: text(primaryTutor.fcTutorId),
      shortName: text(primaryTutor.shortName),
      displayName: text(primaryTutor.displayName),
    },
    absentTutor: {
      fcTutorId: text(absentTutor.fcTutorId),
      shortName: text(absentTutor.shortName),
      displayName: absentName,
    },
    coverTutor: {
      fcTutorId: text(coverTutor.fcTutorId),
      shortName: text(coverTutor.shortName || absence.coverTutorShortName),
      displayName: coverName,
      type: text(coverTutor.type) || (text(coverTutor.fcTutorId) ? 'internal' : 'external_or_unmatched'),
    },
    lesson: {
      date: absenceDate,
      time: text(lesson.lessonTime),
      durationMinutes: text(lesson.durationMinutes),
      instrument: text(lesson.instrument || student.instrument),
    },
    state: nextStep ? {
      code: nextStep.stateCode,
      label: nextStep.stateLabel,
      reason: nextStep.clearsWhen,
    } : {
      code: 'ready',
      label: 'Cover ready',
      reason: 'The cover tutor, briefing, calendar and parent-message checks are complete.',
    },
    milestones,
    attentionItems,
    provenance: {
      sourceSystem: 'tutor_absence_state',
      observedAt: validIso(absence.updatedAt),
      derivedAt: validIso(derivedAt),
      conflicts: stableIdentityMissing ? [{
        code: 'missing_cover_episode_identity',
        detail: 'A stable First Chord student ID or tutor-absence ID is missing.',
      }] : [],
    },
  };
}

export function sortTeachingCoverEpisodes(episodes = []) {
  return [...episodes].sort((left, right) => (
    left.lesson.date.localeCompare(right.lesson.date)
    || left.lesson.time.localeCompare(right.lesson.time)
    || left.student.displayName.localeCompare(right.student.displayName, 'en')
  ));
}
