/** @fileoverview Pure parsing and presentation helpers for the admin planning interface. */
// Pure, framework-free helpers for the admin planning surface — extracted from
// AdminPlanningPageClient.js so they can be unit-tested and the component stays a view.
// Cluster 1: date/format helpers + pause-date parsing + pause prefill-URL and parent
// confirmation message. No React, no hooks — same inputs always produce the same output.

import { ADMIN_TUTORS } from './tutors-data.js';
import { formatDateTime as baseFormatDateTime } from './health-helpers.mjs';
import {
  buildFirstLessonCheckinPlanningId,
  PLANNING_ITEM_TYPES,
  SCHOOL_FORWARD_PLANNING_ID,
  detectTutorAbsenceCapture,
  inferPlanningTargetDateFromText,
  isMeetingPlanningItem,
  parseLinkedStudentIds,
  planningModeForItemType,
} from './planning-helpers.mjs';

export const FIRST_LESSON_CHECKIN_CHECKLIST = Object.freeze([
  {
    key: 'lesson_payment',
    label: 'Lesson + payment decision',
    detail: 'Ask how lesson one went and confirm whether the weekly subscription should continue.',
  },
  {
    key: 'whatsapp_groups',
    label: 'WhatsApp groups',
    detail: 'Check the parent/student is in both the lesson group and the community group.',
  },
  {
    key: 'student_access',
    label: 'Student access',
    detail: 'Confirm they have the student portal link and notes-privacy instructions.',
  },
]);

export function isFirstLessonCheckinPlanningItem(item = {}) {
  const prefix = buildFirstLessonCheckinPlanningId('');
  return Boolean(`${item.planningId || ''}`.trim())
    && `${item.planningId || ''}`.startsWith(prefix);
}

export function isFirstLessonCheckinChecklistComplete(checks = {}) {
  return FIRST_LESSON_CHECKIN_CHECKLIST.every((step) => checks[step.key] === true);
}

const PAYMENT_PAUSE_PWA_URL = process.env.NEXT_PUBLIC_PAYMENT_PAUSE_PWA_URL || 'https://payment-pause-pwa.web.app/';

const SHORT_MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Planning's two deliberate differences from the house format: blank reads as
// "Not yet" rather than a dash, and the year is dropped because these are
// compact cards about the near future.
export function formatDateTime(value) {
  return baseFormatDateTime(value, { empty: 'Not yet', withYear: false });
}

