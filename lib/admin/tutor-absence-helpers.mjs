/** @fileoverview Pure core of the tutor-absence workflow: state parsing, generated planning bundles, cover ranking, and parent message groups. */
import { buildStructuredPausePlanningDraft } from './planning-helpers.mjs';

const DEFAULT_TIME_ZONE = 'Europe/London';
const ABSENCE_STATUS_VALUES = new Set(['draft', 'in_progress', 'parents_to_message', 'pause_handoff', 'resolved']);
const ABSENCE_DECISION_VALUES = new Set(['', 'cancel_day', 'cover']);
const AUTO_SYNC_MUTABLE_PLANNING_STATUSES = new Set(['active']);

// Generated tutor-absence cards are rebuilt whenever a related absence changes.
// Human terminal states are history, not defaults to reconcile against: a later
// cancellation must never turn completed, parked, or deliberately deferred work
// back into a live task. Only a still-active generated card is safe to refresh.
export function isTutorAbsenceGeneratedPlanningItemMutable(item = {}) {
  return AUTO_SYNC_MUTABLE_PLANNING_STATUSES.has(`${item.status || ''}`.trim().toLowerCase());
}

export function tutorAbsencePlanningItemMatchesGeneratedPlan(existing = {}, next = {}) {
  return [
    'title',
    'notes',
    'itemType',
    'planMode',
    'owner',
    'status',
    'area',
    'linkedWorkflowId',
    'linkedStudentId',
    'linkedTutorId',
    'parentPlanningId',
    'outcome',
    'nextAction',
    'targetDate',
    'isPause',
  ].every((key) => `${existing[key] ?? ''}`.trim() === `${next[key] ?? ''}`.trim());
}

export function shouldSyncGeneratedTutorAbsencePlanningItem({ existing = {}, next = {} } = {}) {
  if (!existing?.planningId) return true;
  return isTutorAbsenceGeneratedPlanningItemMutable(existing)
    && !tutorAbsencePlanningItemMatchesGeneratedPlan(existing, next);
}

export function selectObsoleteTutorAbsenceFinalConfirmationPlanningIds({
  planningItems = [],
  absenceIds = [],
  currentPlanningIds = [],
} = {}) {
  const relevantAbsenceIds = [...new Set((absenceIds || []).filter(Boolean))];
  const currentIds = new Set((currentPlanningIds || []).filter(Boolean));

  return (planningItems || [])
    .filter((item) => (
      item.linkedWorkflowId === 'tutor-absence-final-confirmation'
      && isTutorAbsenceGeneratedPlanningItemMutable(item)
      && !currentIds.has(item.planningId)
      && relevantAbsenceIds.some((absenceId) => `${item.notes || ''}`.includes(`Tutor absence ID: ${absenceId}.`))
    ))
    .map((item) => item.planningId);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseMmsWallClock(value) {
  const match = `${value || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    weekdayDate: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
  };
}

export function formatTutorAbsenceDate(value = '') {
  const wallClock = parseMmsWallClock(`${value}T12:00:00`);
  if (!wallClock) return value;
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(wallClock.weekdayDate);
  const day = Number(value.slice(8, 10));
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(wallClock.weekdayDate);
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${weekday} ${day}${suffix} ${month}`;
}

function formatTime(value = '') {
  const wallClock = parseMmsWallClock(value);
  if (wallClock) return wallClock.time;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DEFAULT_TIME_ZONE,
  }).format(parsed);
}

function firstName(value = '', fallback = '') {
  return `${value || ''}`.trim().split(/\s+/)[0] || fallback;
}

