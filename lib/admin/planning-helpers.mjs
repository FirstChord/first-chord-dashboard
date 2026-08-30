/** @fileoverview Pure core of the planning board: item vocabularies, recurring-item builders, date inference, progress and momentum, and summaries. */
export const PLANNING_ITEM_TYPES = ['idea', 'initiative', 'action', 'learning_note', 'strategic_note'];
// The ordinary Planning UI deliberately exposes only the three shapes people
// need to choose between. Learning/strategic notes remain valid stored types
// for the dedicated school-notes capture and existing rows.
export const PLANNING_PRIMARY_ITEM_TYPES = ['action', 'initiative', 'idea'];
export const PLANNING_STATUSES = ['inbox', 'active', 'waiting', 'done', 'parked'];
export const PLANNING_OWNERS = ['Unassigned', 'Finn', 'Tom', 'Fennella'];
// Stored work-mode compatibility. Ordinary cards derive this from kind:
// Action/Note = task, Project = ongoing. Dedicated legacy note/workflow rows may
// still preserve an explicit mode without exposing another choice in the UI.
export const PLANNING_MODES = ['task', 'ongoing'];
export const PLANNING_AREAS = [
  'admin',
  'tutor',
  'parent',
  'finance',
  'growth',
  'learning',
  'teaching',
  'recruitment',
  'rooms',
  'culture',
  'student_experience',
  'showcase',
  'tech',
  'marketing',
  'workflow',
  'other',
];
// A small responsibility-based set for new/manual choices. The wider stored
// enum stays intact so legacy and workflow-generated rows keep round-tripping.
export const PLANNING_PRIMARY_AREAS = [
  'other',
  'teaching',
  'student_experience',
  'tutor',
  'admin',
  'finance',
  'growth',
];
export const PLANNING_PROGRESS_TYPES = [
  'note',
  'action_completed',
  'decision',
  'status_change',
  'next_action_update',
  // A worked session on an ongoing plan: what you did this time, paired with a
  // rescheduled next meeting day (target_date).
  'session_logged',
  // Controlled, append-only state for workflow cards such as first-lesson
  // follow-up. The human-readable note carries the versioned step/value marker.
  'workflow_step',
];
export const SCHOOL_FORWARD_PLANNING_ID = 'planning_weekly_school_forward_review';
export const SCHOOL_FORWARD_REFLECTION_LIMIT = 8;
export const MONDAY_SCHEDULE_PLANNING_ID = 'planning_weekly_monday_schedule';
export const MONTH_END_EXPENSES_PLANNING_ID = 'planning_monthly_expense_reconciliation';
export const REFLECTION_INTENTION_DISMISSED_PREFIX = 'Dismissed Friday reflection intention:';

const MONTH_INDEX = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const PLANNING_MEETING_DAYS = new Set([
  WEEKDAY_INDEX.monday,
  WEEKDAY_INDEX.thursday,
  WEEKDAY_INDEX.friday,
]);

// Check-in reminders land on a check-in day (Mon/Wed/Fri), which is deliberately
// distinct from PLANNING_MEETING_DAYS (Mon/Thu/Fri) used for the planning/meeting rhythm.
const FIRST_LESSON_CHECKIN_DAYS = new Set([
  WEEKDAY_INDEX.monday,
  WEEKDAY_INDEX.wednesday,
  WEEKDAY_INDEX.friday,
]);

const STATUS_LABELS = {
  inbox: 'Inbox',
  active: 'Active',
  waiting: 'Waiting',
  done: 'Done',
  parked: 'Parked',
};

const TYPE_LABELS = {
  idea: 'Note / idea',
  initiative: 'Project',
  action: 'Action',
  learning_note: 'Learning note',
  strategic_note: 'Strategic note',
};

const AREA_LABELS = {
  admin: 'School operations',
  tutor: 'Tutors & team',
  parent: 'Parent',
  finance: 'Finance & administration',
  growth: 'Growth & events',
  learning: 'Learning',
  teaching: 'Teaching & curriculum',
  recruitment: 'Recruitment',
  rooms: 'Rooms',
  culture: 'Culture',
  student_experience: 'Students & families',
  showcase: 'Showcase',
  tech: 'Tech',
  marketing: 'Marketing',
  workflow: 'Workflow',
  other: 'No area',
};

const MOMENTUM_LABELS = {
  inbox: 'Inbox',
  moving: 'Moving',
  steady: 'Steady',
  no_next_action: 'No next action',
  stalled: 'Stalled',
  done: 'Done',
  parked: 'Parked',
};

function normaliseEnum(value, validValues, fallback) {
  const normalised = `${value || ''}`.trim().toLowerCase();
  return validValues.includes(normalised) ? normalised : fallback;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Passive "noticing" aid: flag pauses for the same student whose windows sit next to
// (or overlap) each other within `gapDays`, so a human can spot they might be one longer
// break (e.g. a tutor-absence pause running straight into the student's own pause).
// Read-only — no merging, no writes. entries: [{ planningId, studentId, start, end }] (ISO).
// Returns a Map: planningId -> { otherStart, otherEnd }.
export function flagNearbyPauses(entries = [], { gapDays = 8 } = {}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const toTime = (value) => {
    const t = new Date(`${`${value || ''}`.slice(0, 10)}T00:00:00Z`).getTime();
    return Number.isNaN(t) ? null : t;
  };
  const flags = new Map();
  const byStudent = new Map();
  for (const entry of entries) {
    if (!entry?.planningId || !entry?.studentId || !entry?.start) continue;
    if (!byStudent.has(entry.studentId)) byStudent.set(entry.studentId, []);
    byStudent.get(entry.studentId).push(entry);
  }
  for (const list of byStudent.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => `${a.start}`.localeCompare(`${b.start}`));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const aEnd = toTime(a.end || a.start);
      const bStart = toTime(b.start);
      if (aEnd === null || bStart === null) continue;
      const gap = Math.round((bStart - aEnd) / dayMs); // negative if they overlap
      if (gap <= gapDays) {
        flags.set(a.planningId, { otherStart: b.start, otherEnd: b.end || b.start });
        flags.set(b.planningId, { otherStart: a.start, otherEnd: a.end || a.start });
      }
    }
  }
  return flags;
}

