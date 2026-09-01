/** @fileoverview Pure, framework-free helpers behind the admin issues surface: classification, filtering, quick actions, and plain-language copy. */
// Pure, framework-free helpers for the admin issues surface: issue classification,
// filtering, plain-language story/what-to-do copy, hints, labels, and Stripe-snapshot
// summarising. Extracted from AdminIssuesPageClient.js so they can be unit-tested
// (they hold the bug-prone classification logic) and the component stays a thin view.
// No React, no hooks — same inputs always produce the same output.

import { formatDateTime } from './health-helpers.mjs';

export const ISSUE_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'TUTOR CONFLICT', label: 'Tutor conflict' },
  { value: 'SHEETS ONLY', label: 'Sheets only' },
  { value: 'REGISTRY ONLY', label: 'Registry only' },
  { value: 'PAYMENT SETUP PENDING', label: 'Payment setup pending' },
  { value: 'SETUP PENDING STRIPE LINKED', label: 'Setup pending but linked' },
  { value: 'STRIPE SETUP INCOMPLETE', label: 'Stripe setup incomplete' },
  { value: 'STRIPE CUSTOMER MISSING', label: 'Stripe customer missing' },
  { value: 'STRIPE SUBSCRIPTION MISSING', label: 'Stripe subscription missing' },
  { value: 'ACTIVE_WITHOUT_SUBSCRIPTION', label: 'Active without subscription' },
  { value: 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY', label: 'Subscription cancelled unexpectedly' },
  { value: 'SUBSCRIPTION_STATE_MISMATCH', label: 'Subscription state mismatch' },
  { value: 'PAUSE EXPECTATION MISMATCH', label: 'Pause record alignment' },
  { value: 'PAUSE EXPECTATION STALE', label: 'Pause expectation stale' },
  { value: 'INACTIVE_STILL_BILLING', label: 'Inactive still billing' },
  { value: 'PAYMENT_FAILED', label: 'Payment failed' },
  { value: 'PAYMENT_RETRYING', label: 'Payment retry scheduled' },
];

export const ISSUE_VIEW_OPTIONS = [
  { value: 'all', label: 'All active', hint: 'Everything in the current queue.' },
  { value: 'payment_risk', label: 'Payment risk', hint: 'Failed payments and live Stripe/billing mismatches.' },
  { value: 'pause', label: 'Pause checks', hint: 'Pause History, Stripe state, and expectation alignment.' },
  { value: 'setup', label: 'Setup/linking', hint: 'Students not fully connected to Stripe yet.' },
  { value: 'records', label: 'Registry & Sheets', hint: 'Record mismatches between systems.' },
  { value: 'cleared', label: 'Ready to clear', hint: 'No longer detected by the latest source check.' },
];

export function freshnessClasses(status) {
  if (status === 'Fresh') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'Aging') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'Stale') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'Current') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'Manual') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (status === 'Cleared') return 'border-slate-200 bg-slate-100 text-slate-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function isSetupIssue(issue) {
  return [
    'PAYMENT SETUP PENDING',
    'SETUP PENDING STRIPE LINKED',
    'STRIPE SETUP INCOMPLETE',
    'STRIPE CUSTOMER MISSING',
    'STRIPE SUBSCRIPTION MISSING',
  ].includes(issue.type);
}

export function isRecordIssue(issue) {
  return [
    'TUTOR CONFLICT',
    'SHEETS ONLY',
    'REGISTRY ONLY',
  ].includes(issue.type);
}

const DATA_HEALTH_TYPES = new Set([
  'SHEETS ONLY',
  'REGISTRY ONLY',
  'PAYMENT SETUP PENDING',
  'SETUP PENDING STRIPE LINKED',
  'STRIPE SETUP INCOMPLETE',
  'STRIPE CUSTOMER MISSING',
  'STRIPE SUBSCRIPTION MISSING',
  'FINANCE DATA GAP',
]);

export function getIssueWorkBucket(issue) {
  if (!['open', 'acknowledged'].includes(issue.status) || !issue.sourcePresent) return 'history';
  if (issue.type === 'PAYMENT_RETRYING') return 'waiting';
  if (DATA_HEALTH_TYPES.has(issue.type)) return 'data_health';
  return 'needs_you';
}

export function buildPaymentQuickActionAuditNote(issue, action) {
  const issueLabel = issue.type ? ` for ${issue.type}` : '';
  const summary = issue.summary ? ` ${issue.summary}` : '';
  return `${action.label}${issueLabel}.${summary}`.trim();
}

