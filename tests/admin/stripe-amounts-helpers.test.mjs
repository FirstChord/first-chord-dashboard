import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSplitBillingIndex,
  buildStripeCollectionMatchStudents,
  buildStripeAmountsCacheRows,
  buildStripeAmountsMap,
  mapSubscriptionToAmounts,
  previousMonthKey,
  summariseCollectedInvoices,
} from '../../lib/admin/stripe-amounts-helpers.mjs';

const NOW = new Date('2026-07-06T06:00:00Z');

function weeklySub({ id = 'sub_1', customer = 'cus_1', unitAmount = 2500, quantity = 1, status = 'active', paused = false, interval = 'week', intervalCount = 1, coupon = null } = {}) {
  return {
    id,
    customer,
    status,
    pause_collection: paused ? { behavior: 'void' } : null,
    discount: coupon ? { coupon } : null,
    items: {
      data: [{
        quantity,
        price: { unit_amount: unitAmount, currency: 'gbp', recurring: { interval, interval_count: intervalCount } },
      }],
    },
  };
}

test('mapSubscriptionToAmounts converts weekly pence to weekly/monthly pounds', () => {
  const mapped = mapSubscriptionToAmounts(weeklySub({ unitAmount: 2500 }));
  assert.equal(mapped.weekly, 25);
  assert.equal(mapped.monthly, Math.round(25 * (52 / 12) * 100) / 100);
  assert.equal(mapped.interval, 'week');
  assert.equal(mapped.paused, false);
});

test('mapSubscriptionToAmounts handles monthly interval and pause_collection', () => {
  const mapped = mapSubscriptionToAmounts(weeklySub({ unitAmount: 4250, interval: 'month', paused: true }));
  assert.equal(mapped.monthly, 42.5);
  assert.equal(mapped.weekly, Math.round(((42.5 * 12) / 52) * 100) / 100);
  assert.equal(mapped.paused, true);
});

test('mapSubscriptionToAmounts applies percent and amount discounts', () => {
  const pct = mapSubscriptionToAmounts(weeklySub({ unitAmount: 2000, coupon: { percent_off: 50 } }));
  assert.equal(pct.weekly, 10);
  assert.equal(pct.discountPct, 50);

  const off = mapSubscriptionToAmounts(weeklySub({ unitAmount: 2000, coupon: { amount_off: 500 } }));
  assert.equal(off.weekly, 15);
});

test('mapSubscriptionToAmounts returns null for unpriced or unknown intervals', () => {
  assert.equal(mapSubscriptionToAmounts({ items: { data: [] } }), null);
  assert.equal(mapSubscriptionToAmounts(weeklySub({ interval: 'day' })), null);
});

test('buildStripeAmountsCacheRows joins by subscription id first, then best customer subscription', () => {
  const subs = [
    weeklySub({ id: 'sub_direct', customer: 'cus_a', unitAmount: 2500 }),
    weeklySub({ id: 'sub_paused', customer: 'cus_b', unitAmount: 3300, paused: true }),
    weeklySub({ id: 'sub_active', customer: 'cus_b', unitAmount: 3300 }),
  ];
  const students = [
    { mmsId: 'sdt_1', fullName: 'Direct Match', paymentMode: 'stripe', stripeSubscriptionId: 'sub_direct', stripeCustomerId: '' },
    { mmsId: 'sdt_2', fullName: 'Customer Match', paymentMode: 'stripe', stripeSubscriptionId: '', stripeCustomerId: 'cus_b' },
    { mmsId: 'sdt_3', fullName: 'No Stripe', paymentMode: 'stripe', stripeSubscriptionId: '', stripeCustomerId: '' },
    { mmsId: 'sdt_4', fullName: 'Manual Payer', paymentMode: 'manual' },
  ];

  const { rows, unmatchedStudents, unmatchedSubscriptions } = buildStripeAmountsCacheRows(subs, students, { now: NOW });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].mms_id, 'sdt_1');
  assert.equal(rows[0].weekly_amount, 25);
  // active unpaused beats paused for the same customer
  assert.equal(rows[1].stripe_subscription_id, 'sub_active');
  assert.equal(rows[1].paused, 'no');
  assert.equal(unmatchedStudents, 1); // sdt_3 is stripe-managed with no match; manual payer not counted
  assert.equal(unmatchedSubscriptions, 1); // sub_paused matched no student
  assert.equal(rows[0].checked_at, NOW.toISOString());
});

