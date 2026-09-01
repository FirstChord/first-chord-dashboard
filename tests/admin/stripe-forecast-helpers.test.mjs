import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStripeForecastRow,
  buildStripeForecastConfidence,
  buildStripeMonthlyForecast,
  buildStripeReconciliation,
  currentMonthKey,
  ensureMonthlyStripeForecast,
  findMonthlyStripeForecast,
} from '../../lib/admin/stripe-forecast-helpers.mjs';

const AT = new Date('2026-08-03T05:00:00.000Z');

function student(overrides = {}) {
  return {
    mmsId: 'sdt_1',
    fullName: 'Ada Student',
    paymentMode: 'stripe',
    paymentExpectation: 'stripe_active_expected',
    lifecycleStatus: 'active',
    instrument: 'Piano',
    scheduleContext: {
      status: 'found',
      durationMinutes: '30',
      usualWeekday: 'Monday',
    },
    ...overrides,
  };
}

test('monthly forecast uses dashboard prices and the target month calendar', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [
      student(),
      student({ mmsId: 'sdt_2', fullName: 'Paused Student', lifecycleStatus: 'paused', paymentExpectation: 'stripe_paused_expected' }),
      student({ mmsId: 'sdt_manual', paymentMode: 'manual' }),
    ],
    month: '2026-08',
    forecastedAt: AT,
  });

  // August 2026 has five Mondays: £25 × 5. Stripe subscription/cache amounts
  // are deliberately not accepted as an input to this builder.
  assert.equal(forecast.forecastTotal, 125);
  assert.equal(forecast.candidateStudentCount, 2);
  assert.equal(forecast.forecastedStudentCount, 2);
  assert.equal(forecast.billedStudentCount, 1);
  assert.equal(forecast.zeroExpectedCount, 1);
  assert.equal(forecast.items[0].expected_amount, 125);
  assert.equal(forecast.items[1].expected_amount, 0);
});

test('monthly forecast removes dated structured pauses and exposes weak inputs', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [
      student(),
      student({
        mmsId: 'sdt_no_day',
        fullName: 'No Day',
        scheduleContext: { status: 'not_found', durationMinutes: '45', usualWeekday: '' },
      }),
      student({
        mmsId: 'sdt_unpriced',
        fullName: 'Unpriced',
        scheduleContext: { status: 'found', durationMinutes: '35', usualWeekday: 'Tuesday' },
      }),
    ],
    planningRows: [{
      planningId: 'pause_1',
      linkedStudentId: 'sdt_1',
      title: 'Pause Ada Student',
      notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-08-10.\nReturning from date: 2026-08-24.',
    }],
    month: '2026-08',
    forecastedAt: AT,
  });

  const ada = forecast.items.find((item) => item.mms_id === 'sdt_1');
  const noDay = forecast.items.find((item) => item.mms_id === 'sdt_no_day');
  assert.equal(ada.expected_occurrences, 3);
  assert.equal(ada.expected_amount, 75);
  assert.equal(ada.billing_basis, 'calendar_less_structured_pauses');
  assert.equal(noDay.billing_basis, 'average_month_no_weekday');
  assert.equal(noDay.confidence, 'low');
  assert.equal(forecast.unpricedCount, 1);
  assert.equal(forecast.coveragePct, 66.67);
});

test('monthly forecast resumes billing after a current structured pause ends', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [student({
      lifecycleStatus: 'paused',
      paymentExpectation: 'stripe_paused_expected',
    })],
    planningRows: [{
      planningId: 'pause_current',
      linkedStudentId: 'sdt_1',
      title: 'Pause Ada Student',
      notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-07-20.\nReturning from date: 2026-08-17.',
    }],
    month: '2026-08',
    forecastedAt: AT,
  });

  // The student is paused when the forecast is locked, but Mondays on and
  // after the 17 August return date are billable again.
  assert.equal(forecast.forecastTotal, 75);
  assert.equal(forecast.billedStudentCount, 1);
  assert.equal(forecast.zeroExpectedCount, 0);
  assert.equal(forecast.items[0].expected_occurrences, 3);
  assert.equal(forecast.items[0].billing_basis, 'calendar_less_structured_pauses');
});

test('monthly forecast keeps a current pause at zero without a dated return window', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [student({
      lifecycleStatus: 'paused',
      paymentExpectation: 'stripe_paused_expected',
    })],
    month: '2026-08',
    forecastedAt: AT,
  });

  assert.equal(forecast.forecastTotal, 0);
  assert.equal(forecast.items[0].billing_basis, 'paused_expected');
  assert.equal(forecast.items[0].expected_occurrences, 0);
});

