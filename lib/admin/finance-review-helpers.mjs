/** @fileoverview Completed-month finance evidence and versioned forecast scorecards without provider reads or historical writes. */
import { buildStripeReconciliation, currentMonthKey } from './stripe-forecast-helpers.mjs';

const clean = (value) => `${value ?? ''}`.trim();
const round = (value) => Math.round(value * 100) / 100;
function number(value) {
  if (value == null || clean(value) === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function validDate(value) {
  const date = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

export function buildFinanceScorecard({ forecastRows = [], collectedRows = [], waitingRows = [], now = new Date() } = {}) {
  const current = currentMonthKey(now);
  const months = [...new Set([...forecastRows, ...collectedRows].map((row) => clean(row.month)))]
    .filter((month) => validDate(`${month}-01`) && month < current)
    .sort().reverse();
  return months.map((month) => {
    const score = buildStripeReconciliation({ forecastRows, collectedRows, waitingRows, now, month });
    const summary = { ...score };
    delete summary.differences;
    delete summary.attribution;
    delete summary.confidence;
    delete summary.unmatchedInvoices;
    return summary;
  });
}

export function buildCompletedMonthFinance({ month, now = new Date(), snapshotRows = [], expenseLogRows = [], payrollRows = [], collectedRows = [] } = {}) {
  const start = validDate(`${month}-01`);
  if (!start || month >= currentMonthKey(now)) throw new Error('A valid completed month is required');
  const today = currentMonthKey(now) + now.toISOString().slice(7, 10);
  const snapshots = snapshotRows.filter((row) => clean(row.snapshot_at).startsWith(`${month}-`))
    .sort((a, b) => clean(a.snapshot_at).localeCompare(clean(b.snapshot_at)));
  const baseline = snapshots.find((row) => row.period_type === 'monthly') || snapshots[0] || null;
  const lastSnapshot = snapshots.at(-1) || null;
  const spend = expenseLogRows.filter((row) => {
    const date = validDate(row.date);
    return date && date.startsWith(`${month}-`) && date <= today && number(row.amount) > 0;
  });
  const spendTotal = round(spend.reduce((sum, row) => sum + number(row.amount), 0));
  const lateSpend = lastSnapshot ? spend.filter((row) => {
    const created = Date.parse(row.created_at);
    return Number.isFinite(created) && created > Date.parse(lastSnapshot.snapshot_at);
  }) : [];
  // A paid marker is user-attested workflow state. Never label this as bank truth.
  const paid = payrollRows.filter((row) => clean(row.status) === 'paid'
    && validDate(row.paid_at).startsWith(`${month}-`) && number(row.final_amount) !== null);
  const overlapping = payrollRows.filter((row) => {
    const from = validDate(row.period_start), to = validDate(row.period_end);
    return from && to && from <= to && from.slice(0, 7) <= month && to.slice(0, 7) >= month
      && ['reviewed', 'paid'].includes(clean(row.status));
  });
  const crossMonth = overlapping.filter((row) => !clean(row.period_start).startsWith(`${month}-`) || !clean(row.period_end).startsWith(`${month}-`));
  const collected = collectedRows.find((row) => clean(row.month) === month);
  const baselineMargin = number(baseline?.margin_monthly);
  return {
    month, generatedAt: now.toISOString(),
    invoiceTotal: number(collected?.collected_total), invoiceRefreshedAt: collected?.refreshed_at || null,
    spendTotal, spendCount: spend.length,
    lateSpendTotal: round(lateSpend.reduce((sum, row) => sum + number(row.amount), 0)), lateSpendCount: lateSpend.length,
    baselineAt: baseline?.snapshot_at || null, baselineType: baseline?.period_type || null,
    lastSnapshotAt: lastSnapshot?.snapshot_at || null,
    estimatedCosts: number(baseline?.total_cost_monthly), baselineMargin,
    marginAfterLoggedSpend: baselineMargin === null ? null : round(baselineMargin - spendTotal),
    payrollMarkedPaidTotal: round(paid.reduce((sum, row) => sum + number(row.final_amount), 0)), payrollMarkedPaidCount: paid.length,
    payrollCrossMonthCount: crossMonth.length, reviewedPayrollCount: overlapping.length,
    actualProfit: null,
  };
}

export function addCurrentFinanceEvidence(reconciliation, { students = [], stripeCacheRows = [] } = {}) {
  const byId = new Map(students.map((student) => [student.mmsId, student]));
  return {
    ...reconciliation,
    differences: reconciliation.differences.map((item) => {
      const student = byId.get(item.mmsId);
      const cache = stripeCacheRows.filter((row) => row.mms_id === item.mmsId);
      return {
        ...item,
        current: student ? {
          lifecycle: student.lifecycleStatus, expectation: student.paymentExpectation,
          frequency: student.lessonFrequency || student.registry?.lessonFrequency || 'weekly',
        } : { missing: true },
        cachedBilling: cache.map((row) => ({ weekly: number(row.weekly_amount), paused: row.paused, checkedAt: row.checked_at })),
      };
    }),
  };
}
