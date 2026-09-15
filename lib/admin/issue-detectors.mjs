/** @fileoverview Derives payment and pause issue records from student, registry, and lifecycle context. */
import { buildPaymentIssueRecord, classifyIssue } from './issues-helpers.mjs';
import { buildIssueId } from './issue-queue-helpers.mjs';
import { deriveStudentLifecycleStatus } from './lifecycle-helpers.mjs';
import { derivePauseExpectationDecision } from './pause-auto-sync-helpers.mjs';
import { derivePaymentValueContext } from './payment-value-helpers.mjs';
import { isTestStudentRecord } from './test-student-helpers.mjs';

function withRegistryContext(student, registryByMmsId) {
  const registryEntry = student.registryEntry
    || student.registry
    || registryByMmsId.get(student.mmsId)
    || null;
  const registryTutor = student.registryTutor || registryEntry?.tutor || '';
  const hasLifecycle = Boolean(student.lifecycleStatus);
  const lifecycle = hasLifecycle ? {} : deriveStudentLifecycleStatus({
    ...student,
    registry: registryEntry,
    registryEntry,
    hasRegistryEntry: Boolean(registryEntry),
  });
  return {
    ...student,
    registry: registryEntry,
    registryEntry,
    registryTutor,
    ...lifecycle,
  };
}

function eligibleStripeStudents(students, registryByMmsId) {
  return students
    .filter((student) => student.mmsId)
    .map((student) => withRegistryContext(student, registryByMmsId))
    .filter((student) => !isTestStudentRecord(student))
    .filter((student) => student.paymentMode === 'stripe');
}

export function buildPaymentIssues(students = [], registryByMmsId = new Map()) {
  return eligibleStripeStudents(students, registryByMmsId).flatMap((student) => {
    if (student.paymentExpectation === 'setup_pending') {
      return student.stripeCustomerId && student.stripeSubscriptionId
        ? [buildPaymentIssueRecord({ type: 'SETUP PENDING STRIPE LINKED', student })]
        : [];
    }

    if (!student.stripeCustomerId && !student.stripeSubscriptionId) {
      return [buildPaymentIssueRecord({ type: 'STRIPE SETUP INCOMPLETE', student })];
    }
    if (!student.stripeCustomerId && student.stripeSubscriptionId) {
      return [buildPaymentIssueRecord({ type: 'STRIPE CUSTOMER MISSING', student })];
    }
    if (student.stripeCustomerId && !student.stripeSubscriptionId) {
      return [buildPaymentIssueRecord({ type: 'STRIPE SUBSCRIPTION MISSING', student })];
    }
    return [];
  });
}

export function buildPauseIssues(students = [], registryByMmsId = new Map()) {
  return eligibleStripeStudents(students, registryByMmsId).flatMap((student) => {
    const pauseSummary = student.pauseSummary || null;
    const pauseDecision = student.pauseExpectationDecision || derivePauseExpectationDecision(student);
    if (!pauseSummary?.hasPauseHistory || pauseSummary.matchConfidence === 'low') return [];

    if (pauseSummary.currentlyPaused && student.paymentExpectation !== 'stripe_paused_expected') {
      if (!pauseDecision.shouldCreateIssue && pauseDecision.expectedPaymentExpectation === 'stripe_paused_expected') {
        return [];
      }
      return [buildPaymentIssueRecord({ type: 'PAUSE EXPECTATION MISMATCH', student })];
    }

    if (pauseSummary.upcomingPause) return [];

    if (!pauseSummary.currentlyPaused && student.paymentExpectation === 'stripe_paused_expected') {
      if (pauseDecision.allowsActiveBillingBeforeNextLesson || !pauseDecision.shouldCreateIssue) return [];
      return [buildPaymentIssueRecord({ type: 'PAUSE EXPECTATION STALE', student })];
    }

    return [];
  });
}

export const LESSON_DURATION_ISSUE_TYPE = 'LESSON DURATION MISMATCH';
export const LESSON_DURATION_ISSUE_SOURCE = 'lesson_duration';

// Emitted verbatim by buildScheduleContext in schedule-context-helpers.mjs and
// cached as a string in the Schedule_Context tab. Matched rather than recomputed
// so the wording stays owned by the place that decides it.
const BILLING_PROFILE_DURATION_WARNING =
  'Billing profile lesson duration does not match the next calendar event duration.';