export function paymentQuickActionResolvesIssue(issue, action) {
  const nextExpectation = action.payload?.paymentExpectation || '';
  if (!nextExpectation) {
    return false;
  }

  if (issue.type === 'PAUSE EXPECTATION MISMATCH') {
    return nextExpectation === 'stripe_paused_expected';
  }

  if (issue.type === 'PAUSE EXPECTATION STALE') {
    return ['stripe_active_expected', 'inactive_or_stopped'].includes(nextExpectation);
  }

  if (issue.type === 'SUBSCRIPTION_STATE_MISMATCH') {
    return (
      (issue.paymentExpectation === 'stripe_paused_expected' && nextExpectation === 'stripe_active_expected') ||
      (issue.paymentExpectation === 'stripe_active_expected' && nextExpectation === 'stripe_paused_expected')
    );
  }

  return false;
}

export function getDetectiveResolution(issue, primaryPaymentAction = null) {
  if (!issue || !['open', 'acknowledged'].includes(issue.status)) {
    return null;
  }

  if (!issue.sourcePresent) {
    return {
      kind: 'resolve_source_absent',
      buttonLabel: 'Yes, close the case',
      proposal: 'The source check no longer detects this issue. Mark the case resolved; it will reappear if a later check finds the problem again.',
    };
  }

  if (primaryPaymentAction && paymentQuickActionResolvesIssue(issue, primaryPaymentAction)) {
    return {
      kind: 'payment_quick_action',
      buttonLabel: 'Yes, solve it',
      proposal: `Use the existing reviewed action “${primaryPaymentAction.label}”. The payment record will be checked for changes before the update is accepted.`,
      action: primaryPaymentAction,
    };
  }

  return null;
}

export function isPaymentIssue(issue) {
  return [
    'PAYMENT SETUP PENDING',
    'SETUP PENDING STRIPE LINKED',
    'STRIPE SETUP INCOMPLETE',
    'STRIPE CUSTOMER MISSING',
    'STRIPE SUBSCRIPTION MISSING',
    'ACTIVE_WITHOUT_SUBSCRIPTION',
    'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY',
    'SUBSCRIPTION_STATE_MISMATCH',
    'INACTIVE_STILL_BILLING',
    'PAYMENT_FAILED',
    'PAYMENT_RETRYING',
    'PAUSE EXPECTATION MISMATCH',
    'PAUSE EXPECTATION STALE',
  ].includes(issue.type);
}

export function issueMatchesView(issue, view) {
  if (view === 'payment_risk') {
    return needsLiveStripeReview(issue);
  }
  if (view === 'pause') {
    return isPauseIssue(issue);
  }
  if (view === 'setup') {
    return isSetupIssue(issue);
  }
  if (view === 'records') {
    return isRecordIssue(issue);
  }
  if (view === 'cleared') {
    return ['open', 'acknowledged'].includes(issue.status) && !issue.sourcePresent;
  }
  return true;
}

export function needsLiveStripeReview(issue) {
  return [
    'ACTIVE_WITHOUT_SUBSCRIPTION',
    'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY',
    'SUBSCRIPTION_STATE_MISMATCH',
    'INACTIVE_STILL_BILLING',
    'PAYMENT_FAILED',
    'PAUSE EXPECTATION MISMATCH',
    'PAUSE EXPECTATION STALE',
  ].includes(issue.type);
}

export function isPauseIssue(issue) {
  return [
    'SUBSCRIPTION_STATE_MISMATCH',
    'PAUSE EXPECTATION MISMATCH',
    'PAUSE EXPECTATION STALE',
  ].includes(issue.type);
}

export function shouldRefreshStripeFirst(issue) {
  return [
    'ACTIVE_WITHOUT_SUBSCRIPTION',
    'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY',
    'SUBSCRIPTION_STATE_MISMATCH',
    'INACTIVE_STILL_BILLING',
    'PAYMENT_FAILED',
  ].includes(issue.type);
}

