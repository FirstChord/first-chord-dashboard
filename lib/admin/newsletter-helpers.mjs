/** @fileoverview Pure newsletter rules: issue/item row building, derived item and consent state, and the readiness answer to "what is still missing". */
// No I/O, directly or through an import — the `-helpers.mjs` suffix promises
// this module can be unit-tested without stubbing a provider.
//
// The central decision here: there is no status column. Every state is derived
// from a fact that is either present or absent, which is why a stale write can
// never leave an item claiming something that is not true. Same reasoning as
// teaching-relationship-helpers.mjs.
import { ADMIN_TUTORS } from './tutors-data.js';
import { resolveTutorName } from './tutor-identity.mjs';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FC_STUDENT_ID_PATTERN = /^fc_std_[a-f0-9]{8}$/u;
const FC_TUTOR_ID_PATTERN = /^fc_tut_[a-f0-9]{8}$/u;

export const TUTOR_TEXT_MAX_LENGTH = 2000;
export const QUESTION_MAX_LENGTH = 300;
export const INTRO_MAX_LENGTH = 4000;

export const CONSENT_ANSWERS = ['no', 'yes_once', 'yes_ongoing'];
export const EDITORIAL_VALUES = ['selected', 'not_selected'];
export const TUTOR_RESPONSES = ['nothing_this_month'];

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function normaliseEnum(value, allowed) {
  const candidate = clean(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : '';
}

export function normaliseIssueMonth(value = '') {
  const candidate = clean(value);
  return MONTH_PATTERN.test(candidate) ? candidate : '';
}

export function normaliseDate(value = '') {
  const candidate = clean(value);
  if (!DATE_PATTERN.test(candidate)) return '';
  // Reject a well-shaped but impossible date (2026-02-31) rather than letting
  // Date roll it over into March and silently move a deadline.
  const [year, month, day] = candidate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isReal = parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
  return isReal ? candidate : '';
}

// "2026-09" -> "September 2026". Used in copy, so it must not depend on the
// server's locale or timezone.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatIssueMonthLabel(issueMonth = '') {
  const month = normaliseIssueMonth(issueMonth);
  if (!month) return '';
  const [year, monthNumber] = month.split('-');
  return `${MONTH_NAMES[Number(monthNumber) - 1]} ${year}`;
}

