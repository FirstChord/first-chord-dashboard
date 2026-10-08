import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStripeCustomerDashboardUrl,
  buildStripeStudentDashboardLink,
  DEFAULT_STRIPE_DASHBOARD_BASE_URL,
} from '../../lib/admin/stripe-dashboard-helpers.mjs';

test('buildStripeCustomerDashboardUrl builds the default customer profile URL', () => {
  assert.equal(
    buildStripeCustomerDashboardUrl('cus_123'),
    `${DEFAULT_STRIPE_DASHBOARD_BASE_URL}/customers/cus_123`,
  );
});

test('student Stripe link goes straight to a valid subscription, then a customer, then lookup', () => {
  assert.deepEqual(buildStripeStudentDashboardLink({ stripeSubscriptionId: ' sub_demo ', stripeCustomerId: 'cus_demo' }), {
    href: 'https://dashboard.stripe.com/subscriptions/sub_demo', label: 'Open Stripe subscription ↗', kind: 'subscription',
  });
  assert.equal(buildStripeStudentDashboardLink({ stripeCustomerId: 'cus_demo', stripeSubscriptionId: 'Starts October?' }).kind, 'customer');
  assert.equal(buildStripeStudentDashboardLink({ stripeCustomerId: 'pays cash', stripeSubscriptionId: 'sub_demo?note' }).href, 'https://dashboard.stripe.com/customers');
  assert.equal(buildStripeStudentDashboardLink({}, 'https://dashboard.stripe.com/acct_demo/').href, 'https://dashboard.stripe.com/acct_demo/customers');
});

test('buildStripeCustomerDashboardUrl supports configured accounts and safely encodes IDs', () => {
  assert.equal(
    buildStripeCustomerDashboardUrl(' cus/family ', 'https://dashboard.stripe.com/acct_123/'),
    'https://dashboard.stripe.com/acct_123/customers/cus%2Ffamily',
  );
});

test('buildStripeCustomerDashboardUrl returns no link without a customer ID', () => {
  assert.equal(buildStripeCustomerDashboardUrl(''), '');
  assert.equal(buildStripeCustomerDashboardUrl('   '), '');
});