function durationMinutes(value) {
  const parsed = Number.parseInt(`${value ?? ''}`.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// What this student would be worth if the given duration were the truth. The
// price table is never copied here: swapping the duration and re-deriving keeps
// payment-value-helpers.mjs the single home for prices, so a price change can
// never leave this detector quoting stale money.
function weeklyValueForDuration(student, minutes) {
  return derivePaymentValueContext({
    ...student,
    lessonLength: String(minutes),
    scheduleContext: { ...(student.scheduleContext || {}), durationMinutes: String(minutes) },
  });
}

// Lesson duration is the one MMS fact that silently sets money: it picks the
// weekly price band for the forecast, and the minutes tutors are paid for.
// Three systems hold it — the MMS calendar (what is booked), the MMS billing
// profile (what MMS would invoice), and the Students sheet — and until now
// nothing compared them. The pricing path prefers the calendar and falls back to
// the sheet, so a disagreement misprices a student rather than failing, which is
// exactly the kind of gap that survives for months.
//
// One card per student, keyed on the student alone: the two disagreements have
// different fixes but the same question — which duration is right?
export function buildLessonDurationIssues(students = [], registryByMmsId = new Map()) {
  return students
    .filter((student) => student.mmsId)
    .map((student) => withRegistryContext(student, registryByMmsId))
    .filter((student) => !isTestStudentRecord(student))
    // Same roster the finance estimate prices. A student who has left cannot be
    // mispriced, and their stale duration is history, not a task.
    .filter((student) => `${student.lifecycleStatus || ''}`.trim() === 'active')
    .flatMap((student) => {
      const scheduleContext = student.scheduleContext || null;
      // With no cached MMS lesson there is nothing to disagree with. The missing
      // cache is its own finance-coverage concern, not a duration mismatch.
      if (scheduleContext?.status !== 'found') return [];

      const mmsMinutes = durationMinutes(scheduleContext.durationMinutes);
      const sheetMinutes = durationMinutes(student.lessonLength);
      const sheetDisagrees = Boolean(mmsMinutes && sheetMinutes && mmsMinutes !== sheetMinutes);
      const billingProfileDisagrees = (scheduleContext.warnings || [])
        .includes(BILLING_PROFILE_DURATION_WARNING);

      if (!sheetDisagrees && !billingProfileDisagrees) return [];

      const details = [];
      let pricedApart = false;

      if (sheetDisagrees) {
        const onMms = weeklyValueForDuration(student, mmsMinutes);
        const onSheet = weeklyValueForDuration(student, sheetMinutes);
        pricedApart = onMms.baselineWeeklyValue !== onSheet.baselineWeeklyValue;
        details.push(
          `The MMS calendar books ${mmsMinutes} minutes; the Students sheet says ${sheetMinutes}.`,
        );
        details.push(pricedApart
          // The forecast prefers the cached MMS duration, so the MMS figure is
          // the one currently in the estimate — name it as such rather than
          // presenting two equal candidates.
          ? `The forecast prices from MMS at ${onMms.baselineWeeklyLabel || '—'} a week; on the sheet duration it would be ${onSheet.baselineWeeklyLabel || '—'}.`
          : 'Both durations price the same, so the forecast is unaffected.');
      }

      if (billingProfileDisagrees) {
        details.push('The MMS billing profile duration does not match the booked calendar lesson, so MMS itself would invoice the wrong length.');
      }

      const type = LESSON_DURATION_ISSUE_TYPE;
      const source = LESSON_DURATION_ISSUE_SOURCE;
      const contextKey = student.mmsId;
      const issueId = buildIssueId({ source, issueType: type, mmsId: student.mmsId, contextKey });
      const classification = classifyIssue(type);

      return [{
        id: issueId,
        issueId,
        source,
        contextKey,
        type,
        mmsId: student.mmsId,
        studentName: student.fullName || student.mmsId,
        detail: details.join(' '),
        generatedDate: '',
        severity: classification.severity,
        systemsAffected: classification.systemsAffected,
        summary: classification.summary,
        recommendedAction: classification.recommendedAction,
        actionLabel: classification.actionLabel,
        messageable: classification.messageable,
        hasSheetRow: true,
        hasRegistryEntry: Boolean(student.registryEntry),
        sheetTutor: student.tutor || '',
        registryTutor: student.registryTutor || '',
        instrument: student.instrument || '',
        email: student.email || '',
        lessonDuration: {
          mmsMinutes,
          sheetMinutes,
          sheetDisagrees,
          billingProfileDisagrees,
          pricedApart,
        },
        active: true,
        adminStudentPath: `/admin/students/${student.mmsId}`,
      }];
    });
}