test('monthly forecast prorates a dated return when the usual weekday is unknown', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [student({
      lifecycleStatus: 'paused',
      paymentExpectation: 'stripe_paused_expected',
      scheduleContext: { status: 'not_found', durationMinutes: '30', usualWeekday: '' },
    })],
    planningRows: [{
      planningId: 'pause_no_weekday',
      linkedStudentId: 'sdt_1',
      title: 'Pause Ada Student',
      notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-07-20.\nReturning from date: 2026-08-17.',
    }],
    month: '2026-08',
    forecastedAt: AT,
  });

  assert.equal(forecast.items[0].billing_basis, 'average_month_less_structured_pauses_no_weekday');
  assert.equal(forecast.items[0].confidence, 'low');
  assert.equal(forecast.items[0].expected_occurrences, 2.1);
  assert.equal(forecast.items[0].expected_amount, 52.5);
});

test('monthly forecast does not revive a stopped student from an old pause window', () => {
  const forecast = buildStripeMonthlyForecast({
    students: [student({
      lifecycleStatus: 'stopped',
      paymentExpectation: 'inactive_or_stopped',
    })],
    planningRows: [{
      planningId: 'pause_old',
      linkedStudentId: 'sdt_1',
      title: 'Pause Ada Student',
      notes: 'Pause type: away period.\nFirst lesson to pause date: 2026-07-20.\nReturning from date: 2026-08-17.',
    }],
    month: '2026-08',
    forecastedAt: AT,
  });

  assert.equal(forecast.forecastTotal, 0);
  assert.equal(forecast.items[0].billing_basis, 'not_expected_to_bill');
});

test('forecast rows are compact, first-write-wins monthly records', async () => {
  const forecast = buildStripeMonthlyForecast({ students: [student()], month: '2026-08', forecastedAt: AT });
  const row = buildStripeForecastRow(forecast);
  assert.equal(row.month, '2026-08');
  assert.equal(row.forecast_total, 125);
  assert.equal(row.method, 'dashboard_price_x_calendar_v2');
  assert.equal(JSON.parse(row.items_json)[0].mms_id, 'sdt_1');
  assert.equal(JSON.parse(row.items_json)[0].amount, 125);
  assert.equal(currentMonthKey(AT), '2026-08');
  assert.equal(findMonthlyStripeForecast([row], { month: '2026-08' }), row);

  let builds = 0;
  let appends = 0;
  const existing = await ensureMonthlyStripeForecast({
    at: AT,
    getForecastRows: async () => [row],
    buildForecastRow: async () => { builds += 1; return row; },
    appendForecastRow: async () => { appends += 1; },
  });
  assert.equal(existing.skipped, true);
  assert.equal(builds, 0);
  assert.equal(appends, 0);

  const created = await ensureMonthlyStripeForecast({
    at: AT,
    getForecastRows: async () => [],
    buildForecastRow: async ({ month }) => { builds += 1; return { ...row, month }; },
    appendForecastRow: async () => { appends += 1; return { appended: true }; },
  });
  assert.equal(created.skipped, false);
  assert.equal(builds, 1);
  assert.equal(appends, 1);
});

test('forecast confidence separates actionable gaps from normal calendar assumptions', () => {
  const confidence = buildStripeForecastConfidence({
    candidate_student_count: '6',
    unpriced_count: '1',
    unparsed_pause_count: '2',
    items_json: JSON.stringify([
      { amount: 100, basis: 'calendar_weekday' },
      { amount: 75, basis: 'calendar_less_structured_pauses' },
      { amount: 50, basis: 'average_month_no_weekday' },
      { amount: 0, basis: 'paused_expected' },
      { amount: 0, basis: 'not_expected_to_bill' },
      { amount: null, basis: 'calendar_weekday' },
    ]),
  });

  assert.deepEqual(confidence, {
    candidateCount: 6,
    calendarCount: 2,
    datedPauseCount: 1,
    missingWeekdayCount: 1,
    undatedPauseCount: 1,
    inactiveCount: 1,
    monthlyPriceCount: 0,
    unpricedCount: 1,
    unparsedPauseCount: 2,
    actionableInputCount: 5,
  });
});