// "2026-09-30" -> "30 September". Year omitted deliberately: a deadline inside
// the issue's own month does not need one, and it reads better in a message.
export function formatDeadlineLabel(deadline = '') {
  const date = normaliseDate(deadline);
  if (!date) return '';
  const [, monthNumber, day] = date.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(monthNumber) - 1]}`;
}

export function currentIssueMonth(currentDate = new Date()) {
  const date = currentDate instanceof Date ? currentDate : new Date(currentDate);
  if (Number.isNaN(date.getTime())) return '';
  // London-anchored, so a late-evening BST session does not open next month's
  // issue. Newsletter months are wall-clock facts about the school.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  return normaliseIssueMonth(`${year}-${month}`);
}

// --- identity ---------------------------------------------------------------

// Resolving a composed dashboard student onto the identity the newsletter stores.
//
// `fcStudentId` on a composed student is already resolved sheet-then-registry by
// buildStudentContextCollection, and a stored value is authoritative: it is never
// recomputed here, and generateFcStudentId is deliberately not imported — an
// invariant pinned by tests/admin/newsletter-identity-boundary.test.mjs.
//
// Lives in the pure layer, not the orchestrator, so it can actually be run in a
// test: importing the orchestrator drags the whole Sheets path in behind it.
export function resolveNewsletterIdentity(student = {}, roster = ADMIN_TUTORS) {
  const fcStudentId = clean(student.fcStudentId);
  if (!fcStudentId) {
    return { error: 'fc_identity_unresolved' };
  }

  // The same composition grades a sheet/registry fcStudentId disagreement
  // `high`. Refuse rather than pick a winner: attributing a child's story to the
  // wrong identity is worse than making Fenella resolve the mismatch first.
  const hasIdentityConflict = (student.provenance?.conflicts || []).some(
    (conflict) => conflict.field === 'fcStudentId',
  );
  if (hasIdentityConflict) {
    return { error: 'fc_identity_conflict' };
  }

  const tutorShortName = resolveTutorName(student.tutor || student.registryTutor || '', roster);
  const tutor = roster[tutorShortName] || null;

  return {
    fcStudentId,
    studentName: clean(student.fullName),
    mmsId: clean(student.mmsId),
    // An unrecognised tutor name leaves the FC tutor id blank rather than
    // guessing. The contribution still belongs to a real student.
    fcTutorId: tutor?.fcTutorId || '',
    tutorName: tutorShortName || '',
    parentFirstName: clean(student.parentFirstName),
    firstName: clean(student.firstName),
  };
}

// A newsletter item is identified by the issue month and the student's *stored*
// FC id. Deterministic on purpose: assigning the same priority twice is a no-op
// upsert, and a first capture lands on the request row rather than beside it.
//
// An additional contribution for a student who already has a row carries a
// client-generated ticket, so a resubmitted save updates one row instead of
// creating a second copy of the same story.
export function buildNewsletterItemId({ issueMonth = '', fcStudentId = '', captureTicket = '' } = {}) {
  const month = normaliseIssueMonth(issueMonth);
  const fcId = clean(fcStudentId);
  if (!month || !FC_STUDENT_ID_PATTERN.test(fcId)) return '';
  const suffix = clean(captureTicket).toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 8);
  return suffix ? `nli_${month}_${fcId}_${suffix}` : `nli_${month}_${fcId}`;
}

// --- issue -----------------------------------------------------------------

export function buildNewsletterIssueRow({
  issueMonth = '',
  question = '',
  deadline = '',
  intro = '',
  existingRow = null,
  actorEmail = '',
  now = new Date(),
} = {}) {
  const month = normaliseIssueMonth(issueMonth);
  if (!month) return { error: 'invalid_issue_month' };

  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const rawDeadline = clean(deadline);
  if (rawDeadline && !normaliseDate(rawDeadline)) {
    return { error: 'invalid_deadline' };
  }

  return {
    row: {
      issueMonth: month,
      question: clean(question).slice(0, QUESTION_MAX_LENGTH),
      deadline: normaliseDate(rawDeadline),
      intro: clean(intro).slice(0, INTRO_MAX_LENGTH),
      // Opened-at/by belong to the first write and never move, so a later edit
      // cannot rewrite who started the issue.
      openedAt: clean(existingRow?.openedAt) || timestamp,
      openedBy: clean(existingRow?.openedBy) || clean(actorEmail),
      updatedAt: timestamp,
    },
  };
}

// --- item ------------------------------------------------------------------

export function buildNewsletterItemRow({
  issueMonth = '',
  fcStudentId = '',
  studentName = '',
  mmsId = '',
  fcTutorId = '',
  tutorName = '',
  captureTicket = '',
  requested = false,
  tutorText = '',
  tutorResponse = '',
  hasMedia = false,
  existingRow = null,
  actorEmail = '',
  now = new Date(),
} = {}) {
  const month = normaliseIssueMonth(issueMonth);
  if (!month) return { error: 'invalid_issue_month' };

  const fcId = clean(fcStudentId);
  // The whole point of this workflow is that a contribution is attached to a
  // real First Chord student. A name is not an identity, so an unresolved id is
  // refused rather than stored alongside one.
  if (!FC_STUDENT_ID_PATTERN.test(fcId)) return { error: 'fc_identity_unresolved' };

  const fcTutor = clean(fcTutorId);
  if (fcTutor && !FC_TUTOR_ID_PATTERN.test(fcTutor)) return { error: 'fc_tutor_unresolved' };

  const response = normaliseEnum(tutorResponse, TUTOR_RESPONSES);
  if (clean(tutorResponse) && !response) return { error: 'invalid_tutor_response' };

  const text = clean(tutorText).slice(0, TUTOR_TEXT_MAX_LENGTH);
  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const itemId = clean(existingRow?.itemId)
    || buildNewsletterItemId({ issueMonth: month, fcStudentId: fcId, captureTicket });
  if (!itemId) return { error: 'invalid_item_id' };

  // `capturedAt` means material arrived. A "nothing this month" reply is a
  // closure, not a contribution, so it deliberately does not set it — otherwise
  // every decline would inflate the "arrived" count and read as a story.
  const resolvedText = text || (response ? '' : clean(existingRow?.tutorText));
  // Material supersedes an earlier decline: a tutor who said "nothing" and then
  // remembered something should not stay recorded as having declined.
  const resolvedResponse = text
    ? ''
    : (response || normaliseEnum(existingRow?.tutorResponse, TUTOR_RESPONSES));
  const alreadyCaptured = Boolean(clean(existingRow?.capturedAt));
  const hasMaterial = Boolean(resolvedText);

  return {
    row: {
      itemId,
      issueMonth: month,
      fcStudentId: fcId,
      // Names and the MMS id are provenance and human readability only — the
      // same three-column shape WhatsApp_Group_Map uses. Identity is fc_*.
      studentName: clean(studentName) || clean(existingRow?.studentName),
      fcTutorId: fcTutor || clean(existingRow?.fcTutorId),
      tutorName: clean(tutorName) || clean(existingRow?.tutorName),
      mmsId: clean(mmsId) || clean(existingRow?.mmsId),

      // Requested is sticky: clearing a priority is a separate deliberate act
      // (clearPriority below), never a side effect of a capture.
      requestedAt: clean(existingRow?.requestedAt) || (requested ? timestamp : ''),
      requestedBy: clean(existingRow?.requestedBy) || (requested ? clean(actorEmail) : ''),

      capturedAt: hasMaterial
        ? (alreadyCaptured ? existingRow.capturedAt : timestamp)
        : '',
      capturedBy: hasMaterial
        ? (alreadyCaptured ? (existingRow.capturedBy || '') : clean(actorEmail))
        : '',
      tutorText: resolvedText,
      tutorResponse: resolvedResponse,

      hasMedia: hasMedia ? 'true' : (isTruthy(existingRow?.hasMedia) ? 'true' : ''),
      consentAskedAt: clean(existingRow?.consentAskedAt),
      consentAnswer: normaliseEnum(existingRow?.consentAnswer, CONSENT_ANSWERS),
      consentRecordedAt: clean(existingRow?.consentRecordedAt),

      editorial: normaliseEnum(existingRow?.editorial, EDITORIAL_VALUES),
      updatedAt: timestamp,
    },
  };
}

export function isTruthy(value) {
  return clean(value).toLowerCase() === 'true';
}

// --- derived state ---------------------------------------------------------

export function deriveItemState(item = {}) {
  const editorial = normaliseEnum(item.editorial, EDITORIAL_VALUES);
  const captured = Boolean(clean(item.capturedAt));
  const response = normaliseEnum(item.tutorResponse, TUTOR_RESPONSES);

  // Contradictory: judged, but there is nothing to have judged. Surfaced rather
  // than resolved in either direction — the repo's rule is that conflicting
  // evidence produces "needs review", not a winner.
  if (editorial && !captured) return 'needs_review';
  if (editorial) return editorial;
  if (captured) return 'captured';
  if (response) return 'declined';
  if (clean(item.requestedAt)) return 'requested';
  // A row with no request, no material and no reply should not exist. Say so
  // rather than picking a state that would hide it from every count.
  return 'needs_review';
}

// Recording the answer Fenella got back. Separate from capture because it is a
// different fact, recorded at a different moment, by a different action.
export function buildConsentUpdate({
  existingRow = null,
  asked = false,
  answer = '',
  now = new Date(),
} = {}) {
  if (!existingRow?.itemId) return { error: 'item_not_found' };

  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const normalisedAnswer = normaliseEnum(answer, CONSENT_ANSWERS);
  if (clean(answer) && !normalisedAnswer) return { error: 'invalid_consent_answer' };
  if (!asked && !normalisedAnswer) return { error: 'nothing_to_record' };

  return {
    row: {
      ...existingRow,
      // The first ask keeps its date; re-copying the message is not a new ask.
      consentAskedAt: clean(existingRow.consentAskedAt) || (asked || normalisedAnswer ? timestamp : ''),
      consentAnswer: normalisedAnswer || normaliseEnum(existingRow.consentAnswer, CONSENT_ANSWERS),
      consentRecordedAt: normalisedAnswer ? timestamp : clean(existingRow.consentRecordedAt),
      updatedAt: timestamp,
    },
  };
}

// Fenella's editorial judgement. Refuses a picture whose permission is not
// recorded — the one real guard in this workflow.
export function buildEditorialUpdate({
  existingRow = null,
  editorial = '',
  standingConsent = null,
  now = new Date(),
} = {}) {
  if (!existingRow?.itemId) return { error: 'item_not_found' };

  const raw = clean(editorial);
  const normalised = normaliseEnum(raw, EDITORIAL_VALUES);
  // An empty value is a deliberate un-decide, which is always allowed.
  if (raw && !normalised) return { error: 'invalid_editorial_value' };

  if (normalised === 'selected') {
    const gate = canSelectItem(existingRow, { standingConsent });
    if (!gate.ok) return { error: gate.reason };
  }

  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    row: { ...existingRow, editorial: normalised, updatedAt: timestamp },
  };
}

// Removing a priority never deletes the row: if something already arrived, it
// stays as an unsolicited contribution. Clearing the request is the only way a
// requested_at is ever unset.
export function buildClearPriorityUpdate({ existingRow = null, now = new Date() } = {}) {
  if (!existingRow?.itemId) return { error: 'item_not_found' };
  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    row: { ...existingRow, requestedAt: '', requestedBy: '', updatedAt: timestamp },
  };
}

// True when a priority row can be removed outright rather than demoted: nothing
// has arrived, nobody has replied, and no permission conversation has started.
export function isEmptyRequestRow(item = {}) {
  return Boolean(clean(item.requestedAt))
    && !clean(item.capturedAt)
    && !clean(item.tutorText)
    && !normaliseEnum(item.tutorResponse, TUTOR_RESPONSES)
    && !clean(item.consentAskedAt)
    && !normaliseEnum(item.consentAnswer, CONSENT_ANSWERS)
    && !normaliseEnum(item.editorial, EDITORIAL_VALUES);
}

export function isExtraContribution(item = {}) {
  return Boolean(clean(item.capturedAt)) && !clean(item.requestedAt);
}

export function isOutstandingRequest(item = {}) {
  return Boolean(clean(item.requestedAt))
    && !clean(item.capturedAt)
    && !normaliseEnum(item.tutorResponse, TUTOR_RESPONSES);
}

// Standing newsletter consent is derived from real recorded answers, never
// stored twice. It is deliberately newsletter-scoped: a parent who agreed to
// "future newsletters" agreed to future newsletters, not to social media.
export function buildStandingConsentIndex(items = []) {
  const standing = new Map();
  for (const item of items) {
    if (normaliseEnum(item.consentAnswer, CONSENT_ANSWERS) !== 'yes_ongoing') continue;
    const fcId = clean(item.fcStudentId);
    if (!fcId) continue;
    const recordedAt = clean(item.consentRecordedAt) || clean(item.updatedAt);
    const existing = standing.get(fcId);
    // Keep the earliest recorded yes — that is when the permission was given.
    if (!existing || (recordedAt && recordedAt < existing.recordedAt)) {
      standing.set(fcId, { recordedAt, issueMonth: clean(item.issueMonth) });
    }
  }
  return standing;
}

// How many times this family has been asked and declined, so Fenella can decide
// whether to ask again. The software never turns this into a standing refusal.
export function countPriorDeclines(items = [], fcStudentId = '') {
  const fcId = clean(fcStudentId);
  if (!fcId) return 0;
  return items.filter((item) => (
    clean(item.fcStudentId) === fcId
    && normaliseEnum(item.consentAnswer, CONSENT_ANSWERS) === 'no'
  )).length;
}

export function deriveItemConsent(item = {}, { standingConsent = null } = {}) {
  if (!isTruthy(item.hasMedia)) {
    return { required: false, status: 'not_required', standing: null };
  }

  const answer = normaliseEnum(item.consentAnswer, CONSENT_ANSWERS);
  if (answer === 'no') {
    return { required: true, status: 'blocked', standing: null };
  }
  if (answer === 'yes_once' || answer === 'yes_ongoing') {
    return { required: true, status: 'cleared', standing: answer === 'yes_ongoing' ? standingConsent : null };
  }
  if (standingConsent) {
    return { required: true, status: 'cleared', standing: standingConsent };
  }
  if (clean(item.consentAskedAt)) {
    return { required: true, status: 'waiting', standing: null };
  }
  return { required: true, status: 'needed', standing: null };
}

// The guard. An item with a picture cannot be selected for the newsletter until
// permission is recorded. Enforced server-side, not only in the UI.
export function canSelectItem(item = {}, { standingConsent = null } = {}) {
  const consent = deriveItemConsent(item, { standingConsent });
  if (!consent.required) return { ok: true };
  if (consent.status === 'cleared') return { ok: true };
  return { ok: false, reason: `consent_${consent.status}` };
}

// --- issue summary and readiness ------------------------------------------

export function summariseIssue(items = [], { issue = null, currentDate = new Date() } = {}) {
  const month = normaliseIssueMonth(issue?.issueMonth);
  const scoped = items.filter((item) => !month || clean(item.issueMonth) === month);
  const standing = buildStandingConsentIndex(items);

  const decorated = scoped.map((item) => {
    const standingConsent = standing.get(clean(item.fcStudentId)) || null;
    return {
      ...item,
      state: deriveItemState(item),
      isExtra: isExtraContribution(item),
      isOutstanding: isOutstandingRequest(item),
      consent: deriveItemConsent(item, { standingConsent }),
      priorDeclines: countPriorDeclines(items, item.fcStudentId),
    };
  });

  const counts = {
    asked: decorated.filter((item) => clean(item.requestedAt)).length,
    arrived: decorated.filter((item) => clean(item.capturedAt)).length,
    outstanding: decorated.filter((item) => item.isOutstanding).length,
    extra: decorated.filter((item) => item.isExtra).length,
    declined: decorated.filter((item) => item.state === 'declined').length,
    selected: decorated.filter((item) => item.state === 'selected').length,
    needsReview: decorated.filter((item) => item.state === 'needs_review').length,
    consentNeeded: decorated.filter((item) => item.consent.status === 'needed').length,
    consentWaiting: decorated.filter((item) => item.consent.status === 'waiting').length,
    consentBlocked: decorated.filter((item) => item.consent.status === 'blocked').length,
  };

  return {
    items: decorated,
    counts,
    blockers: buildIssueReadiness(decorated, { issue, counts, currentDate }),
  };
}

// The answer to "what is still preventing this issue from being ready for
// editorial review", derived rather than remembered. An empty list means ready.
export function buildIssueReadiness(decoratedItems = [], { issue = null, counts = null, currentDate = new Date() } = {}) {
  const totals = counts || { arrived: 0, outstanding: 0, needsReview: 0, consentNeeded: 0, consentWaiting: 0 };
  const blockers = [];

  if (!totals.arrived) {
    blockers.push({ code: 'nothing_arrived', detail: 'Nothing has arrived yet.' });
  }

  if (totals.outstanding) {
    const names = decoratedItems
      .filter((item) => item.isOutstanding)
      .map((item) => clean(item.studentName))
      .filter(Boolean);
    blockers.push({
      code: 'outstanding_requests',
      detail: names.length
        ? `Nothing yet from ${formatNameList(names)}.`
        : `${totals.outstanding} priority student${totals.outstanding === 1 ? '' : 's'} still to hear from.`,
      names,
    });
  }

  if (totals.consentNeeded) {
    blockers.push({
      code: 'consent_needed',
      detail: `${totals.consentNeeded} picture${totals.consentNeeded === 1 ? '' : 's'} still need permission asking for.`,
    });
  }

  if (totals.consentWaiting) {
    blockers.push({
      code: 'consent_waiting',
      detail: `${totals.consentWaiting} permission request${totals.consentWaiting === 1 ? '' : 's'} awaiting a reply.`,
    });
  }

  if (totals.needsReview) {
    blockers.push({
      code: 'needs_review',
      detail: `${totals.needsReview} item${totals.needsReview === 1 ? '' : 's'} marked but with nothing recorded.`,
    });
  }

  const deadlineNote = describeDeadline(issue?.deadline, currentDate);
  if (deadlineNote && totals.outstanding) {
    blockers.push({ code: 'deadline', detail: deadlineNote });
  }

  return blockers;
}

export function describeDeadline(deadline = '', currentDate = new Date()) {
  const date = normaliseDate(deadline);
  if (!date) return '';
  const now = currentDate instanceof Date ? currentDate : new Date(currentDate);
  if (Number.isNaN(now.getTime())) return '';

  // Compare whole London days, so "today" does not flip on a timezone offset.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );

  if (days < 0) return `Deadline passed ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`;
  if (days === 0) return 'Deadline is today.';
  return `Deadline in ${days} day${days === 1 ? '' : 's'}.`;
}

export function formatNameList(names = []) {
  const list = names.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Group this issue's priority students by tutor, so Fenella gets one block of
// text per tutor rather than one message she has to edit by hand per person.
export function groupPrioritiesByTutor(items = [], { issueMonth = '' } = {}) {
  const month = normaliseIssueMonth(issueMonth);
  const byTutor = new Map();

  for (const item of items) {
    if (month && clean(item.issueMonth) !== month) continue;
    if (!clean(item.requestedAt)) continue;
    const tutorName = clean(item.tutorName) || 'Unassigned';
    const entry = byTutor.get(tutorName) || { tutorName, fcTutorId: clean(item.fcTutorId), students: [] };
    entry.students.push({
      fcStudentId: clean(item.fcStudentId),
      studentName: clean(item.studentName),
      outstanding: isOutstandingRequest(item),
    });
    byTutor.set(tutorName, entry);
  }

  return [...byTutor.values()]
    .map((entry) => ({
      ...entry,
      students: [...entry.students].sort((a, b) => a.studentName.localeCompare(b.studentName)),
    }))
    .sort((a, b) => a.tutorName.localeCompare(b.tutorName));
}
