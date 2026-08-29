/** @fileoverview Pure core of the incoming-message inbox: classification, student and tutor matching, snoozing, WhatsApp group sync, reply templates, and planning drafts. */
import { buildStructuredPausePlanningDraft } from './planning-helpers.mjs';
import { extractDatesFromMessage } from './incoming-date-helpers.mjs';

export const INCOMING_MESSAGE_STATUSES = ['inbox', 'converted', 'ignored', 'needs_review'];
export const INCOMING_MESSAGE_RESOLUTION_TYPES = ['planning_task', 'handled_no_plan', 'ignored_no_action'];
export const INCOMING_MESSAGE_CATEGORIES = [
  'one_off_absence',
  'extended_absence',
  'summer_break',
  'absence_pause',
  'leaving',
  'payment',
  'schedule',
  'concern',
  'general',
];
export const INCOMING_MESSAGE_INTENTS = [
  'request',
  'question',
  'notification',
  'acknowledgement',
  'social',
  'unclear',
];
export const INCOMING_MESSAGE_ACTIONABILITY = [
  'action_needed',
  'reply_needed',
  'uncertain',
  'no_action',
];
export const INCOMING_CLASSIFICATION_VERSION = '2';

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function collapse(value = '') {
  return clean(value).replace(/\s+/gu, ' ');
}