test('buildStripeAmountsMap filters stale and unpriced rows', () => {
  const cacheRows = [
    { mms_id: 'sdt_fresh', weekly_amount: '25', monthly_amount: '108.33', checked_at: '2026-07-06T05:30:00Z' },
    { mms_id: 'sdt_stale', weekly_amount: '33', monthly_amount: '143', checked_at: '2026-06-01T05:30:00Z' },
    { mms_id: 'sdt_zero', weekly_amount: '0', monthly_amount: '0', checked_at: '2026-07-06T05:30:00Z' },
    { mms_id: '', weekly_amount: '25', checked_at: '2026-07-06T05:30:00Z' },
  ];
  const { amounts, count, staleCount } = buildStripeAmountsMap(cacheRows, { now: NOW, maxAgeDays: 14 });

  assert.equal(count, 1);
  assert.equal(staleCount, 1);
  assert.deepEqual(amounts.sdt_fresh, { weekly: 25, monthly: 108.33 });
  assert.equal(amounts.sdt_stale, undefined);
});

test('summariseCollectedInvoices sums paid invoices and preserves a student breakdown', () => {
  const june = Math.floor(new Date('2026-06-15T12:00:00Z').getTime() / 1000);
  const july = Math.floor(new Date('2026-07-01T12:00:00Z').getTime() / 1000);
  const invoices = [
    { status: 'paid', amount_paid: 2500, created: june, subscription: 'sub_a', customer: 'cus_a' },
    { status: 'paid', amount_paid: 3300, created: june, parent: { subscription_details: { subscription: 'sub_b' } }, customer: 'cus_shared' },
    { status: 'paid', amount_paid: 1000, created: june, customer: 'cus_unknown' },
    { status: 'paid', amount_paid: 2500, created: july }, // wrong month
    { status: 'open', amount_paid: 2500, created: june }, // not paid
    { status: 'paid', amount_paid: 0, created: june }, // nothing collected
  ];
  const students = [
    { mmsId: 'a', fullName: 'A', stripeSubscriptionId: 'sub_a', stripeCustomerId: 'cus_a' },
    { mmsId: 'b', fullName: 'B', stripeSubscriptionId: 'sub_b', stripeCustomerId: 'cus_shared' },
    { mmsId: 'c', fullName: 'C', stripeSubscriptionId: 'sub_c', stripeCustomerId: 'cus_shared' },
  ];
  const summary = summariseCollectedInvoices(invoices, { month: '2026-06', students });

  assert.equal(summary.month, '2026-06');
  assert.equal(summary.collectedTotal, 68);
  assert.equal(summary.invoiceCount, 3);
  assert.equal(summary.matchedTotal, 58);
  assert.equal(summary.matchedInvoiceCount, 2);
  assert.equal(summary.unmatchedTotal, 10);
  assert.equal(summary.unmatchedInvoiceCount, 1);
  assert.deepEqual(summary.studentBreakdown, [
    { mms_id: 'a', student_name: 'A', invoice_count: 1, paid_days: [15], amount: 25 },
    { mms_id: 'b', student_name: 'B', invoice_count: 1, paid_days: [15], amount: 33 },
  ]);
});

test('summariseCollectedInvoices retains compact paid days for seasonal analysis', () => {
  const day = (iso) => Math.floor(new Date(`${iso}T12:00:00Z`).getTime() / 1000);
  const summary = summariseCollectedInvoices([
    { status: 'paid', amount_paid: 2500, created: day('2026-08-17'), subscription: 'sub_a' },
    { status: 'paid', amount_paid: 2500, created: day('2026-08-24'), subscription: 'sub_a' },
    { status: 'paid', amount_paid: 500, created: day('2026-08-24'), subscription: 'sub_a' },
  ], {
    month: '2026-08',
    students: [{ mmsId: 'a', fullName: 'A', stripeSubscriptionId: 'sub_a' }],
  });

  assert.deepEqual(summary.studentBreakdown, [{
    mms_id: 'a',
    student_name: 'A',
    invoice_count: 3,
    paid_days: [17, 24],
    amount: 55,
  }]);
});

