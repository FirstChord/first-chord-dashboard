/** @fileoverview Pure first-lesson follow-up progress, evidence matching, readiness, and next-action rules. */

export const FIRST_LESSON_LOOP_PROGRESS_TYPE = 'workflow_step';
export const FIRST_LESSON_LOOP_MARKER = 'First lesson loop v1:';
export const FIRST_LESSON_CHECKIN_PREFIX = 'planning_first_lesson_checkin_';
export const FIRST_LESSON_LOOP_STEPS = Object.freeze([
  'payment_decision',
  'cancellation_handled',
  'whatsapp_groups',
  'student_access',
]);

const PAYMENT_DECISIONS = new Set(['pending', 'continue_weekly', 'stop']);
const BOOLEAN_STEPS = new Set(['cancellation_handled', 'whatsapp_groups', 'student_access']);

function clean(value) {
  return `${value || ''}`.trim();
}

function londonDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isFirstLessonCheckinPlanningItem(item = {}) {
  return clean(item.planningId).startsWith(FIRST_LESSON_CHECKIN_PREFIX);
}

export function parseFirstLessonLoopMetadata(item = {}) {
  const notes = clean(item.notes);
  const lesson = notes.match(/\bFirst lesson:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\./u);
  const tutor = notes.match(/\bTutor:\s*([^.]*)\./u);
  return {
    studentMmsId: clean(item.linkedStudentId),
    lessonDate: lesson?.[1] || '',
    lessonTime: lesson?.[2] || '',
    tutorName: clean(tutor?.[1]),
  };
}

export function normaliseFirstLessonLoopStep(step, value) {
  const normalisedStep = clean(step);
  if (!FIRST_LESSON_LOOP_STEPS.includes(normalisedStep)) {
    throw new Error('Unknown first-lesson follow-up step');
  }
  const normalisedValue = clean(value).toLowerCase();
  if (normalisedStep === 'payment_decision') {
    if (!PAYMENT_DECISIONS.has(normalisedValue)) {
      throw new Error('Choose whether weekly lessons are continuing or stopping');
    }
    return { step: normalisedStep, value: normalisedValue };
  }
  if (!BOOLEAN_STEPS.has(normalisedStep) || !['true', 'false'].includes(normalisedValue)) {
    throw new Error('First-lesson confirmation must be true or false');
  }
  return { step: normalisedStep, value: normalisedValue };
}

export function buildFirstLessonLoopProgressNote(step, value) {
  const normalised = normaliseFirstLessonLoopStep(step, value);
  return `${FIRST_LESSON_LOOP_MARKER} ${normalised.step}=${normalised.value}`;
}

export function parseFirstLessonLoopProgressNote(progressNote = '') {
  const escaped = FIRST_LESSON_LOOP_MARKER.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = clean(progressNote).match(new RegExp(`^${escaped}\\s+([a-z_]+)=([a-z_]+)$`, 'u'));
  if (!match) return null;
  try {
    return normaliseFirstLessonLoopStep(match[1], match[2]);
  } catch {
    return null;
  }
}

export function deriveFirstLessonLoopProgress(progressRows = []) {
  const result = {
    paymentDecision: 'pending',
    cancellationHandled: false,
    whatsappGroups: false,
    studentAccess: false,
  };
  const seen = new Set();
  const rows = [...progressRows].sort((a, b) => (
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  ));
  for (const row of rows) {
    const parsed = parseFirstLessonLoopProgressNote(row.progressNote);
    if (!parsed || seen.has(parsed.step)) continue;
    seen.add(parsed.step);
    if (parsed.step === 'payment_decision') result.paymentDecision = parsed.value;
    if (parsed.step === 'cancellation_handled') result.cancellationHandled = parsed.value === 'true';
    if (parsed.step === 'whatsapp_groups') result.whatsappGroups = parsed.value === 'true';
    if (parsed.step === 'student_access') result.studentAccess = parsed.value === 'true';
  }
  return result;
}