export function buildDateInputRange(startValue = '', endValue = '', { maxDays = 35 } = {}) {
  const start = parseDateInputValue(startValue);
  const end = parseDateInputValue(endValue);
  if (!start || !end || end.getTime() < start.getTime()) {
    return { dates: [], tooLong: false };
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    if (dates.length >= maxDays) {
      return { dates, tooLong: true };
    }
    dates.push(formatDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { dates, tooLong: false };
}

function nextWeekdayDate(now = new Date(), weekdayIndex = WEEKDAY_INDEX.friday, { skipToday = false } = {}) {
  const today = startOfLocalDay(now);
  const current = today.getDay();
  let delta = (weekdayIndex - current + 7) % 7;
  if (delta === 0 && skipToday) {
    delta = 7;
  }
  return addDays(today, delta);
}

export function calculateFridayReviewDate(now = new Date(), { skipToday = false } = {}) {
  return formatDateInput(nextWeekdayDate(now, WEEKDAY_INDEX.friday, { skipToday }));
}

export function calculateMondayScheduleDate(now = new Date(), { skipToday = false } = {}) {
  return formatDateInput(nextWeekdayDate(now, WEEKDAY_INDEX.monday, { skipToday }));
}

export function calculateMonthEndDate(now = new Date(), { skipToday = false } = {}) {
  const today = startOfLocalDay(now);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (monthEnd < today || (skipToday && monthEnd.getTime() === today.getTime())) {
    return formatDateInput(new Date(today.getFullYear(), today.getMonth() + 2, 0));
  }
  return formatDateInput(monthEnd);
}

export function calculateNextMeetingDate(now = new Date()) {
  const today = startOfLocalDay(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addDays(today, offset);
    if (PLANNING_MEETING_DAYS.has(candidate.getDay())) {
      return formatDateInput(candidate);
    }
  }
  return formatDateInput(today);
}

// Returns the first check-in day (Mon/Wed/Fri) strictly after the first lesson.
// Any 6-day window after a lesson always contains a Mon/Wed/Fri, so the reminder
// always lands after the first lesson but before the next week's lesson.
export function calculateFirstLessonCheckinDate(lessonDate, { fallbackNow = new Date() } = {}) {
  const parsedLesson = parseFlexibleDate(lessonDate);
  const base = startOfLocalDay(parsedLesson || fallbackNow);
  for (let offset = 1; offset <= 6; offset += 1) {
    const candidate = addDays(base, offset);
    if (FIRST_LESSON_CHECKIN_DAYS.has(candidate.getDay())) {
      return formatDateInput(candidate);
    }
  }
  // Unreachable in practice; keep a safe fallback rather than returning empty.
  return formatDateInput(addDays(base, 1));
}

// When a family subscribes well before lesson one, the weekly renewal can land
// before the lesson. Queue a human review early enough to check the provider
// timing; this function never reads or changes Stripe itself.
export function requiresEarlyStripeTimingReview(lessonDate, { now = new Date() } = {}) {
  const parsedLesson = parseFlexibleDate(lessonDate);
  if (!parsedLesson) return false;

  const today = startOfLocalDay(now);
  const lessonDay = startOfLocalDay(parsedLesson);
  const daysUntilLesson = Math.round((lessonDay.getTime() - today.getTime()) / 86_400_000);
  return daysUntilLesson >= 7;
}

// Deterministic planning id for a student's first-lesson check-in, so re-running
// onboarding upserts the same task rather than creating a duplicate.
export function buildFirstLessonCheckinPlanningId(mmsId) {
  return `planning_first_lesson_checkin_${`${mmsId || ''}`.trim()}`;
}

export function buildEarlyStripeTimingReviewPlanningId(mmsId) {
  return `planning_early_stripe_timing_${`${mmsId || ''}`.trim()}`;
}

// Pure builder for the auto-created first-lesson check-in planning item.
// Owner is intentionally 'Unassigned' with Finn & Tom named in the action, so it
// surfaces in shared inbox/meeting views rather than one person's queue.
export function buildFirstLessonCheckinPlanningItem({
  mmsId,
  studentName,
  tutorName = '',
  lessonDate,
  lessonTime = '',
  now = new Date(),
}) {
  const name = `${studentName || ''}`.trim() || 'New student';
  const lessonLabel = `${lessonDate || ''}`.trim();
  const timeLabel = `${lessonTime || ''}`.trim();
  const tutorLabel = `${tutorName || ''}`.trim();
  const targetDate = calculateFirstLessonCheckinDate(lessonDate, { fallbackNow: now });

  const notes = [
    `Auto-created at onboarding for ${name}.`,
    lessonLabel ? `First lesson: ${lessonLabel}${timeLabel ? ` ${timeLabel}` : ''}.` : '',
    tutorLabel ? `Tutor: ${tutorLabel}.` : '',
    "Check in after the first lesson and before next week's lesson.",
  ].filter(Boolean).join(' ');

  return {
    title: `First-lesson check-in — ${name}`,
    notes,
    itemType: 'action',
    owner: 'Unassigned',
    status: 'active',
    area: 'parent',
    linkedWorkflowId: 'onboarding',
    linkedStudentId: `${mmsId || ''}`.trim(),
    nextAction: `Finn & Tom: complete the lesson, WhatsApp and student-access checks with ${name}'s parent/student`,
    targetDate,
  };
}

export function buildEarlyStripeTimingReviewPlanningItem({
  mmsId,
  studentName,
  lessonDate,
  now = new Date(),
}) {
  const name = `${studentName || ''}`.trim() || 'New student';
  const lessonLabel = `${lessonDate || ''}`.trim();

  return {
    title: `Check Stripe timing before lesson one — ${name}`,
    notes: [
      `Auto-created at onboarding because lesson one is at least 7 days away.`,
      lessonLabel ? `First lesson: ${lessonLabel}.` : '',
      'This is a review task only: check Stripe before taking any provider action.',
    ].filter(Boolean).join(' '),
    itemType: 'action',
    owner: 'Unassigned',
    status: 'active',
    area: 'finance',
    linkedWorkflowId: 'onboarding',
    linkedStudentId: `${mmsId || ''}`.trim(),
    nextAction: `Check ${name}'s weekly subscription timing before the first renewal and confirm no extra payment falls before lesson one`,
    targetDate: calculateNextMeetingDate(now),
  };
}

function escapeRegExp(value = '') {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normaliseMatchText(value = '') {
  return `${value || ''}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Detect a tutor-absence capture from free text (e.g. "pause tutor robbie",
// "robbie off friday"). tutorOptions is [{ shortName, fullName, ... }].
export function detectTutorAbsenceCapture(rawText = '', tutorOptions = []) {
  const original = `${rawText || ''}`;
  const text = normaliseMatchText(original);

  const hasTutorWord = /\b(tutor|teacher)\b/u.test(text);
  const hasAbsenceWord = /\b(away|off|cover|absent|absence|holiday|not in)\b/u.test(text);
  const hasPause = /\bpaus(?:e|ed|ing)\b/u.test(text);

  const matches = [];
  for (const option of tutorOptions) {
    const shortName = normaliseMatchText(option.shortName);
    const firstName = normaliseMatchText(`${option.fullName || ''}`.split(/\s+/u)[0]);
    const shortHit = shortName && new RegExp(`\\b${escapeRegExp(shortName)}\\b`, 'u').test(text);
    const firstHit = firstName && new RegExp(`\\b${escapeRegExp(firstName)}\\b`, 'u').test(text);
    if (shortHit || firstHit) {
      matches.push({ option, exact: Boolean(shortHit) });
    }
  }

  // Prefer exact short-name matches; if multiple distinct tutors match, treat as
  // ambiguous and let the UI require manual selection.
  const exactMatches = matches.filter((match) => match.exact);
  const effectiveMatches = exactMatches.length ? exactMatches : matches;
  const distinct = new Map(effectiveMatches.map((match) => [match.option.shortName, match.option]));
  const tutor = distinct.size === 1 ? [...distinct.values()][0] : null;

  const isTutorAbsence = (hasTutorWord && (hasAbsenceWord || hasPause))
    || (Boolean(tutor) && hasAbsenceWord);

  const eventDate = inferEventDateFromText(original);
  const inferredDates = eventDate ? [formatDateInput(eventDate)] : [];

  return {
    isTutorAbsence: Boolean(isTutorAbsence),
    tutor: isTutorAbsence ? tutor : null,
    inferredDates,
  };
}

// Deterministic id so re-capturing the same tutor + day upserts one card.
export function buildTutorAbsencePlanningId(shortName = '', absenceDate = '') {
  return `planning_tutor_absence_${`${shortName || ''}`.trim().toLowerCase()}_${`${absenceDate || ''}`.trim()}`;
}

// New tutor-absence captures opt into the two-stage parent communication flow.
// Keep this marker on the capture card rather than changing historical absence
// rows, so existing/live summer work stays exactly as it was captured.
export const TUTOR_ABSENCE_NOTICE_PLANNING_MARKER = 'Tutor absence notice planning: v1';

function meetingDayOnOrBefore(date) {
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = addDays(date, -offset);
    if (PLANNING_MEETING_DAYS.has(candidate.getDay())) {
      return candidate;
    }
  }
  return date;
}

// Pure builder for an auto-created tutor-absence planning card. Owner is
// Unassigned (shared inbox/meeting views). linkedWorkflowId stays the generic
// 'tutor-absence' so existing meeting-filter and workflow-link logic keep working;
// the specific tutor + date live as parseable lines in notes for the deep link.
export function buildTutorAbsencePlanningItem({
  tutor = {},
  absenceDate = '',
  lessons = [],
  enableEarlyNotice = false,
}) {
  const shortName = `${tutor.shortName || ''}`.trim();
  const fullName = `${tutor.fullName || ''}`.trim() || shortName || 'Tutor';
  const dateValue = `${absenceDate || ''}`.trim();
  const parsedDate = parseDateInputValue(dateValue);
  const readableDate = parsedDate ? formatReadableDate(parsedDate) : dateValue;

  const studentNames = (lessons || [])
    .map((lesson) => `${lesson.studentName || ''}`.trim())
    .filter(Boolean);
  const count = studentNames.length;

  const targetDate = parsedDate
    ? formatDateInput(meetingDayOnOrBefore(addDays(parsedDate, enableEarlyNotice ? -14 : -1)))
    : '';

  const noteLines = [
    `Tutor absence date: ${dateValue}`,
    `Tutor: ${shortName}`,
    count
      ? `Affected students (${count}): ${studentNames.join(', ')}`
      : 'No MMS lessons found for this date — check MMS directly or this may be a non-teaching day.',
    `Deep link: /admin/workflows/tutor-absence?tutor=${encodeURIComponent(shortName)}&date=${encodeURIComponent(dateValue)}`,
    enableEarlyNotice ? TUTOR_ABSENCE_NOTICE_PLANNING_MARKER : '',
  ];

  return {
    title: `Tutor absence: ${fullName} — ${readableDate}`,
    notes: noteLines.join('\n'),
    itemType: 'action',
    owner: 'Unassigned',
    status: 'active',
    area: 'tutor',
    linkedWorkflowId: 'tutor-absence',
    linkedTutorId: shortName,
    linkedStudentId: '',
    // This is the parent decision/handoff card. Student-linked children own any
    // structured payment pause work created after a cancellation decision.
    isPause: false,
    nextAction: enableEarlyNotice
      ? `Decide cover or cancel and send the initial parent notice about two weeks before this lesson date.`
      : `Decide cancel or cover and message ${count} parent${count === 1 ? '' : 's'}: open tutor absence workflow`,
    targetDate,
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateInputValue(value = '') {
  const match = `${value || ''}`.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return null;
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatUkNumericDate(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatReadableDate(date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function parseFlexibleDate(value = '') {
  const text = `${value || ''}`.trim();
  if (!text) {
    return null;
  }

  const dateOnly = parseDateInputValue(text.slice(0, 10));
  if (dateOnly) {
    return dateOnly;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateFromMonthDay({ day, month, now }) {
  const year = now.getFullYear();
  let parsed = new Date(year, month, day);
  if (parsed < startOfLocalDay(now)) {
    parsed = new Date(year + 1, month, day);
  }
  return parsed;
}

export function inferEventDateFromText(rawText = '', now = new Date()) {
  const text = `${rawText || ''}`.toLowerCase();
  const today = startOfLocalDay(now);

  if (/\btoday\b/u.test(text)) {
    return today;
  }
  if (/\btomorrow\b/u.test(text)) {
    return addDays(today, 1);
  }

  const numericDate = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/u);
  if (numericDate) {
    const day = Number(numericDate[1]);
    const month = Number(numericDate[2]) - 1;
    const explicitYear = numericDate[3] ? Number(numericDate[3]) : null;
    const year = explicitYear
      ? explicitYear < 100 ? 2000 + explicitYear : explicitYear
      : now.getFullYear();
    let parsed = new Date(year, month, day);
    if (!explicitYear && parsed < today) {
      parsed = new Date(year + 1, month, day);
    }
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const monthDay = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/u)
    || text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/u);
  if (monthDay) {
    const firstIsMonth = Number.isNaN(Number(monthDay[1]));
    const month = MONTH_INDEX[firstIsMonth ? monthDay[1] : monthDay[2]];
    const day = Number(firstIsMonth ? monthDay[2] : monthDay[1]);
    if (typeof month === 'number' && day > 0) {
      return dateFromMonthDay({ day, month, now });
    }
  }

  const weekdayMatch = text.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u);
  if (weekdayMatch) {
    const target = WEEKDAY_INDEX[weekdayMatch[2]];
    const current = today.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0 || weekdayMatch[1]) {
      delta += 7;
    }
    return addDays(today, delta);
  }

  return null;
}

export function inferPlanningTargetDateFromText(rawText = '', now = new Date()) {
  const eventDate = inferEventDateFromText(rawText, now);
  if (!eventDate) {
    return '';
  }

  const text = `${rawText || ''}`.toLowerCase();
  const isPauseReminder = /\bpaus(?:e|ed|ing)\b/u.test(text);
  const shouldBeDoneBefore = /\b(pause|away|off|cover|cancel lesson|no lesson|holiday)\b/u.test(text);
  let targetDate = shouldBeDoneBefore ? addDays(eventDate, -1) : eventDate;

  if (isPauseReminder) {
    for (let daysBefore = 2; daysBefore <= 5; daysBefore += 1) {
      const candidate = addDays(eventDate, -daysBefore);
      if (PLANNING_MEETING_DAYS.has(candidate.getDay())) {
        targetDate = candidate;
        break;
      }
    }
  }

  return formatDateInput(targetDate);
}

export function buildStructuredPausePlanningDraft({
  studentName = '',
  pauseType = 'single',
  lessonDate = '',
  firstPauseDate = '',
  returnDate = '',
  extraNote = '',
  now = new Date(),
} = {}) {
  const type = pauseType === 'range' ? 'range' : 'single';
  const studentLabel = `${studentName || ''}`.trim() || 'student';
  const trimmedNote = `${extraNote || ''}`.trim();

  const firstDate = parseDateInputValue(type === 'range' ? firstPauseDate : lessonDate);
  const backDate = type === 'range' ? parseDateInputValue(returnDate) : null;
  const missingFields = [];

  if (!firstDate) {
    missingFields.push(type === 'range' ? 'first lesson to pause' : 'lesson date');
  }
  if (type === 'range' && !backDate) {
    missingFields.push('returning from date');
  }

  if (missingFields.length) {
    return {
      isComplete: false,
      missingFields,
      title: '',
      notes: '',
      nextAction: '',
      targetDate: '',
      progressNote: '',
    };
  }

  const targetDate = inferPlanningTargetDateFromText(
    `Pause ${studentLabel} for ${formatUkNumericDate(firstDate)}`,
    now,
  );

  if (type === 'single') {
    const readableLessonDate = formatReadableDate(firstDate);
    return {
      isComplete: true,
      missingFields: [],
      title: `Pause ${studentLabel} lesson on ${readableLessonDate}`,
    notes: [
      `Pause type: single lesson.`,
      `Lesson to pause: ${readableLessonDate}.`,
      `Lesson date: ${lessonDate}.`,
      trimmedNote ? `Extra note: ${trimmedNote}` : '',
    ].filter(Boolean).join('\n'),
      nextAction: 'Run pause tool for this lesson, then confirm the payment pause message has been sent.',
      targetDate,
      progressNote: 'Captured with structured pause helper.',
    };
  }

  const readableFirstDate = formatReadableDate(firstDate);
  const readableReturnDate = formatReadableDate(backDate);
  return {
    isComplete: true,
    missingFields: [],
    title: `Pause ${studentLabel} from ${readableFirstDate}; returning ${readableReturnDate}`,
    notes: [
      `Pause type: away period.`,
      `First lesson to pause: ${readableFirstDate}.`,
      `First lesson to pause date: ${firstPauseDate}.`,
      `Returning from: ${readableReturnDate}.`,
      `Returning from date: ${returnDate}.`,
      `Use the return date as the first lesson/date they are expected back, not the last lesson to pause.`,
      trimmedNote ? `Extra note: ${trimmedNote}` : '',
    ].filter(Boolean).join('\n'),
    nextAction: 'Run pause tool for the missed lessons in this period, then confirm the payment pause message has been sent.',
    targetDate,
    progressNote: 'Captured with structured pause helper.',
  };
}

export function buildPauseLessonDateSuggestions(scheduleContext = null, {
  now = new Date(),
  count = 6,
  startDate = '',
} = {}) {
  if (!scheduleContext || scheduleContext.status !== 'found') {
    return [];
  }

  let nextLesson = parseFlexibleDate(scheduleContext.nextLessonAt);
  if (!nextLesson) {
    return [];
  }

  const requestedStart = parseDateInputValue(startDate);

  const today = startOfLocalDay(now);
  nextLesson = startOfLocalDay(nextLesson);

  while (nextLesson < today) {
    nextLesson = addDays(nextLesson, 7);
  }

  if (requestedStart) {
    nextLesson = startOfLocalDay(requestedStart);
  }

  const limitedCount = Math.max(1, Math.min(Number(count) || 6, 10));
  return Array.from({ length: limitedCount }, (_, index) => {
    const date = addDays(nextLesson, index * 7);
    const dateValue = formatDateInput(date);
    return {
      date: dateValue,
      label: formatReadableDate(date),
      lessonLabel: [
        formatReadableDate(date),
        scheduleContext.usualTime || '',
        scheduleContext.teacherName ? `with ${scheduleContext.teacherName}` : '',
      ].filter(Boolean).join(' '),
    };
  });
}

export function normalisePlanningItemType(value) {
  return normaliseEnum(value, PLANNING_ITEM_TYPES, 'idea');
}

export function normalisePlanningStatus(value) {
  return normaliseEnum(value, PLANNING_STATUSES, 'inbox');
}

export function normalisePlanningArea(value) {
  return normaliseEnum(value, PLANNING_AREAS, 'other');
}

export function normalisePlanningOwner(value) {
  const trimmed = `${value || ''}`.trim();
  return PLANNING_OWNERS.includes(trimmed) ? trimmed : 'Unassigned';
}

export function normalisePlanningProgressType(value) {
  return normaliseEnum(value, PLANNING_PROGRESS_TYPES, 'note');
}

export function labelPlanningStatus(value) {
  return STATUS_LABELS[normalisePlanningStatus(value)] || 'Inbox';
}

export function labelPlanningType(value) {
  return TYPE_LABELS[normalisePlanningItemType(value)] || 'Note / idea';
}

export function labelPlanningArea(value) {
  return AREA_LABELS[normalisePlanningArea(value)] || 'No area';
}

export function labelPlanningMomentum(value) {
  return MOMENTUM_LABELS[value] || 'Steady';
}

const MODE_LABELS = { task: 'Same-day task', ongoing: 'Ongoing plan' };

export function normalisePlanningMode(value) {
  return normaliseEnum(value, PLANNING_MODES, 'task');
}

export function planningModeForItemType(itemType, requestedMode = 'task') {
  const type = normalisePlanningItemType(itemType);
  if (type === 'initiative') return 'ongoing';
  if (['action', 'idea'].includes(type)) return 'task';
  return normalisePlanningMode(requestedMode);
}

export function labelPlanningMode(value) {
  return MODE_LABELS[normalisePlanningMode(value)] || 'Same-day task';
}

// A planning item can link several students (e.g. a group lesson). They are
// stored in the single `linked_student_id` sheet column as a comma-separated
// list, which keeps one-student rows (and the whole sheet schema) unchanged.
// `parse` is the read boundary, `serialize` the write boundary.
export function parseLinkedStudentIds(value) {
  const list = Array.isArray(value) ? value : `${value || ''}`.split(',');
  const seen = new Set();
  const ids = [];
  for (const raw of list) {
    const id = `${raw || ''}`.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function serializeLinkedStudentIds(value) {
  return parseLinkedStudentIds(value).join(',');
}

export function normalisePlanningItem(row = {}) {
  const linkedStudentIds = parseLinkedStudentIds(row.linkedStudentIds ?? row.linkedStudentId);
  return {
    planningId: `${row.planningId || ''}`.trim(),
    title: `${row.title || ''}`.trim(),
    notes: `${row.notes || ''}`.trim(),
    itemType: normalisePlanningItemType(row.itemType),
    planMode: normalisePlanningMode(row.planMode),
    owner: normalisePlanningOwner(row.owner),
    status: normalisePlanningStatus(row.status),
    area: normalisePlanningArea(row.area),
    linkedWorkflowId: `${row.linkedWorkflowId || ''}`.trim(),
    // `linkedStudentId` stays the primary (first) student so all single-student
    // consumers (pause, schedule, profile link) keep working unchanged.
    linkedStudentId: linkedStudentIds[0] || '',
    linkedStudentIds,
    linkedTutorId: `${row.linkedTutorId || ''}`.trim(),
    parentPlanningId: `${row.parentPlanningId || ''}`.trim(),
    outcome: `${row.outcome || ''}`.trim(),
    nextAction: `${row.nextAction || ''}`.trim(),
    targetDate: `${row.targetDate || ''}`.trim(),
    createdAt: `${row.createdAt || ''}`.trim(),
    updatedAt: `${row.updatedAt || ''}`.trim(),
    createdBy: `${row.createdBy || ''}`.trim(),
    lastUpdatedBy: `${row.lastUpdatedBy || ''}`.trim(),
    isPause: normalisePauseFlag(row.isPause),
  };
}

// Explicit pause classification: 'true' / 'false' / '' (unset). Unset means
// "infer from content" (legacy rows + auto-created plans); a set value overrides.
export function normalisePauseFlag(value) {
  const flag = `${value ?? ''}`.trim().toLowerCase();
  if (flag === 'true') return 'true';
  if (flag === 'false') return 'false';
  return '';
}

export function buildSchoolForwardPlanningItem({
  now = new Date(),
  existingItem = {},
  actorEmail = 'system_planning_seed',
  skipToday = false,
} = {}) {
  const timestamp = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();

  return {
    planningId: SCHOOL_FORWARD_PLANNING_ID,
    title: 'Friday: what moved the school forward?',
    notes: 'Weekly Friday prompt. First clear urgent loops, then protect time for one meaningful improvement, decision, or learning from the week.',
    itemType: 'initiative',
    owner: 'Unassigned',
    status: 'waiting',
    area: 'workflow',
    linkedWorkflowId: 'meeting-review',
    linkedStudentId: '',
    linkedTutorId: '',
    parentPlanningId: '',
    outcome: 'Keep leadership energy focused on improving the school, not only clearing admin.',
    nextAction: 'Review what moved the school forward this week and choose one next meaningful improvement.',
    targetDate: calculateFridayReviewDate(now, { skipToday }),
    createdAt: existingItem.createdAt || timestamp,
    updatedAt: timestamp,
    createdBy: existingItem.createdBy || actorEmail,
    lastUpdatedBy: actorEmail,
  };
}

export function isSchoolForwardPlanningItem(item = {}) {
  return `${item.planningId || ''}`.trim() === SCHOOL_FORWARD_PLANNING_ID;
}

export function buildSchoolForwardReflections(items = [], { limit = SCHOOL_FORWARD_REFLECTION_LIMIT } = {}) {
  const schoolForwardItem = items.find(isSchoolForwardPlanningItem);
  if (!schoolForwardItem) {
    return [];
  }

  return (schoolForwardItem.progress || [])
    .filter((entry) => `${entry.progressNote || ''}`.trim())
    .sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`))
    .slice(0, limit);
}

export function shouldRefreshSchoolForwardPlanningItem(existingItem = {}, now = new Date()) {
  const existing = normalisePlanningItem(existingItem);
  const today = formatDateInput(startOfLocalDay(now));

  if (!existing.planningId) {
    return true;
  }
  if (!existing.targetDate) {
    return true;
  }
  if (existing.status === 'done' && existing.targetDate <= today) {
    return true;
  }
  // Parked means "skip this occurrence", never "kill the recurring prompt" —
  // the prompt died silently for two weeks in July 2026 because a busy-Friday
  // park was read as never-again. Strictly past (not <=) so a prompt parked
  // on its own day stays parked that day; it re-arms from the next day's load.
  if (existing.status === 'parked' && existing.targetDate < today) {
    return true;
  }
  return false;
}

// The Monday prompt is the back-half of the Friday loop: look at last Friday's
// reflection and turn its "next improvement" intentions into scheduled, owned work.
export function buildMondaySchedulePlanningItem({
  now = new Date(),
  existingItem = {},
  actorEmail = 'system_planning_seed',
  skipToday = false,
} = {}) {
  const timestamp = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();

  return {
    planningId: MONDAY_SCHEDULE_PLANNING_ID,
    title: 'Monday: schedule what we said we’d work on',
    notes: 'Weekly Monday prompt. Look back at Friday’s reflection and turn each “next improvement to make time for” into a dated, owned task.',
    itemType: 'initiative',
    owner: 'Unassigned',
    status: 'waiting',
    area: 'workflow',
    linkedWorkflowId: 'meeting-review',
    linkedStudentId: '',
    linkedTutorId: '',
    parentPlanningId: '',
    outcome: 'Friday’s intentions become scheduled work, not just notes.',
    nextAction: 'Schedule this week’s improvements from Friday’s reflection.',
    targetDate: calculateMondayScheduleDate(now, { skipToday }),
    createdAt: existingItem.createdAt || timestamp,
    updatedAt: timestamp,
    createdBy: existingItem.createdBy || actorEmail,
    lastUpdatedBy: actorEmail,
  };
}

export function isMondaySchedulePlanningItem(item = {}) {
  return `${item.planningId || ''}`.trim() === MONDAY_SCHEDULE_PLANNING_ID;
}

export function shouldRefreshMondaySchedulePlanningItem(existingItem = {}, now = new Date()) {
  const existing = normalisePlanningItem(existingItem);
  const today = formatDateInput(startOfLocalDay(now));

  if (!existing.planningId) {
    return true;
  }
  if (!existing.targetDate) {
    return true;
  }
  if (existing.status === 'done' && existing.targetDate <= today) {
    return true;
  }
  // Parked means "skip this occurrence", never "kill the recurring prompt" —
  // the prompt died silently for two weeks in July 2026 because a busy-Friday
  // park was read as never-again. Strictly past (not <=) so a prompt parked
  // on its own day stays parked that day; it re-arms from the next day's load.
  if (existing.status === 'parked' && existing.targetDate < today) {
    return true;
  }
  return false;
}

// Month-end money prompt: Expense_Log's job is to be reconciled against the bank
// at month end, and one-off spend is easy to forget to log at all. This seed is
// the only prompt for both.
export function buildMonthEndExpensesPlanningItem({
  now = new Date(),
  existingItem = {},
  actorEmail = 'system_planning_seed',
  skipToday = false,
} = {}) {
  const timestamp = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();

  return {
    planningId: MONTH_END_EXPENSES_PLANNING_ID,
    title: 'Month end: reconcile spending against the bank',
    notes: 'Monthly prompt. Check Expense_Log against the bank account for this month — add any spending that is missing (repairs, materials, coffees, one-offs), then confirm the month’s totals look right before the snapshot.',
    itemType: 'action',
    owner: 'Unassigned',
    status: 'waiting',
    area: 'finance',
    linkedWorkflowId: 'finance-month-end',
    linkedStudentId: '',
    linkedTutorId: '',
    parentPlanningId: '',
    outcome: 'Expense_Log matches the bank, so the month-end snapshot and margin view can be trusted.',
    nextAction: 'Compare this month’s Expense_Log with the bank account and add anything missing.',
    targetDate: calculateMonthEndDate(now, { skipToday }),
    createdAt: existingItem.createdAt || timestamp,
    updatedAt: timestamp,
    createdBy: existingItem.createdBy || actorEmail,
    lastUpdatedBy: actorEmail,
  };
}

export function isMonthEndExpensesPlanningItem(item = {}) {
  return `${item.planningId || ''}`.trim() === MONTH_END_EXPENSES_PLANNING_ID;
}

export function shouldRefreshMonthEndExpensesPlanningItem(existingItem = {}, now = new Date()) {
  const existing = normalisePlanningItem(existingItem);
  const today = formatDateInput(startOfLocalDay(now));

  if (!existing.planningId) {
    return true;
  }
  if (!existing.targetDate) {
    return true;
  }
  if (existing.status === 'done' && existing.targetDate <= today) {
    return true;
  }
  // Parked means "skip this occurrence", never "kill the recurring prompt" —
  // the prompt died silently for two weeks in July 2026 because a busy-Friday
  // park was read as never-again. Strictly past (not <=) so a prompt parked
  // on its own day stays parked that day; it re-arms from the next day's load.
  if (existing.status === 'parked' && existing.targetDate < today) {
    return true;
  }
  return false;
}

// The latest genuine Friday reflection note (not the automatic status-change
// entries), used as the source for Monday scheduling.
export function getLatestSchoolForwardReflectionNote(items = []) {
  const schoolForwardItem = items.find(isSchoolForwardPlanningItem);
  if (!schoolForwardItem) {
    return null;
  }
  return (schoolForwardItem.progress || [])
    .filter((entry) => `${entry.progressNote || ''}`.trim() && entry.progressType !== 'status_change')
    .sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`))[0] || null;
}

// Pull the "next improvement to make time for" lines out of a reflection note so
// each can be scheduled individually. Stops at the next "Section:" heading; this
// is a light convenience parse, not task classification — the human still picks.
export function extractReflectionIntentions(reflectionNote = '') {
  const lines = `${reflectionNote || ''}`.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /next improvement/i.test(line));
  if (headerIndex === -1) {
    return [];
  }
  const intentions = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (/:\s*$/.test(line)) {
      break; // next section heading
    }
    intentions.push(line.replace(/^[-*•]\s*/u, '').trim());
  }
  return intentions.filter(Boolean);
}

export function normaliseReflectionIntentionKey(value = '') {
  return `${value || ''}`.trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function buildReflectionIntentionDismissalNote(intention = '') {
  return `${REFLECTION_INTENTION_DISMISSED_PREFIX} ${`${intention || ''}`.trim()}`;
}

export function extractDismissedReflectionIntentions(mondayItem = {}) {
  const dismissed = new Set();
  for (const entry of mondayItem.progress || []) {
    const note = `${entry.progressNote || ''}`.trim();
    if (!note.startsWith(REFLECTION_INTENTION_DISMISSED_PREFIX)) {
      continue;
    }
    const intention = note.slice(REFLECTION_INTENTION_DISMISSED_PREFIX.length).trim();
    const key = normaliseReflectionIntentionKey(intention);
    if (key) {
      dismissed.add(key);
    }
  }
  return dismissed;
}

export function isReflectionIntentionDismissed(mondayItem = {}, intention = '') {
  return extractDismissedReflectionIntentions(mondayItem).has(normaliseReflectionIntentionKey(intention));
}

export function normalisePlanningProgress(row = {}) {
  return {
    progressId: `${row.progressId || ''}`.trim(),
    planningId: `${row.planningId || ''}`.trim(),
    progressNote: `${row.progressNote || ''}`.trim(),
    progressType: normalisePlanningProgressType(row.progressType),
    createdAt: `${row.createdAt || ''}`.trim(),
    createdBy: `${row.createdBy || ''}`.trim(),
  };
}

function parseDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageDaysSince(value, now = new Date()) {
  const parsed = parseDateMs(value);
  if (!parsed) {
    return null;
  }
  return Math.floor((now.getTime() - parsed) / 86_400_000);
}

export function derivePlanningMomentum(item = {}, progress = [], now = new Date()) {
  const status = normalisePlanningStatus(item.status);
  const itemType = normalisePlanningItemType(item.itemType);

  if (status === 'done') {
    return 'done';
  }
  if (status === 'parked') {
    return 'parked';
  }
  if (status === 'inbox' && itemType === 'idea') {
    return 'inbox';
  }

  const latestProgress = [...progress]
    .filter((entry) => entry.planningId === item.planningId)
    .sort((a, b) => parseDateMs(b.createdAt) - parseDateMs(a.createdAt))[0] || null;
  const latestActivityAt = [item.updatedAt, latestProgress?.createdAt]
    .filter(Boolean)
    .sort((a, b) => parseDateMs(b) - parseDateMs(a))[0] || '';
  const activityAgeDays = ageDaysSince(latestActivityAt, now);
  // A manual Action is executable when it has a day; its title already names
  // the work, so requiring a duplicate `next_action` sentence only creates
  // noise. Workflow-generated undated cards can still use next_action as their
  // explicit completion cue. Projects expose their linked Actions instead.
  const needsNextAction = itemType === 'action'
    && !`${item.targetDate || ''}`.trim()
    && !`${item.nextAction || ''}`.trim();

  if (needsNextAction) {
    return 'no_next_action';
  }
  if (typeof activityAgeDays === 'number' && activityAgeDays <= 7) {
    return 'moving';
  }
  if (['active', 'waiting'].includes(status) && (activityAgeDays === null || activityAgeDays >= 14)) {
    return 'stalled';
  }
  return 'steady';
}

export function attachPlanningProgress(items = [], progressRows = [], now = new Date()) {
  const normalisedProgress = progressRows.map(normalisePlanningProgress);
  const progressByPlanningId = new Map();

  for (const entry of normalisedProgress) {
    if (!entry.planningId) {
      continue;
    }
    const entries = progressByPlanningId.get(entry.planningId) || [];
    entries.push(entry);
    progressByPlanningId.set(entry.planningId, entries);
  }

  return items.map((itemRow) => {
    const item = normalisePlanningItem(itemRow);
    const progress = (progressByPlanningId.get(item.planningId) || [])
      .sort((a, b) => parseDateMs(b.createdAt) - parseDateMs(a.createdAt));
    const momentum = derivePlanningMomentum(item, progress, now);

    return {
      ...item,
      statusLabel: labelPlanningStatus(item.status),
      itemTypeLabel: labelPlanningType(item.itemType),
      areaLabel: labelPlanningArea(item.area),
      momentum,
      momentumLabel: labelPlanningMomentum(momentum),
      progress,
      // Structured workflow markers are durable state, not useful prose in the
      // card's “Latest progress” panel.
      latestProgress: progress.find((entry) => entry.progressType !== 'workflow_step') || null,
    };
  });
}

function isDateInput(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(`${value || ''}`.trim());
}

export function buildPlanningDueSummary(items = [], now = new Date()) {
  const today = formatDateInput(startOfLocalDay(now));
  const activeDatedItems = items
    .map(normalisePlanningItem)
    .filter((item) => !['done', 'parked'].includes(item.status) && isDateInput(item.targetDate));
  const dueTodayItems = activeDatedItems.filter((item) => item.targetDate === today);
  const overdueItems = activeDatedItems.filter((item) => item.targetDate < today);
  const dueNowItems = [...overdueItems, ...dueTodayItems].sort((a, b) => (
    a.targetDate.localeCompare(b.targetDate)
    || a.title.localeCompare(b.title)
  ));

  return {
    today,
    dueToday: dueTodayItems.length,
    overdue: overdueItems.length,
    dueNow: dueNowItems.length,
    firstDueItem: dueNowItems[0] || null,
    dueNowTitles: dueNowItems.slice(0, 3).map((item) => item.title).filter(Boolean),
  };
}

export function isMeetingPlanningItem(item = {}, now = new Date()) {
  const normalised = normalisePlanningItem(item);
  if (['done', 'parked'].includes(normalised.status)) {
    return false;
  }

  const nextMeetingDate = calculateNextMeetingDate(now);
  const momentum = item.momentum || derivePlanningMomentum(normalised, item.progress || [], now);
  const linkedWorkflowId = `${normalised.linkedWorkflowId || ''}`.toLowerCase();
  const searchableText = [
    normalised.title,
    normalised.notes,
    normalised.nextAction,
  ].join(' ');

  return normalised.planningId === SCHOOL_FORWARD_PLANNING_ID
    || normalised.planningId === MONDAY_SCHEDULE_PLANNING_ID
    || (isDateInput(normalised.targetDate) && normalised.targetDate <= nextMeetingDate)
    || normalised.status === 'waiting'
    || normalised.owner === 'Unassigned'
    || ['no_next_action', 'stalled'].includes(momentum)
    || linkedWorkflowId === 'tutor-absence'
    || (/\bpaus(?:e|ed|ing)\b/iu.test(searchableText) && isDateInput(normalised.targetDate) && normalised.targetDate <= nextMeetingDate);
}

export function buildPlanningSummary(items = [], now = new Date()) {
  const activeItems = items.filter((item) => !['done', 'parked'].includes(item.status));
  const initiatives = items.filter((item) => item.itemType === 'initiative');
  const schoolNotes = items.filter((item) => ['idea', 'learning_note', 'strategic_note'].includes(item.itemType));
  const noNextAction = activeItems.filter((item) => item.momentum === 'no_next_action').length;
  const stalled = activeItems.filter((item) => item.momentum === 'stalled').length;
  const dueSummary = buildPlanningDueSummary(items, now);

  return {
    total: items.length,
    open: activeItems.length,
    inbox: items.filter((item) => item.status === 'inbox').length,
    active: items.filter((item) => item.status === 'active').length,
    waiting: items.filter((item) => item.status === 'waiting').length,
    done: items.filter((item) => item.status === 'done').length,
    parked: items.filter((item) => item.status === 'parked').length,
    initiatives: initiatives.length,
    activeInitiatives: initiatives.filter((item) => item.status === 'active').length,
    schoolNotes: schoolNotes.length,
    activeSchoolNotes: schoolNotes.filter((item) => !['done', 'parked'].includes(item.status)).length,
    learningNotes: items.filter((item) => item.itemType === 'learning_note').length,
    strategicNotes: items.filter((item) => item.itemType === 'strategic_note').length,
    moving: activeItems.filter((item) => item.momentum === 'moving').length,
    stalled,
    noNextAction,
    needsAttention: noNextAction + stalled,
    dueToday: dueSummary.dueToday,
    overdue: dueSummary.overdue,
    dueNow: dueSummary.dueNow,
    dueNowTitles: dueSummary.dueNowTitles,
  };
}