test('summariseCollectedInvoices refuses an ambiguous customer-only match', () => {
  const created = Math.floor(new Date('2026-06-15T12:00:00Z').getTime() / 1000);
  const summary = summariseCollectedInvoices([
    { status: 'paid', amount_paid: 2500, created, customer: 'cus_family' },
  ], {
    month: '2026-06',
    students: [
      { mmsId: 'a', stripeCustomerId: 'cus_family' },
      { mmsId: 'b', stripeCustomerId: 'cus_family' },
    ],
  });

  assert.equal(summary.matchedTotal, 0);
  assert.equal(summary.unmatchedTotal, 25);
  assert.deepEqual(summary.studentBreakdown, []);
});

test('collection matching retains archived students without overriding the current roster', () => {
  const students = buildStripeCollectionMatchStudents(
    [{ mmsId: 'current', fullName: 'Current Name', stripeSubscriptionId: 'sub_current' }],
    [
      { mms_id: 'archived', 'Student forename': 'Past', 'Student Surname': 'Student', stripe_subscription_id: 'sub_archived' },
      { mms_id: 'current', 'Student forename': 'Old', 'Student Surname': 'Name', stripe_subscription_id: 'sub_old' },
    ],
  );

  assert.deepEqual(students, [
    { mmsId: 'current', fullName: 'Current Name', stripeSubscriptionId: 'sub_current', stripeCustomerId: '', rosterSource: 'current' },
    { mmsId: 'archived', fullName: 'Past Student', stripeSubscriptionId: 'sub_archived', stripeCustomerId: '', rosterSource: 'archive' },
  ]);
});

test('summariseCollectedInvoices matches a prior-month invoice through the archive', () => {
  const created = Math.floor(new Date('2026-06-15T12:00:00Z').getTime() / 1000);
  const summary = summariseCollectedInvoices([
    { status: 'paid', amount_paid: 2500, created, subscription: 'sub_archived' },
  ], {
    month: '2026-06',
    students: [],
    archivedStudents: [{
      mms_id: 'archived',
      'Student forename': 'Past',
      'Student Surname': 'Student',
      stripe_subscription_id: 'sub_archived',
    }],
  });

  assert.equal(summary.unmatchedTotal, 0);
  assert.deepEqual(summary.studentBreakdown, [{
    mms_id: 'archived',
    student_name: 'Past Student',
    roster_source: 'archive',
    invoice_count: 1,
    paid_days: [15],
    amount: 25,
  }]);
});

test('previousMonthKey returns the last full calendar month, across year ends', () => {
  assert.equal(previousMonthKey(new Date('2026-07-06T06:00:00Z')), '2026-06');
  assert.equal(previousMonthKey(new Date('2026-01-10T06:00:00Z')), '2025-12');
});

// --- Split billing: two parents, two subscriptions, one student ----------------
// Calan Clacherty's separated parents each pay half. Stripe cannot split one
// subscription across two cards, so the household is two subscriptions and
// `Students` has room for exactly one.

const CALAN = { mmsId: 'sdt_BpDPJZ', fullName: 'Calan Clacherty', stripeSubscriptionId: 'sub_ross', stripeCustomerId: 'cus_ross', paymentMode: 'stripe' };
const CALAN_SPLIT = [{
  mms_id: 'sdt_BpDPJZ',
  student_name: 'Calan Clacherty',
  payer_label: 'Clare',
  stripe_customer_id: 'cus_clare',
  stripe_subscription_id: 'sub_clare',
  share_pct: '50',
  active: 'yes',
}];