// Which one-click payment-expectation corrections each issue type offers. The
// payloads PATCH the student record; label wording is free to change.
export function getPaymentQuickActions(issue) {
  if (issue.paymentMode !== 'stripe' && !['PAYMENT SETUP PENDING', 'SETUP PENDING STRIPE LINKED'].includes(issue.type)) {
    return [];
  }

  if (['PAYMENT SETUP PENDING', 'SETUP PENDING STRIPE LINKED'].includes(issue.type)) {
    return [
      { label: 'Expect payments active', payload: { paymentMode: 'stripe', paymentExpectation: 'stripe_active_expected' } },
      { label: 'Mark manual payer', payload: { paymentMode: 'manual', paymentExpectation: '' } },
    ];
  }

  if (['STRIPE SETUP INCOMPLETE', 'STRIPE CUSTOMER MISSING', 'STRIPE SUBSCRIPTION MISSING'].includes(issue.type)) {
    return [
      { label: 'Set setup pending', payload: { paymentExpectation: 'setup_pending' } },
      { label: 'Mark manual payer', payload: { paymentMode: 'manual', paymentExpectation: '' } },
    ];
  }

  if (issue.type === 'SUBSCRIPTION_STATE_MISMATCH') {
    return [
      { label: 'Set Stripe paused expected', payload: { paymentExpectation: 'stripe_paused_expected' } },
      { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } },
      { label: 'Set inactive / stopped', payload: { paymentExpectation: 'inactive_or_stopped' } },
    ];
  }

  if (issue.type === 'PAUSE EXPECTATION MISMATCH') {
    return [
      { label: 'Confirm pause — expect payments paused', payload: { paymentExpectation: 'stripe_paused_expected' } },
      { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } },
    ];
  }

  if (issue.type === 'PAUSE EXPECTATION STALE') {
    return [
      { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } },
      { label: 'Set inactive / stopped', payload: { paymentExpectation: 'inactive_or_stopped' } },
    ];
  }

  if (issue.type === 'INACTIVE_STILL_BILLING') {
    return [
      { label: 'Set Stripe paused expected', payload: { paymentExpectation: 'stripe_paused_expected' } },
      { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } },
    ];
  }

  if (['ACTIVE_WITHOUT_SUBSCRIPTION', 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY', 'PAYMENT_FAILED'].includes(issue.type)) {
    return [
      { label: 'Set setup pending', payload: { paymentExpectation: 'setup_pending' } },
      { label: 'Mark manual payer', payload: { paymentMode: 'manual', paymentExpectation: '' } },
    ];
  }

  return [];
}

// Match on the payload, not the label text, so button copy can change freely
// without silently breaking which action is primary.
export function getPrimaryPaymentQuickAction(issue, actions = []) {
  if (issue.type === 'PAUSE EXPECTATION MISMATCH') {
    return actions.find((action) => action.payload?.paymentExpectation === 'stripe_paused_expected') || null;
  }

  if (issue.type === 'PAUSE EXPECTATION STALE') {
    return actions.find((action) => action.payload?.paymentExpectation === 'stripe_active_expected') || null;
  }

  return null;
}

export function getIssueKeyFact(issue) {
  if (issue.pauseCoverageContext?.summary && isPauseIssue(issue)) {
    return issue.pauseCoverageContext.summary;
  }

  if (issue.pauseSummary?.latestPause) {
    return `Pause window: ${issue.pauseSummary.latestPause.startDate || '—'} to ${issue.pauseSummary.latestPause.endDate || '—'}`;
  }

  if (issue.type === 'PAYMENT_FAILED' && issue.detail) {
    return issue.detail;
  }

  if (issue.lastSeenAt) {
    return `Last seen: ${formatDateTime(issue.lastSeenAt)}`;
  }

  return '';
}

export function getRecommendedActionText(issue) {
  if (!issue.sourcePresent) {
    return 'If this matches the current record, mark it resolved. Keep it active only if you want to monitor it manually.';
  }

  if (issue.identityMismatchHint) {
    return `${issue.recommendedAction} Check the possible same-name match before creating or deleting records.`;
  }

  return issue.recommendedAction;
}

export function getPaymentActionHint(issue) {
  if (issue.type === 'PAYMENT SETUP PENDING') {
    return 'Usually not a broken billing case yet. Finish setup or deliberately move the student into a different payment mode/expectation.';
  }

  if (issue.type === 'SETUP PENDING STRIPE LINKED') {
    return 'This is probably stale setup state rather than missing Stripe setup. Confirm the student should be live, then mark Stripe active expected.';
  }

  if (['STRIPE SETUP INCOMPLETE', 'STRIPE CUSTOMER MISSING', 'STRIPE SUBSCRIPTION MISSING'].includes(issue.type)) {
    return 'Usually a linkage/setup problem rather than a live billing failure. Check whether setup is still pending before treating it as broken Stripe.';
  }

  if (issue.type === 'PAYMENT_FAILED') {
    return 'This usually needs live Stripe review rather than only a sheet-field correction.';
  }

  if (issue.type === 'SUBSCRIPTION_STATE_MISMATCH') {
    return 'This usually means either the expectation is wrong or Stripe pause/billing state is wrong. Compare both before changing anything else.';
  }

  if (issue.type === 'INACTIVE_STILL_BILLING') {
    return 'The student state and billing state disagree. Keep this active until live Stripe no longer shows billing.';
  }

  if (issue.type === 'ACTIVE_WITHOUT_SUBSCRIPTION' || issue.type === 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY') {
    return 'Treat this as a real live billing problem first, then use sheet-field changes only if the expectation itself is wrong.';
  }

  return '';
}

