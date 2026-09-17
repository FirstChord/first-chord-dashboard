import test from 'node:test';
import assert from 'node:assert/strict';

import { getLiveStripeSnapshot } from '../../lib/admin/stripe.js';

const STUDENT = {
  paymentMode: 'stripe',
  paymentExpectation: 'setup_pending',
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  email: 'student@example.com',
};

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installStripeFetch(subscription) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = `${url}`;
    if (target.includes('/customers/cus_123')) {
      return jsonResponse({ id: 'cus_123' });
    }
    if (target.includes('/subscriptions/sub_123')) {
      return jsonResponse(subscription);
    }
    throw new Error(`Unexpected Stripe request: ${target}`);
  };
  return () => { globalThis.fetch = originalFetch; };
}

test('setup-pending live reads stay skipped unless completion review is explicit', async () => {
  const restoreFetch = installStripeFetch({
    id: 'sub_123',
    status: 'active',
    items: { data: [{ quantity: 1 }] },
    latest_invoice: { id: 'in_123', status: 'paid', paid: true },
  });
  const originalStripeApiKey = process.env.STRIPE_API_KEY;
  process.env.STRIPE_API_KEY = 'rk_test_only';

  try {
    const ordinary = await getLiveStripeSnapshot(STUDENT);
    assert.equal(ordinary.snapshot, null);
    assert.match(ordinary.skippedReason, /intentionally pending/);

    const reviewed = await getLiveStripeSnapshot(STUDENT, { allowSetupPending: true });
    assert.equal(reviewed.snapshot.customerFound, true);
    assert.equal(reviewed.snapshot.subscriptionFound, true);
    assert.equal(reviewed.snapshot.activelyBilling, true);
    assert.deepEqual(reviewed.issues, []);
  } finally {
    restoreFetch();
    if (originalStripeApiKey === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = originalStripeApiKey;
  }
});

test('setup completion review evaluates payment problems as active-expected', async () => {
  const restoreFetch = installStripeFetch({
    id: 'sub_123',
    status: 'past_due',
    items: { data: [{ quantity: 1 }] },
    latest_invoice: {
      id: 'in_failed',
      status: 'past_due',
      paid: false,
      attempt_count: 2,
      payment_intent: { status: 'requires_payment_method' },
    },
  });
  const originalStripeApiKey = process.env.STRIPE_API_KEY;
  process.env.STRIPE_API_KEY = 'rk_test_only';

  try {
    const reviewed = await getLiveStripeSnapshot(STUDENT, { allowSetupPending: true });
    assert.deepEqual(reviewed.issues, ['PAYMENT_FAILED']);
  } finally {
    restoreFetch();
    if (originalStripeApiKey === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = originalStripeApiKey;
  }
});