test('buildSplitBillingIndex drops inactive and linkless rows', () => {
  const index = buildSplitBillingIndex([
    ...CALAN_SPLIT,
    { mms_id: 'sdt_BpDPJZ', payer_label: 'Old', stripe_subscription_id: 'sub_dead', active: 'no' },
    { mms_id: 'sdt_other', payer_label: 'No links at all' },
    { payer_label: 'No student' },
  ]);

  assert.deepEqual(index.get('sdt_BpDPJZ'), [
    { customerId: 'cus_clare', subscriptionId: 'sub_clare', payerLabel: 'Clare' },
  ]);
  assert.equal(index.has('sdt_other'), false);
});

test('a split household contributes one labelled cache row per real subscription', () => {
  const { rows, unmatchedSubscriptions } = buildStripeAmountsCacheRows(
    [weeklySub({ id: 'sub_ross', customer: 'cus_ross', unitAmount: 1250 }), weeklySub({ id: 'sub_clare', customer: 'cus_clare', unitAmount: 1250 })],
    [CALAN],
    { now: NOW, splitBillingRows: CALAN_SPLIT },
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.stripe_subscription_id), ['sub_ross', 'sub_clare']);
  assert.deepEqual(rows.map((row) => row.payer_label), ['', 'Clare']);
  assert.equal(rows.every((row) => row.mms_id === 'sdt_BpDPJZ'), true);
  // The second parent's subscription is no longer an orphan.
  assert.equal(unmatchedSubscriptions, 0);
});

test('without the split row the second subscription is orphaned and the student is halved', () => {
  // This is the behaviour being fixed — pinned so a regression is visible.
  const { rows, unmatchedSubscriptions } = buildStripeAmountsCacheRows(
    [weeklySub({ id: 'sub_ross', customer: 'cus_ross', unitAmount: 1250 }), weeklySub({ id: 'sub_clare', customer: 'cus_clare', unitAmount: 1250 })],
    [CALAN],
    { now: NOW },
  );

  assert.equal(rows.length, 1);
  assert.equal(unmatchedSubscriptions, 1);
});

test('buildStripeAmountsMap sums a split household into one weekly figure', () => {
  // resolveStudentRevenue reads this as the student's whole weekly revenue.
  const checkedAt = NOW.toISOString();
  const { amounts, count } = buildStripeAmountsMap([
    { mms_id: 'sdt_BpDPJZ', stripe_subscription_id: 'sub_ross', weekly_amount: 12.5, monthly_amount: 54.17, checked_at: checkedAt },
    { mms_id: 'sdt_BpDPJZ', stripe_subscription_id: 'sub_clare', weekly_amount: 12.5, monthly_amount: 54.17, checked_at: checkedAt },
  ], { now: NOW });

  assert.equal(count, 1);
  assert.equal(amounts.sdt_BpDPJZ.weekly, 25);
  assert.equal(amounts.sdt_BpDPJZ.monthly, 108.34);
});

test('buildStripeAmountsMap will not double-count a repeated subscription row', () => {
  const checkedAt = NOW.toISOString();
  const { amounts } = buildStripeAmountsMap([
    { mms_id: 'sdt_BpDPJZ', stripe_subscription_id: 'sub_ross', weekly_amount: 12.5, checked_at: checkedAt },
    { mms_id: 'sdt_BpDPJZ', stripe_subscription_id: 'sub_ross', weekly_amount: 12.5, checked_at: checkedAt },
  ], { now: NOW });

  assert.equal(amounts.sdt_BpDPJZ.weekly, 12.5);
});

test('the second parent\'s invoices attach to the student instead of unmatched money', () => {
  const june = Math.floor(new Date('2026-06-15T12:00:00Z').getTime() / 1000);
  const invoices = [
    { status: 'paid', amount_paid: 1250, created: june, subscription: 'sub_ross', customer: 'cus_ross' },
    { status: 'paid', amount_paid: 1250, created: june, subscription: 'sub_clare', customer: 'cus_clare' },
  ];

  const without = summariseCollectedInvoices(invoices, { month: '2026-06', students: [CALAN] });
  assert.equal(without.unmatchedTotal, 12.5, 'today Clare\'s payment is unmatched money');

  const withSplit = summariseCollectedInvoices(invoices, { month: '2026-06', students: [CALAN], splitBillingRows: CALAN_SPLIT });
  assert.equal(withSplit.unmatchedTotal, 0);
  assert.equal(withSplit.unmatchedInvoiceCount, 0);
  assert.deepEqual(withSplit.studentBreakdown, [
    { mms_id: 'sdt_BpDPJZ', student_name: 'Calan Clacherty', invoice_count: 2, paid_days: [15], amount: 25 },
  ]);
});