function joinHumanList(items = []) {
  const list = items.map((item) => `${item || ''}`.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function studentIdsForEvent(event = {}) {
  const ids = new Set();
  if (event.StudentID) ids.add(event.StudentID);
  for (const id of event.StudentIDs || []) {
    if (id) ids.add(id);
  }
  for (const attendance of event.Attendances || []) {
    if (attendance.StudentID) ids.add(attendance.StudentID);
  }
  for (const student of event.Students || []) {
    if (student.ID) ids.add(student.ID);
  }
  return [...ids];
}

function eventStudentName(event = {}) {
  const student = (event.Students || [])[0] || {};
  return student.FullName || [student.FirstName, student.LastName].filter(Boolean).join(' ').trim();
}

export function normaliseTutorAbsenceStatus(value = '') {
  const normalised = `${value || ''}`.trim().toLowerCase();
  return ABSENCE_STATUS_VALUES.has(normalised) ? normalised : 'draft';
}

export function normaliseTutorAbsenceDecision(value = '') {
  const normalised = `${value || ''}`.trim().toLowerCase();
  return ABSENCE_DECISION_VALUES.has(normalised) ? normalised : '';
}

export function parseTutorAbsenceStateRow(row = {}) {
  return {
    absenceId: row.absenceId || '',
    tutorShortName: row.tutorShortName || '',
    tutorName: row.tutorName || '',
    absenceDate: row.absenceDate || '',
    status: normaliseTutorAbsenceStatus(row.status),
    decision: normaliseTutorAbsenceDecision(row.decision),
    coverTutorShortName: row.coverTutorShortName || '',
    coverTutorName: row.coverTutorName || '',
    affectedLessons: parseJson(row.affectedLessonsJson, []),
    messageState: parseJson(row.messageStateJson, {}),
    note: row.note || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    resolvedAt: row.resolvedAt || '',
    updatedBy: row.updatedBy || '',
  };
}

function buildTutorAbsenceLesson(event, studentMmsId, studentByMmsId, studentCount) {
  const student = studentByMmsId.get(studentMmsId) || {};
  // Only fall back to the event's own student name on a single-student event —
  // on a group event that name belongs to one member and would mislabel the rest.
  const studentName = student.fullName
    || (studentCount <= 1 ? eventStudentName(event) : '')
    || 'Unknown student';
  const instrument = student.instrument || '';

  return {
    eventId: event.ID || '',
    studentMmsId,
    studentName,
    parentName: [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
    parentEmail: student.email || '',
    parentPhone: student.contactNumber || '',
    instrument,
    tutor: student.tutor || '',
    paymentMode: student.paymentMode || '',
    paymentExpectation: student.paymentExpectation || '',
    stripeCustomerId: student.stripeCustomerId || '',
    stripeSubscriptionId: student.stripeSubscriptionId || '',
    startAt: event.StartDate || '',
    lessonDate: parseMmsWallClock(event.StartDate)?.date || '',
    lessonTime: formatTime(event.StartDate),
    durationMinutes: event.Duration ? String(event.Duration) : '',
    studentCount,
  };
}

// One MMS event can carry several students — a sibling pair, or a class such as
// the ukulele group. This used to collapse to studentIds[0] and silently drop
// every other household, which is exactly what the old day-wide "manual
// household check" block existed to compensate for. Expanding to one entry per
// student makes "no household is missed" true by construction, so the block is
// no longer the only safe answer to a group booking.
export function expandTutorAbsenceEvent(event = {}, studentByMmsId = new Map()) {
  const studentIds = studentIdsForEvent(event);
  const ids = studentIds.length ? studentIds : [''];
  return ids.map((studentMmsId) => (
    buildTutorAbsenceLesson(event, studentMmsId, studentByMmsId, studentIds.length)
  ));
}

// The first student on an event. Anything that must reach every household should
// use expandTutorAbsenceEvent instead.
export function normaliseTutorAbsenceEvent(event = {}, studentByMmsId = new Map()) {
  return expandTutorAbsenceEvent(event, studentByMmsId)[0];
}

export function buildTutorAbsenceId({ tutorShortName = '', absenceDate = '' } = {}) {
  return `tutor_absence:${tutorShortName}:${absenceDate}`;
}

function safeIdSegment(value = '') {
  return `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDateValue(value = '') {
  const match = `${value || ''}`.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(first, second) {
  return Math.round((second.getTime() - first.getTime()) / 86400000);
}

function lessonSignature(lesson = {}) {
  return [
    lesson.eventId || '',
    lesson.studentMmsId || '',
    lesson.lessonDate || '',
    lesson.lessonTime || '',
  ].join('::');
}

export function scopeTutorAbsenceLessonSnapshots({
  expectedLessons = [],
  liveLessons = [],
  studentMmsId = '',
} = {}) {
  const targetStudentId = `${studentMmsId || ''}`.trim();
  if (!targetStudentId) {
    return { expectedLessons, liveLessons };
  }
  return {
    expectedLessons: expectedLessons.filter((lesson) => lesson.studentMmsId === targetStudentId),
    liveLessons: liveLessons.filter((lesson) => lesson.studentMmsId === targetStudentId),
  };
}

// A multi-student event no longer blocks here: lessons are expanded to one entry
// per student before they reach this point, so the signatures below already
// compare every household rather than only the first one MMS listed.
export function compareTutorAbsenceLessonSnapshots({ expectedLessons = [], liveLessons = [] } = {}) {
  const expected = new Set((expectedLessons || []).map(lessonSignature));
  const live = new Set((liveLessons || []).map(lessonSignature));
  const added = [...live].filter((signature) => !expected.has(signature));
  const removed = [...expected].filter((signature) => !live.has(signature));
  if (added.length || removed.length) {
    return {
      ready: false,
      reason: 'schedule_changed',
      message: 'MMS lessons have changed since this absence was planned. Review the date before messaging or changing payment.',
      addedCount: added.length,
      removedCount: removed.length,
    };
  }
  return { ready: true, reason: 'current', message: 'MMS matches the saved absence snapshot.' };
}

function inferReturnDateFromMissedLessons(dates = []) {
  const parsedDates = [...new Set(dates)]
    .map(parseDateValue)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  if (!parsedDates.length) return '';

  const last = parsedDates[parsedDates.length - 1];
  const previous = parsedDates[parsedDates.length - 2] || null;
  const intervalDays = previous
    ? Math.max(1, Math.min(daysBetween(previous, last), 14))
    : 7;
  return formatDateValue(addDays(last, intervalDays || 7));
}

export function buildTutorAbsencePausePlanningId({ absenceId = '', lesson = {} } = {}) {
  return [
    'planning_tutor_absence_pause',
    safeIdSegment(absenceId),
    safeIdSegment(lesson.studentMmsId),
    safeIdSegment(lesson.eventId || lesson.lessonDate),
  ].filter(Boolean).join('_');
}

export function buildTutorAbsencePausePeriodPlanningId({
  tutorShortName = '',
  studentMmsId = '',
  firstDate = '',
  lastDate = '',
} = {}) {
  return [
    'planning_tutor_absence_pause_period',
    safeIdSegment(tutorShortName),
    safeIdSegment(studentMmsId),
    safeIdSegment(firstDate),
    safeIdSegment(lastDate),
  ].filter(Boolean).join('_');
}

export function buildTutorAbsenceEarlyNoticePlanningId({
  tutorShortName = '',
  studentMmsId = '',
  firstDate = '',
  lastDate = '',
} = {}) {
  return [
    'planning_tutor_absence_notice',
    safeIdSegment(tutorShortName),
    safeIdSegment(studentMmsId),
    safeIdSegment(firstDate),
    safeIdSegment(lastDate),
  ].filter(Boolean).join('_');
}

export function buildTutorAbsenceEarlyNoticePlanningPrefix({ tutorShortName = '', studentMmsId = '' } = {}) {
  return [
    'planning_tutor_absence_notice',
    safeIdSegment(tutorShortName),
    safeIdSegment(studentMmsId),
  ].filter(Boolean).join('_');
}

function collectPauseCandidatesFromRows(rows = []) {
  return (rows || []).flatMap((row) => {
    if (row.decision !== 'cancel_day') return [];
    return (row.affectedLessons || []).flatMap((lesson) => {
      const state = row.messageState?.[lesson.eventId] || {};
      const lessonDate = `${lesson.lessonDate || row.absenceDate || ''}`.trim();
      const studentMmsId = `${lesson.studentMmsId || ''}`.trim();

      if (!lessonDate || !studentMmsId || state.pauseSkipped) {
        return [];
      }
      if (
        `${lesson.paymentExpectation || ''}`.trim() === 'stripe_paused_expected'
        && !row.requiresDatedPaymentTool
      ) {
        return [];
      }

      return [{
        row,
        lesson,
        state,
        lessonDate,
        studentMmsId,
      }];
    });
  });
}

function splitCandidatesIntoBlocks(candidates = []) {
  const sorted = [...candidates].sort((a, b) => (
    a.lessonDate.localeCompare(b.lessonDate)
    || `${a.lesson.eventId || ''}`.localeCompare(`${b.lesson.eventId || ''}`)
  ));
  const blocks = [];

  for (const candidate of sorted) {
    const candidateDate = parseDateValue(candidate.lessonDate);
    const currentBlock = blocks[blocks.length - 1];
    const previous = currentBlock?.[currentBlock.length - 1];
    const previousDate = previous ? parseDateValue(previous.lessonDate) : null;
    const gap = previousDate && candidateDate ? daysBetween(previousDate, candidateDate) : 0;

    if (!currentBlock || gap > 8) {
      blocks.push([candidate]);
    } else {
      currentBlock.push(candidate);
    }
  }

  return blocks;
}

export function buildTutorAbsencePausePlanningBundle({
  rows = [],
  now = new Date(),
} = {}) {
  const candidates = collectPauseCandidatesFromRows(rows);
  const groupedByStudent = new Map();

  for (const candidate of candidates) {
    const tutorKey = candidate.row.tutorShortName || candidate.row.tutorName || '';
    const key = `${tutorKey}::${candidate.studentMmsId}`;
    const existing = groupedByStudent.get(key) || [];
    existing.push(candidate);
    groupedByStudent.set(key, existing);
  }

  const plans = [];
  const supersededPlanningIds = new Set();
  const supersededPlanningPrefixes = new Set();

  for (const studentCandidates of groupedByStudent.values()) {
    for (const block of splitCandidatesIntoBlocks(studentCandidates)) {
      if (block.length < 2) {
        const candidate = block[0];
        plans.push(...buildTutorAbsencePausePlanningItems({
          absenceId: candidate.row.absenceId,
          tutorName: candidate.row.tutorName,
          tutorShortName: candidate.row.tutorShortName,
          absenceDate: candidate.row.absenceDate,
          lessons: [candidate.lesson],
          messageState: candidate.row.messageState,
          requiresDatedPaymentTool: candidate.row.requiresDatedPaymentTool,
          now,
        }));
        continue;
      }

      const firstCandidate = block[0];
      const missedDates = [...new Set(block.map((candidate) => candidate.lessonDate))].sort();
      const firstDate = missedDates[0];
      const lastDate = missedDates[missedDates.length - 1];
      const returnDate = inferReturnDateFromMissedLessons(missedDates);
      const tutorName = firstCandidate.row.tutorName || firstCandidate.row.tutorShortName || '';
      const tutorShortName = firstCandidate.row.tutorShortName || '';
      const studentName = firstCandidate.lesson.studentName || 'student';
      const draft = buildStructuredPausePlanningDraft({
        studentName,
        pauseType: 'range',
        firstPauseDate: firstDate,
        returnDate,
        extraNote: [
          `Tutor absence: ${tutorName || tutorShortName || 'Tutor'}.`,
          `Missed lessons: ${missedDates.join(', ')}.`,
        ].join(' '),
        now,
      });

      if (!draft.isComplete) {
        continue;
      }

      for (const candidate of block) {
        supersededPlanningIds.add(buildTutorAbsencePausePlanningId({
          absenceId: candidate.row.absenceId,
          lesson: candidate.lesson,
        }));
      }

      const planningId = buildTutorAbsencePausePeriodPlanningId({
        tutorShortName,
        studentMmsId: firstCandidate.studentMmsId,
        firstDate,
        lastDate,
      });
      const groupPrefix = [
        'planning_tutor_absence_pause_period',
        safeIdSegment(tutorShortName),
        safeIdSegment(firstCandidate.studentMmsId),
      ].filter(Boolean).join('_');
      supersededPlanningPrefixes.add(groupPrefix);

      const allAligned = block.every((candidate) => Boolean(candidate.state.paymentExpectationAligned));
      const absenceIds = [...new Set(block.map((candidate) => candidate.row.absenceId).filter(Boolean))];
      const eventIds = [...new Set(block.map((candidate) => candidate.lesson.eventId).filter(Boolean))];

      plans.push({
        planningId,
        item: {
          ...draft,
          notes: [
            draft.notes,
            `Tutor absence IDs: ${absenceIds.join(', ')}.`,
            tutorName || tutorShortName ? `Tutor absence tutor: ${tutorName || tutorShortName}.` : '',
            `Tutor absence missed lesson dates: ${missedDates.join(', ')}.`,
            eventIds.length ? `MMS event IDs: ${eventIds.join(', ')}.` : '',
          ].filter(Boolean).join('\n'),
          itemType: 'action',
          status: allAligned ? 'done' : 'active',
          area: 'admin',
          linkedWorkflowId: 'tutor-absence',
          linkedStudentId: firstCandidate.studentMmsId,
          linkedTutorId: tutorShortName || tutorName || '',
          parentPlanningId: `tutor_absence_period:${tutorShortName}:${firstDate}:${lastDate}`,
          nextAction: allAligned
            ? 'Payment pause already handled from the tutor absence workflow.'
            : draft.nextAction,
          isPause: true,
        },
        progressNote: allAligned
          ? 'Auto-created from grouped tutor absence cancellations; payment pauses were already aligned.'
          : 'Auto-created from grouped tutor absence cancellations.',
      });
    }
  }

  return {
    plans,
    supersededPlanningIds: [...supersededPlanningIds],
    supersededPlanningPrefixes: [...supersededPlanningPrefixes],
  };
}

// Cross-lane card retirement: which OPEN tutor-absence pause cards are made redundant
// because the student's own pause now covers those dates. `coveredStudentMmsIds` are the
// students the reconciliation marked as fully covered by their pause (net-new 0) — that
// IS the date-coverage check, so we only park cards for genuinely-subsumed students.
// Pure: returns [{ studentMmsId, planningIds }]; the caller does the parking write.
export function selectRedundantTutorAbsencePauseCards({
  planningItems = [],
  coveredStudentMmsIds = [],
  tutorShortName = '',
} = {}) {
  const covered = new Set((coveredStudentMmsIds || []).filter(Boolean));
  const tutor = `${tutorShortName || ''}`.trim();
  const isOpen = (status) => !['parked', 'done', 'resolved'].includes(`${status || ''}`.trim().toLowerCase());
  const byStudent = new Map();
  for (const item of planningItems || []) {
    if (item.linkedWorkflowId !== 'tutor-absence') continue;
    if (!`${item.planningId || ''}`.startsWith('planning_tutor_absence_pause')) continue;
    if (tutor && `${item.linkedTutorId || ''}`.trim() !== tutor) continue;
    if (!covered.has(item.linkedStudentId)) continue;
    if (!isOpen(item.status)) continue;
    if (!byStudent.has(item.linkedStudentId)) byStudent.set(item.linkedStudentId, []);
    byStudent.get(item.linkedStudentId).push(item.planningId);
  }
  return [...byStudent.entries()].map(([studentMmsId, planningIds]) => ({ studentMmsId, planningIds }));
}

function collectMessageCandidatesFromRows(rows = []) {
  return (rows || []).flatMap((row) => {
    if (row.decision !== 'cancel_day') return [];
    return (row.affectedLessons || []).flatMap((lesson) => {
      const lessonDate = `${lesson.lessonDate || row.absenceDate || ''}`.trim();
      const studentMmsId = `${lesson.studentMmsId || ''}`.trim();

      if (!lessonDate || !studentMmsId || !lesson.eventId) {
        return [];
      }

      return [{
        row,
        lesson,
        state: row.messageState?.[lesson.eventId] || {},
        lessonDate,
        studentMmsId,
      }];
    });
  });
}

export function buildTutorAbsenceCancellationMessageGroups({
  rows = [],
  tutorShortName = '',
  includeSingleLessons = false,
} = {}) {
  const candidates = collectMessageCandidatesFromRows(rows)
    .filter((candidate) => !tutorShortName || candidate.row.tutorShortName === tutorShortName);
  const groupedByStudent = new Map();

  for (const candidate of candidates) {
    const tutorKey = candidate.row.tutorShortName || candidate.row.tutorName || '';
    const key = `${tutorKey}::${candidate.studentMmsId}`;
    const existing = groupedByStudent.get(key) || [];
    existing.push(candidate);
    groupedByStudent.set(key, existing);
  }

  const groups = [];

  for (const studentCandidates of groupedByStudent.values()) {
    for (const block of splitCandidatesIntoBlocks(studentCandidates)) {
      if (block.length < 2 && !includeSingleLessons) {
        continue;
      }

      const firstCandidate = block[0];
      const missedDates = [...new Set(block.map((candidate) => candidate.lessonDate))].sort();
      const firstDate = missedDates[0];
      const lastDate = missedDates[missedDates.length - 1];
      const tutorName = firstCandidate.row.tutorName || firstCandidate.row.tutorShortName || '';
      const tutorShort = firstCandidate.row.tutorShortName || '';
      const studentName = firstCandidate.lesson.studentName || 'student';
      const parentName = firstCandidate.lesson.parentName || '';
      const studentFirst = firstName(studentName, 'the lesson');
      const parentFirst = firstName(parentName, 'there');
      const tutorFirst = firstName(tutorName, 'their tutor');
      const dateText = joinHumanList(missedDates.map(formatTutorAbsenceDate));
      const occurrences = block.map((candidate) => ({
        absenceId: candidate.row.absenceId,
        absenceDate: candidate.row.absenceDate,
        eventId: candidate.lesson.eventId,
        studentMmsId: candidate.studentMmsId,
        lessonDate: candidate.lessonDate,
        messaged: Boolean(candidate.state.messaged),
      }));
      const groupKey = [
        'tutor_absence_cancel_message',
        safeIdSegment(tutorShort || tutorName),
        safeIdSegment(firstCandidate.studentMmsId),
        safeIdSegment(firstDate),
        safeIdSegment(lastDate),
      ].filter(Boolean).join('_');

      groups.push({
        groupKey,
        tutorShortName: tutorShort,
        tutorName,
        studentMmsId: firstCandidate.studentMmsId,
        studentName,
        parentName,
        firstDate,
        lastDate,
        missedDates,
        occurrenceCount: occurrences.length,
        messagedCount: occurrences.filter((occurrence) => occurrence.messaged).length,
        allMessaged: occurrences.every((occurrence) => occurrence.messaged),
        occurrences,
        message: `Hi ${parentFirst}! Just a quick heads up that ${tutorFirst} is away on ${dateText}, so ${studentFirst}’s lessons won’t be going ahead on those dates.\n\nWe’ll make sure the lesson/payment side is handled correctly from our end, so this is just to keep you in the loop.`,
      });
    }
  }

  return groups.sort((a, b) => (
    a.firstDate.localeCompare(b.firstDate)
    || a.studentName.localeCompare(b.studentName)
  ));
}

// This is deliberately separate from the pause bundle. It creates planning
// metadata only: no payment expectation, absence state or reconciliation input
// is changed by an early-notice plan.
export function buildTutorAbsenceEarlyNoticePlanningBundle({ rows = [] } = {}) {
  const groups = buildTutorAbsenceCancellationMessageGroups({ rows, includeSingleLessons: true });
  const plans = groups.map((group) => {
    const firstDate = parseDateValue(group.firstDate);
    const noticeTargetDate = firstDate ? formatDateValue(addDays(firstDate, -14)) : '';
    const dateText = joinHumanList(group.missedDates.map(formatTutorAbsenceDate));
    const parentFirst = firstName(group.parentName, 'there');
    const tutorFirst = firstName(group.tutorName, 'their tutor');
    const studentFirst = firstName(group.studentName, 'the lesson');
    const message = `Hi ${parentFirst}! Just a quick heads up that ${tutorFirst} is away on ${dateText}, so ${studentFirst}’s lesson${group.missedDates.length === 1 ? '' : 's'} won’t be going ahead on those date${group.missedDates.length === 1 ? '' : 's'}.\n\nWe’ll confirm the payment adjustment closer to the time.`;
    const absenceIds = [...new Set(group.occurrences.map((occurrence) => occurrence.absenceId).filter(Boolean))];
    const planningId = buildTutorAbsenceEarlyNoticePlanningId({
      tutorShortName: group.tutorShortName || group.tutorName,
      studentMmsId: group.studentMmsId,
      firstDate: group.firstDate,
      lastDate: group.lastDate,
    });

    return {
      planningId,
      prefix: buildTutorAbsenceEarlyNoticePlanningPrefix({
        tutorShortName: group.tutorShortName || group.tutorName,
        studentMmsId: group.studentMmsId,
      }),
      item: {
        title: `Tell ${group.studentName} about ${firstName(group.tutorName, 'their tutor')}’s absence`,
        notes: [
          'Tutor absence early notice plan: v1.',
          `Tutor absence IDs: ${absenceIds.join(', ')}.`,
          `Tutor absence tutor: ${group.tutorName || group.tutorShortName}.`,
          `Tutor absence missed lesson dates: ${group.missedDates.join(', ')}.`,
          'Parent notice message:',
          message,
        ].filter(Boolean).join('\n'),
        itemType: 'action',
        status: 'active',
        area: 'admin',
        linkedWorkflowId: 'tutor-absence-notice',
        linkedStudentId: group.studentMmsId,
        linkedTutorId: group.tutorShortName || group.tutorName || '',
        parentPlanningId: group.groupKey,
        nextAction: `Send the initial absence notice by ${noticeTargetDate || 'the notice target'}; the final payment confirmation stays on the pause card.`,
        targetDate: noticeTargetDate,
        isPause: false,
      },
      progressNote: 'Created from a newly captured tutor absence; this early notice does not change payment or reconciliation.',
    };
  });

  return { plans };
}

// A human can explicitly record that no payment adjustment is required. Those
// students still need a truthful final parent confirmation; this separate card
// has no pause/finance semantics and never enters the reconciliation inputs.
// The broad Students.payment_expectation flag is deliberately not enough:
// stripe_paused_expected has no date coverage and cannot prove this absence was
// handled.
export function buildTutorAbsenceFinalConfirmationPlanningItems({ rows = [] } = {}) {
  return collectMessageCandidatesFromRows(rows).flatMap((candidate) => {
    if (!candidate.state.pauseSkipped) return [];

    const targetDate = parseDateValue(candidate.lessonDate)
      ? formatDateValue(addDays(parseDateValue(candidate.lessonDate), -5))
      : '';
    const parentFirst = firstName(candidate.lesson.parentName, 'there');
    const studentFirst = firstName(candidate.lesson.studentName, 'the lesson');
    const tutorFirst = firstName(candidate.row.tutorName, 'their tutor');
    const dateLabel = formatTutorAbsenceDate(candidate.lessonDate);
    const message = `Hi ${parentFirst}, just confirming no payment adjustment was needed for ${studentFirst}’s lesson affected by ${tutorFirst}’s absence on ${dateLabel}. Thanks!`;
    const planningId = [
      'planning_tutor_absence_final_confirmation',
      safeIdSegment(candidate.row.absenceId),
      safeIdSegment(candidate.studentMmsId),
      safeIdSegment(candidate.lesson.eventId),
    ].filter(Boolean).join('_');

    return [{
      planningId,
      item: {
        title: `Confirm ${candidate.lesson.studentName}’s payment outcome`,
        notes: [
          'Tutor absence final confirmation: v1.',
          `Tutor absence ID: ${candidate.row.absenceId}.`,
          `Tutor absence tutor: ${candidate.row.tutorName || candidate.row.tutorShortName}.`,
          `Tutor absence lesson date: ${candidate.lessonDate}.`,
          `Payment action not needed: ${candidate.state.pauseSkipReason || 'recorded in tutor absence workflow'}.`,
          'Parent final confirmation message:',
          message,
        ].filter(Boolean).join('\n'),
        itemType: 'action',
        status: 'active',
        area: 'admin',
        linkedWorkflowId: 'tutor-absence-final-confirmation',
        linkedStudentId: candidate.studentMmsId,
        linkedTutorId: candidate.row.tutorShortName || candidate.row.tutorName || '',
        parentPlanningId: candidate.row.absenceId,
        nextAction: 'Send and record the final payment outcome confirmation. No payment tool action is required.',
        targetDate,
        isPause: false,
      },
      progressNote: 'Created final confirmation for a tutor absence with no payment-tool action required.',
    }];
  });
}

export function buildTutorAbsencePausePlanningItems({
  absenceId = '',
  tutorName = '',
  tutorShortName = '',
  absenceDate = '',
  lessons = [],
  messageState = {},
  requiresDatedPaymentTool = false,
  now = new Date(),
} = {}) {
  return (lessons || []).flatMap((lesson) => {
    const state = messageState[lesson.eventId] || {};
    const lessonDate = `${lesson.lessonDate || absenceDate || ''}`.trim();
    const studentMmsId = `${lesson.studentMmsId || ''}`.trim();

    if (!lessonDate || !studentMmsId || state.pauseSkipped) {
      return [];
    }
    // A pause card exists to drive the Stripe payment pause. A manual payer has
    // no subscription to pause, so they stay listed as an affected household for
    // the parent message but get no payment card. This is what keeps a class
    // booking like the ukulele group from generating cards nobody can action,
    // while each sibling on Stripe still gets their own. An unknown payment mode
    // is deliberately not treated as manual — it still gets a card to look at.
    if (`${lesson.paymentMode || ''}`.trim().toLowerCase() === 'manual') {
      return [];
    }
    if (
      `${lesson.paymentExpectation || ''}`.trim() === 'stripe_paused_expected'
      && !requiresDatedPaymentTool
    ) {
      return [];
    }

    const draft = buildStructuredPausePlanningDraft({
      studentName: lesson.studentName || 'student',
      pauseType: 'single',
      lessonDate,
      extraNote: `Tutor absence: ${tutorName || tutorShortName || 'Tutor'}.`,
      now,
    });

    if (!draft.isComplete) {
      return [];
    }

    const alreadyAligned = Boolean(state.paymentExpectationAligned);
    const planningId = buildTutorAbsencePausePlanningId({ absenceId, lesson });
    const tutorLine = tutorName || tutorShortName
      ? `Tutor absence tutor: ${tutorName || tutorShortName}.`
      : '';
    const absenceLine = absenceDate ? `Tutor absence date: ${absenceDate}.` : '';
    const eventLine = lesson.eventId ? `MMS event ID: ${lesson.eventId}.` : '';

    return [{
      planningId,
      item: {
        ...draft,
        notes: [
          draft.notes,
          `Tutor absence ID: ${absenceId}.`,
          tutorLine,
          absenceLine,
          eventLine,
        ].filter(Boolean).join('\n'),
        itemType: 'action',
        status: alreadyAligned ? 'done' : 'active',
        area: 'admin',
        linkedWorkflowId: 'tutor-absence',
        linkedStudentId: studentMmsId,
        linkedTutorId: tutorShortName || tutorName || '',
        parentPlanningId: absenceId,
        nextAction: alreadyAligned
          ? 'Payment pause already handled from the tutor absence workflow.'
          : draft.nextAction,
        isPause: true,
      },
      progressNote: alreadyAligned
        ? 'Auto-created from tutor absence cancellation; payment pause was already aligned.'
        : 'Auto-created from tutor absence cancellation.',
    }];
  });
}

export function buildCoverTutorOptions({ absentTutor = {}, lessons = [], tutors = [] } = {}) {
  const neededInstruments = new Set(lessons.map((lesson) => `${lesson.instrument || ''}`.toLowerCase()).filter(Boolean));
  const absentTeacherId = absentTutor.teacherId || '';

  return tutors
    .filter((tutor) => tutor.teacherId && tutor.teacherId !== absentTeacherId)
    .map((tutor) => {
      const tutorInstruments = (tutor.instruments || []).map((instrument) => instrument.toLowerCase());
      const matchedInstruments = [...neededInstruments].filter((instrument) => tutorInstruments.includes(instrument));
      return {
        ...tutor,
        matchedInstruments,
      };
    })
    .filter((tutor) => tutor.matchedInstruments.length)
    .sort((a, b) => b.matchedInstruments.length - a.matchedInstruments.length || a.fullName.localeCompare(b.fullName));
}

// The ask sent TO a cover candidate (clipboard + Communication_Log, never
// auto-sent), as opposed to buildTutorAbsenceMessage below which addresses the
// parent once cover is arranged.
export function buildCoverAskMessage({ candidateName = '', absentTutorName = '', absenceDate = '', lessons = [] } = {}) {
  const candidateFirst = firstName(candidateName, 'there');
  const absentFirst = firstName(absentTutorName, 'one of the tutors');
  const day = formatTutorAbsenceDate(absenceDate);
  const sorted = [...lessons].sort((a, b) => `${a.lessonTime || ''}`.localeCompare(`${b.lessonTime || ''}`));
  const times = sorted.map((lesson) => lesson.lessonTime).filter(Boolean);
  const timeSpan = times.length > 1 ? `${times[0]}–${times[times.length - 1]}` : times[0] || '';
  const instruments = [...new Set(lessons.map((lesson) => `${lesson.instrument || ''}`.trim().toLowerCase()).filter(Boolean))];
  const detailParts = [
    `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`,
    timeSpan,
    instruments.length ? instruments.join(', ') : '',
  ].filter(Boolean);

  return `Hi ${candidateFirst}! ${absentFirst} is off on ${day} — any chance you could cover?\n\n${detailParts.join(' · ')}. Let me know and I'll sort the details.`;
}

export function buildTutorAbsenceMessage({ lesson = {}, tutorName = '', absenceDate = '', decision = '', coverTutorName = '' } = {}) {
  const parentFirst = firstName(lesson.parentName, 'there');
  const studentFirst = firstName(lesson.studentName, 'the lesson');
  const absentTutorFirst = firstName(tutorName, 'their tutor');
  const coverTutorFirst = firstName(coverTutorName, 'another First Chord tutor');
  const day = formatTutorAbsenceDate(absenceDate);

  if (decision === 'cover') {
    return `Hi ${parentFirst}! Just a quick heads up that ${absentTutorFirst} is off on ${day}, so ${studentFirst}’s lesson will be covered by ${coverTutorFirst}.\n\nThe lesson should go ahead as normal, and ${absentTutorFirst} will pass on notes so ${coverTutorFirst} is up to speed with what ${studentFirst} has been working on.`;
  }

  return `Hi ${parentFirst}! Just a quick heads up that ${absentTutorFirst} is off on ${day}, so ${studentFirst}’s lesson won’t be going ahead that day.\n\nSorry for the disruption, and we’ll make sure the lesson/payment side is handled correctly from our end.`;
}

export function isTutorAbsencePaymentHandled(lesson = {}, state = {}) {
  if (!lesson || typeof lesson !== 'object') {
    return false;
  }
  if (state.pauseSkipped) {
    return true;
  }

  return Boolean(
    state.pauseToolRan
    && state.paymentExpectationAligned,
  );
}

export function summariseTutorAbsenceState({
  lessons = [],
  messageState = {},
  decision = '',
  coverTutorName = '',
} = {}) {
  const totalLessons = lessons.length;
  const messagedCount = lessons.filter((lesson) => messageState[lesson.eventId]?.messaged).length;
  const normalisedDecision = normaliseTutorAbsenceDecision(decision);
  const workflowState = messageState.__workflow || {};
  const paymentHandledCount = normalisedDecision === 'cancel_day'
    ? lessons.filter((lesson) => isTutorAbsencePaymentHandled(lesson, messageState[lesson.eventId] || {})).length
    : 0;
  const coverTutorSelected = Boolean(coverTutorName);
  const coverTutorConfirmed = Boolean(workflowState.coverTutorConfirmed);
  const coverTutorBriefed = Boolean(workflowState.coverTutorBriefed);
  const calendarAligned = Boolean(workflowState.calendarUpdated);
  const coverReady = normalisedDecision === 'cover'
    ? coverTutorSelected && coverTutorConfirmed && coverTutorBriefed && calendarAligned
    : false;
  const allMessaged = totalLessons > 0 && messagedCount === totalLessons;
  const paymentComplete = normalisedDecision === 'cancel_day' && totalLessons > 0 && paymentHandledCount === totalLessons;
  let resolutionHint = '';
  if (!normalisedDecision) resolutionHint = 'Choose cancel or cover before resolving.';
  else if (normalisedDecision === 'cover' && !coverTutorSelected) resolutionHint = 'Choose a cover tutor before resolving.';
  else if (normalisedDecision === 'cover' && !coverTutorConfirmed) resolutionHint = 'Confirm the cover tutor before resolving.';
  else if (normalisedDecision === 'cover' && !coverTutorBriefed) resolutionHint = 'Pass on the lesson notes and context before resolving.';
  else if (normalisedDecision === 'cover' && !calendarAligned) resolutionHint = 'Confirm the MMS/calendar update, or that no change is needed, before resolving.';
  else if (!allMessaged) resolutionHint = 'Resolve unlocks once all affected parents are marked messaged.';
  else if (normalisedDecision === 'cancel_day' && !paymentComplete) resolutionHint = 'Resolve unlocks once every affected lesson has payment handled or explicitly skipped.';

  return {
    totalLessons,
    messagedCount,
    remainingMessages: Math.max(totalLessons - messagedCount, 0),
    allMessaged,
    paymentHandledCount,
    remainingPaymentActions: normalisedDecision === 'cancel_day'
      ? Math.max(totalLessons - paymentHandledCount, 0)
      : 0,
    paymentComplete,
    coverTutorSelected,
    coverTutorConfirmed,
    coverTutorBriefed,
    calendarAligned,
    coverReady,
    canResolve: normalisedDecision === 'cancel_day'
      ? allMessaged && paymentComplete
      : normalisedDecision === 'cover'
        ? allMessaged && coverReady
        : false,
    resolutionHint,
  };
}

export function assertTutorAbsenceResolutionReady({
  status = '',
  lessons = [],
  messageState = {},
  decision = '',
  coverTutorName = '',
} = {}) {
  const summary = summariseTutorAbsenceState({ lessons, messageState, decision, coverTutorName });
  if (normaliseTutorAbsenceStatus(status) !== 'resolved' || lessons.length === 0 || summary.canResolve) {
    return summary;
  }

  const error = new Error(summary.resolutionHint || 'This tutor absence is not ready to resolve.');
  error.code = 'TUTOR_ABSENCE_NOT_READY';
  throw error;
}
