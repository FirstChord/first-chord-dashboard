/** @fileoverview Deterministic half of the reply lane: classifies a message against the cancellation policy, computes the notice window, and validates any draft against both. */
// Deterministic half of the proposals-inbox reply lane: classify an incoming
// message against the Lesson Cancellation Policy, compute the notice window,
// and validate any draft (model or human template) against both. The policy
// home is Obsidian `05 Policies/Lesson Cancellation Policy.md`; the rules
// encoded here are the classifier spec agreed in PLAN_proposals-inbox.md.
//
// The load-bearing subtlety: one-off moves never, permanent changes gladly.
// A draft must never offer a one-off reschedule/swap/make-up, and a permanent
// slot-change request gets a warm welcome, never a policy lecture. When the
// evidence can't establish the lesson date, the notice window, or one-off vs
// permanent, the only safe draft is a neutral acknowledgement.

import { extractIncomingMessageDates } from './incoming-message-helpers.mjs';

export const REPLY_POLICY_SCHEMA_VERSION = 2;
export const REPLY_POLICY_CASES = ['one_off_absence', 'permanent_change', 'ending', 'extended_break', 'general'];
export const REPLY_NOTICE_WINDOWS = ['seven_plus', 'inside_week', 'same_day', 'not_applicable', 'unknown'];
export const REPLY_DRAFT_MAX_LENGTH = 900;
export const REPLY_ALLOWED_PLACEHOLDERS = Object.freeze(['[PARENT_FIRST]', '[STUDENT_FIRST]']);

