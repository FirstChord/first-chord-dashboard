/** @fileoverview Pure classification of Stripe subscription, pause, and invoice state into a snapshot and its live payment issues. */
function isFailureInvoiceStatus(status) {
  return ['past_due', 'uncollectible'].includes((status || '').trim().toLowerCase());
}

const HARD_DECLINE_CODES = new Set([
  'incorrect_number',
  'lost_card',
  'pickup_card',
  'stolen_card',
  'revocation_of_authorization',
  'revocation_of_all_authorizations',
  'authentication_required',
  'highest_risk_level',
  'transaction_not_allowed',
]);

const RETRY_SETTLING_GRACE_MS = 24 * 60 * 60 * 1000;

function stripeTimestampToIso(value) {
  const seconds = Number(value || 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
}

export function classifyStripePaymentRecovery(snapshot = {}, now = new Date()) {
  if (!snapshot.hasPaymentProblem) return 'none';

  const subscriptionStatus = `${snapshot.subscriptionStatus || ''}`.trim().toLowerCase();
  const paymentIntentStatus = `${snapshot.latestPaymentIntentStatus || ''}`.trim().toLowerCase();
  const declineCode = `${snapshot.latestDeclineCode || ''}`.trim().toLowerCase();
  const attemptCount = Number(snapshot.latestInvoiceAttemptCount || 0);
  const nextAttemptAt = Date.parse(snapshot.nextPaymentAttemptAt || '');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  if (
    ['unpaid', 'canceled', 'incomplete_expired'].includes(subscriptionStatus)
    || paymentIntentStatus === 'requires_action'
    || HARD_DECLINE_CODES.has(declineCode)
  ) {
    return 'action';
  }

  // A first recoverable failure is Stripe's job while a retry is genuinely
  // scheduled. The small settling window avoids promoting a stale snapshot at
  // the exact retry boundary. A second failed attempt deserves human attention.
  if (
    attemptCount <= 1
    && Number.isFinite(nextAttemptAt)
    && Number.isFinite(nowMs)
    && nextAttemptAt > nowMs - RETRY_SETTLING_GRACE_MS
  ) {
    return 'waiting';
  }

  return 'action';
}

function isVoidInvoiceWithBalance(invoice, latestInvoiceStatus) {
  if (latestInvoiceStatus !== 'void') {
    return false;
  }

  const amountRemaining = Number(invoice?.amount_remaining ?? invoice?.amount_due ?? 0);
  return amountRemaining > 0 && invoice?.paid === false;
}

export function deriveStripePauseState(subscription) {
  if (!subscription) {
    return 'not_found';
  }

  if (subscription.pause_collection) {
    return 'paused';
  }

  const hasZeroQuantityItem = Array.isArray(subscription.items?.data)
    && subscription.items.data.some((item) => Number(item?.quantity || 0) === 0);

  if (hasZeroQuantityItem) {
    return 'paused';
  }

  return 'active';
}

export function deriveStripeInvoiceSummary(invoice) {
  if (!invoice) {
    return {
      latestInvoiceId: '',
      latestInvoiceStatus: '',
      latestInvoicePaid: null,
      latestInvoiceAttemptCount: 0,
      nextPaymentAttemptAt: '',
      latestDeclineCode: '',
      latestPaymentIntentStatus: '',
      lastFailureAt: '',
      hasPaymentProblem: false,
    };
  }

  const latestInvoiceStatus = `${invoice.status || ''}`.trim().toLowerCase();
  const latestPaymentIntentStatus = `${invoice.payment_intent?.status || ''}`.trim().toLowerCase();
  const latestDeclineCode = `${invoice.payment_intent?.last_payment_error?.decline_code || ''}`.trim().toLowerCase();
  const latestInvoiceAttemptCount = Number(invoice.attempt_count || 0);
  const hasVoidInvoiceBalance = isVoidInvoiceWithBalance(invoice, latestInvoiceStatus);
  const hasPaymentProblem = Boolean(
    isFailureInvoiceStatus(latestInvoiceStatus)
      || hasVoidInvoiceBalance
      || ['requires_payment_method', 'canceled'].includes(latestPaymentIntentStatus)
      || (latestInvoiceStatus === 'open' && invoice.paid === false && latestInvoiceAttemptCount > 0)
  );

  return {
    latestInvoiceId: invoice.id || '',
    latestInvoiceStatus,
    latestInvoicePaid: typeof invoice.paid === 'boolean' ? invoice.paid : null,
    latestInvoiceAttemptCount,
    nextPaymentAttemptAt: stripeTimestampToIso(invoice.next_payment_attempt),
    latestDeclineCode,
    latestInvoiceAmountDue: Number(invoice.amount_due || 0),
    latestInvoiceAmountRemaining: Number(invoice.amount_remaining ?? invoice.amount_due ?? 0),
    latestInvoiceBillingReason: invoice.billing_reason || '',
    latestInvoiceVoidWithBalance: hasVoidInvoiceBalance,
    latestPaymentIntentStatus,
    lastFailureAt: hasPaymentProblem
      ? new Date((invoice.status_transitions?.voided_at || invoice.status_transitions?.finalized_at || invoice.created || 0) * 1000).toISOString()
      : '',
    hasPaymentProblem,
  };
}

export function buildStripeSnapshot({ customer = null, subscription = null, invoice = null } = {}) {
  const customerFound = Boolean(customer?.id);
  const subscriptionFound = Boolean(subscription?.id);
  const pauseState = deriveStripePauseState(subscription);
  const subscriptionStatus = `${subscription?.status || ''}`.trim().toLowerCase();
  const invoiceSummary = deriveStripeInvoiceSummary(invoice);

  const activelyBilling = Boolean(
    subscriptionFound
      && pauseState !== 'paused'
      && ['active', 'trialing', 'past_due', 'unpaid'].includes(subscriptionStatus),
  );

  return {
    customerFound,
    subscriptionFound,
    resolvedCustomerId: customer?.id || '',
    resolvedSubscriptionId: subscription?.id || '',
    subscriptionStatus,
    trialEndsAt: Number.isFinite(subscription?.trial_end) && subscription.trial_end > 0
      ? new Date(subscription.trial_end * 1000).toISOString()
      : '',
    pauseState,
    activelyBilling,
    scheduleId: subscription?.schedule || '',
    ...invoiceSummary,
    lastCheckedAt: new Date().toISOString(),
  };
}

export function buildLiveStripeIssues({ student, snapshot }) {
  if (!student || student.paymentMode !== 'stripe' || !snapshot) {
    return [];
  }

  const expectation = student.paymentExpectation || '';
  const issues = [];

  if (expectation === 'setup_pending') {
    return issues;
  }

  if (expectation === 'stripe_active_expected' && !snapshot.subscriptionFound) {
    issues.push('ACTIVE_WITHOUT_SUBSCRIPTION');
  }

  if (expectation === 'stripe_active_expected' && ['canceled', 'incomplete_expired'].includes(snapshot.subscriptionStatus)) {
    issues.push('SUBSCRIPTION_CANCELLED_UNEXPECTEDLY');
  }

  if (expectation === 'stripe_active_expected' && snapshot.pauseState === 'paused') {
    issues.push('SUBSCRIPTION_STATE_MISMATCH');
  }

  if (
    expectation === 'stripe_paused_expected'
    && snapshot.activelyBilling
    && !student.pauseExpectationDecision?.allowsActiveBillingBeforeNextLesson
  ) {
    issues.push('SUBSCRIPTION_STATE_MISMATCH');
  }

  if (expectation === 'inactive_or_stopped' && snapshot.activelyBilling) {
    issues.push('INACTIVE_STILL_BILLING');
  }

  const voidPastDueNeedsReview = Boolean(
    snapshot.latestInvoiceVoidWithBalance
      && ['past_due', 'unpaid'].includes(snapshot.subscriptionStatus),
  );

  if (snapshot.hasPaymentProblem && (expectation !== 'stripe_paused_expected' || voidPastDueNeedsReview)) {
    issues.push(classifyStripePaymentRecovery(snapshot) === 'waiting' ? 'PAYMENT_RETRYING' : 'PAYMENT_FAILED');
  }

  return [...new Set(issues)];
}