test('reconciliation exposes offsetting student errors that a correct total hides', () => {
  const forecast = buildStripeForecastRow({
    month: '2026-07',
    forecastedAt: '2026-07-01T05:00:00.000Z',
    forecastTotal: 200,
    candidateStudentCount: 2,
    forecastedStudentCount: 2,
    billedStudentCount: 2,
    zeroExpectedCount: 0,
    unpricedCount: 0,
    approximateCount: 2,
    coveragePct: 100,
    unparsedPauseCount: 0,
    items: [
      { mms_id: 'a', student_name: 'A', expected_amount: 100 },
      { mms_id: 'b', student_name: 'B', expected_amount: 100 },
    ],
  });
  const result = buildStripeReconciliation({
    forecastRows: [forecast],
    collectedRows: [{
      month: '2026-07',
      collected_total: 200,
      invoice_count: 2,
      matched_total: 200,
      unmatched_total: 0,
      unmatched_invoice_count: 0,
      student_breakdown_json: JSON.stringify([
        { mms_id: 'a', student_name: 'A', amount: 150, invoice_count: 1 },
        { mms_id: 'b', student_name: 'B', amount: 50, invoice_count: 1 },
      ]),
    }],
    now: AT,
  });

  assert.equal(result.netDifference, 0);
  assert.equal(result.totalAbsoluteError, 100);
  assert.equal(result.offsettingError, 50);
  assert.equal(result.mismatchCount, 2);
  assert.equal(result.matchedCollectionPct, 100);
});

test('reconciliation keeps unresolved Stripe invoices visible', () => {
  const forecast = buildStripeForecastRow({
    month: '2026-07',
    forecastedAt: '2026-07-01T05:00:00.000Z',
    forecastTotal: 100,
    candidateStudentCount: 1,
    forecastedStudentCount: 1,
    billedStudentCount: 1,
    zeroExpectedCount: 0,
    unpricedCount: 0,
    approximateCount: 1,
    coveragePct: 100,
    unparsedPauseCount: 0,
    items: [{ mms_id: 'a', student_name: 'A', expected_amount: 100 }],
  });
  const result = buildStripeReconciliation({
    forecastRows: [forecast],
    collectedRows: [{
      month: '2026-07',
      collected_total: 125,
      unmatched_total: 25,
      unmatched_invoice_count: 1,
      student_breakdown_json: JSON.stringify([{ mms_id: 'a', amount: 100, invoice_count: 4 }]),
    }],
    now: AT,
  });

  assert.equal(result.netDifference, 25);
  assert.equal(result.totalAbsoluteError, 25);
  assert.equal(result.unmatchedActualTotal, 25);
  assert.equal(result.matchedCollectionPct, 80);
});

test('reconciliation attributes pause misses and separates students who joined after lock', () => {
  const forecast = buildStripeForecastRow({
    month: '2026-07',
    forecastedAt: '2026-07-01T05:00:00.000Z',
    forecastTotal: 0,
    candidateStudentCount: 1,
    forecastedStudentCount: 1,
    billedStudentCount: 0,
    zeroExpectedCount: 1,
    unpricedCount: 0,
    approximateCount: 0,
    coveragePct: 100,
    unparsedPauseCount: 0,
    items: [{
      mms_id: 'paused',
      student_name: 'Paused Student',
      expected_amount: 0,
      billing_basis: 'paused_expected',
      weekly_amount: 25,
      expected_occurrences: 0,
    }],
  });
  const result = buildStripeReconciliation({
    forecastRows: [forecast],
    collectedRows: [{
      month: '2026-07',
      collected_total: 125,
      matched_total: 125,
      unmatched_total: 0,
      student_breakdown_json: JSON.stringify([
        { mms_id: 'paused', amount: 75, invoice_count: 3 },
        { mms_id: 'new', student_name: 'New Student', amount: 50, invoice_count: 2 },
      ]),
    }],
    waitingRows: [{ mms_id: 'new', status: 'onboarded', updated_at: '2026-07-12T10:00:00.000Z' }],
    now: AT,
  });

  assert.equal(result.totalAbsoluteError, 125);
  assert.equal(result.modelAbsoluteError, 75);
  assert.deepEqual(result.attribution.map((item) => [item.category, item.count, item.absoluteError]), [
    ['paused_expected_but_collected', 1, 75],
    ['post_lock_onboarding', 1, 50],
  ]);
  assert.equal(result.differences.find((item) => item.mmsId === 'new').category, 'post_lock_onboarding');
});