// The complete set of policy statements a draft may make. Facts are granted
// per case + notice window below; the validator rejects any charge/video/zoom
// wording that is not backed by a granted fact.
export const REPLY_POLICY_FACTS = Object.freeze({
  no_charge_cancel: 'Cancelled with a week’s notice or more, so the lesson is cancelled and not charged.',
  zoom_at_slot: 'A Zoom lesson at the usual scheduled time is available instead of missing the lesson.',
  practice_video: 'A practice video (5–10 minutes, with practice notes for next lesson) can replace the lesson.',
  charged_inside_week: 'Inside a week’s notice the lesson is still charged.',
  charged_same_day: 'Same-day cancellations and no-shows are charged.',
  permanent_change_welcome: 'Permanent slot changes are welcome — we will work with the family to find a more convenient time, and Finn will follow up.',
  ending_two_lessons_notice: 'Ending lessons needs two lessons’ notice; we will sort the final lesson and the payment side, then confirm.',
  pause_route: 'We will sort the pause dates through our pause planning and confirm them back.',
});

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function normaliseText(value = '') {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

// --- classification: one-off vs permanent vs ending vs break ----------------

const PERMANENT_MARKERS = [
  'going forward',
  'from now on',
  'from next term',
  'permanently',
  'permanent',
  'every week',
  'each week',
  'in future',
  'for the future',
  'long term',
  'regular slot',
  'regular time',
  'change our slot',
  'change the slot',
  'change his slot',
  'change her slot',
  'change their slot',
  'change slot',
  'new day going',
  'a different day from',
];
// "move Thursdays to Wednesdays" — a plural weekday is a strong permanent
// signal ("can we miss Thursday" never pluralises).
const PLURAL_WEEKDAY_PATTERN = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\b/iu;

const ONE_OFF_MARKERS = [
  'this week',
  'next week',
  'tomorrow',
  'today',
  'tonight',
  'this time',
  'just this week',
  'that day',
  'that lesson',
  'this lesson',
  'one week',
  'miss',
  'missing',
  'cant make',
  'can t make',
  'cannot make',
  'wont make',
  'won t make',
  'cant come',
  'can t come',
  'cannot come',
  'cant attend',
  'can t attend',
  'cannot attend',
  'off sick',
  'ill',
  'unwell',
  'poorly',
];
const SINGULAR_WEEKDAY_PATTERN = /\b(?:this|next|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu;

const SCHEDULE_CHANGE_PATTERN = /\b(?:change|move|switch|swap|different|another|new)\b[^.]{0,40}\b(?:slot|time|day|lesson)\b|\b(?:slot|time|day)\b[^.]{0,30}\b(?:change|move|switch)\b/iu;

function hasAnyPhrase(normalised, phrases) {
  const padded = ` ${normalised} `;
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
}

// Which policy case governs the reply. `suspectedCategory` (the existing
// keyword classifier) supplies the broad bucket; the extra work here is the
// one-off vs permanent split inside schedule-ish messages.
export function classifyReplyPolicyCase({ messageText = '', suspectedCategory = '' } = {}) {
  const normalised = normaliseText(messageText);
  const ambiguityFlags = [];

  if (suspectedCategory === 'leaving') {
    return { policyCase: 'ending', ambiguityFlags };
  }

  const permanentSignal = hasAnyPhrase(normalised, PERMANENT_MARKERS) || PLURAL_WEEKDAY_PATTERN.test(messageText);
  const oneOffSignal = hasAnyPhrase(normalised, ONE_OFF_MARKERS) || SINGULAR_WEEKDAY_PATTERN.test(messageText);
  const scheduleChangeSignal = SCHEDULE_CHANGE_PATTERN.test(messageText) || suspectedCategory === 'schedule';

  if (permanentSignal && oneOffSignal) {
    ambiguityFlags.push('one_off_vs_permanent_unclear');
    return { policyCase: 'general', ambiguityFlags };
  }
  if (permanentSignal && scheduleChangeSignal) {
    return { policyCase: 'permanent_change', ambiguityFlags };
  }

  if (['extended_absence', 'summer_break'].includes(suspectedCategory)) {
    return { policyCase: 'extended_break', ambiguityFlags };
  }

  if (suspectedCategory === 'one_off_absence' || oneOffSignal) {
    return { policyCase: 'one_off_absence', ambiguityFlags };
  }

  if (scheduleChangeSignal) {
    // A slot-change request with no explicit one-off or permanent marker:
    // guessing wrong either lectures a family who asked a welcome question or
    // green-lights a swap. Don't guess.
    ambiguityFlags.push('one_off_vs_permanent_unclear');
    return { policyCase: 'general', ambiguityFlags };
  }

  if (suspectedCategory === 'absence_pause') {
    // The weak catch-all category: an absence of unknown shape.
    ambiguityFlags.push('one_off_vs_extended_unclear');
    return { policyCase: 'general', ambiguityFlags };
  }

  return { policyCase: 'general', ambiguityFlags };
}

// --- notice window -----------------------------------------------------------

const SCHOOL_TIME_ZONE = 'Europe/London';

function toSchoolDateIso(value = '') {
  const raw = clean(value);
  // Date-only values and MMS calendar wall-clock timestamps are already school
  // local dates. Absolute timestamps from WhatsApp/capture use Z or an offset
  // and must be converted to the school's date before the notice calculation;
  // otherwise a late-evening BST message can land on the previous UTC day.
  const absoluteTimestamp = /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(raw);
  const writtenDate = /^(\d{4})-(\d{2})-(\d{2})/u.exec(raw);
  if (writtenDate && !absoluteTimestamp) {
    return `${writtenDate[1]}-${writtenDate[2]}-${writtenDate[3]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function toDateOnlyMs(value = '') {
  const dateIso = toSchoolDateIso(value);
  if (!dateIso) return null;
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function classifyNoticeWindow({ lessonDateIso = '', messageDateIso = '' } = {}) {
  const lessonMs = toDateOnlyMs(lessonDateIso);
  const messageMs = toDateOnlyMs(messageDateIso);
  if (lessonMs === null || messageMs === null) return 'unknown';

  const diffDays = Math.round((lessonMs - messageMs) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 'unknown';
  if (diffDays === 0) return 'same_day';
  if (diffDays < 7) return 'inside_week';
  return 'seven_plus';
}

const FACTS_BY_CASE_AND_WINDOW = {
  one_off_absence: {
    seven_plus: ['no_charge_cancel', 'zoom_at_slot'],
    inside_week: ['charged_inside_week', 'zoom_at_slot', 'practice_video'],
    same_day: ['charged_same_day'],
  },
  permanent_change: { not_applicable: ['permanent_change_welcome'] },
  ending: { not_applicable: ['ending_two_lessons_notice'] },
  extended_break: { not_applicable: ['pause_route'] },
  general: { not_applicable: [] },
};

// The full deterministic context a draft is produced and validated against.
// `scheduleContext` is the student's Schedule_Context row (or null); it only
// supplies a lesson date when the message itself names none.
export function buildReplyPolicyContext({ record = {}, scheduleContext = null } = {}) {
  if (record.groupType === 'tutor') {
    return {
      kind: 'incoming_reply_policy_context', schemaVersion: REPLY_POLICY_SCHEMA_VERSION,
      policyCase: 'general', noticeWindow: 'not_applicable',
      lessonDateIso: '', lessonDateSource: '', messageDateIso: toSchoolDateIso(record.messageAt || record.capturedAt),
      extractedDates: [], allowedFacts: [], ambiguityFlags: ['tutor_group_requires_review'],
      acknowledgementOnly: true, neutralFallback: true,
    };
  }
  const { policyCase, ambiguityFlags } = classifyReplyPolicyCase({
    messageText: record.messageText || '',
    suspectedCategory: record.suspectedCategory || '',
  });

  const messageDateIso = clean(record.messageAt) || clean(record.capturedAt);
  const extraction = extractIncomingMessageDates(record);

  let noticeWindow = 'not_applicable';
  let lessonDateIso = '';
  let lessonDateSource = '';

  if (policyCase === 'one_off_absence') {
    if (extraction.startDate) {
      lessonDateIso = extraction.startDate;
      lessonDateSource = 'message';
    } else if (scheduleContext?.status === 'found' && scheduleContext.nextLessonAt) {
      lessonDateIso = scheduleContext.nextLessonAt;
      lessonDateSource = 'schedule_context';
    }

    if (!messageDateIso) ambiguityFlags.push('message_date_unknown');
    if (!lessonDateIso) ambiguityFlags.push('lesson_date_unknown');

    noticeWindow = classifyNoticeWindow({ lessonDateIso, messageDateIso });
    if (noticeWindow === 'unknown' && lessonDateIso && messageDateIso) {
      ambiguityFlags.push('notice_window_unresolvable');
    }
  }

  // A clear general message may use the model for a warmer, message-aware
  // acknowledgement, but it gets no policy facts and may not commit the school
  // to an operational outcome. Ambiguous policy evidence stays entirely on the
  // deterministic fallback path.
  const acknowledgementOnly = policyCase === 'general';
  const neutralFallback = ambiguityFlags.length > 0
    || (policyCase === 'one_off_absence' && noticeWindow === 'unknown');

  const factIds = neutralFallback
    ? []
    : (FACTS_BY_CASE_AND_WINDOW[policyCase]?.[policyCase === 'one_off_absence' ? noticeWindow : 'not_applicable'] || []);

  return {
    kind: 'incoming_reply_policy_context',
    schemaVersion: REPLY_POLICY_SCHEMA_VERSION,
    policyCase,
    noticeWindow: policyCase === 'one_off_absence' ? noticeWindow : 'not_applicable',
    lessonDateIso: toSchoolDateIso(lessonDateIso),
    lessonDateSource,
    messageDateIso: toSchoolDateIso(messageDateIso),
    extractedDates: extraction.dates,
    allowedFacts: factIds.map((id) => ({ id, statement: REPLY_POLICY_FACTS[id] })),
    ambiguityFlags: [...new Set(ambiguityFlags)],
    acknowledgementOnly,
    neutralFallback,
  };
}

// The deterministic draft for every ambiguous case: warm, commits to nothing.
export function buildNeutralAcknowledgementDraft() {
  return 'Hi [PARENT_FIRST], thanks for letting us know — I’ll take a proper look and come back to you shortly.';
}

// --- deterministic draft validation -------------------------------------------

const OPENING_PATTERN = /^(?:hi|hello|hey)\b/iu;
const HEYA_PATTERN = /^heya\b/iu;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const PHONE_PATTERN = /(?:\+?44\s?7|\b07)\d(?:[\s-]?\d){8}\b/u;
const URL_PATTERN = /https?:\/\/\S+/iu;
const IDENTIFIER_PATTERN = /\b(?:cus|sub|sdt|pi|in|evt|ch|pm)_[A-Za-z0-9_-]+\b/u;
const INSTRUCTION_PATTERN = /\b(?:ignore|disregard|override)\b.{0,40}\b(?:instruction|prompt|rule)s?\b|\bsystem prompt\b/iu;
const COMPLETED_ACTION_PATTERN = /\b(?:i|we)\s*(?:['’]ve|have)?\s*(?:already\s+)?(?:paused|refunded|cancelled|changed|moved|sent|emailed|updated|completed|sorted)\b/iu;

// A one-off reschedule/swap/make-up in any wording. Never allowed: offering
// it in writing creates the precedent every future message has to fight.
const RESCHEDULE_OFFER_PATTERN = /\b(?:make[\s-]?up|swap|resched\w*|rearrang\w*|catch[\s-]?up lesson|just this once)\b/iu;
// "move it to Friday" — banned outside permanent_change (where moving the
// regular slot is exactly what is being welcomed).
const ONE_OFF_MOVE_PATTERN = /\b(?:move|moving|moved)\b/iu;
const ONE_OFF_ALTERNATIVE_SLOT_PATTERN = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b.{0,30}\binstead\b|\b(?:book|fit|put|see|have|do)\b.{0,30}\b(?:another|different)\s+(?:day|time|slot)\b/iu;

const CHARGE_NEGATIVE_PATTERN = /\b(?:no charge|not (?:be )?charged|won[’']?t (?:be )?charged|free of charge|without (?:a )?charge|not charge)\b/iu;
const CHARGE_POSITIVE_PATTERN = /\b(?:still (?:be )?charged|will (?:be )?charged|is (?:still )?charged|charged for|charged as (?:normal|usual))\b/iu;
const VIDEO_PATTERN = /\bvideo\b/iu;
const ZOOM_PATTERN = /\bzoom\b|\bvirtual lesson\b|\bonline lesson\b/iu;
const COMMITMENT_PATTERN = /\bcancel\w*\b|\bpaus\w*\b/iu;
const OPERATIONAL_COMMITMENT_PATTERN = /\b(?:we|i)\s*(?:['’]ll|will|can|shall|are going to|am going to)\s+(?:refund\w*|credit\w*|waive\w*|charg\w*|cancel\w*|paus\w*|chang\w*|mov\w*|switch\w*|swap\w*|resched\w*|rearrang\w*|book\w*|schedul\w*|send\w*|email\w*|call\w*|updat\w*|fix\w*|sort\w*|offer\w*|provid\w*)\b/iu;
const OPERATIONAL_OUTCOME_PATTERN = /\b(?:refund\w*|credit(?:ed|ing)?|waiv\w*|charg(?:e[ds]?|ing)|cancel\w*|paus\w*|swap(?:ped|ping)?|resched\w*|rearrang\w*|book(?:ed|ing)?|schedul(?:ed|ing))\b/iu;

export function validateIncomingReplyDraft(draftText = '', context = {}) {
  const errors = [];
  const draft = clean(draftText);
  const factIds = new Set((context.allowedFacts || []).map((fact) => fact.id));

  if (!draft) errors.push('draft_required');
  if (draft.length > REPLY_DRAFT_MAX_LENGTH) errors.push('draft_too_long');
  if (HEYA_PATTERN.test(draft) || !OPENING_PATTERN.test(draft)) errors.push('opening_must_be_hi_hello_hey');

  if (EMAIL_PATTERN.test(draft)) errors.push('email_not_allowed');
  if (PHONE_PATTERN.test(draft)) errors.push('phone_not_allowed');
  if (URL_PATTERN.test(draft)) errors.push('url_not_allowed');
  if (IDENTIFIER_PATTERN.test(draft)) errors.push('identifier_not_allowed');
  if (INSTRUCTION_PATTERN.test(draft)) errors.push('untrusted_instruction_in_draft');
  if (COMPLETED_ACTION_PATTERN.test(draft)) errors.push('completed_action_claim_not_allowed');

  const placeholders = [...new Set(draft.match(/\[[A-Z_]+\]/gu) || [])];
  for (const placeholder of placeholders) {
    if (!REPLY_ALLOWED_PLACEHOLDERS.includes(placeholder)) errors.push(`unknown_placeholder:${placeholder}`);
  }

  if (RESCHEDULE_OFFER_PATTERN.test(draft)) errors.push('one_off_reschedule_offered');
  if (context.policyCase !== 'permanent_change' && ONE_OFF_MOVE_PATTERN.test(draft)) {
    errors.push('one_off_reschedule_offered');
  }
  if (context.policyCase !== 'permanent_change' && ONE_OFF_ALTERNATIVE_SLOT_PATTERN.test(draft)) {
    errors.push('one_off_reschedule_offered');
  }

  if (CHARGE_NEGATIVE_PATTERN.test(draft) && !factIds.has('no_charge_cancel')) {
    errors.push('no_charge_claim_contradicts_notice_window');
  }
  if (CHARGE_POSITIVE_PATTERN.test(draft) && !factIds.has('charged_inside_week') && !factIds.has('charged_same_day')) {
    errors.push('charge_claim_contradicts_notice_window');
  }
  if (VIDEO_PATTERN.test(draft) && !factIds.has('practice_video')) {
    errors.push(context.noticeWindow === 'same_day' ? 'video_promise_on_same_day' : 'video_claim_not_supported');
  }
  if (ZOOM_PATTERN.test(draft) && !factIds.has('zoom_at_slot')) {
    errors.push('zoom_offer_not_supported');
  }

  // Ambiguous evidence: the draft may acknowledge, never decide. "I'll get
  // that cancelled/paused" is a decided policy outcome.
  if (context.neutralFallback && COMMITMENT_PATTERN.test(draft)) {
    errors.push('policy_outcome_in_neutral_draft');
  }
  if (context.acknowledgementOnly
    && (OPERATIONAL_COMMITMENT_PATTERN.test(draft) || OPERATIONAL_OUTCOME_PATTERN.test(draft))) {
    errors.push('unsupported_operational_commitment');
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

// Placeholder substitution for the stored/displayed proposal body. First names
// only, matching the templates the inbox already uses.
export function materialiseReplyDraft(draftText = '', { parentName = '', studentName = '' } = {}) {
  const parentFirst = clean(parentName).split(/\s+/u)[0] || 'there';
  const studentFirst = clean(studentName).split(/\s+/u)[0] || 'your child';
  return clean(draftText)
    .split('[PARENT_FIRST]').join(parentFirst)
    .split('[STUDENT_FIRST]').join(studentFirst);
}