export function shouldShowLifecycleContext(issue) {
  return Boolean(issue.lifecycleLabel) && (
    isPaymentIssue(issue)
    || ['SHEETS ONLY', 'REGISTRY ONLY'].includes(issue.type)
  );
}

export function getLifecycleContextText(issue) {
  const firstWarning = issue.lifecycleWarnings?.[0] || '';
  const firstReason = issue.lifecycleReasons?.[0] || '';
  const explanation = firstWarning || firstReason;

  return [
    `Lifecycle: ${issue.lifecycleLabel}`,
    issue.lifecycleConfidence ? `(${issue.lifecycleConfidence} confidence)` : '',
    explanation ? `— ${explanation}` : '',
  ].filter(Boolean).join(' ');
}

export function shouldShowPaymentValueContext(issue) {
  return isPaymentIssue(issue) && Boolean(issue.paymentValueContext?.baselineWeeklyLabel || issue.paymentValueContext?.baselineMonthlyLabel);
}

export function getPaymentValueContextText(issue) {
  const value = issue.paymentValueContext || {};
  const weekly = value.baselineWeeklyLabel ? `${value.baselineWeeklyLabel}/week` : '';
  const monthly = value.baselineMonthlyLabel ? `${value.baselineMonthlyLabel}/month` : '';
  const confidence = value.confidence ? `${value.confidence} confidence` : '';

  return [
    'Baseline value:',
    [weekly, monthly].filter(Boolean).join(' · '),
    confidence ? `(${confidence})` : '',
  ].filter(Boolean).join(' ');
}

export function getPaymentActionPath(issue) {
  if (issue.type === 'PAYMENT SETUP PENDING') {
    return [
      'Confirm this is genuinely still in setup rather than a broken active billing case.',
      'If setup is complete, move the expectation to Stripe active expected.',
      'If this student will not use Stripe, mark them as a manual payer instead.',
    ];
  }

  if (issue.type === 'SETUP PENDING STRIPE LINKED') {
    return [
      'Confirm the recorded Stripe customer and subscription belong to this student.',
      'If they should now be live, move the expectation to Stripe active expected.',
      'If they are not actually live, choose the correct expectation rather than leaving setup pending by habit.',
    ];
  }

  if (['STRIPE SETUP INCOMPLETE', 'STRIPE CUSTOMER MISSING', 'STRIPE SUBSCRIPTION MISSING'].includes(issue.type)) {
    return [
      'Treat this as a linkage/setup issue before assuming Stripe itself is broken.',
      'Use setup pending if the family is not fully live yet.',
      'If they should already be billing, open the student record and confirm the missing Stripe linkage.',
    ];
  }

  if (issue.type === 'PAYMENT_FAILED') {
    return [
      'Run a one-student live Stripe refresh first.',
      'If the failure is still live, keep the issue active and review the parent/payment follow-up path.',
      'Only downgrade this to setup pending if the student is not really live yet.',
    ];
  }

  if (issue.type === 'SUBSCRIPTION_STATE_MISMATCH') {
    return [
      'Check whether Pause History and payment expectation are correct first.',
      'If the school record is right, refresh live Stripe to confirm the remaining mismatch.',
      'Keep the issue active until live Stripe agrees with the expectation.',
    ];
  }

  if (issue.type === 'PAUSE EXPECTATION MISMATCH') {
    return [
      'Confirm Pause History really means this student is paused now.',
      'If the pause is correct, set payment expectation to Stripe paused expected. Stripe scans verify live billing; they do not update this expectation field automatically.',
      'Refresh Stripe if you need to confirm billing has stopped before resolving.',
    ];
  }

  if (issue.type === 'PAUSE EXPECTATION STALE') {
    return [
      'Confirm the latest pause window has actually ended.',
      'If lessons and billing should be active again, set payment expectation to Stripe active expected.',
      'Refresh Stripe if you need to confirm the subscription is no longer paused.',
    ];
  }

  if (issue.type === 'INACTIVE_STILL_BILLING') {
    return [
      'Confirm the student really should be inactive or stopped.',
      'Refresh live Stripe to confirm billing is still active.',
      'Keep this active until the billing state no longer contradicts the student state.',
    ];
  }

  if (issue.type === 'ACTIVE_WITHOUT_SUBSCRIPTION' || issue.type === 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY') {
    return [
      'Treat this as a real live Stripe problem first.',
      'Refresh the student Stripe status to confirm the current live state.',
      'Only change the expectation if the school record itself is wrong.',
    ];
  }

  return [];
}

