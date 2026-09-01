import assert from 'node:assert/strict';
import test from 'node:test';

import { createStripeAmountsPostHandler } from '../../lib/admin/stripe-amounts-endpoint.mjs';
import {
  previousMonthKey,
  summariseCollectedInvoices,
} from '../../lib/admin/stripe-amounts-helpers.mjs';

const AT = new Date('2026-08-03T05:30:00.000Z');
const SECRET = 'finance-secret';

function request(secret = SECRET) {
  return new Request('https://dashboard.test/api/cron/stripe-amounts', {
    method: 'POST',
    headers: secret === null ? {} : { 'x-firstchord-finance-secret': secret },
  });
}

function createHandler(overrides = {}) {
  return createStripeAmountsPostHandler({
    getSecret: () => SECRET,
    now: () => AT,
    getForecastRows: async () => [],
    buildForecastRow: async ({ month, forecastedAt }) => ({
      month,
      forecasted_at: forecastedAt.toISOString(),
      forecast_total: 456,
    }),
    appendForecastRow: async () => ({ appended: true }),
    getStudents: async () => [{ mmsId: 'student-1' }],
    fetchSubscriptions: async () => [{ id: 'subscription-1' }],
    buildCacheRows: () => ({
      rows: [{ mms_id: 'student-1', monthly_amount: 100 }],
      unmatchedStudents: 0,
      unmatchedSubscriptions: 0,
    }),
    replaceCacheRows: async () => {},
    previousMonth: previousMonthKey,
    fetchPaidInvoices: async () => [],
    summariseInvoices: summariseCollectedInvoices,
    upsertCollectedMonth: async () => {},
    ...overrides,
  });
}

test('Stripe amounts endpoint rejects unauthorised calls before any provider read', async () => {
  let providerReads = 0;
  const unconfigured = createHandler({
    getSecret: () => '',
    fetchSubscriptions: async () => { providerReads += 1; return []; },
  });
  const missingConfigResponse = await unconfigured(request());
  assert.equal(missingConfigResponse.status, 503);

  const configured = createHandler({
    fetchSubscriptions: async () => { providerReads += 1; return []; },
  });
  const badSecretResponse = await configured(request('finance-secrex'));
  assert.equal(badSecretResponse.status, 401);
  assert.equal(providerReads, 0);
});

test('Stripe amounts endpoint refreshes both caches against one fixed capture time', async () => {
  const students = [{ mmsId: 'student-1' }];
  const subscriptions = [{ id: 'subscription-1' }];
  const rows = [{ mms_id: 'student-1' }, { mms_id: 'student-2' }];
  let buildArgs = null;
  let replacedRows = null;
  let invoiceMonth = '';
  let collectedRow = null;
  const handler = createHandler({
    getStudents: async () => students,
    fetchSubscriptions: async () => subscriptions,
    buildCacheRows: (receivedSubscriptions, receivedStudents, options) => {
      buildArgs = { receivedSubscriptions, receivedStudents, options };
      return { rows, unmatchedStudents: 3, unmatchedSubscriptions: 4 };
    },
    replaceCacheRows: async (receivedRows) => { replacedRows = receivedRows; },
    fetchPaidInvoices: async (month) => {
      invoiceMonth = month;
      return [{
        status: 'paid',
        created: Date.parse('2026-07-12T10:00:00.000Z') / 1000,
        amount_paid: 12345,
      }];
    },
    upsertCollectedMonth: async (row) => { collectedRow = row; },
  });

  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(buildArgs, {
    receivedSubscriptions: subscriptions,
    receivedStudents: students,
    options: { now: AT },
  });
  assert.equal(replacedRows, rows);
  assert.equal(invoiceMonth, '2026-07');
  assert.deepEqual(collectedRow, {
    month: '2026-07',
    collected_total: 123.45,
    invoice_count: 1,
    matched_total: 0,
    matched_invoice_count: 0,
    unmatched_total: 123.45,
    unmatched_invoice_count: 1,
    student_breakdown_json: '[]',
    currency: 'gbp',
    refreshed_at: '2026-08-03T05:30:00.000Z',
  });
  assert.deepEqual(await response.json(), {
    success: true,
    forecastMonth: '2026-08',
    forecastLocked: true,
    forecastSkipped: false,
    cachedStudents: 2,
    unmatchedStudents: 3,
    unmatchedSubscriptions: 4,
    collectedMonth: '2026-07',
    collectedTotal: 123.45,
    invoiceCount: 1,
    unmatchedTotal: 123.45,
    unmatchedInvoiceCount: 1,
  });
});

test('Stripe amounts endpoint uses archived students only for prior-month invoice matching', async () => {
  const students = [{ mmsId: 'current' }];
  const archivedStudents = [{ mms_id: 'archived' }];
  let cacheStudents = null;
  let collectionOptions = null;
  const handler = createHandler({
    getStudents: async () => students,
    getArchivedStudents: async () => archivedStudents,
    buildCacheRows: (_subscriptions, receivedStudents) => {
      cacheStudents = receivedStudents;
      return { rows: [], unmatchedStudents: 0, unmatchedSubscriptions: 0 };
    },
    summariseInvoices: (_invoices, options) => {
      collectionOptions = options;
      return {
        month: options.month,
        collectedTotal: 0,
        invoiceCount: 0,
        matchedTotal: 0,
        matchedInvoiceCount: 0,
        unmatchedTotal: 0,
        unmatchedInvoiceCount: 0,
        studentBreakdown: [],
      };
    },
  });

  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(cacheStudents, students);
  assert.deepEqual(collectionOptions, { month: '2026-07', students, archivedStudents });
});

test('Stripe endpoint durably locks the forecast before any provider read', async () => {
  const order = [];
  const handler = createHandler({
    getForecastRows: async () => { order.push('read forecast'); return []; },
    buildForecastRow: async ({ month }) => { order.push('build forecast'); return { month }; },
    appendForecastRow: async () => { order.push('append forecast'); return { appended: true }; },
    fetchSubscriptions: async () => { order.push('read subscriptions'); return []; },
    fetchPaidInvoices: async () => { order.push('read invoices'); return []; },
  });

  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(order.slice(0, 3), ['read forecast', 'build forecast', 'append forecast']);
  assert.equal(order.indexOf('read subscriptions') > order.indexOf('append forecast'), true);
  assert.equal(order.indexOf('read invoices') > order.indexOf('append forecast'), true);
});

test('Stripe endpoint makes no provider read when the blind forecast cannot be locked', async () => {
  let providerReads = 0;
  const handler = createHandler({
    appendForecastRow: async () => { throw new Error('Forecast sheet unavailable'); },
    fetchSubscriptions: async () => { providerReads += 1; return []; },
    fetchPaidInvoices: async () => { providerReads += 1; return []; },
  });

  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Forecast sheet unavailable' });
  assert.equal(providerReads, 0);
});

test('Stripe amounts endpoint completes provider reads before either cache write', async () => {
  let cacheWrites = 0;
  let collectionWrites = 0;
  const handler = createHandler({
    fetchPaidInvoices: async () => { throw new Error('Stripe invoices unavailable'); },
    replaceCacheRows: async () => { cacheWrites += 1; },
    upsertCollectedMonth: async () => { collectionWrites += 1; },
  });

  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Stripe invoices unavailable' });
  assert.equal(cacheWrites, 0);
  assert.equal(collectionWrites, 0);
});