function normaliseText(value = '') {
  return collapse(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s+]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function firstName(value = '', fallback = 'there') {
  const first = clean(value).split(/\s+/u)[0];
  return first || fallback;
}

export function normalisePhone(value = '') {
  const digits = clean(value).replace(/[^\d+]/gu, '');
  if (!digits) return '';
  if (digits.startsWith('+44')) return `0${digits.slice(3)}`;
  if (digits.startsWith('44') && digits.length > 10) return `0${digits.slice(2)}`;
  return digits.replace(/^\+/, '');
}

function phoneComparable(value = '') {
  const phone = normalisePhone(value).replace(/\D/gu, '');
  return phone.length >= 9 ? phone.slice(-9) : phone;
}

function normaliseEnum(value, allowed, fallback) {
  const candidate = clean(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
}

export function deriveIncomingMessageResolutionType({ resolutionType = '', status = '', createdPlanningId = '' } = {}) {
  const explicit = normaliseEnum(resolutionType, INCOMING_MESSAGE_RESOLUTION_TYPES, '');
  if (explicit) return explicit;
  if (`${createdPlanningId || ''}`.trim()) return 'planning_task';
  if (`${status || ''}`.trim() === 'converted') return 'handled_no_plan';
  if (`${status || ''}`.trim() === 'ignored') return 'ignored_no_action';
  return '';
}

export function labelIncomingResolutionType(value = '') {
  return {
    planning_task: 'Plan created',
    handled_no_plan: 'Handled — no plan needed',
    ignored_no_action: 'No action needed',
  }[value] || '';
}

export function buildIncomingMessageId({ source = '', externalMessageId = '', chatId = '', messageText = '', messageAt = '', senderPhone = '' } = {}) {
  const externalId = clean(externalMessageId);
  // WhatsApp replays star events on reconnect/restart, often without the
  // original text or timestamp (cache miss → placeholder + capture-time
  // message_at). When the capture carries an external message id, hash only
  // the stable identity so every replay upserts the same row — and a replay
  // that recovers the real text can heal an earlier placeholder.
  const stable = externalId
    ? [normaliseText(source) || 'manual', clean(chatId), externalId].join('::')
    : [
      normaliseText(source) || 'manual',
      '',
      clean(messageAt) || '',
      normalisePhone(senderPhone) || '',
      collapse(messageText).slice(0, 280),
    ].join('::');
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `incoming_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normaliseIncomingMessagePayload(payload = {}, { now = new Date() } = {}) {
  const source = clean(payload.source || payload.Source || 'manual_paste') || 'manual_paste';
  const messageText = collapse(payload.messageText || payload.message_text || payload.body || payload.text || payload.Message || '');
  const externalMessageId = clean(payload.externalMessageId || payload.external_message_id || payload.messageId || payload.message_id || '');
  const capturedAt = clean(payload.capturedAt || payload.captured_at) || now.toISOString();

  return {
    incomingId: clean(payload.incomingId || payload.incoming_id) || buildIncomingMessageId({
      source,
      externalMessageId,
      chatId: payload.chatId || payload.chat_id || '',
      messageText,
      messageAt: payload.messageAt || payload.message_at || payload.timestamp || '',
      senderPhone: payload.senderPhone || payload.sender_phone || '',
    }),
    source,
    externalMessageId,
    capturedAt,
    messageAt: clean(payload.messageAt || payload.message_at || payload.timestamp || ''),
    chatId: clean(payload.chatId || payload.chat_id || ''),
    chatName: clean(payload.chatName || payload.chat_name || ''),
    senderName: clean(payload.senderName || payload.sender_name || payload.fromName || ''),
    senderPhone: clean(payload.senderPhone || payload.sender_phone || payload.from || ''),
    messageText,
    capturedBy: clean(payload.capturedBy || payload.captured_by || ''),
    status: normaliseEnum(payload.status, INCOMING_MESSAGE_STATUSES, 'inbox'),
    resolutionType: deriveIncomingMessageResolutionType({
      resolutionType: payload.resolutionType || payload.resolution_type,
      status: payload.status,
      createdPlanningId: payload.createdPlanningId || payload.created_planning_id,
    }),
    reviewNote: clean(payload.reviewNote || payload.review_note || ''),
    createdPlanningId: clean(payload.createdPlanningId || payload.created_planning_id || ''),
    snoozedUntil: clean(payload.snoozedUntil || payload.snoozed_until || ''),
    rawJson: clean(payload.rawJson || payload.raw_json || ''),
  };
}

// Text the bridge substitutes when it never saw the real message body: a star
// event for a message older than its cache, or a message it couldn't decrypt.
const PLACEHOLDER_TEXT_PATTERN = /^\[(message content unavailable|media or unsupported message)/iu;

export function isIncomingPlaceholderText(value = '') {
  return PLACEHOLDER_TEXT_PATTERN.test(clean(value));
}

// "Later" is a wake-up time on an otherwise-open inbox row, not another
// resolution status. That keeps handled, ignored, and planned outcomes intact
// while letting the daily surface omit work that genuinely is not for now.
export function isIncomingMessageSnoozed(entry = {}, { now = new Date() } = {}) {
  const untilMs = new Date(clean(entry.snoozedUntil)).getTime();
  return Number.isFinite(untilMs) && untilMs > now.getTime();
}

export function applyIncomingMessageSnooze(row = {}, {
  snoozedUntil = '',
  actorEmail = '',
  now = new Date(),
} = {}) {
  if (!['inbox', 'needs_review'].includes(clean(row.status))) {
    throw new Error('Only open incoming messages can be moved to Later');
  }

  const requested = clean(snoozedUntil);
  if (!requested) {
    return {
      ...row,
      snoozedUntil: '',
      reviewedBy: actorEmail || row.reviewedBy || '',
      reviewedAt: now.toISOString(),
    };
  }

  const untilMs = new Date(requested).getTime();
  if (!Number.isFinite(untilMs) || untilMs <= now.getTime()) {
    throw new Error('Later date must be in the future');
  }

  return {
    ...row,
    snoozedUntil: new Date(untilMs).toISOString(),
    reviewedBy: actorEmail || row.reviewedBy || '',
    reviewedAt: now.toISOString(),
  };
}

// Keyword rules measured against the privacy-reviewed synthetic eval fixture
// (tests/admin/fixtures/incoming-eval-set.json — run
// scripts/eval-incoming-classifier.mjs after changing anything here).
// Matching is whole-word/phrase: substring matching classified "will" as
// "ill" and "Rechargeable" as "charge" in representative messages.
export function classifyIncomingMessage(messageText = '') {
  const text = normaliseText(messageText);
  const padded = ` ${text} `;
  const hasAny = (terms) => terms.some((term) => padded.includes(` ${term} `));
  const hasRegex = (pattern) => pattern.test(padded);
  const evidence = [];
  const matchedTerms = (terms) => terms.filter((term) => padded.includes(` ${term} `));
  const recordEvidence = (kind, terms = []) => {
    for (const term of matchedTerms(terms)) evidence.push({ kind, term });
  };
  const hasQuestion = /\?/u.test(`${messageText || ''}`)
    || /^(can|could|would|will|is|are|do|does|did|when|what|which|where|how|why)\b/u.test(text);
  const hasRequest = hasAny(['please', 'can we', 'could we', 'would like', 'we need', 'i need', 'need to']);
  const resolvedTerms = [
    'all sorted', 'sorted now', 'went through', 'works fine', 'lesson is fine',
    'lessons are normal', 'lessons normal', 'no change',
    'slot works', 'thanks for confirming', 'thank you for confirming',
  ];
  const socialPatterns = [
    /\bhope (you|everyone) (had|have|enjoyed)\b/u,
    /\bhow was (your|the) (holiday|summer)\b/u,
    /\b(enjoyed|lovely|great) (the )?summer\b/u,
  ];
  const noImpactPatterns = [
    /\baway (for the )?(weekend|day)\b.*\b(lesson|lessons) (is|are|as) (fine|normal|usual)\b/u,
    /\bbank holiday\b.*\b(fine|normal|usual|no change)\b/u,
    /\bpaid for (the |a )?(book|music book|exam|instrument|strings|accessory)\b/u,
    /\b(slow|late) reply\b.*\b(caught up|catching up)\b/u,
  ];
  const isResolved = hasAny(resolvedTerms);
  const isSocial = socialPatterns.some((pattern) => pattern.test(padded));
  const isExplicitNoImpact = noImpactPatterns.some((pattern) => pattern.test(padded));
  const isTentative = hasAny(['might', 'maybe', 'possibly', 'not sure', 'thinking about', 'may need', 'might need']);
  const operationalText = text.replace(/\b(?:i )?(?:cannot|cant|can t) make (?:the )?parent call\b/gu, '');
  const hasCompetingAction = hasRequest || /\b(?:cannot|cant|can t|unable|miss|cancel|pause|stop lessons|ending lessons|reschedule|move (?:the )?lesson|change (?:the )?(?:lesson|slot|time|day)|restart|resume|charged twice|failed payment|not appeared|worried|struggling|unhappy|complaint)\b/u.test(operationalText);
  const isSocialOnly = isSocial && !hasCompetingAction;
  const isResolvedOnly = isResolved && !hasCompetingAction;
  const isExplicitNoImpactOnly = isExplicitNoImpact && !hasCompetingAction;

  const finish = ({ category = 'general', reason = '', strength = 'medium' } = {}) => {
    let intent = 'unclear';
    if (isSocialOnly) intent = 'social';
    else if (isResolvedOnly || isExplicitNoImpactOnly) intent = 'acknowledgement';
    else if (hasRequest) intent = 'request';
    else if (hasQuestion) intent = 'question';
    else if (category !== 'general') intent = 'notification';

    let actionability = 'no_action';
    if (!isSocialOnly && !isResolvedOnly && !isExplicitNoImpactOnly) {
      if (isTentative && !hasQuestion) actionability = 'uncertain';
      else if (intent === 'request') actionability = 'action_needed';
      else if (intent === 'question') actionability = 'reply_needed';
      else if (category !== 'general') {
        actionability = ['payment', 'concern'].includes(category) ? 'reply_needed' : 'action_needed';
      } else if (hasAny(['lesson', 'lessons', 'tutor', 'showcase', 'booking', 'availability'])) {
        actionability = 'uncertain';
      }
    }

    const confidence = isSocialOnly || isResolvedOnly || isExplicitNoImpactOnly || (strength === 'strong' && !isTentative)
      ? 'high'
      : strength === 'weak' || actionability === 'uncertain'
        ? 'low'
        : 'medium';

    return {
      category,
      intent,
      actionability,
      confidence,
      evidence,
      reasons: reason ? [reason] : [],
      version: INCOMING_CLASSIFICATION_VERSION,
    };
  };

  if (!text || isSocialOnly || isExplicitNoImpactOnly || isResolvedOnly) {
    if (isSocialOnly) evidence.push({ kind: 'context', term: 'social seasonal wording' });
    if (isExplicitNoImpactOnly) evidence.push({ kind: 'context', term: 'explicitly no lesson/payment impact' });
    return finish({
      category: 'general',
      reason: isSocialOnly
        ? 'Seasonal wording is conversational, not evidence of a lesson change'
        : isExplicitNoImpactOnly
          ? 'The message explicitly says no school action is needed'
          : isResolvedOnly
            ? 'The message says the matter is already settled'
            : '',
      strength: 'strong',
    });
  }

  const summerTerms = [
    'summer',
    'summer holiday',
    'school holiday',
    'schools are off',
    'schools off',
    'schools return',
    'schools go back',
    'back to school',
    'after the holidays',
  ];
  // The seasonal set is strictly seasonal — pairing away/holiday with generic
  // "back"/"return" made every Christmas break read as summer.
  const lessonImpactTerms = [
    'lesson', 'lessons', 'pause', 'stop', 'cancel', 'resume', 'restart',
    'last lesson', 'last lessons',
  ];
  const hasAbsenceStatement = /\b(?:i|we|he|she|they|[a-z0-9_]+)\s+(?:will be|shall be|am|are|is|going|go)\s+(?:away|on holiday)\b/u.test(text);
  const hasSeasonalTiming = hasAny([
    'july', 'august', 'today', 'tomorrow', 'next week', 'this week',
    'next month', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday',
  ]) || /\b(?:from|until|till|starting|during|after|before)\b/u.test(text)
    || /\b\d{1,2}(?:st|nd|rd|th)?\b/u.test(text);
  const hasSummerContext = hasAny(summerTerms)
    || (
      hasAny(['camp', 'holiday', 'away'])
      && hasAny(['july', 'august'])
    )
    || (
      hasAny(['last lesson', 'last lessons'])
      && hasAny(['july', 'august', 'summer', 'holiday', 'camp', 'school'])
    );
  const hasExplicitSummerChange = hasAny([
    'summer break', 'schools are off', 'schools off', 'schools return',
    'schools go back', 'after the holidays',
  ]) || /\b(?:pause|stop|cancel|resume|restart|last lesson|last lessons)\b.{0,40}\b(?:summer|holiday|holidays)\b/u.test(text);
  if (hasSummerContext && (!isSocial || hasExplicitSummerChange) && (
    hasAny(lessonImpactTerms)
    || hasRequest
    || hasQuestion
    || hasSeasonalTiming
    || hasAbsenceStatement
  )) {
    recordEvidence('topic', summerTerms);
    return finish({
      category: 'summer_break',
      reason: 'summer wording is tied to a lesson break, stop, return, or date',
      strength: 'strong',
    });
  }

  const leavingTerms = [
    'leaving lessons',
    'stop lessons',
    'ending lessons',
    'end lessons',
    'cancel subscription',
    'cancel payments',
    'last lesson',
  ];
  if (hasAny(leavingTerms)) {
    recordEvidence('topic', leavingTerms);
    return finish({ category: 'leaving', reason: 'Message says lessons or their subscription may be ending', strength: 'strong' });
  }

  const extendedTerms = [
    'pause',
    'paused',
    'pausing',
    'holiday',
    'holidays',
    'away for',
    'going away',
    'returning',
    'back on',
    'back from',
    'be back',
    'come back',
    'break from',
    'for two weeks',
    'for 2 weeks',
    'for three weeks',
    'for 3 weeks',
  ];
  const hasExtendedDuration = hasRegex(/\bfor\s+\d+\s+(week|weeks|month|months)\b/u)
    || hasAny(['for two weeks', 'for 2 weeks', 'for three weeks', 'for 3 weeks']);
  const hasExplicitSingleLessonAbsence = /\b(?:will\s+)?(?:miss|misses|missing)\s+(?:his|her|their|my|our|the|a)\s+lesson\b/u.test(text)
    || /\b(?:cannot|cant|can t|unable to)\s+make\s+(?:his|her|their|my|our|the|a)\s+lesson\b/u.test(text);
  const hasExplicitPauseRequest = hasAny(['pause', 'paused', 'pausing', 'break from']);
  // A return date can clarify one missed lesson without turning it into a
  // multi-lesson pause. Prefer the explicit singular lesson statement unless
  // the message also supplies real duration/pause evidence.
  if (hasExplicitSingleLessonAbsence && !hasExtendedDuration && !hasExplicitPauseRequest) {
    evidence.push({ kind: 'topic', term: 'specific missed lesson' });
    return finish({ category: 'one_off_absence', reason: 'Message says one specific lesson will be missed', strength: 'strong' });
  }
  const hasExtendedSignal = hasAny(extendedTerms) || hasExtendedDuration;
  const conversationalHoliday = hasAny(['holiday', 'holidays'])
    && !hasAny(['lesson', 'lessons', 'pause', 'away', 'going away', 'returning', 'back on', 'back from', 'be back', 'break from'])
    && !hasAny(['today', 'tomorrow', 'next week', 'this week', 'next month', 'july', 'august'])
    && !hasExtendedDuration
    && !hasRequest;
  if (hasExtendedSignal && !conversationalHoliday) {
    recordEvidence('topic', extendedTerms);
    if (hasExtendedDuration) evidence.push({ kind: 'duration', term: 'multi-week duration' });
    return finish({ category: 'extended_absence', reason: 'Message describes a lesson pause, return, or multi-lesson absence', strength: 'strong' });
  }

  const oneOffTerms = [
    'cant make',
    'can t make',
    'cannot make',
    'can not make',
    'cannot attend',
    'can t attend',
    'cant attend',
    'cannot come',
    'can t come',
    'cant come',
    'miss lesson',
    'missed lesson',
    'missing lesson',
    'absent',
    'not able to make',
    'unable to make',
    'not able to come',
    'unable to come',
    'off sick',
    'sick',
    'ill',
    'unwell',
    'cancel lesson',
    'cancel the lesson',
    'cancelled lesson',
  ];
  if (hasAny(oneOffTerms)) {
    recordEvidence('topic', oneOffTerms);
    const weakIllnessOnly = !hasAny(['lesson', 'lessons', 'attend', 'come', 'make', 'miss', 'cancel'])
      && hasAny(['sick', 'ill', 'unwell']);
    if (!weakIllnessOnly
      || hasAny(['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
      || hasRegex(/\b(on|from|until)\s+\d/u)) {
      return finish({ category: 'one_off_absence', reason: 'Message says a specific lesson cannot be attended', strength: 'strong' });
    }
  }

  const absenceTerms = [
    'away',
    'poorly',
    'under the weather',
  ];
  if (hasAny(absenceTerms) && (
    hasAny(['lesson', 'lessons', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    || hasRegex(/\b(on|from|until)\s+\d/u)
    || hasAny(['for how long', 'how long yet'])
  )) {
    recordEvidence('topic', absenceTerms);
    return finish({ category: 'absence_pause', reason: 'Absence wording is tied to lesson timing', strength: 'medium' });
  }

  const paymentTerms = ['payment', 'payments', 'stripe', 'bank', 'paid', 'charge', 'charged', 'failed payment', 'direct debit'];
  const paymentIssueTerms = ['failed', 'twice', 'not appeared', 'still active', 'set up', 'direct debit', 'stripe', 'charged', 'charge'];
  if (hasAny(paymentTerms) && (hasAny(paymentIssueTerms) || hasQuestion || hasRequest)) {
    recordEvidence('topic', paymentTerms);
    return finish({ category: 'payment', reason: 'Payment wording is tied to a question, problem, or account update', strength: 'strong' });
  }

  const scheduleTerms = [
    'change time',
    'change slot',
    'change the day',
    'change the time',
    'move lesson',
    'different time',
    'different day',
    'another day',
    'reschedule',
    'new slot',
    'slot',
    'swap',
    'restart',
    'resume',
    'start again',
    'what time',
  ];
  if (hasAny(scheduleTerms)) {
    recordEvidence('topic', scheduleTerms);
    return finish({ category: 'schedule', reason: 'Message refers to a lesson time, slot, move, or restart', strength: 'strong' });
  }

  const concernTerms = ['worried', 'concern', 'unhappy', 'struggling', 'upset', 'complaint', 'confused'];
  if (hasAny(concernTerms) && (
    hasAny(['lesson', 'lessons', 'confidence', 'feedback', 'help', 'talk', 'talking', 'discuss', 'discussion', 'going'])
    || hasRequest
  )) {
    recordEvidence('topic', concernTerms);
    return finish({ category: 'concern', reason: 'Concern wording is tied to learning, lessons, feedback, or a request to talk', strength: 'strong' });
  }

  if (isResolved) recordEvidence('context', resolvedTerms);
  return finish({
    category: 'general',
    reason: isResolved ? 'The message says the matter is already settled' : '',
    strength: isResolved ? 'strong' : 'weak',
  });
}

export function matchIncomingMessageToStudent(message = {}, students = [], { groupMapRows = [] } = {}) {
  const confirmedGroup = groupMapRows.find((row) => (
    row.chatId
    && row.chatId === message.chatId
    && row.status === 'confirmed'
    && row.matchedMmsId
  ));
  if (confirmedGroup) {
    const groupStudentIds = [
      confirmedGroup.matchedMmsId,
      ...`${confirmedGroup.additionalMmsIds || ''}`.split(',').map((id) => id.trim()),
    ].filter(Boolean);
    const uniqueGroupStudentIds = [...new Set(groupStudentIds)];

    // Single-student group: the confirmed map is the answer.
    if (uniqueGroupStudentIds.length <= 1) {
      return {
        matchedMmsId: confirmedGroup.matchedMmsId || '',
        matchedStudentName: confirmedGroup.matchedStudentName || '',
        matchConfidence: 'high',
        matchReasons: 'confirmed WhatsApp group map matches this student',
        score: 0.98,
      };
    }

    // Shared (sibling) group: pick the student the message actually names.
    const nameHaystack = normaliseText([message.messageText, message.senderName].filter(Boolean).join(' '));
    const nameTokens = new Set(nameHaystack.split(' ').filter(Boolean));
    const groupStudents = uniqueGroupStudentIds
      .map((id) => students.find((entry) => entry.mmsId === id))
      .filter(Boolean);
    const named = groupStudents.filter((entry) => {
      const full = normaliseText(entry.fullName || '');
      const first = normaliseText(entry.firstName || '');
      return (full && nameHaystack.includes(full)) || (first && nameTokens.has(first));
    });

    if (named.length === 1) {
      return {
        matchedMmsId: named[0].mmsId || '',
        matchedStudentName: named[0].fullName || '',
        matchConfidence: 'high',
        matchReasons: 'named student in a shared WhatsApp group',
        score: 0.95,
      };
    }

    // Ambiguous: don't guess which sibling — flag for manual review.
    const names = groupStudents.map((entry) => entry.fullName).filter(Boolean).join(', ');
    return {
      matchedMmsId: '',
      matchedStudentName: '',
      matchConfidence: 'none',
      matchReasons: `shared WhatsApp group with ${groupStudents.length} students (${names}) — no student named in the message, needs manual review`,
      score: 0,
    };
  }

  const senderPhone = phoneComparable(message.senderPhone);
  const haystack = normaliseText([
    message.messageText,
    message.senderName,
    message.chatName,
    message.senderPhone,
  ].filter(Boolean).join(' '));
  const firstNameCounts = new Map();

  for (const student of students) {
    const first = normaliseText(student.firstName || '');
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  }

  const candidates = [];
  for (const student of students) {
    const reasons = [];
    let score = 0;
    const studentPhone = phoneComparable(student.contactNumber);
    if (senderPhone && studentPhone && senderPhone === studentPhone) {
      score = Math.max(score, 0.95);
      reasons.push('sender phone matches student contact number');
    }

    const fullName = normaliseText(student.fullName || '');
    if (fullName && haystack.includes(fullName)) {
      score = Math.max(score, 0.9);
      reasons.push('message includes full student name');
    }

    const firstName = normaliseText(student.firstName || '');
    const lastName = normaliseText(student.lastName || '');
    if (firstName && lastName && haystack.includes(firstName) && haystack.includes(lastName)) {
      score = Math.max(score, 0.78);
      reasons.push('message includes student first and last name');
    }

    if (firstName && firstNameCounts.get(firstName) === 1 && haystack.includes(firstName)) {
      score = Math.max(score, 0.52);
      reasons.push('message includes a unique student first name');
    }

    const parentName = normaliseText(`${student.parentFirstName || ''} ${student.parentLastName || ''}`);
    if (parentName && haystack.includes(parentName)) {
      score = Math.max(score, 0.64);
      reasons.push('message includes parent name from Students sheet');
    }

    if (score > 0) {
      candidates.push({
        student,
        score,
        reasons,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return {
      matchedMmsId: '',
      matchedStudentName: '',
      matchConfidence: 'none',
      matchReasons: '',
      score: 0,
    };
  }

  const matchConfidence = best.score >= 0.85 ? 'high' : best.score >= 0.6 ? 'medium' : 'low';
  return {
    matchedMmsId: best.student.mmsId || '',
    matchedStudentName: best.student.fullName || '',
    matchConfidence,
    matchReasons: best.reasons.join(' | '),
    score: best.score,
  };
}

export function buildIncomingMessageRecord(payload = {}, { students = [], groupMapRows = [], now = new Date() } = {}) {
  const message = normaliseIncomingMessagePayload(payload, { now });
  const classification = classifyIncomingMessage(message.messageText);
  const match = matchIncomingMessageToStudent(message, students, { groupMapRows });
  const isPlaceholder = isIncomingPlaceholderText(message.messageText);

  return {
    ...message,
    status: isPlaceholder && message.status === 'inbox' ? 'needs_review' : message.status,
    suspectedCategory: classification.category,
    proposedCategory: classification.category,
    proposedIntent: classification.intent,
    proposedActionability: classification.actionability,
    classificationIntent: classification.intent,
    classificationActionability: classification.actionability,
    classificationConfidence: classification.confidence,
    classificationVersion: classification.version,
    classificationEvidence: JSON.stringify(classification.evidence || []),
    classificationDecision: 'unreviewed',
    matchedMmsId: match.matchedMmsId,
    matchedStudentName: match.matchedStudentName,
    matchConfidence: match.matchConfidence,
    matchReasons: [
      ...(isPlaceholder
        ? ['Starred message arrived without its text (older than the bridge cache) — paste the original message to classify it']
        : []),
      ...classification.reasons,
      match.matchReasons,
    ].filter(Boolean).join(' | '),
    rawJson: message.rawJson || JSON.stringify(payload || {}),
  };
}

// Decides what a fresh capture should do when a row with the same incoming id
// already exists (WhatsApp replays star events on reconnect/restart):
//   skip — the replay adds nothing new; leave the stored row untouched
//   heal — the stored row is a placeholder and the replay recovered real text;
//          take the fresh classification/match but keep every human decision
export function mergeIncomingCapture(existing, fresh) {
  if (!existing) return { action: 'insert', record: fresh };

  const freshHasText = fresh.messageText && !isIncomingPlaceholderText(fresh.messageText);
  if (!isIncomingPlaceholderText(existing.messageText) || !freshHasText) {
    return { action: 'skip', record: existing };
  }

  return {
    action: 'heal',
    record: {
      ...fresh,
      capturedAt: existing.capturedAt || fresh.capturedAt,
      status: ['converted', 'ignored'].includes(existing.status) ? existing.status : fresh.status,
      reviewNote: existing.reviewNote || fresh.reviewNote || '',
      reviewedBy: existing.reviewedBy || '',
      reviewedAt: existing.reviewedAt || '',
      createdPlanningId: existing.createdPlanningId || '',
      resolutionType: existing.resolutionType || fresh.resolutionType || '',
      snoozedUntil: existing.snoozedUntil || '',
      matchReasons: [fresh.matchReasons, 'recovered text healed an earlier placeholder capture'].filter(Boolean).join(' | '),
    },
  };
}

// The reviewer pasted the real message into a placeholder row: swap the text
// in, re-run classification and matching, and reopen the row for action while
// keeping any archive decision already made.
export function applyIncomingMessageTextUpdate(row = {}, { messageText = '', students = [], groupMapRows = [], actorEmail = '', now = new Date() } = {}) {
  const text = collapse(messageText);
  if (!text) {
    throw new Error('Message text is required');
  }

  const classification = classifyIncomingMessage(text);
  const match = matchIncomingMessageToStudent({ ...row, messageText: text }, students, { groupMapRows });

  return {
    ...row,
    messageText: text,
    suspectedCategory: classification.category,
    proposedCategory: classification.category,
    proposedIntent: classification.intent,
    proposedActionability: classification.actionability,
    classificationIntent: classification.intent,
    classificationActionability: classification.actionability,
    classificationConfidence: classification.confidence,
    classificationVersion: classification.version,
    classificationEvidence: JSON.stringify(classification.evidence || []),
    classificationDecision: 'unreviewed',
    matchedMmsId: match.matchedMmsId,
    matchedStudentName: match.matchedStudentName,
    matchConfidence: match.matchConfidence,
    matchReasons: [...classification.reasons, match.matchReasons, 'reviewer supplied the message text'].filter(Boolean).join(' | '),
    status: ['converted', 'ignored'].includes(row.status) ? row.status : 'inbox',
    snoozedUntil: '',
    reviewedBy: actorEmail || row.reviewedBy || '',
    reviewedAt: now.toISOString(),
  };
}

// Record a human classification decision without erasing the machine proposal.
// This is the learning boundary: accepted and corrected suggestions can be
// measured later, while untouched/legacy rows never masquerade as labels.
export function applyIncomingClassificationReview(row = {}, {
  category = '',
  actionability = '',
} = {}) {
  const currentCategory = normaliseEnum(row.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general');
  const currentActionability = normaliseEnum(
    row.classificationActionability,
    INCOMING_MESSAGE_ACTIONABILITY,
    'uncertain',
  );
  const selectedCategory = clean(category) || currentCategory;
  const selectedActionability = clean(actionability) || currentActionability;

  if (!INCOMING_MESSAGE_CATEGORIES.includes(selectedCategory)) {
    throw new Error(`Unknown incoming message category: ${selectedCategory}`);
  }
  if (!INCOMING_MESSAGE_ACTIONABILITY.includes(selectedActionability)) {
    throw new Error(`Unknown incoming message actionability: ${selectedActionability}`);
  }

  const proposedCategory = normaliseEnum(
    row.proposedCategory || row.suspectedCategory,
    INCOMING_MESSAGE_CATEGORIES,
    'general',
  );
  const proposedActionability = normaliseEnum(
    row.proposedActionability || row.classificationActionability,
    INCOMING_MESSAGE_ACTIONABILITY,
    'uncertain',
  );

  return {
    ...row,
    proposedCategory,
    proposedIntent: normaliseEnum(row.proposedIntent, INCOMING_MESSAGE_INTENTS, 'unclear'),
    proposedActionability,
    suspectedCategory: selectedCategory,
    classificationActionability: selectedActionability,
    classificationDecision: selectedCategory === proposedCategory
      && selectedActionability === proposedActionability
      ? 'accepted'
      : 'corrected',
  };
}

export function isWhatsappGroupChatId(chatId = '') {
  return clean(chatId).endsWith('@g.us');
}

// A message sent by the school side of a chat: our own account (from_me from
// the bridge) or a staff member messaging from their personal number (Tom is
// in every group under his own number — INCOMING_STAFF_PHONES lists those).
// Staff messages never become inbox items; they are reply evidence.
export function isSchoolStaffMessage(payload = {}, staffPhones = '') {
  const fromMe = payload.fromMe ?? payload.from_me;
  if (fromMe === true || `${fromMe || ''}`.toLowerCase() === 'true') return true;

  const sender = phoneComparable(payload.senderPhone || payload.sender_phone || '');
  if (!sender) return false;
  return `${staffPhones || ''}`
    .split(',')
    .map((phone) => phoneComparable(phone))
    .filter(Boolean)
    .includes(sender);
}

// Build a phone -> tutor-name lookup from the Tutor_Phones sheet rows so a
// tutor's own reply in a lesson group can be recognised as school-side. Numbers
// are compared on their last 9 digits (phoneComparable), tolerant of +44/0 formats.
export function buildTutorPhoneLookup(tutorPhoneRows = []) {
  const lookup = new Map();
  for (const row of tutorPhoneRows) {
    const name = clean(row?.tutorName ?? row?.name ?? '');
    const phone = phoneComparable(row?.phone ?? row?.phoneNumber ?? '');
    if (name && phone) {
      lookup.set(phone, name);
    }
  }
  return lookup;
}

// The tutor's name if this message came from a known tutor number, else ''.
// A match means the message is a tutor's own reply — reply evidence, never a new
// (mis-classified) parent inbox row, and never a "handled" state.
export function matchTutorPhone(payload = {}, tutorPhoneLookup = new Map()) {
  const sender = phoneComparable(payload?.senderPhone || payload?.sender_phone || '');
  if (!sender) return '';
  return tutorPhoneLookup.get(sender) || '';
}

// Fallback tutor recognition for when no usable sender number survives (LID-
// addressed groups can hide it entirely): the sender's WhatsApp push name
// matched against this group's own tutor from the group map. Deliberately
// restricted to the group's tutor — matching "any tutor name" would let a
// parent who shares a name with a tutor be silently absorbed as reply
// evidence. Names match when the shorter one's words are a leading prefix of
// the longer's with at least two words agreeing ("Dean Louden" ~ "Dean Louden
// Music", but never bare "Dean" — parents often use single-word push names, and
// the safe failure direction is inbox noise, not a silently archived parent).
export function matchTutorSenderName(senderName = '', groupTutorName = '') {
  const sender = normaliseText(senderName).split(' ').filter(Boolean);
  const tutor = normaliseText(groupTutorName).split(' ').filter(Boolean);
  if (sender.length < 2 || tutor.length < 2) return '';
  const [shorter, longer] = sender.length <= tutor.length ? [sender, tutor] : [tutor, sender];
  return shorter.every((word, index) => word === longer[index]) ? clean(groupTutorName) : '';
}

// A later school-side chat message is weak engagement evidence for the nearest
// preceding open parent message only. Stamping every open row in the group made
// one tutor reply look like proof that several unrelated loops were answered.
export function selectReplyEvidenceTarget(rows = [], { chatId = '', repliedAt = '' } = {}) {
  const replyTime = new Date(repliedAt || '').getTime();
  return rows
    .filter((row) => row.chatId === chatId
      && ['inbox', 'needs_review'].includes(row.status)
      && !row.schoolRepliedAt)
    .filter((row) => {
      if (!Number.isFinite(replyTime)) return true;
      const rowTime = new Date(row.messageAt || row.capturedAt || '').getTime();
      return !Number.isFinite(rowTime) || rowTime <= replyTime;
    })
    .sort((a, b) => {
      const aTime = new Date(a.messageAt || a.capturedAt || '').getTime();
      const bTime = new Date(b.messageAt || b.capturedAt || '').getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })[0] || null;
}

// Auto-captured group messages that carry no operational signal ("Thanks!",
// "See you then") land pre-archived so the inbox only shows work. Anything
// with a specific category or a date stays open for review.
export function decideAutoCaptureStatus(record = {}, extraction = null) {
  const actionability = normaliseEnum(
    record.classificationActionability,
    INCOMING_MESSAGE_ACTIONABILITY,
    '',
  );
  if (actionability === 'action_needed' || actionability === 'reply_needed') return 'inbox';
  if (actionability === 'uncertain') return 'needs_review';
  if (actionability === 'no_action') return 'ignored';

  // Legacy rows/callers have no actionability field. Preserve the old,
  // conservative behaviour while every new capture uses the richer contract.
  const category = normaliseEnum(record.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general');
  if (category !== 'general') return 'inbox';
  const dates = extraction || extractIncomingMessageDates(record);
  return dates.dates.length || dates.durationWeeks ? 'inbox' : 'ignored';
}

// Rows the auto-capture rules archived (vs a human decision, which stamps
// reviewed_by). Surfaced as their own filter so the noise policy can be
// audited cheaply while trust is being built.
export function isAutoArchivedMessage(entry = {}) {
  return entry.source === 'whatsapp_group_auto'
    && normaliseEnum(entry.status, INCOMING_MESSAGE_STATUSES, 'inbox') === 'ignored'
    && !clean(entry.reviewedBy);
}

// Turns the bridge's heartbeat row into a verdict the overview/inbox can
// render. "Alive but not okay" states (empty group list, stale heartbeat)
// matter as much as silence — a connected bridge with no capture list posts
// heartbeats but captures nothing (exactly the 2026-07-06 rollout failure).
export function assessBridgeHealth(status = null, { now = new Date(), lastAutoCaptureAt = '' } = {}) {
  const problems = [];
  const nowMs = now.getTime();

  const captureMs = new Date(lastAutoCaptureAt || 0).getTime();
  const captureAgeDays = lastAutoCaptureAt && Number.isFinite(captureMs) ? (nowMs - captureMs) / (24 * 60 * 60 * 1000) : null;
  if (captureAgeDays !== null && captureAgeDays >= 3) {
    problems.push(`No group message captured for ${Math.floor(captureAgeDays)} days`);
  }

  // No heartbeat row yet (bridge running pre-heartbeat code, or never ran):
  // the capture-gap check above still applies; otherwise stay quiet.
  if (!status || !status.lastHeartbeatAt) {
    return {
      state: problems.length ? 'warn' : 'none',
      problems: problems.length ? problems : ['No bridge heartbeat recorded yet'],
      heartbeatAgeHours: null,
      captureAgeDays,
    };
  }

  const heartbeatMs = new Date(status.lastHeartbeatAt).getTime();
  const heartbeatAgeHours = Number.isFinite(heartbeatMs) ? (nowMs - heartbeatMs) / (60 * 60 * 1000) : null;
  if (heartbeatAgeHours === null || heartbeatAgeHours >= 2) {
    problems.push(`No heartbeat for ${heartbeatAgeHours === null ? 'an unknown time' : `${Math.floor(heartbeatAgeHours)}h`} — the bridge is probably down or unlinked`);
  }

  if (!status.confirmedGroups) {
    problems.push('Bridge has an empty confirmed-group list — connected but capturing nothing');
  }

  return {
    state: problems.length ? 'warn' : 'ok',
    problems,
    heartbeatAgeHours,
    captureAgeDays,
  };
}

// One-tap convert: the card can go straight to "Convert to plan + draft reply"
// without opening the correction panel when both guesses are strong — a
// high-confidence student match (confirmed group / phone) and a specific
// category. `general` and `absence_pause` (the weak catch-all) still need the
// human to pick, and placeholder rows have no text to act on.
export function isOneTapConvertEligible(entry = {}) {
  const category = normaliseEnum(entry.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general');
  const status = normaliseEnum(entry.status, INCOMING_MESSAGE_STATUSES, 'inbox');
  return Boolean(
    entry.matchedMmsId
    && entry.matchConfidence === 'high'
    && entry.classificationActionability === 'action_needed'
    && entry.classificationConfidence === 'high'
    && !['general', 'absence_pause'].includes(category)
    && !isIncomingPlaceholderText(entry.messageText)
    && ['inbox', 'needs_review'].includes(status),
  );
}

// Keep the Planning path visible without letting a low-confidence machine
// proposal create work unchecked. Strong rows can convert immediately; every
// other readable open row enters the correction/review panel first.
export function resolveIncomingPlanningAction(entry = {}) {
  if (clean(entry.createdPlanningId)) return 'open_plan';
  const status = normaliseEnum(entry.status, INCOMING_MESSAGE_STATUSES, 'inbox');
  if (!['inbox', 'needs_review'].includes(status) || isIncomingPlaceholderText(entry.messageText)) {
    return 'none';
  }
  return isOneTapConvertEligible(entry) ? 'convert' : 'review';
}

export function buildWhatsappGroupMapRecord(record = {}, existing = {}) {
  if (!isWhatsappGroupChatId(record.chatId)) return null;

  const now = new Date().toISOString();
  const lastSeenAt = record.capturedAt || now;
  return {
    chatId: record.chatId || existing.chatId || '',
    chatName: record.chatName || existing.chatName || '',
    firstSeenAt: existing.firstSeenAt || lastSeenAt,
    lastSeenAt,
    lastIncomingId: record.incomingId || existing.lastIncomingId || '',
    lastMessageAt: record.messageAt || existing.lastMessageAt || '',
    lastSenderName: record.senderName || existing.lastSenderName || '',
    lastSenderPhone: record.senderPhone || existing.lastSenderPhone || '',
    matchedMmsId: record.matchedMmsId || existing.matchedMmsId || '',
    matchedFcId: record.matchedFcId || existing.matchedFcId || '',
    matchedStudentName: record.matchedStudentName || existing.matchedStudentName || '',
    additionalMmsIds: record.additionalMmsIds ?? existing.additionalMmsIds ?? '',
    parentName: record.parentName || existing.parentName || '',
    parentPhone: record.parentPhone || existing.parentPhone || '',
    tutorName: record.tutorName || existing.tutorName || '',
    instrument: record.instrument || existing.instrument || '',
    matchConfidence: record.matchConfidence || existing.matchConfidence || '',
    matchReasons: record.matchReasons || existing.matchReasons || '',
    status: record.groupMapStatus || existing.status || 'review',
    confirmedBy: record.confirmedBy || existing.confirmedBy || '',
    confirmedAt: record.confirmedAt || existing.confirmedAt || '',
    notes: existing.notes || '',
    rawJson: record.rawJson || existing.rawJson || '',
  };
}

// Instrument keywords used to recognise a First Chord group by its title.
// Every FC group title contains an instrument; personal groups don't. The
// roster's own instruments are unioned in at call time so new instruments are
// picked up automatically.
export const FIRST_CHORD_INSTRUMENT_KEYWORDS = [
  'guitar', 'piano', 'keyboard', 'keys', 'voice', 'vocal', 'vocals', 'singing', 'sing',
  'ukulele', 'uke', 'bass', 'drums', 'drum', 'violin', 'viola', 'cello', 'sax',
  'saxophone', 'flute', 'clarinet', 'trumpet', 'theory', 'mandolin', 'banjo',
];

export function detectInstrumentInName(name = '', extraInstruments = []) {
  const tokens = new Set(normaliseText(name).split(' ').filter(Boolean));
  if (!tokens.size) return '';

  const keywords = new Set(FIRST_CHORD_INSTRUMENT_KEYWORDS);
  for (const instrument of extraInstruments) {
    for (const token of normaliseText(instrument).split(' ')) {
      if (token.length >= 3) keywords.add(token);
    }
  }

  for (const keyword of keywords) {
    if (tokens.has(keyword)) return keyword;
  }
  return '';
}

// Matches a whole WhatsApp group to a student using participant phone numbers
// (deterministic, strongest) and the student name in the group title.
export function matchGroupToStudent({ chatName = '', participantPhones = [] } = {}, students = []) {
  const comparablePhones = new Set(
    (participantPhones || [])
      .map((phone) => phoneComparable(phone))
      .filter((phone) => phone.length >= 9),
  );
  const haystack = normaliseText(chatName);

  const firstNameCounts = new Map();
  for (const student of students) {
    const first = normaliseText(student.firstName || '');
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  }

  const titleTokens = haystack.split(' ').filter(Boolean);
  const candidates = [];
  for (const student of students) {
    const reasons = [];
    let score = 0;

    const studentPhone = phoneComparable(student.contactNumber);
    if (studentPhone && comparablePhones.has(studentPhone)) {
      score = Math.max(score, 0.95);
      reasons.push('a group member’s number matches this student’s contact number');
    }

    const fullName = normaliseText(student.fullName || '');
    if (fullName && haystack.includes(fullName)) {
      score = Math.max(score, 0.9);
      reasons.push('group name includes the full student name');
    }

    const firstName = normaliseText(student.firstName || '');
    const lastName = normaliseText(student.lastName || '');
    if (firstName && lastName && haystack.includes(firstName) && haystack.includes(lastName)) {
      score = Math.max(score, 0.78);
      reasons.push('group name includes student first and last name');
    }

    // FC group titles are "{First name} {Instrument} Lessons" — first name plus
    // the student's own instrument disambiguates same-name students (e.g. two
    // Alexes on different instruments) even with no matchable phone.
    const firstInTitle = firstName && titleTokens.includes(firstName);
    const instrumentTokens = normaliseText(student.instrument || '').split(' ').filter((token) => token.length >= 3);
    const instrumentInTitle = instrumentTokens.some((token) => titleTokens.includes(token));
    if (firstInTitle && instrumentInTitle) {
      const uniqueFirst = firstNameCounts.get(firstName) === 1;
      score = Math.max(score, uniqueFirst ? 0.9 : 0.7);
      reasons.push(uniqueFirst
        ? 'group name matches student first name and instrument'
        : 'group name matches a shared first name and instrument — confirm');
    }

    if (firstInTitle && firstNameCounts.get(firstName) === 1) {
      score = Math.max(score, 0.55);
      reasons.push('group name includes a unique student first name');
    }

    if (score > 0) candidates.push({ student, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return { matchedMmsId: '', matchedStudentName: '', matchConfidence: 'none', matchReasons: '', score: 0 };
  }

  return {
    matchedMmsId: best.student.mmsId || '',
    matchedStudentName: best.student.fullName || '',
    matchConfidence: best.score >= 0.85 ? 'high' : best.score >= 0.6 ? 'medium' : 'low',
    matchReasons: best.reasons.join(' | '),
    score: best.score,
  };
}

// Turns a raw bridge group dump into the set of First Chord groups worth
// importing: title must contain an instrument, and the group must have been
// active within the window (default 6 months). Unknown last-active is kept
// (fail-open) so a groups-only sync never silently drops a live group.
export function buildGroupSyncPlan({ groups = [], students = [], now = new Date(), activeWithinMonths = 6 } = {}) {
  const rosterInstruments = [...new Set(students.map((student) => student.instrument).filter(Boolean))];
  const cutoff = new Date(now).getTime() - activeWithinMonths * 30 * 24 * 60 * 60 * 1000;

  const summary = {
    totalGroups: 0,
    kept: 0,
    matched: 0,
    skippedNotGroup: 0,
    skippedNoInstrument: 0,
    skippedInactive: 0,
  };
  const records = [];

  for (const group of groups) {
    const chatId = clean(group.chatId || group.id);
    if (!isWhatsappGroupChatId(chatId)) {
      summary.skippedNotGroup += 1;
      continue;
    }
    summary.totalGroups += 1;

    const chatName = clean(group.chatName || group.subject);
    const instrument = detectInstrumentInName(chatName, rosterInstruments);
    if (!instrument) {
      summary.skippedNoInstrument += 1;
      continue;
    }

    const lastActiveAt = clean(group.lastActiveAt);
    const lastActiveMs = Date.parse(lastActiveAt);
    if (Number.isFinite(lastActiveMs) && lastActiveMs < cutoff) {
      summary.skippedInactive += 1;
      continue;
    }

    const match = matchGroupToStudent({ chatName, participantPhones: group.participantPhones || [] }, students);
    if (match.matchedMmsId) summary.matched += 1;
    summary.kept += 1;

    records.push({
      chatId,
      chatName,
      instrument,
      lastActiveAt,
      matchedMmsId: match.matchedMmsId,
      matchedStudentName: match.matchedStudentName,
      matchConfidence: match.matchConfidence,
      matchReasons: match.matchReasons,
    });
  }

  return { records, summary };
}

// Roster-based bucketing for a synced group: if we matched a current student
// it's worth reviewing; if not, it's almost certainly an old student or a
// non-lesson group, so park it as `unmatched` (hidden by default). Preserve
// only human decisions (`confirmed`/`ignored`); `review`/`unmatched` are
// auto-assigned, so re-bucket them on every sync (matching improves over time).
export function decideSyncedGroupStatus(existingStatus = '', hasMatch = false) {
  if (existingStatus === 'confirmed') return 'confirmed';
  if (existingStatus === 'ignored') return 'ignored';
  return hasMatch ? 'review' : 'unmatched';
}

export function groupIncomingMessages(rows = []) {
  return [...rows]
    .map((row) => ({
      ...row,
      status: normaliseEnum(row.status, INCOMING_MESSAGE_STATUSES, 'inbox'),
      suspectedCategory: normaliseEnum(row.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general'),
      proposedCategory: normaliseEnum(row.proposedCategory || row.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general'),
      proposedIntent: normaliseEnum(row.proposedIntent, INCOMING_MESSAGE_INTENTS, 'unclear'),
      proposedActionability: normaliseEnum(row.proposedActionability, INCOMING_MESSAGE_ACTIONABILITY, 'uncertain'),
      classificationIntent: normaliseEnum(row.classificationIntent, INCOMING_MESSAGE_INTENTS, 'unclear'),
      classificationActionability: normaliseEnum(row.classificationActionability, INCOMING_MESSAGE_ACTIONABILITY, 'uncertain'),
      classificationConfidence: normaliseEnum(row.classificationConfidence, ['high', 'medium', 'low'], 'low'),
      classificationDecision: normaliseEnum(row.classificationDecision, ['unreviewed', 'accepted', 'corrected', 'legacy'], 'legacy'),
    }))
    .sort((a, b) => {
      const aMs = new Date(a.capturedAt || a.messageAt || '').getTime();
      const bMs = new Date(b.capturedAt || b.messageAt || '').getTime();
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    });
}

export function labelIncomingCategory(value = '') {
  const labels = {
    one_off_absence: 'One-off absence',
    extended_absence: 'Extended absence',
    summer_break: 'Summer break',
    absence_pause: 'Absence / pause',
    leaving: 'Leaving',
    payment: 'Payment',
    schedule: 'Schedule',
    concern: 'Concern',
    general: 'General',
  };
  return labels[normaliseEnum(value, INCOMING_MESSAGE_CATEGORIES, 'general')];
}

export function labelIncomingIntent(value = '') {
  return {
    request: 'Request',
    question: 'Question',
    notification: 'Information',
    acknowledgement: 'Acknowledgement',
    social: 'Social message',
    unclear: 'Unclear',
  }[normaliseEnum(value, INCOMING_MESSAGE_INTENTS, 'unclear')];
}

export function labelIncomingActionability(value = '') {
  return {
    action_needed: 'Action needed',
    reply_needed: 'Reply needed',
    uncertain: 'Check this',
    no_action: 'No action needed',
  }[normaliseEnum(value, INCOMING_MESSAGE_ACTIONABILITY, 'uncertain')];
}

export function labelIncomingStatus(value = '') {
  const labels = {
    inbox: 'Inbox',
    converted: 'Archived',
    ignored: 'Ignored',
    needs_review: 'Needs review',
  };
  return labels[normaliseEnum(value, INCOMING_MESSAGE_STATUSES, 'inbox')];
}

const CATEGORY_PLANNING_AREA = {
  one_off_absence: 'workflow',
  extended_absence: 'workflow',
  summer_break: 'workflow',
  absence_pause: 'workflow',
  leaving: 'finance',
  payment: 'finance',
  schedule: 'workflow',
  concern: 'parent',
  general: 'parent',
};

// Suggested WhatsApp reply for a reviewed message. This is a copy-paste draft
// the human edits and sends manually — the inbox never auto-sends (see the
// bridge boundary doc). Absence replies are deliberately short, relaxed
// acknowledgements. The reviewed planning card owns the precise names and
// dates; the copy-paste reply does not repeat details it could misstate.
export function buildIncomingReplyTemplate({
  category = '',
  senderName = '',
  parentName = '',
  studentName = '',
} = {}) {
  const parentFirst = firstName(senderName || parentName, 'there');
  const studentFirst = firstName(studentName, 'your child');
  const cat = normaliseEnum(category, INCOMING_MESSAGE_CATEGORIES, 'general');

  switch (cat) {
    case 'one_off_absence':
      return 'No worries at all, that’s noted. We’ll get that date paused 🙂';
    case 'extended_absence':
    case 'absence_pause':
    case 'summer_break':
      return 'No worries at all, that’s noted. We’ll get those dates paused 🙂';
    case 'leaving':
      return `Hi ${parentFirst}, thanks for letting us know. We’re really sorry to see ${studentFirst} go, it’s been a joy having them with us.\n\nWe’ll sort the final lesson and tidy up the payment side from our end, then confirm once it’s all done. The door’s always open if ${studentFirst} ever fancies coming back.`;
    case 'payment':
      return `Hi ${parentFirst}! Thanks for flagging this, no worries at all.\n\nWe’ll take a proper look at the payment side and come back to you shortly to get it sorted.`;
    case 'schedule':
      return `Hi ${parentFirst}! Thanks for letting us know.\n\nWe’ll have a look at ${studentFirst}’s slot and see what we can do, then come back to you with the options.`;
    case 'concern':
      return `Hi ${parentFirst}, thanks for taking the time to raise this. We really appreciate it and we want to get things just right for ${studentFirst}.\n\nWe’ll take a proper look and come back to you soon.`;
    default:
      return `Hi ${parentFirst}! Thanks for your message, we’ve got it and we’ll come back to you shortly.`;
  }
}

export const INCOMING_REPLY_TEMPLATE_MAX_LENGTH = 1_200;

// An authenticated admin may edit the deterministic reply before converting
// the inbox row. Keep the reviewed wording with the linked plan, but bound it
// so a malformed client cannot turn Planning notes into an unbounded text sink.
export function resolveReviewedIncomingReply(reviewedReply = null, fallbackReply = '') {
  const supplied = reviewedReply !== null && reviewedReply !== undefined;
  const reply = `${supplied ? reviewedReply : fallbackReply || ''}`.trim();
  if (!reply) throw new Error('Reply message is required');
  if (reply.length > INCOMING_REPLY_TEMPLATE_MAX_LENGTH) {
    throw new Error(`Reply message must be ${INCOMING_REPLY_TEMPLATE_MAX_LENGTH} characters or fewer`);
  }
  return reply;
}

// WhatsApp's universal share link opens the app (or WhatsApp Web on desktop)
// with the reviewed text prefilled. It deliberately carries no recipient:
// private group JIDs are not supported by click-to-chat, so the human still
// chooses the correct conversation and taps Send.
export function buildWhatsappShareUrl(message = '') {
  const text = `${message || ''}`.trim();
  return text ? `https://wa.me/?text=${encodeURIComponent(text)}` : 'https://wa.me/';
}

// Categories whose extracted dates can become a structured pause plan.
const RANGE_PAUSE_CATEGORIES = new Set(['extended_absence', 'summer_break', 'absence_pause']);

// Extraction for an incoming message, resolved against when the message was
// sent (falling back to capture time) so "next Friday" means the parent's
// next Friday, not the reviewer's.
export function extractIncomingMessageDates(record = {}) {
  const reference = new Date(record.messageAt || record.capturedAt || Date.now());
  return extractDatesFromMessage(record.messageText || '', {
    referenceDate: Number.isNaN(reference.getTime()) ? new Date() : reference,
  });
}

function normalisePlanningDateOverride(value, label) {
  const date = `${value || ''}`.trim();
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}

// The parser supplies the preview defaults; an admin may then confirm, replace,
// or clear either date before the Planning item is written. The override flag
// keeps the resulting notes honest about which evidence the write used.
export function applyIncomingPlanningDateOverrides(extraction = {}, overrides = {}) {
  const hasStartOverride = Object.hasOwn(overrides, 'startDate') && overrides.startDate !== null;
  const hasReturnOverride = Object.hasOwn(overrides, 'returnDate') && overrides.returnDate !== null;
  if (!hasStartOverride && !hasReturnOverride) return extraction;

  const startDate = hasStartOverride
    ? normalisePlanningDateOverride(overrides.startDate, 'First date')
    : `${extraction.startDate || ''}`.trim();
  const returnDate = hasReturnOverride
    ? normalisePlanningDateOverride(overrides.returnDate, 'Return date')
    : `${extraction.returnDate || ''}`.trim();
  const dates = [...new Set([startDate, returnDate].filter(Boolean))];

  return {
    ...extraction,
    startDate,
    returnDate,
    dates,
    durationWeeks: 0,
    matches: dates,
    reviewedOverride: true,
  };
}

// Maps a reviewed incoming message into Planning_Item fields. The suggested
// reply travels in the notes so context stays with the plan.
//
// When the message carries usable dates and a matched student, absence
// categories become a *structured pause plan* — the same note format
// buildStructuredPausePlanningDraft writes and the pause forecast / finance
// outlook already parse — so the message joins the pause loop with no
// re-typing. Otherwise it falls back to the generic action item.
export function buildIncomingPlanningDraft({ record = {}, student = {}, replyTemplate = '', extraction = null, now = new Date() } = {}) {
  const category = normaliseEnum(record.suspectedCategory, INCOMING_MESSAGE_CATEGORIES, 'general');
  const label = labelIncomingCategory(category);
  const studentName = record.matchedStudentName || student.fullName || '';
  const who = studentName || record.senderName || 'Incoming message';
  const senderLine = [record.senderName, record.senderPhone].filter(Boolean).join(' · ');
  const dates = extraction || extractIncomingMessageDates(record);

  const datesLine = dates.dates.length || dates.durationWeeks
    ? `Dates spotted in message: ${[
      dates.startDate ? `from ${dates.startDate}` : '',
      dates.returnDate ? `back ${dates.returnDate}` : '',
      dates.durationWeeks ? `${dates.durationWeeks} week(s)` : '',
      !dates.startDate && !dates.returnDate ? dates.dates.join(', ') : '',
    ].filter(Boolean).join(' · ')}`
    : '';

  const contextLines = [
    `From WhatsApp incoming inbox (${record.source || 'manual'}).`,
    senderLine ? `Sender: ${senderLine}` : '',
    record.chatName ? `Chat: ${record.chatName}` : '',
    record.messageAt ? `Message time: ${record.messageAt}` : '',
    `Message: ${record.messageText || ''}`,
    record.reviewNote ? `Reviewer note: ${record.reviewNote}` : '',
    replyTemplate ? `\nSuggested reply (send manually in WhatsApp):\n${replyTemplate}` : '',
  ].filter((part) => part !== '');

  if (record.matchedMmsId && studentName) {
    const wantsRange = RANGE_PAUSE_CATEGORIES.has(category) && dates.startDate && dates.returnDate;
    const wantsSingle = category === 'one_off_absence' && dates.startDate;
    if (wantsRange || wantsSingle) {
      const pauseDraft = buildStructuredPausePlanningDraft({
        studentName,
        pauseType: wantsRange ? 'range' : 'single',
        lessonDate: wantsRange ? '' : dates.startDate,
        firstPauseDate: wantsRange ? dates.startDate : '',
        returnDate: wantsRange ? dates.returnDate : '',
        now,
      });
      if (pauseDraft.isComplete) {
        const dateEvidence = dates.reviewedOverride
          ? `Dates confirmed in the inbox plan preview: ${dates.matches.join(', ')}.`
          : `Dates read from the message: ${dates.matches.join(', ')} — check them against the parent's wording.`;
        return {
          title: pauseDraft.title,
          notes: [pauseDraft.notes, dateEvidence, '', ...contextLines].join('\n'),
          itemType: 'action',
          owner: 'Unassigned',
          status: 'active',
          area: 'admin',
          linkedStudentIds: [record.matchedMmsId],
          nextAction: pauseDraft.nextAction,
          targetDate: pauseDraft.targetDate,
        };
      }
    }
  }

  return {
    title: `${label}: ${who}`,
    notes: [datesLine, ...contextLines].filter(Boolean).join('\n'),
    itemType: 'action',
    owner: 'Unassigned',
    status: 'inbox',
    area: CATEGORY_PLANNING_AREA[category] || 'parent',
    linkedStudentIds: record.matchedMmsId ? [record.matchedMmsId] : [],
    nextAction: `Reply to ${firstName(record.senderName || student.parentFirstName, 'the parent')} and action the ${label.toLowerCase()}.`,
    targetDate: '',
  };
}

// A parent firing off three messages in a row is one thing to deal with, not
// three. The bridge posts one row per WhatsApp message and that stays the
// canonical record — the burst is reassembled here, for display and for
// applying one outcome to the whole run.
export const INCOMING_BURST_WINDOW_MS = 5 * 60 * 1000;

function burstTimeMs(entry = {}) {
  const ms = new Date(clean(entry.messageAt) || clean(entry.capturedAt) || '').getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

// Same conversation and same person. A shared sibling group can carry messages
// about different children, so a differing student match splits the burst
// rather than merging two children's business into one card.
function burstIdentity(entry = {}) {
  const chat = clean(entry.chatId) || phoneComparable(entry.senderPhone) || normaliseText(entry.chatName);
  const sender = phoneComparable(entry.senderPhone) || normaliseText(entry.senderName);
  if (!chat || !sender) return '';
  return `${chat}::${sender}::${clean(entry.matchedMmsId)}`;
}

const BURST_LEAD_RANK = {
  action_needed: 3,
  reply_needed: 2,
  uncertain: 1,
  no_action: 0,
};

// The message the burst is actually about: "Hi Finn" / "Amy can't make
// Thursday" / "thanks!" should be planned and replied to from the middle one.
function selectBurstLead(entries = []) {
  return entries.reduce((best, entry) => {
    if (!best) return entry;
    const score = (candidate) => [
      isIncomingPlaceholderText(candidate.messageText) ? 0 : 1,
      BURST_LEAD_RANK[candidate.classificationActionability] ?? 1,
      collapse(candidate.messageText).length,
    ];
    const [bestPlaceholder, bestRank, bestLength] = score(best);
    const [entryPlaceholder, entryRank, entryLength] = score(entry);
    if (entryPlaceholder !== bestPlaceholder) return entryPlaceholder > bestPlaceholder ? entry : best;
    if (entryRank !== bestRank) return entryRank > bestRank ? entry : best;
    if (entryLength !== bestLength) return entryLength > bestLength ? entry : best;
    return best;
  }, null);
}

// Takes the already-filtered, newest-first list the view is about to render and
// merges consecutive runs from one sender. Only adjacent entries merge, so a
// burst interrupted by someone else's message stays two cards, and the list
// keeps its existing order. Entries inside a burst come back oldest-first —
// that is the order they were written in.
export function clusterIncomingMessages(entries = [], { windowMs = INCOMING_BURST_WINDOW_MS } = {}) {
  const clusters = [];

  for (const entry of entries) {
    const identity = burstIdentity(entry);
    const previous = clusters[clusters.length - 1];
    const previousEntry = previous?.entries[0];
    const gap = previous && identity
      ? Math.abs(burstTimeMs(previousEntry) - burstTimeMs(entry))
      : NaN;

    if (previous && identity && previous.identity === identity && Number.isFinite(gap) && gap <= windowMs) {
      // The incoming list is newest-first, so each later arrival is older.
      previous.entries.unshift(entry);
      continue;
    }

    clusters.push({ identity, entries: [entry] });
  }

  return clusters.map(({ entries: burst }) => {
    const lead = selectBurstLead(burst) || burst[0];
    return {
      clusterId: burst.map((entry) => entry.incomingId).join('+'),
      lead,
      entries: burst,
    };
  });
}