export function getStudentLabel(issue) {
  return issue.studentName || issue.mmsId || 'This student';
}

// One plain-language sentence describing the issue in human terms — the "story".
export function getIssueStory(issue) {
  const who = getStudentLabel(issue);

  if (!issue.sourcePresent) {
    return `${who} had an issue flagged before, but the latest check no longer sees it.`;
  }

  switch (issue.type) {
    case 'PAYMENT_FAILED':
      return `A payment for ${who} looks like it failed in Stripe.`;
    case 'PAYMENT_RETRYING':
      return `Stripe is retrying a payment for ${who}.`;
    case 'PAUSE EXPECTATION MISMATCH':
      return `${who}'s pause record says they're paused, but the dashboard still has them marked as actively billed.`;
    case 'PAUSE EXPECTATION STALE':
      return `${who}'s pause has ended, but we've still got them marked as paused.`;
    case 'SUBSCRIPTION_STATE_MISMATCH':
      if (issue.paymentExpectation === 'stripe_paused_expected') {
        return `The dashboard has ${who} down as paused, but Stripe is still actively billing them.`;
      }
      if (issue.paymentExpectation === 'stripe_active_expected') {
        return `The dashboard has ${who} down as actively billing, but Stripe has them paused.`;
      }
      return `The dashboard's expectation for ${who} doesn't match what Stripe is actually doing.`;
    case 'INACTIVE_STILL_BILLING':
      return `We've got ${who} down as stopped, but Stripe is still billing them.`;
    case 'ACTIVE_WITHOUT_SUBSCRIPTION':
      return `${who} should be paying through Stripe, but there's no live subscription.`;
    case 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY':
      return `${who}'s Stripe subscription was cancelled, but we still expect them to be active.`;
    case 'SHEETS ONLY':
      return `${who} is in the Sheet but has no dashboard record yet.`;
    case 'REGISTRY ONLY':
      return `${who} has a dashboard record but isn't in the Sheet.`;
    case 'TUTOR CONFLICT':
      return `${who}'s tutor doesn't match between the Sheet and the dashboard.`;
    case 'PAYMENT SETUP PENDING':
      return `${who} isn't fully set up for Stripe payments yet.`;
    case 'SETUP PENDING STRIPE LINKED':
      return `${who} is linked to Stripe but still marked as setup-pending.`;
    case 'STRIPE SETUP INCOMPLETE':
      return `${who}'s Stripe setup looks incomplete.`;
    case 'STRIPE CUSTOMER MISSING':
      return `${who} has no Stripe customer linked yet.`;
    case 'STRIPE SUBSCRIPTION MISSING':
      return `${who} has a Stripe customer but no subscription.`;
    case 'PRACTICE NOTE DELIVERY FAILED':
      return `${who}'s lesson note didn't reach the parent by email — it needs sending by hand.`;
    default:
      return issue.summary || issue.issueReason || 'Something here needs a look.';
  }
}