export function shortPreview(value = '', max = 150) {
  const text = `${value || ''}`.trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

export function formatTargetDate(value = '') {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatFriendlyPauseDate(value = '') {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function firstName(value = '') {
  return `${value || ''}`.trim().split(/\s+/u).filter(Boolean)[0] || '';
}

function differsByAtMostOneCharacter(first = '', second = '') {
  if (first === second) return true;
  if (Math.abs(first.length - second.length) > 1) return false;

  let firstIndex = 0;
  let secondIndex = 0;
  let edits = 0;
  while (firstIndex < first.length && secondIndex < second.length) {
    if (first[firstIndex] === second[secondIndex]) {
      firstIndex += 1;
      secondIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (first.length > second.length) {
      firstIndex += 1;
    } else if (second.length > first.length) {
      secondIndex += 1;
    } else {
      firstIndex += 1;
      secondIndex += 1;
    }
  }
  return true;
}

// Adult students are usually recorded as their own contact — the parent fields echo
// the student's own name (e.g. parent "Sian Malyin" for student "Sian Malyin").
// Treat "no parent" OR "parent name == student name" as the student being their own
// contact, so messages address them directly ("your lesson") not third-person.
export function isStudentOwnContact(student = {}) {
  const norm = (value) => `${value || ''}`.trim().toLowerCase().replace(/\s+/gu, ' ');
  const parentFirst = firstName(student.parentFirstName) || firstName(student.parentLastName);
  if (!parentFirst) return true;

  const studentFull = norm(student.fullName);
  const parentFull = norm([student.parentFirstName, student.parentLastName].filter(Boolean).join(' '));
  if (parentFull && parentFull === studentFull) return true;

  const studentWords = `${student.fullName || ''}`.trim().split(/\s+/u).filter(Boolean);
  const studentLast = norm(studentWords.length > 1 ? studentWords[studentWords.length - 1] : '');
  const pFirst = norm(parentFirst);
  const sFirst = norm(firstName(student.fullName));
  const pLast = norm(student.parentLastName);
  // Human-entered adult contact records occasionally contain a one-character
  // surname typo. Same first name plus the same/nearly-same surname is still
  // overwhelmingly the student themself; a clearly different surname remains
  // a parent contact (even if they happen to share a first name).
  if (sFirst && pFirst === sFirst && (!pLast || differsByAtMostOneCharacter(pLast, studentLast))) return true;

  return false;
}

export function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDaysToDateInput(value = '', days = 0) {
  const match = `${value || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return value;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  parsed.setDate(parsed.getDate() + days);
  return formatDateInput(parsed);
}

export function parseReadablePlanningDate(value = '') {
  const match = `${value || ''}`.trim().match(/(?:mon|tue|wed|thu|fri|sat|sun),?\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})/iu);
  if (!match) return '';
  const month = SHORT_MONTH_INDEX[match[2].toLowerCase()];
  if (typeof month !== 'number') return '';
  const parsed = new Date(Number(match[3]), month, Number(match[1]));
  return Number.isNaN(parsed.getTime()) ? '' : formatDateInput(parsed);
}

export function matchIsoPlanningDate(text = '', labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'iu');
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export function extractPauseDatesFromPlanningItem(item = {}) {
  const text = [item.title, item.notes, item.nextAction].filter(Boolean).join('\n');
  const startDate = matchIsoPlanningDate(text, [
    'Lesson date',
    'First lesson to pause date',
    'First pause date',
    'Start date',
  ]);
  const endDate = matchIsoPlanningDate(text, [
    'Returning from date',
    'Return date',
    'End date',
  ]);

  if (startDate) {
    return {
      startDate,
      endDate: endDate || startDate,
    };
  }

  const singleMatch = text.match(/\blesson on\s+([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2,4}\s+\d{4})/u)
    || text.match(/\bLesson to pause:\s*([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2,4}\s+\d{4})/u);
  if (singleMatch?.[1]) {
    const parsed = parseReadablePlanningDate(singleMatch[1]);
    return parsed ? { startDate: parsed, endDate: parsed } : { startDate: '', endDate: '' };
  }

  const rangeMatch = text.match(/\bfrom\s+([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2,4}\s+\d{4});\s*returning\s+([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2,4}\s+\d{4})/u);
  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    return {
      startDate: parseReadablePlanningDate(rangeMatch[1]),
      endDate: parseReadablePlanningDate(rangeMatch[2]),
    };
  }

  return { startDate: '', endDate: '' };
}

// Incoming-message conversions keep the admin-reviewed parent reply at the end
// of Planning notes. Reading that one labelled block lets the plan surface the
// same draft after navigation without creating a second message-state field.
export function extractIncomingPlanningReply(item = {}) {
  const notes = `${item.notes || ''}`;
  const marker = 'Suggested reply (send manually in WhatsApp):';
  const markerIndex = notes.lastIndexOf(marker);
  if (markerIndex < 0) return '';
  return notes.slice(markerIndex + marker.length).trim().slice(0, 1_200);
}

export function buildPaymentPausePrefillUrl({ item = {}, student = null } = {}) {
  if (!student?.mmsId) return '';
  const { startDate, endDate } = extractPauseDatesFromPlanningItem(item);
  if (!startDate || !endDate) return '';

  // Single-lesson pause: one clean window that comfortably covers the missed lesson —
  //   start  = the planning due date (the day you action it), not the lesson day
  //   resume = a few days after the paused lesson
  // Away-period pause:
  //   start  = the day we're actually doing the pause (action day), so billing pauses from now
  //   resume = a couple of days before the return lesson, so billing is active again by then
  const isSingleLesson = endDate === startDate;
  const dueDate = `${item.targetDate || ''}`.match(/^\d{4}-\d{2}-\d{2}$/u) ? item.targetDate : '';
  const today = formatDateInput(new Date());
  const pauseToolStartDate = isSingleLesson
    ? (dueDate && dueDate <= startDate ? dueDate : startDate)
    : (dueDate || today);
  const pauseToolEndDate = isSingleLesson
    ? addDaysToDateInput(startDate, 3)
    : addDaysToDateInput(endDate, -2);

  const parentName = [
    student.parentFirstName || '',
    student.parentLastName || '',
  ].filter(Boolean).join(' ').trim();
  const url = new URL(PAYMENT_PAUSE_PWA_URL);
  const params = {
    source: 'dashboard-planning',
    planningId: item.planningId || '',
    studentName: student.fullName || '',
    email: student.email || '',
    startDate: pauseToolStartDate,
    endDate: pauseToolEndDate,
    reason: item.linkedWorkflowId === 'tutor-absence'
      || /\b(?:teacher|tutor)\s+absence\b/iu.test(`${item.notes || ''}`)
      ? 'Teacher Holiday'
      : 'Student Holiday',
    mmsId: student.mmsId || '',
    customerId: student.stripeCustomerId || '',
    subscriptionId: student.stripeSubscriptionId || '',
    tutor: student.tutor || '',
    parentName,
  };

  Object.entries(params).forEach(([key, value]) => {
    if (`${value || ''}`.trim()) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

export function buildPauseConfirmationMessage({ item = {}, student = null } = {}) {
  if (!student) return '';
  const { startDate, endDate } = extractPauseDatesFromPlanningItem(item);
  if (!startDate || !endDate) return '';

  const studentFirst = firstName(student.fullName) || student.fullName || '';
  const studentName = studentFirst || 'the lesson';
  const tutorFirst = firstName(student.tutor);
  const startLabel = formatFriendlyPauseDate(startDate);
  const endLabel = formatFriendlyPauseDate(endDate);

  // Adult learners are their own contact (no parent, or parent fields echo the
  // student's own name) — address them directly ("you") not third-person ("they").
  const parentFirst = firstName(student.parentFirstName) || firstName(student.parentLastName);
  if (isStudentOwnContact(student)) {
    const greetingName = studentFirst || 'there';
    if (startDate === endDate) {
      return `Hi ${greetingName}, just confirming we have paused payment for your lesson on ${startLabel}. Thanks!`;
    }
    const adultReturn = tutorFirst
      ? `${tutorFirst} will next see you on ${endLabel} and payment will continue as normal from then.`
      : `You're back on ${endLabel} and payment will continue as normal from then.`;
    return `Hi ${greetingName}, just confirming we have paused your payment from ${startLabel}. ${adultReturn} Thanks!`;
  }

  const parentName = parentFirst;
  if (startDate === endDate) {
    return `Hi ${parentName}, just confirming we have paused payment for ${studentName}'s lesson on ${startLabel}. Thanks!`;
  }

  const parentReturn = tutorFirst
    ? `${tutorFirst} will next see ${studentName} on ${endLabel} and payment will continue as normal from then.`
    : `${studentName} is back on ${endLabel} and payment will continue as normal from then.`;
  return `Hi ${parentName}, just confirming we have paused payment for ${studentName} from ${startLabel}. ${parentReturn} Thanks!`;
}

// --- Cluster 2: planning-item classification, search, and student matching ---

export function isTutorAbsenceCapturePlanningItem(item = {}) {
  const notes = `${item.notes || ''}`;
  return item.linkedWorkflowId === 'tutor-absence'
    && Boolean(`${item.linkedTutorId || ''}`.trim())
    && !parseLinkedStudentIds(item.linkedStudentIds ?? item.linkedStudentId).length
    && /^Tutor absence date:\s*\d{4}-\d{2}-\d{2}$/mu.test(notes)
    && /^Tutor:\s*.+$/mu.test(notes);
}

export function isPausePlanningItem(item = {}) {
  // Explicit is_pause flag wins (set by the plan panel's Structured pause /
  // General toggle); an unset flag falls back to inferring from the wording, so
  // legacy rows and auto-created pause plans keep classifying exactly as before.
  const flag = `${item.isPause ?? item.is_pause ?? ''}`.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  // The original tutor-absence capture remains open as a parent handoff while
  // its student-linked pause cards are completed. Its waiting copy mentions
  // "pause cards", but that must not turn the parent into a payment task.
  if (isTutorAbsenceCapturePlanningItem(item)) return false;
  return /\bpaus(?:e|ed|ing)\b/iu.test([
    item.title,
    item.notes,
    item.nextAction,
  ].join(' '));
}

export function requiresTutorAbsencePaymentTool(item = {}) {
  return item.linkedWorkflowId === 'tutor-absence' && isPausePlanningItem(item);
}

export function normaliseSearchText(value = '') {
  return `${value || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Everyday words that should never auto-attach a student to a captured note.
// Without this, "the" prefix-matched "Theodore" and "and" matched "Andrew".
const STUDENT_MATCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'has', 'have',
  'will', 'but', 'not', 'all', 'any', 'who', 'why', 'how', 'when', 'what', 'where',
  'you', 'your', 'our', 'her', 'his', 'him', 'she', 'they', 'them', 'their',
  'from', 'into', 'onto', 'out', 'over', 'about', 'after', 'before', 'then',
  'today', 'tomorrow', 'week', 'next', 'now', 'soon', 'add', 'new', 'get', 'got',
]);

// A token only counts toward auto-inferring a student if it's substantial enough
// to be a name and isn't a common word. Manual search (StudentSearchField) is
// unaffected — this guards only the automatic note→student detection.
export function isMeaningfulNameTerm(term = '') {
  return term.length >= 3 && !STUDENT_MATCH_STOP_WORDS.has(term);
}

export function isDueNowPlanningItem(item = {}, now = new Date()) {
  const targetDate = `${item.targetDate || ''}`.trim();
  return !['done', 'parked'].includes(item.status)
    && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
    && targetDate <= formatDateInput(now);
}

export function isOpenPlanningItem(item = {}) {
  return !['done', 'parked'].includes(item.status);
}

// Plain-language headline for the calm "due today" cards. Auto-generated pause
// cards get a calmer framing; user-written items already read as human, so we
// use their title. (Mirrors getIssueStory in AdminIssuesPageClient.)
export function getPlanningStory(item = {}, studentOptions = []) {
  if (isPausePlanningItem(item)) {
    const name = findStudentById(studentOptions, item.linkedStudentId)?.fullName || 'a student';
    const { startDate, endDate } = extractPauseDatesFromPlanningItem(item);
    if (startDate && endDate && startDate !== endDate) {
      return `Pause ${name} from ${formatTargetDate(startDate)} until ${formatTargetDate(endDate)}.`;
    }
    if (startDate) {
      return `Pause ${name}'s lesson on ${formatTargetDate(startDate)}.`;
    }
    return `Sort out ${name}'s pause.`;
  }
  return `${item.title || ''}`.trim() || 'This needs a look today.';
}

// The calm "what to do" line beneath the headline.
export function getPlanningWhatToDo(item = {}) {
  const next = `${item.nextAction || ''}`.trim();
  if (next && next !== `${item.title || ''}`.trim()) {
    return next;
  }
  if (isPausePlanningItem(item)) {
    return 'Open the pause steps: pause the payment, then send the confirmation message.';
  }
  if (item.linkedWorkflowId === 'tutor-absence') {
    return 'Open the tutor-absence workflow to arrange cover.';
  }
  if (item.itemType === 'action') {
    return '';
  }
  if (item.itemType === 'initiative') {
    return 'Review the outcome and its open Actions.';
  }
  return 'Take the next step, then mark it done.';
}

// A small due chip: "Today" or "Overdue N days".
export function dueChipLabel(targetDate = '', now = new Date()) {
  const date = `${targetDate || ''}`.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return 'No date';
  }
  const today = formatDateInput(now);
  if (date === today) {
    return 'Today';
  }
  if (date < today) {
    const days = Math.round((new Date(`${today}T00:00:00`) - new Date(`${date}T00:00:00`)) / 86_400_000);
    return days === 1 ? 'Overdue 1 day' : `Overdue ${days} days`;
  }
  return formatTargetDate(date);
}

