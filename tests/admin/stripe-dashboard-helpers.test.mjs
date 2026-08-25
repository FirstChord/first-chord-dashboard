import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStripeCustomerDashboardUrl,
  DEFAULT_STRIPE_DASHBOARD_BASE_URL,
} from '../../lib/admin/stripe-dashboard-helpers.mjs';

test('buildStripeCustomerDashboardUrl builds the default customer profile URL', () => {
  assert.equal(
    buildStripeCustomerDashboardUrl('cus_123'),
    `${DEFAULT_STRIPE_DASHBOARD_BASE_URL}/customers/cus_123`,
  );
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
