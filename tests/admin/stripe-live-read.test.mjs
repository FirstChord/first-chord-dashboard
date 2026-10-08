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

function installReadFixture(t, handler) {
  const originalFetch = globalThis.fetch;
  const originalStripeApiKey = process.env.STRIPE_API_KEY;
  process.env.STRIPE_API_KEY = 'rk_test_only';
  globalThis.fetch = async (input, init) => {
    assert.equal(init.method, 'GET');
    return handler(new URL(input));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStripeApiKey === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = originalStripeApiKey;
  });
}

const ACTIVE_SUBSCRIPTION = {
  id: 'sub_123',
  status: 'active',
  items: { data: [{ quantity: 1 }] },
  latest_invoice: { id: 'in_123', status: 'paid', paid: true },
};

test('notes in subscription ID cells cannot become Stripe paths or query parameters', async (t) => {
  const requests = [];
  installReadFixture(t, (url) => {
    requests.push(url.pathname);
    if (url.pathname === '/v1/customers/cus_123') return jsonResponse({ id: 'cus_123' });
    assert.equal(url.pathname, '/v1/subscriptions');
    assert.equal(url.searchParams.get('customer'), 'cus_123');
    assert.equal(url.searchParams.get('expand[]'), 'data.latest_invoice.payment_intent');
    assert.deepEqual([...url.searchParams.keys()], ['customer', 'status', 'limit', 'expand[]']);
    return jsonResponse({ data: [ACTIVE_SUBSCRIPTION] });
  });

  for (const stripeSubscriptionId of ['Starts October 10..?', 'sub_123?status=canceled', 'cus_123', 'sub_123#note', 'sub_123/other']) {
    const result = await getLiveStripeSnapshot({
      ...STUDENT, paymentExpectation: 'stripe_active_expected', stripeSubscriptionId,
    });
    assert.equal(result.snapshot.activelyBilling, true);
    assert.deepEqual(result.issues, []);
  }
  assert.equal(requests.length, 10);
});

test('invalid customer IDs use email lookup and valid IDs are trimmed', async (t) => {
  const requests = [];
  installReadFixture(t, (url) => {
    requests.push(url.pathname);
    if (url.pathname === '/v1/customers') {
      assert.equal(url.searchParams.get('email'), STUDENT.email);
      return jsonResponse({ data: [{ id: 'cus_123' }] });
    }
    assert.equal(url.pathname, '/v1/subscriptions/sub_123');
    assert.deepEqual([...url.searchParams.entries()], [['expand[]', 'latest_invoice.payment_intent']]);
    return jsonResponse(ACTIVE_SUBSCRIPTION);
  });
  for (const stripeCustomerId of ['pays cash', 'cus_123?note', 'sub_123']) {
    const result = await getLiveStripeSnapshot({
      ...STUDENT, paymentExpectation: 'stripe_active_expected', stripeCustomerId,
      stripeSubscriptionId: ' sub_123 ',
    });
    assert.equal(result.snapshot.activelyBilling, true);
  }
  assert.equal(requests.length, 6);
});

test('invalid identifiers without fallback evidence stay visible as missing Stripe records', async (t) => {
  installReadFixture(t, () => assert.fail('Invalid identifiers must not be requested'));
  const result = await getLiveStripeSnapshot({
    ...STUDENT, paymentExpectation: 'stripe_active_expected',
    stripeCustomerId: 'pays cash', stripeSubscriptionId: 'Starts October?', email: '',
  });
  assert.equal(result.snapshot.customerFound, false);
  assert.equal(result.snapshot.subscriptionFound, false);
  assert.deepEqual(result.issues, ['ACTIVE_WITHOUT_SUBSCRIPTION']);
});

test('real Stripe errors still fail the live read instead of becoming missing records', async (t) => {
  installReadFixture(t, () => new Response('permission denied', { status: 403 }));
  await assert.rejects(
    getLiveStripeSnapshot({ ...STUDENT, paymentExpectation: 'stripe_active_expected' }),
    /Stripe API error 403: permission denied/,
  );
});

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
