import test from 'node:test';
import assert from 'node:assert/strict';
import { addCurrentFinanceEvidence, buildCompletedMonthFinance, buildFinanceScorecard } from '../../lib/admin/finance-review-helpers.mjs';

const now = new Date('2026-10-02T12:00:00Z');

test('current state and cache evidence do not replace frozen facts or invent evidence for a missing student', () => {
  const frozen = { month: '2026-09', differences: [
    { mmsId: 'a', expectedAmount: 0, actualAmount: 100, frozenExpectation: 'stripe_paused_expected' },
    { mmsId: 'gone', expectedAmount: 100, actualAmount: 0 },
  ] };
  const result = addCurrentFinanceEvidence(frozen, {
    students: [{ mmsId: 'a', lifecycleStatus: 'active', paymentExpectation: 'stripe_active_expected', lessonFrequency: 'fortnightly' }],
    stripeCacheRows: [{ mms_id: 'a', weekly_amount: '25', paused: 'no', checked_at: '2026-10-01T05:00:00Z' }],
  });
  assert.equal(result.differences[0].frozenExpectation, 'stripe_paused_expected');
  assert.equal(result.differences[0].current.expectation, 'stripe_active_expected');
  assert.equal(result.differences[0].cachedBilling[0].weekly, 25);
  assert.equal(result.differences[1].current.missing, true);
  assert.deepEqual(result.differences[1].cachedBilling, []);
  assert.equal(frozen.differences[0].current, undefined);
});
test('month-close spend includes entries recorded after the final immutable snapshot', () => {
  const snapshot = { snapshot_at: '2026-09-28T06:00:00Z', period_type: 'weekly', margin_monthly: '1000', total_cost_monthly: '5000', actual_spend_month_to_date: '0' };
  const result = buildCompletedMonthFinance({ month: '2026-09', now, snapshotRows: [snapshot], expenseLogRows: [
    { date: '2026-09-04', amount: '5.9', created_at: '2026-09-30T14:00:00Z' },
    { date: '2026-09-30', amount: '68.17', created_at: '2026-09-30T14:00:00Z' },
    { date: '2026-10-31', amount: '15', created_at: '2026-09-30T14:00:00Z' },
    { date: '2026-09-31', amount: '50' },
    { date: '2026-09-02', amount: 'not money' },
  ] });
  assert.equal(result.spendTotal, 74.07);
  assert.equal(result.lateSpendTotal, 74.07);
  assert.equal(result.marginAfterLoggedSpend, 925.93);
  assert.equal(result.actualProfit, null);
  assert.equal(snapshot.actual_spend_month_to_date, '0');
});

test('missing cost baseline remains unknown and payroll markers are not allocated across months', () => {
  const result = buildCompletedMonthFinance({ month: '2026-09', now, payrollRows: [
    { status: 'paid', paid_at: '2026-09-25T12:00:00Z', final_amount: '250', period_start: '2026-08-25', period_end: '2026-09-20' },
    { status: 'reviewed', final_amount: '500', period_start: '2026-09-21', period_end: '2026-10-04' },
    { status: 'paid_through', paid_at: '2026-09-25', final_amount: '999' },
    { status: 'paid', paid_at: '2026-09-25', final_amount: '' },
  ] });
  assert.equal(result.estimatedCosts, null);
  assert.equal(result.marginAfterLoggedSpend, null);
  assert.equal(result.payrollMarkedPaidTotal, 250);
  assert.equal(result.payrollCrossMonthCount, 2);
  assert.equal(result.actualProfit, null);
  assert.throws(() => buildCompletedMonthFinance({ month: '2026-10', now }), /completed month/);
  assert.throws(() => buildCompletedMonthFinance({ month: '2026-13', now }), /completed month/);
});

test('scorecard preserves original methods, missing predictions and open-month exclusion', () => {
  const forecastRows = [
    { month: '2026-08', method: 'v1', forecast_total: '10', items_json: '[]' },
    { month: '2026-09', method: 'v2', forecast_total: '20', items_json: '[]' },
    { month: '2026-10', method: 'v3', forecast_total: '30', items_json: '[]' },
  ];
  const scorecard = buildFinanceScorecard({ now, forecastRows, collectedRows: [
    { month: '2026-07', collected_total: '15' },
    { month: '2026-09', collected_total: '25' },
    { month: '2026-99', collected_total: '99' },
  ] });
  assert.deepEqual(scorecard.map((score) => score.month), ['2026-09', '2026-08', '2026-07']);
  assert.equal(scorecard[0].method, 'v2');
  assert.equal(scorecard[0].netDifference, 5);
  assert.equal(scorecard[1].actualPresent, false);
  assert.equal(scorecard[2].forecastPresent, false);
  assert.equal(scorecard[2].forecastTotal, null);
  assert.equal(scorecard[2].totalAbsoluteError, null);
  assert.equal(scorecard[2].mismatchCount, null);
  assert.equal(scorecard[2].matchedCollectionPct, null);
});
