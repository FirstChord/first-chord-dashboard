/** @fileoverview Admin-gated endpoint assembling finance run-rate, coverage, trend, and the scored Stripe proof. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  getScheduleContextRows,
  getTutorPayRows,
  getExpenseRows,
  getExpenseLogRows,
  getFinanceSnapshotRows,
  getWaitingListStateRows,
  getStripeAmountsCacheRows,
  getStripeCollectedMonthlyRows,
  getStripeForecastMonthlyRows,
} from '@/lib/admin/sheets';
import { enrichScheduleContextsWithSharedSlots } from '@/lib/admin/schedule-context-helpers.mjs';
import { parseTutorPay } from '@/lib/admin/cost-helpers.mjs';
import { buildFinanceOverview } from '@/lib/admin/finance-helpers.mjs';
import { PRICE_ASSUMPTIONS_VERSION } from '@/lib/admin/finance-assumptions.mjs';
import { buildFinanceCoverage } from '@/lib/admin/finance-coverage.mjs';
import { buildFinanceTrend } from '@/lib/admin/finance-trend.mjs';
import { buildStripeAmountsMap } from '@/lib/admin/stripe-amounts-helpers.mjs';
import { buildStripeReconciliation, currentMonthKey, findMonthlyStripeForecast } from '@/lib/admin/stripe-forecast-helpers.mjs';

// Read-only structured finance picture — the same builders the finance page uses,
// exposed as JSON so the numbers can be *questioned* (by an agent, a script, or
// future Brain tooling) without scraping the page. No writes, no Stripe calls
// (actuals come from the weekly cache tab), admin session required.

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const trendPeriod = url.searchParams.get('period') === 'monthly' ? 'monthly' : 'weekly';

  try {
    const [students, scheduleRows, tutorPayRows, expenseRows, expenseLogRows, snapshotRows, waitingStateRows, stripeCacheRows, forecastRows, collectedRows] = await Promise.all([
      getOperationalAdminStudents(),
      getScheduleContextRows(),
      getTutorPayRows(),
      getExpenseRows(),
      getExpenseLogRows(),
      getFinanceSnapshotRows(),
      getWaitingListStateRows(),
      getStripeAmountsCacheRows(),
      getStripeForecastMonthlyRows(),
      getStripeCollectedMonthlyRows(),
    ]);

    const scheduleByMmsId = enrichScheduleContextsWithSharedSlots(scheduleRows);
    const enriched = students.map((student) => ({
      ...student,
      scheduleContext: scheduleByMmsId.get(student.mmsId) || student.scheduleContext || null,
    }));
    const tutorPay = parseTutorPay(tutorPayRows);
    const stripeActuals = buildStripeAmountsMap(stripeCacheRows);
    const overview = buildFinanceOverview(enriched, { tutorPay, expenseRows, expenseLogRows, stripeAmounts: stripeActuals.amounts });
    const coverage = buildFinanceCoverage(enriched, { tutorPay });
    const trend = buildFinanceTrend(snapshotRows, { period: trendPeriod, limit: 12 });

    const stripeReconciliation = buildStripeReconciliation({ forecastRows, collectedRows, waitingRows: waitingStateRows });
    const openStripeForecast = findMonthlyStripeForecast(forecastRows, { month: currentMonthKey() });

    return Response.json({
      generatedAt: new Date().toISOString(),
      assumptionsVersion: PRICE_ASSUMPTIONS_VERSION,
      totals: overview.totals,
      revenue: {
        active: overview.revenue.active,
        paused: overview.revenue.paused,
        setupPendingCount: overview.revenue.setupPendingCount,
        activeUnpriced: overview.revenue.activeUnpriced,
        byLessonKind: overview.revenue.byLessonKind,
        byPaymentMode: overview.revenue.byPaymentMode,
        bySource: overview.revenue.bySource,
        isEstimateOnly: overview.revenue.isEstimateOnly,
      },
      cost: {
        variableMonthly: overview.cost.variableMonthly,
        salariedMonthly: overview.cost.salariedMonthly,
        slotCount: overview.cost.slotCount,
        unpricedSlots: overview.cost.unpricedSlots,
      },
      stripeActuals: { pricedFromCache: stripeActuals.count, staleRows: stripeActuals.staleCount },
      coverage: {
        activeCount: coverage.activeCount,
        pricedCount: coverage.pricedCount,
        coveragePct: coverage.coveragePct,
        flagCounts: coverage.flagCounts,
        tutorsNotInPayTable: coverage.tutorsNotInPayTable,
        isClean: coverage.isClean,
      },
      trend: {
        period: trend.period,
        points: trend.points,
        deltas: trend.deltas,
        summary: trend.summary,
      },
      stripeProof: {
        openForecast: openStripeForecast,
        reconciliation: stripeReconciliation,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Finance overview failed' }, { status: 500 });
  }
}