export function hasPlanningLink(item = {}) {
  return Boolean(
    `${item.linkedWorkflowId || ''}`.trim()
    || `${item.linkedStudentId || ''}`.trim()
    || `${item.linkedTutorId || ''}`.trim()
    || `${item.parentPlanningId || ''}`.trim(),
  );
}

export function studentLabel(student = {}) {
  return [
    student.fullName || student.mmsId,
    student.tutor ? `Tutor: ${student.tutor}` : '',
    student.instrument || '',
  ].filter(Boolean).join(' · ');
}

export function findStudentById(studentOptions = [], mmsId = '') {
  return studentOptions.find((student) => student.mmsId === mmsId) || null;
}

export function findStudentSuggestions(studentOptions = [], query = '', limit = 6) {
  const search = normaliseSearchText(query);
  if (!search) {
    return [];
  }
  const terms = search.split(/\s+/).filter(Boolean);

  return studentOptions
    .map((student) => {
      const haystack = normaliseSearchText([
        student.fullName,
        student.mmsId,
        student.tutor,
        student.instrument,
      ].filter(Boolean).join(' '));
      const score = terms.reduce((sum, term) => (
        haystack.includes(term) ? sum + (haystack.startsWith(term) ? 2 : 1) : sum
      ), 0);
      return { student, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.student.fullName.localeCompare(b.student.fullName))
    .slice(0, limit)
    .map((entry) => entry.student);
}

export function inferStudentFromText(studentOptions = [], rawText = '') {
  const text = normaliseSearchText(rawText);
  if (!text) {
    return null;
  }

  const exactMatches = studentOptions
    .map((student) => {
      const name = normaliseSearchText(student.fullName);
      if (!name || !text.includes(name)) {
        return null;
      }
      return { student, score: name.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (exactMatches.length) {
    return exactMatches[0].student;
  }

  const studentQuery = text
    .replace(/\b(please|can|could|you|we|need|to|for|from|until|pause|paused|pausing|lesson|lessons|away|off|holiday|holidays)\b/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  // Drop common words and ultra-short tokens so everyday language can't latch
  // onto a name. If nothing substantial is left, don't guess a student.
  const queryTerms = studentQuery.split(/\s+/).filter(isMeaningfulNameTerm);
  if (!queryTerms.length) {
    return null;
  }

  const exactFirstNameMatches = studentOptions.filter((student) => {
    const studentFirstName = normaliseSearchText(student.fullName).split(/\s+/)[0] || '';
    return queryTerms.includes(studentFirstName);
  });
  if (exactFirstNameMatches.length === 1) {
    return exactFirstNameMatches[0];
  }

  const cleanQuery = queryTerms.join(' ');
  const suggestions = findStudentSuggestions(studentOptions, cleanQuery, 3);
  if (suggestions.length > 1) {
    const firstNameMatches = suggestions.filter((student) => {
      const studentFirstName = normaliseSearchText(student.fullName).split(/\s+/)[0] || '';
      // Only a length-4+ token may prefix-match (so "theo" finds Theodore but
      // "the" never does); shorter tokens must match the first name exactly.
      return queryTerms.some((term) => studentFirstName === term || (term.length >= 4 && studentFirstName.startsWith(term)));
    });
    if (firstNameMatches.length === 1) {
      return firstNameMatches[0];
    }
  }
  return suggestions.length === 1 ? suggestions[0] : null;
}

export function firstLine(value = '') {
  return `${value || ''}`
    .split(/\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

export function truncateTitle(value = '', max = 90) {
  const text = firstLine(value).replace(/^[-•⁠\s]+/u, '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

export function momentumClasses(momentum = '') {
  if (momentum === 'moving') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (momentum === 'stalled' || momentum === 'no_next_action') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (momentum === 'done') {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }
  if (momentum === 'parked') {
    return 'border-purple-200 bg-purple-50 text-purple-800';
  }
  return 'border-blue-100 bg-blue-50 text-slate-700';
}

export function applySmartDefaults(form) {
  const next = { ...form };
  // Work mode follows the item shape. Keeping this derivation here lets the
  // stored `plan_mode` column remain backward-compatible without asking a
  // person to understand a second, overlapping classification.
  next.planMode = planningModeForItemType(next.itemType, next.planMode);
  if (next.itemType === 'initiative' && next.status === 'inbox') {
    next.status = 'active';
  }
  if (next.itemType === 'action' && next.status === 'inbox' && next.targetDate) {
    next.status = 'active';
  }
  return next;
}

export function buildPlanningRelationships(items = []) {
  const itemsById = new Map();
  const actionsByProjectId = new Map();

  for (const item of items || []) {
    if (item?.planningId) itemsById.set(item.planningId, item);
  }

  for (const item of items || []) {
    if (item?.itemType !== 'action' || !item.parentPlanningId) continue;
    const parent = itemsById.get(item.parentPlanningId);
    if (parent?.itemType !== 'initiative' || parent.planningId === SCHOOL_FORWARD_PLANNING_ID) continue;
    const actions = actionsByProjectId.get(parent.planningId) || [];
    actions.push(item);
    actionsByProjectId.set(parent.planningId, actions);
  }

  for (const actions of actionsByProjectId.values()) {
    actions.sort((a, b) => (
      `${b.updatedAt || b.createdAt || ''}`.localeCompare(`${a.updatedAt || a.createdAt || ''}`)
      || `${a.title || ''}`.localeCompare(`${b.title || ''}`)
    ));
  }

  return { itemsById, actionsByProjectId };
}

// --- Cluster 3: search text, deep-link builders, and school-note classification ---

// `idea` is the one ordinary capture shape for school thinking. The two older
// note types stay in this set so existing rows continue to appear in the same
// “Let's work on the school” home without a data migration.
export const SCHOOL_NOTE_TYPES = new Set(['idea', 'learning_note', 'strategic_note']);

export const PAUSE_PAYMENT_CONFIRMATION_NOTE = 'Payment pause confirmation message sent.';

export function buildSearchText(item) {
  return [
    item.title,
    item.notes,
    item.owner,
    item.areaLabel,
    item.statusLabel,
    item.itemTypeLabel,
    item.linkedWorkflowId,
    (item.linkedStudentIds || [item.linkedStudentId]).join(' '),
    item.linkedTutorId,
    item.outcome,
    item.nextAction,
    item.targetDate,
    item.latestProgress?.progressNote,
    item.parentProject?.title,
    ...(item.projectActions || []).map((action) => action.title),
  ].join(' ').toLowerCase();
}

// The review board's one filter predicate: every filter chip (view filters,
// status buckets, item types, momentum values) plus free-text search and the
// done/parked veil (hidden unless showDone or a done/parked chip is active).
// Unknown filter values fall through to a momentum match, same as the chips.
export function filterPlanningItems(items = [], { filter = 'all', query = '', showDone = false } = {}) {
  const search = `${query || ''}`.trim().toLowerCase();
  return (items || []).filter((item) => {
    if (!showDone && !['done', 'parked'].includes(filter) && ['done', 'parked'].includes(item.status)) {
      return false;
    }
    if (search && !buildSearchText(item).includes(search)) {
      return false;
    }
    if (filter === 'due_now') {
      return isDueNowPlanningItem(item);
    }
    if (filter === 'meeting') {
      return isMeetingPlanningItem(item);
    }
    if (filter === 'school_notes') {
      return SCHOOL_NOTE_TYPES.has(item.itemType);
    }
    if (filter === 'unassigned') {
      return isOpenPlanningItem(item) && item.owner === 'Unassigned';
    }
    if (filter === 'owner_fennella') {
      return isOpenPlanningItem(item) && item.owner === 'Fennella';
    }
    if (filter === 'waiting_status') {
      return isOpenPlanningItem(item) && item.status === 'waiting';
    }
    if (filter === 'linked') {
      return isOpenPlanningItem(item) && hasPlanningLink(item);
    }
    if (filter === 'all') {
      return true;
    }
    if (filter === 'done') {
      return item.status === 'done';
    }
    if (filter === 'parked') {
      return item.status === 'parked';
    }
    if (filter === 'initiative') {
      return item.itemType === 'initiative' && item.planningId !== SCHOOL_FORWARD_PLANNING_ID;
    }
    if (PLANNING_ITEM_TYPES.includes(filter)) {
      return item.itemType === filter;
    }
    return item.momentum === filter;
  });
}

export function workflowHref(workflowId = '') {
  const key = `${workflowId || ''}`.trim().toLowerCase();
  const routes = {
    'tutor-absence': '/admin/workflows/tutor-absence',
    'parent-understanding': '/admin/workflows/parent-understanding',
    waiting: '/admin/waiting',
    onboarding: '/admin/onboard',
    showcase: '/admin/showcase',
    holidays: '/admin/holidays',
  };
  return routes[key] || '';
}

// Tutor-absence cards keep the generic linkedWorkflowId ('tutor-absence') and store
// the specific tutor + date as parseable lines in notes; build the prefilled deep
// link from those so the workflow opens ready for that tutor/date.
export function buildTutorAbsenceWorkflowHref(item = {}) {
  const notes = `${item.notes || ''}`;
  const dateMatch = notes.match(/Tutor absence date:\s*(\d{4}-\d{2}-\d{2})/u);
  const tutorMatch = notes.match(/^Tutor:\s*(\S+)/mu);
  const tutor = tutorMatch ? tutorMatch[1] : `${item.linkedTutorId || ''}`.trim();
  if (!dateMatch || !tutor) {
    return '/admin/workflows/tutor-absence';
  }
  return `/admin/workflows/tutor-absence?tutor=${encodeURIComponent(tutor)}&date=${encodeURIComponent(dateMatch[1])}`;
}

export function studentHref(studentId = '') {
  const key = `${studentId || ''}`.trim();
  return key ? `/admin/students/${encodeURIComponent(key)}` : '';
}

export function isSchoolNotePlanningItem(item = {}) {
  return SCHOOL_NOTE_TYPES.has(item.itemType);
}

export function isTutorAbsenceNoticePlanningItem(item = {}) {
  return item.linkedWorkflowId === 'tutor-absence-notice'
    && `${item.notes || ''}`.includes('Tutor absence early notice plan: v1.');
}

export function extractTutorAbsenceNoticeMessage(item = {}) {
  const notes = `${item.notes || ''}`;
  const marker = 'Parent notice message:\n';
  const start = notes.indexOf(marker);
  return start === -1 ? '' : notes.slice(start + marker.length).trim();
}

export function isTutorAbsenceFinalConfirmationPlanningItem(item = {}) {
  return item.linkedWorkflowId === 'tutor-absence-final-confirmation'
    && `${item.notes || ''}`.includes('Tutor absence final confirmation: v1.');
}

export function extractTutorAbsenceFinalConfirmationMessage(item = {}) {
  const notes = `${item.notes || ''}`;
  const marker = 'Parent final confirmation message:\n';
  const start = notes.indexOf(marker);
  return start === -1 ? '' : notes.slice(start + marker.length).trim();
}

export function hasPausePaymentConfirmation(item = {}) {
  return (item.progress || []).some((entry) => (
    `${entry.progressNote || ''}`.toLowerCase().includes(PAUSE_PAYMENT_CONFIRMATION_NOTE.toLowerCase())
  ));
}

export function buildSchoolNoteItem(form = {}) {
  const mainNote = `${form.mainNote || ''}`.trim();
  const keyIdeas = `${form.keyIdeas || ''}`.trim();
  const applications = `${form.applications || ''}`.trim();
  const sections = [
    mainNote ? `Main note / transcript summary:\n${mainNote}` : '',
    keyIdeas ? `Key ideas:\n${keyIdeas}` : '',
    applications ? `Possible First Chord applications:\n${applications}` : '',
  ].filter(Boolean);
  return {
    title: `${form.title || ''}`.trim(),
    notes: sections.join('\n\n'),
    itemType: 'idea',
    owner: form.owner || 'Unassigned',
    status: 'inbox',
    area: form.area || 'other',
    linkedWorkflowId: 'school-notes',
    nextAction: '',
    progressNote: 'Captured for Let\'s work on the school.',
  };
}

// --- Cluster 4: quick-capture (shared by the orchestrator's handlers and the
// QuickBrainCapture component) + its data consts. Pure (no React), now testable. ---

// Tutor short-name/full-name options for client-side capture parsing.
export const CLIENT_TUTOR_OPTIONS = Object.entries(ADMIN_TUTORS).map(([shortName, tutor]) => ({
  shortName,
  fullName: tutor.fullName,
}));

// The blank planning-item form (also the orchestrator's edit-form initial state).
export const EMPTY_FORM = {
  title: '',
  notes: '',
  itemType: 'idea',
  planMode: 'task',
  owner: 'Unassigned',
  status: 'inbox',
  area: 'other',
  linkedWorkflowId: '',
  linkedStudentId: '',
  linkedStudentIds: [],
  linkedTutorId: '',
  parentPlanningId: '',
  outcome: '',
  nextAction: '',
  targetDate: '',
  progressNote: '',
  isPause: '',
};

const QUICK_CAPTURE_DEFAULTS = {
  owner: 'Unassigned',
  area: 'other',
  itemType: 'action',
  status: 'inbox',
  linkedWorkflowId: '',
};

export function isPauseCaptureText(raw = '') {
  return /\bpaus(?:e|ed|ing)\b/iu.test(`${raw || ''}`);
}

export function isTutorAbsenceCaptureText(raw = '') {
  return detectTutorAbsenceCapture(raw, CLIENT_TUTOR_OPTIONS).isTutorAbsence;
}

export function inferQuickCapture(raw = '') {
  const text = `${raw || ''}`.toLowerCase();
  const defaults = { ...QUICK_CAPTURE_DEFAULTS };

  if (/\b(pause|holiday|away|off|cancel lesson|no lesson)\b/u.test(text)) {
    defaults.area = 'admin';
    defaults.itemType = 'action';
  }
  if (isTutorAbsenceCaptureText(raw)) {
    defaults.area = 'tutor';
    defaults.linkedWorkflowId = 'tutor-absence';
  }
  if (/\b(onboard|new student|starting|sign.?up)\b/u.test(text)) {
    defaults.area = 'admin';
    defaults.linkedWorkflowId = 'onboarding';
  }
  if (/\b(stripe|payment|billing|refund|charge|subscription|vat|payroll)\b/u.test(text)) {
    defaults.area = 'finance';
  }
  if (/\b(show|showcase|poster|venue|perform)\b/u.test(text)) {
    defaults.area = 'growth';
    defaults.linkedWorkflowId = 'showcase';
  }
  if (/\b(dashboard|tool|website|mms|soundslice|link|bug)\b/u.test(text)) {
    defaults.area = 'admin';
  }
  if (/\b(maybe|idea|revisit|could|should|future|plan)\b/u.test(text)) {
    defaults.itemType = 'idea';
  }

  return defaults;
}

export function buildQuickCaptureItem(rawNote = '', overrides = {}, studentOptions = []) {
  const inferred = inferQuickCapture(rawNote);
  const studentSelectionSource = overrides.studentSelectionSource;
  const overrideStudentId = overrides.linkedStudentId;
  const overrideStudentIds = overrides.linkedStudentIds;
  const controlFields = new Set([
    'structuredCapture',
    'pauseType',
    'pauseLessonDate',
    'pauseFirstPauseDate',
    'pauseReturnDate',
    'pauseExtraNote',
    'showPauseBuilder',
    'hidePauseBuilder',
    'studentSelectionSource',
    'linkedStudentId',
    'linkedStudentIds',
    'tutorAbsenceShortName',
    'tutorAbsenceDates',
    'showTutorAbsenceBuilder',
    'hideTutorAbsenceBuilder',
  ]);
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !controlFields.has(key)),
  );
  // A student list is explicit when the user touched it (manual/cleared) or when
  // a caller passed ids directly (e.g. a pause capture). Otherwise we infer one.
  const hasStudentOverride = studentSelectionSource === 'manual'
    || studentSelectionSource === 'cleared'
    || overrideStudentIds !== undefined
    || overrideStudentId !== undefined;
  const inferredStudent = hasStudentOverride ? null : inferStudentFromText(studentOptions, rawNote);
  const linkedStudentIds = hasStudentOverride
    ? parseLinkedStudentIds(overrideStudentIds ?? overrideStudentId)
    : (inferredStudent ? [inferredStudent.mmsId] : []);
  const item = {
    ...EMPTY_FORM,
    ...inferred,
    ...safeOverrides,
    title: safeOverrides.title || truncateTitle(rawNote),
    notes: safeOverrides.notes || rawNote.trim(),
    linkedStudentId: linkedStudentIds[0] || '',
    linkedStudentIds,
    targetDate: safeOverrides.targetDate || inferPlanningTargetDateFromText(rawNote),
    progressNote: safeOverrides.progressNote || 'Captured from quick brain capture.',
  };

  if (item.itemType === 'idea') {
    item.targetDate = '';
  }

  if (item.itemType === 'action') {
    item.nextAction = item.nextAction || item.title;
  }

  // Keep frictionless brain capture in Inbox. Only an explicit kind choice
  // (including the Project choice) changes status/mode automatically.
  return Object.prototype.hasOwnProperty.call(safeOverrides, 'itemType') || item.targetDate
    ? applySmartDefaults(item)
    : item;
}