// Short, plain imperative — the calm "what to do" line shown under the story.
export function getIssueWhatToDo(issue) {
  if (!issue.sourcePresent) {
    return 'If the record looks right now, mark it resolved.';
  }

  switch (issue.type) {
    case 'PAYMENT_FAILED':
      return "Check the latest invoice in Stripe and confirm whether it's resolved.";
    case 'PAYMENT_RETRYING':
      return 'No action yet — Stripe has another attempt scheduled.';
    case 'PAUSE EXPECTATION MISMATCH':
      return 'Confirm the pause is right, then set "paused expected".';
    case 'PAUSE EXPECTATION STALE':
      return 'If the pause has really ended, set "active expected".';
    case 'SUBSCRIPTION_STATE_MISMATCH':
      if (issue.paymentExpectation === 'stripe_paused_expected') {
        return 'If they should be paused, check the pause actually landed in Stripe. If they should be active, set "active expected".';
      }
      if (issue.paymentExpectation === 'stripe_active_expected') {
        return 'If they should be active, unpause them in Stripe. If they should be paused, set "paused expected".';
      }
      return 'Decide which side is right, then set the matching expectation.';
    case 'INACTIVE_STILL_BILLING':
      return 'Keep active until Stripe stops billing, then confirm the state.';
    case 'ACTIVE_WITHOUT_SUBSCRIPTION':
    case 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY':
      return 'Refresh Stripe to see the live state before changing anything.';
    case 'SHEETS ONLY':
      return "Create the dashboard record when you're ready.";
    case 'REGISTRY ONLY':
      return "Check the Sheet — delete the dashboard record if it shouldn't exist.";
    case 'TUTOR CONFLICT':
      return 'Decide which tutor is correct and align the records.';
    case 'PAYMENT SETUP PENDING':
    case 'SETUP PENDING STRIPE LINKED':
    case 'STRIPE SETUP INCOMPLETE':
    case 'STRIPE CUSTOMER MISSING':
    case 'STRIPE SUBSCRIPTION MISSING':
      return 'Finish setup, or set the right payment mode/expectation.';
    default:
      return issue.recommendedAction || '';
  }
}

// Quiet category word shown alongside severity in the card corner.
export function getIssueCategoryLabel(issue) {
  if (isPauseIssue(issue)) return 'Pause';
  if (isPaymentIssue(issue)) return 'Payment';
  if (isSetupIssue(issue)) return 'Setup';
  if (isRecordIssue(issue)) return 'Records';
  return 'Issue';
}

const ISSUE_SHORT_LABELS = {
  'TUTOR CONFLICT': 'Tutor mismatch',
  'SHEETS ONLY': 'Missing dashboard record',
  'REGISTRY ONLY': 'Missing Sheet row',
  'PAYMENT SETUP PENDING': 'Payment setup pending',
  'SETUP PENDING STRIPE LINKED': 'Setup status out of date',
  'STRIPE SETUP INCOMPLETE': 'Stripe setup missing',
  'STRIPE CUSTOMER MISSING': 'Stripe customer missing',
  'STRIPE SUBSCRIPTION MISSING': 'Subscription link missing',
  ACTIVE_WITHOUT_SUBSCRIPTION: 'Active billing missing',
  SUBSCRIPTION_CANCELLED_UNEXPECTEDLY: 'Billing stopped unexpectedly',
  SUBSCRIPTION_STATE_MISMATCH: 'Billing state mismatch',
  'PAUSE EXPECTATION MISMATCH': 'Pause state mismatch',
  'PAUSE EXPECTATION STALE': 'Pause status out of date',
  INACTIVE_STILL_BILLING: 'Billing still active',
  PAYMENT_FAILED: 'Payment needs attention',
  PAYMENT_RETRYING: 'Stripe retry scheduled',
  'PRACTICE NOTE DELIVERY FAILED': 'Practice note not delivered',
  'FINANCE DATA GAP': 'Finance data missing',
};

// Compact deterministic wording for the visible card pill. This is display
// copy only: the issue type remains the stable detector/workflow identifier.
export function getIssueShortLabel(issue) {
  return ISSUE_SHORT_LABELS[`${issue?.type || ''}`.trim().toUpperCase()] || 'Review issue';
}

// Severity becomes a quiet coloured left edge instead of a loud chip.
export function severityEdgeClass(severity) {
  if (severity === 'Needs action') return 'border-l-4 border-l-red-300';
  if (severity === 'Warning') return 'border-l-4 border-l-amber-300';
  return 'border-l-4 border-l-slate-200';
}

export function summariseStripeSnapshot(snapshot, issues = []) {
  if (!snapshot) {
    return '';
  }

  const parts = [];

  if (snapshot.subscriptionFound) {
    parts.push(`Subscription ${snapshot.subscriptionStatus || 'found'}`);
  } else {
    parts.push('No live subscription found');
  }

  if (snapshot.pauseState && snapshot.pauseState !== '—') {
    parts.push(`Pause state: ${snapshot.pauseState}`);
  }

  parts.push(snapshot.activelyBilling ? 'Actively billing' : 'Not actively billing');

  if (snapshot.latestInvoiceStatus && snapshot.latestInvoiceStatus !== '—') {
    parts.push(`Invoice: ${snapshot.latestInvoiceStatus}`);
  }

  if (issues.length) {
    parts.push(`Issues: ${issues.join(', ')}`);
  }

  return parts.join(' • ');
}