test('two payers sharing one Stripe customer stay an unambiguous match', () => {
  // "This customer identifies one student" must mean one student, not one
  // match entry, or a split household would look ambiguous to itself.
  const june = Math.floor(new Date('2026-06-15T12:00:00Z').getTime() / 1000);
  const summary = summariseCollectedInvoices(
    [{ status: 'paid', amount_paid: 1250, created: june, customer: 'cus_ross' }],
    {
      month: '2026-06',
      students: [CALAN],
      splitBillingRows: [{ mms_id: 'sdt_BpDPJZ', payer_label: 'Clare', stripe_customer_id: 'cus_ross', stripe_subscription_id: 'sub_clare', active: 'yes' }],
    },
  );

  assert.equal(summary.unmatchedTotal, 0);
  assert.equal(summary.matchedTotal, 12.5);
});

test('a split row repeating the primary payer cannot double-count it', () => {
  const entries = buildStripeCollectionMatchStudents([CALAN], [], [
    { mms_id: 'sdt_BpDPJZ', payer_label: 'Duplicate', stripe_customer_id: 'cus_ross', stripe_subscription_id: 'sub_ross', active: 'yes' },
  ]);

  assert.equal(entries.length, 1);
});

test('alternating full-price fortnightly payers total the same as one weekly subscription', () => {
  // Calan's actual arrangement: each parent pays the full lesson price, every
  // other week, on their own subscription. Stripe puts the cadence on the price
  // (interval_count: 2), and mapSubscriptionToAmounts divides by it — so the two
  // halves of the household land on the same weekly basis as anyone else.
  const fortnightly = (id, customer) => weeklySub({ id, customer, unitAmount: 2500, intervalCount: 2 });
  const { rows, unmatchedSubscriptions } = buildStripeAmountsCacheRows(
    [fortnightly('sub_ross', 'cus_ross'), fortnightly('sub_clare', 'cus_clare')],
    [CALAN],
    { now: NOW, splitBillingRows: CALAN_SPLIT },
  );

  assert.deepEqual(rows.map((row) => row.weekly_amount), [12.5, 12.5]);
  assert.equal(unmatchedSubscriptions, 0);

  const { amounts } = buildStripeAmountsMap(rows, { now: NOW });
  const single = mapSubscriptionToAmounts(weeklySub({ unitAmount: 2500 }));
  assert.equal(amounts.sdt_BpDPJZ.weekly, single.weekly, 'the household is worth one full weekly lesson');
});

test('a fortnightly household\'s invoices all land on the student', () => {
  const at = (iso) => Math.floor(new Date(`${iso}T10:00:00Z`).getTime() / 1000);
  const summary = summariseCollectedInvoices([
    { status: 'paid', amount_paid: 2500, created: at('2026-09-01'), subscription: 'sub_ross', customer: 'cus_ross' },
    { status: 'paid', amount_paid: 2500, created: at('2026-09-08'), subscription: 'sub_clare', customer: 'cus_clare' },
    { status: 'paid', amount_paid: 2500, created: at('2026-09-15'), subscription: 'sub_ross', customer: 'cus_ross' },
    { status: 'paid', amount_paid: 2500, created: at('2026-09-22'), subscription: 'sub_clare', customer: 'cus_clare' },
  ], { month: '2026-09', students: [CALAN], splitBillingRows: CALAN_SPLIT });

  assert.equal(summary.unmatchedTotal, 0);
  assert.equal(summary.matchedTotal, 100);
  assert.deepEqual(summary.studentBreakdown[0].paid_days, [1, 8, 15, 22]);
});