export function matchFirstLessonObservation({ metadata = {}, observations = [], source = {} } = {}) {
  if (!source.verified) {
    return {
      state: 'unavailable',
      sourceState: clean(source.state) || 'unknown',
      lastVerifiedAt: clean(source.lastVerifiedAt),
      rawAttendanceStatus: '',
      sourceStatus: '',
    };
  }
  if (!metadata.lessonDate || !metadata.studentMmsId) {
    return { state: 'missing_plan', sourceState: 'fresh', lastVerifiedAt: clean(source.lastVerifiedAt), rawAttendanceStatus: '', sourceStatus: '' };
  }
  const targetTime = clean(metadata.lessonTime).slice(0, 5);
  const matches = observations.filter((observation) => (
    clean(observation.studentExternalId) === metadata.studentMmsId
    && clean(observation.localDate) === metadata.lessonDate
    && (!targetTime || clean(observation.localTime).slice(0, 5) === targetTime)
  ));
  if (!matches.length) {
    return { state: 'not_observed', sourceState: 'fresh', lastVerifiedAt: clean(source.lastVerifiedAt), rawAttendanceStatus: '', sourceStatus: '' };
  }
  if (matches.length > 1) {
    return { state: 'ambiguous', sourceState: 'fresh', lastVerifiedAt: clean(source.lastVerifiedAt), rawAttendanceStatus: '', sourceStatus: '' };
  }
  const match = matches[0];
  return {
    state: 'observed',
    sourceState: 'fresh',
    lastVerifiedAt: clean(source.lastVerifiedAt),
    rawAttendanceStatus: clean(match.rawAttendanceStatus),
    sourceStatus: clean(match.sourceStatus),
    localDate: clean(match.localDate),
    localTime: clean(match.localTime).slice(0, 5),
  };
}

export function isStudentAccessWorkflowComplete(row = {}) {
  return clean(row.workflowStatus) === 'completed'
    && row.protectionEnabled === true
    && Boolean(clean(row.messageSentAt) || clean(row.activatedAt));
}

export function isFirstLessonLoopDue(item = {}, { now = new Date() } = {}) {
  const today = londonDate(now);
  return Boolean(item.targetDate && today && clean(item.targetDate) <= today);
}

export function buildFirstLessonLoopContext({
  item = {},
  student = null,
  portalAccess = null,
  lessonEvidence = null,
  now = new Date(),
} = {}) {
  const metadata = parseFirstLessonLoopMetadata(item);
  const progress = deriveFirstLessonLoopProgress(item.progress || []);
  const paymentMode = clean(student?.paymentMode).toLowerCase() || 'unknown';
  const stripeCustomerRecorded = Boolean(clean(student?.stripeCustomerId));
  const stripeSubscriptionRecorded = Boolean(clean(student?.stripeSubscriptionId));
  const portalWorkflowComplete = isStudentAccessWorkflowComplete(portalAccess || {});
  const accessComplete = progress.studentAccess || portalWorkflowComplete;
  const isDue = isFirstLessonLoopDue(item, { now });
  const paymentComplete = progress.paymentDecision === 'continue_weekly'
    ? paymentMode === 'manual' || stripeSubscriptionRecorded
    : progress.paymentDecision === 'stop' && progress.cancellationHandled;
  const blockers = [];
  if (!isDue) blockers.push('Wait until the follow-up date');
  if (progress.paymentDecision === 'pending') blockers.push('Record the continue-or-stop decision');
  if (progress.paymentDecision === 'continue_weekly' && paymentMode !== 'manual' && !stripeSubscriptionRecorded) {
    blockers.push('Record the Stripe subscription before confirming continuation');
  }
  if (progress.paymentDecision === 'stop' && !progress.cancellationHandled) {
    blockers.push('Confirm the Stripe cancellation or that no subscription started');
  }
  if (!progress.whatsappGroups) blockers.push('Confirm both WhatsApp groups');
  if (!accessComplete) blockers.push('Confirm student access');

  return {
    version: 'first_lesson_loop_v1',
    metadata,
    isDue,
    progress,
    lessonEvidence: lessonEvidence || { state: 'unavailable', sourceState: 'unknown' },
    payment: {
      mode: paymentMode,
      customerRecorded: stripeCustomerRecorded,
      subscriptionRecorded: stripeSubscriptionRecorded,
    },
    studentAccess: {
      complete: accessComplete,
      source: portalWorkflowComplete ? 'portal_workflow' : progress.studentAccess ? 'human_confirmation' : 'none',
      workflowStatus: clean(portalAccess?.workflowStatus) || 'not_started',
      protectionEnabled: portalAccess?.protectionEnabled === true,
      messageSentAt: clean(portalAccess?.messageSentAt),
    },
    blockers,
    canClose: isDue && paymentComplete && progress.whatsappGroups && accessComplete,
    nextAction: blockers[0] || 'Close the first-lesson follow-up',
  };
}
