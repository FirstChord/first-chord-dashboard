/** @fileoverview Summarises payment mode and expectation counts across the student roster. */
function isStripeManaged(student) {
  return student.paymentMode === 'stripe';
}

export function assessPaymentSetupCompletion({ student = {}, snapshot = null, issues = [] } = {}) {
  if (student.paymentMode !== 'stripe') {
    return { canCheck: false, ready: false, reason: 'Student is not Stripe-managed.' };
  }

  if (student.paymentExpectation !== 'setup_pending') {
    return { canCheck: false, ready: false, reason: 'Payment setup is no longer marked pending.' };
  }

  if (!student.stripeCustomerId || !student.stripeSubscriptionId) {
    return { canCheck: false, ready: false, reason: 'Both Stripe IDs are required before setup can be completed.' };
  }

  if (!snapshot) {
    return { canCheck: true, ready: false, reason: 'Live Stripe has not been checked yet.' };
  }

  if (!snapshot.customerFound || !snapshot.subscriptionFound) {
    return { canCheck: true, ready: false, reason: 'Stripe could not confirm both the customer and subscription.' };
  }

  if (issues.length > 0) {
    return { canCheck: true, ready: false, reason: `Stripe still reports ${issues.join(', ')}.` };
  }

  if (!snapshot.activelyBilling) {
    return { canCheck: true, ready: false, reason: 'The Stripe subscription is not actively billing.' };
  }

  return {
    canCheck: true,
    ready: true,
    reason: 'Live Stripe confirms an actively billing customer and subscription with no payment issues.',
  };
}

export function buildPaymentOperationsSummary(students = []) {
  const summary = {
    totalStudents: students.length,
    stripeManaged: 0,
    manualPayers: 0,
    unknownPaymentMode: 0,
    setupPending: 0,
    pausedExpected: 0,
    inactiveOrStopped: 0,
    activeExpected: 0,
    linkedStripeCustomers: 0,
    linkedStripeSubscriptions: 0,
    stripeLinkingGaps: 0,
  };

  for (const student of students) {
    if (student.paymentMode === 'stripe') {
      summary.stripeManaged += 1;
    } else if (student.paymentMode === 'manual') {
      summary.manualPayers += 1;
    } else {
      summary.unknownPaymentMode += 1;
    }

    if (student.paymentExpectation === 'setup_pending') {
      summary.setupPending += 1;
    } else if (student.paymentExpectation === 'stripe_paused_expected') {
      summary.pausedExpected += 1;
    } else if (student.paymentExpectation === 'inactive_or_stopped') {
      summary.inactiveOrStopped += 1;
    } else if (student.paymentExpectation === 'stripe_active_expected') {
      summary.activeExpected += 1;
    }

    if (!isStripeManaged(student)) {
      continue;
    }

    if (student.stripeCustomerId) {
      summary.linkedStripeCustomers += 1;
    }

    if (student.stripeSubscriptionId) {
      summary.linkedStripeSubscriptions += 1;
    }

    const hasLinkingGap = !student.stripeCustomerId || !student.stripeSubscriptionId;
    if (hasLinkingGap && student.paymentExpectation !== 'setup_pending') {
      summary.stripeLinkingGaps += 1;
    }
  }

  return summary;
}
