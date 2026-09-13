/** @fileoverview Pure normalisation of pause history rows into coverage context, per-lesson coverage lookups, and a pause summary. */
function pickFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (`${value || ''}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  return '';
}

function parseDate(value) {
  if (!value) return null;
  const normalised = `${value}`.trim();
  const dateOnlyMatch = normalised.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function formatDateLabel(date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });
}

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findNextWeekdayAfter(date, weekdayIndex) {
  if (!Number.isInteger(weekdayIndex)) return null;
  const cursor = new Date(date);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  for (let guard = 0; guard < 8; guard += 1) {
    if (cursor.getDay() === weekdayIndex) {
      return cursor;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function normaliseIdentityName(value) {
  return `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalisePauseHistoryRow(row) {
  return {
    studentName: pickFirst(row, ['studentName', 'Student Name', 'Student name', 'student_name']),
    email: pickFirst(row, ['email', 'Email', 'Student Email', 'Student email', 'student_email']),
    tutor: pickFirst(row, ['tutor', 'Tutor']),
    subscriptionId: pickFirst(row, [
      'subscriptionId',
      'Stripe Subscription ID',
      'Subscription ID',
      'Subscription Id',
      'Subscription id',
      'stripe_subscription_id',
    ]),
    startDate: pickFirst(row, [
      'startDate',
      'Pause Start Date',
      'Start Date',
      'Start date',
      'start_date',
      'start',
      'Start',
    ]),
    endDate: pickFirst(row, [
      'endDate',
      'Pause End Date',
      'End Date',
      'End date',
      'end_date',
      'end',
      'End',
    ]),
    stripeStatus: pickFirst(row, ['stripeStatus', 'Stripe Status', 'Stripe status', 'stripe_status']),
  };
}

export function derivePauseCoverageContext({
  pauseSummary = null,
  scheduleContext = null,
  currentDate = new Date(),
} = {}) {
  if (!pauseSummary?.hasPauseHistory || !pauseSummary.latestPause) {
    return {
      status: 'no_pause_history',
      confidence: 'low',
      coveredLessonDates: [],
      summary: 'No pause history window is available to match against the lesson schedule.',
      recommendation: 'Use the normal payment and Stripe checks.',
      warnings: [],
    };
  }

  const startDate = parseDate(pauseSummary.latestPause.startDate);
  const endDate = parseDate(pauseSummary.latestPause.endDate);
  const today = parseDate(currentDate) || new Date();
  today.setHours(0, 0, 0, 0);

  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) {
    return {
      status: 'invalid_pause_window',
      confidence: 'low',
      coveredLessonDates: [],
      summary: 'Pause History has dates that cannot be matched safely against the lesson schedule.',
      recommendation: 'Review Pause History before changing payment expectation.',
      warnings: ['Pause start/end dates are missing or invalid.'],
    };
  }

  const usualWeekday = `${scheduleContext?.usualWeekday || ''}`.trim();
  const usualWeekdayIndex = WEEKDAY_INDEX[usualWeekday];
  const usualTime = `${scheduleContext?.usualTime || ''}`.trim();
  const hasUsualSlot = scheduleContext?.status === 'found' && Number.isInteger(usualWeekdayIndex);

  if (!hasUsualSlot) {
    return {
      status: 'schedule_missing',
      confidence: 'low',
      coveredLessonDates: [],
      summary: 'Pause window found, but no reliable cached lesson slot is available to infer which lesson was being paused.',
      recommendation: 'Refresh schedule context or review manually before relying on the pause expectation.',
      warnings: ['Cached schedule context is missing or incomplete.'],
    };
  }

  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const finalDate = new Date(endDate);
  finalDate.setHours(0, 0, 0, 0);
  const coveredLessonDates = [];

  while (cursor.getTime() <= finalDate.getTime()) {
    if (cursor.getDay() === usualWeekdayIndex) {
      coveredLessonDates.push({
        date: formatInputDate(cursor),
        label: `${formatDateLabel(cursor)}${usualTime ? `, ${usualTime}` : ''}`,
        weekday: usualWeekday,
        time: usualTime,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const futureOrTodayLessons = coveredLessonDates.filter((lesson) => {
    const lessonDate = parseDate(lesson.date);
    return lessonDate && lessonDate.getTime() >= today.getTime();
  });
  const pastLessons = coveredLessonDates.length - futureOrTodayLessons.length;
  const lessonCount = coveredLessonDates.length;
  const lessonLabel = lessonCount === 1 ? 'lesson' : 'lessons';
  const dateText = coveredLessonDates.map((lesson) => lesson.label).join('; ');
  const confidence = scheduleContext.confidence === 'high' ? 'high' : 'medium';
  const nextBillableLessonDate = findNextWeekdayAfter(finalDate, usualWeekdayIndex);
  const nextBillableLesson = nextBillableLessonDate
    ? {
        date: formatInputDate(nextBillableLessonDate),
        label: `${formatDateLabel(nextBillableLessonDate)}${usualTime ? `, ${usualTime}` : ''}`,
        weekday: usualWeekday,
        time: usualTime,
      }
    : null;
  const warnings = [];

  if (lessonCount === 0) {
    warnings.push('The pause window does not contain the student’s usual lesson day.');
  }

  if (scheduleContext.confidence && scheduleContext.confidence !== 'high') {
    warnings.push('Schedule context is not high confidence, so treat coverage as a best estimate.');
  }

  let status = 'covers_future_or_current_lesson';
  let recommendation = 'Keep payment expectation aligned with the active pause until the covered lesson has passed.';

  if (lessonCount === 0) {
    status = 'no_usual_lesson_covered';
    recommendation = 'Review manually before changing payment expectation; the pause dates may not cover the usual lesson slot.';
  } else if (futureOrTodayLessons.length === 0) {
    status = 'covered_lessons_passed';
    recommendation = 'Covered pause lessons have passed; payment expectation should usually return to Stripe active expected.';
  } else if (pauseSummary.upcomingPause) {
    status = 'upcoming_covered_lesson';
    recommendation = 'No payment expectation change is needed yet; set paused expected when the covered lesson window starts.';
  }

  return {
    status,
    confidence,
    coveredLessonDates,
    coveredLessonCount: lessonCount,
    pastCoveredLessonCount: pastLessons,
    remainingCoveredLessonCount: futureOrTodayLessons.length,
    nextBillableLessonDate: nextBillableLesson?.date || '',
    nextBillableLessonLabel: nextBillableLesson?.label || '',
    usualLesson: `${usualWeekday}${usualTime ? ` ${usualTime}` : ''}`.trim(),
    summary: lessonCount
      ? `This pause window appears to cover ${lessonCount} usual ${lessonLabel}: ${dateText}.`
      : `This pause window does not appear to include the usual ${usualWeekday}${usualTime ? ` ${usualTime}` : ''} lesson.`,
    recommendation,
    warnings,
  };
}

function getPauseMatch(row, { normalisedEmail, normalisedSubscriptionId, normalisedStudentName }) {
  if (normalisedSubscriptionId && row.subscriptionId && row.subscriptionId === normalisedSubscriptionId) {
    return {
      confidence: 'high',
      matchedBy: 'subscription_id',
      evidence: 'Matched Pause History by Stripe subscription ID.',
    };
  }

  if (normalisedEmail && row.email && row.email.toLowerCase() === normalisedEmail) {
    const rowName = normaliseIdentityName(row.studentName);
    if (normalisedStudentName && rowName && rowName === normalisedStudentName) {
      return {
        confidence: 'medium',
        matchedBy: 'email_and_student_name',
        evidence: 'Matched Pause History by email and student name.',
      };
    }

    return {
      confidence: 'low',
      matchedBy: 'email_only',
      evidence: 'Matched Pause History by email only; check this is the right student before acting.',
    };
  }

  return null;
}

export function findPauseHistoryCoverageForLesson({
  studentEmail = '',
  studentName = '',
  stripeSubscriptionId = '',
  lessonDate = '',
  pauseRows = [],
} = {}) {
  const lesson = parseDate(lessonDate);
  if (!lesson) return { found: false, confidence: '', actionable: false };
  lesson.setHours(0, 0, 0, 0);

  const identity = {
    normalisedEmail: `${studentEmail || ''}`.trim().toLowerCase(),
    normalisedStudentName: normaliseIdentityName(studentName),
    normalisedSubscriptionId: `${stripeSubscriptionId || ''}`.trim(),
  };
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  const matches = pauseRows
    .map(normalisePauseHistoryRow)
    .map((row) => ({ ...row, match: getPauseMatch(row, identity) }))
    .filter((row) => row.match)
    .filter((row) => {
      const start = parseDate(row.startDate);
      const end = parseDate(row.endDate);
      if (!start || !end) return false;
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      return start.getTime() <= lesson.getTime() && lesson.getTime() <= end.getTime();
    })
    .sort((a, b) => confidenceOrder[a.match.confidence] - confidenceOrder[b.match.confidence]);

  const match = matches[0];
  if (!match) return { found: false, confidence: '', actionable: false };
  return {
    found: true,
    actionable: ['high', 'medium'].includes(match.match.confidence),
    confidence: match.match.confidence,
    matchedBy: match.match.matchedBy,
    evidence: match.match.evidence,
    startDate: match.startDate,
    endDate: match.endDate,
    stripeStatus: match.stripeStatus,
  };
}

export function matchPauseHistoryRows({
  studentEmail = '',
  studentName = '',
  stripeSubscriptionId = '',
  pauseRows = [],
} = {}) {
  const normalisedEmail = `${studentEmail || ''}`.trim().toLowerCase();
  const normalisedStudentName = normaliseIdentityName(studentName);
  const normalisedSubscriptionId = `${stripeSubscriptionId || ''}`.trim();

  return pauseRows
    .map(normalisePauseHistoryRow)
    .map((row) => ({
      ...row,
      match: getPauseMatch(row, { normalisedEmail, normalisedSubscriptionId, normalisedStudentName }),
    }))
    .filter((row) => row.match)
    .sort((a, b) => {
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      const confidenceDelta = confidenceOrder[a.match.confidence] - confidenceOrder[b.match.confidence];
      if (confidenceDelta) return confidenceDelta;
      const aDate = parseDate(a.endDate)?.getTime() || 0;
      const bDate = parseDate(b.endDate)?.getTime() || 0;
      return bDate - aDate;
    });
}

export function buildPauseSummary({
  studentEmail = '',
  studentName = '',
  stripeSubscriptionId = '',
  pauseRows = [],
  currentDate = new Date(),
} = {}) {
  const candidates = matchPauseHistoryRows({
    studentEmail,
    studentName,
    stripeSubscriptionId,
    pauseRows,
  });

  const latest = candidates[0] || null;
  if (!latest) {
    return {
      hasPauseHistory: false,
      currentlyPaused: false,
      upcomingPause: false,
      latestPause: null,
      matchConfidence: '',
      matchedBy: '',
      matchEvidence: '',
    };
  }

  const startDate = parseDate(latest.startDate);
  const endDate = parseDate(latest.endDate);
  const today = parseDate(currentDate) || new Date();
  today.setHours(0, 0, 0, 0);
  const startsOnOrBeforeToday = Boolean(startDate && startDate.getTime() <= today.getTime());
  const endsOnOrAfterToday = Boolean(endDate && endDate.getTime() >= today.getTime());
  const startsAfterToday = Boolean(startDate && startDate.getTime() > today.getTime());

  return {
    hasPauseHistory: true,
    currentlyPaused: startsOnOrBeforeToday && endsOnOrAfterToday,
    upcomingPause: startsAfterToday,
    latestPause: {
      studentName: latest.studentName,
      email: latest.email,
      tutor: latest.tutor,
      subscriptionId: latest.subscriptionId,
      startDate: latest.startDate,
      endDate: latest.endDate,
      stripeStatus: latest.stripeStatus,
    },
    matchConfidence: latest.match.confidence,
    matchedBy: latest.match.matchedBy,
    matchEvidence: latest.match.evidence,
  };
}
