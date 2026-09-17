import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessPaymentSetupCompletion,
  buildPaymentOperationsSummary,
} from '../../lib/admin/payment-summary.mjs';

test('buildPaymentOperationsSummary counts payment modes and expectations', () => {
  const summary = buildPaymentOperationsSummary([
    {
      paymentMode: 'stripe',
      paymentExpectation: 'stripe_active_expected',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    },
    {
      paymentMode: 'stripe',
      paymentExpectation: 'setup_pending',
      stripeCustomerId: 'cus_2',
      stripeSubscriptionId: '',
    },
    {
      paymentMode: 'manual',
      paymentExpectation: '',
      stripeCustomerId: '',
      stripeSubscriptionId: '',
    },
    {
      paymentMode: 'stripe',
      paymentExpectation: 'stripe_paused_expected',
      stripeCustomerId: '',
      stripeSubscriptionId: '',
    },
    {
      paymentMode: 'unknown',
      paymentExpectation: 'inactive_or_stopped',
      stripeCustomerId: '',
      stripeSubscriptionId: '',
    },
  ]);

  assert.equal(summary.totalStudents, 5);
  assert.equal(summary.stripeManaged, 3);
  assert.equal(summary.manualPayers, 1);
  assert.equal(summary.unknownPaymentMode, 1);
  assert.equal(summary.setupPending, 1);
  assert.equal(summary.pausedExpected, 1);
  assert.equal(summary.inactiveOrStopped, 1);
  assert.equal(summary.activeExpected, 1);
  assert.equal(summary.linkedStripeCustomers, 2);
  assert.equal(summary.linkedStripeSubscriptions, 1);
  assert.equal(summary.stripeLinkingGaps, 1);
});

test('assessPaymentSetupCompletion only offers a live check for fully linked pending Stripe students', () => {
  const pending = {
    paymentMode: 'stripe',
    paymentExpectation: 'setup_pending',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
  };

  assert.deepEqual(assessPaymentSetupCompletion({ student: pending }), {
    canCheck: true,
    ready: false,
    reason: 'Live Stripe has not been checked yet.',
  });
  assert.equal(assessPaymentSetupCompletion({
    student: { ...pending, stripeSubscriptionId: '' },
  }).canCheck, false);
  assert.equal(assessPaymentSetupCompletion({
    student: { ...pending, paymentExpectation: 'stripe_active_expected' },
  }).canCheck, false);
  assert.equal(assessPaymentSetupCompletion({
    student: { ...pending, paymentMode: 'manual' },
  }).canCheck, false);
});

test('assessPaymentSetupCompletion requires clean actively-billing live evidence', () => {
  const student = {
    paymentMode: 'stripe',
    paymentExpectation: 'setup_pending',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
  };
  const snapshot = {
    customerFound: true,
    subscriptionFound: true,
    activelyBilling: true,
  };

  assert.equal(assessPaymentSetupCompletion({ student, snapshot }).ready, true);
  assert.equal(assessPaymentSetupCompletion({
    student,
    snapshot: { ...snapshot, activelyBilling: false },
  }).ready, false);
  assert.equal(assessPaymentSetupCompletion({
    student,
    snapshot,
    issues: ['PAYMENT_FAILED'],
  }).ready, false);
  assert.equal(assessPaymentSetupCompletion({
    student,
    snapshot: { ...snapshot, subscriptionFound: false },
  }).ready, false);
});
