/** @fileoverview Admin finance composition for the blind Stripe proof, evidence, and actual-spend workflow. */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  appendExpenseLogRow,
  deleteExpenseLogRow,
  getExpenseLogRows,
  getExpenseRows,
  getFinanceSnapshotRows,
  getScheduleContextRows,
  getStripeAmountsCacheRows,
  getStripeCollectedMonthlyRows,
  getStripeForecastMonthlyRows,
  getStudentsArchiveRows,
  getTutorPayRows,
  getWaitingListStateRows,
} from '@/lib/admin/sheets';
import { enrichScheduleContextsWithSharedSlots } from '@/lib/admin/schedule-context-helpers.mjs';
import { buildFinanceOverview } from '@/lib/admin/finance-helpers.mjs';
import {
  buildExpenseLogSummary,
  parseTutorPay,
  validateExpenseLogInput,
} from '@/lib/admin/cost-helpers.mjs';
import { buildFinanceCoverage } from '@/lib/admin/finance-coverage.mjs';
import { buildFinanceTrend } from '@/lib/admin/finance-trend.mjs';
import { buildStripeAmountsMap } from '@/lib/admin/stripe-amounts-helpers.mjs';
import {
  buildStripeForecastConfidence,
  buildStripeReconciliation,
  currentMonthKey,
  findMonthlyStripeForecast,
} from '@/lib/admin/stripe-forecast-helpers.mjs';
import {
  buildRosterMovement,
  leftDatesFromArchive,
  onboardedDatesFromWaitingState,
} from '@/lib/admin/roster-movement.mjs';
import { authOptions } from '@/lib/admin/auth';
import AdminFinanceView from '@/components/finance/AdminFinanceView';

export const dynamic = 'force-dynamic';

async function addExpenseLogAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');

  const now = new Date();
  const input = validateExpenseLogInput({
    date: `${formData.get('date') || ''}`.trim(),
    amount: `${formData.get('amount') || ''}`.trim(),
    description: `${formData.get('description') || ''}`.trim(),
  }, { at: now });

  await appendExpenseLogRow({
    expense_id: `expense_${now.getTime()}_${randomUUID().slice(0, 8)}`,
    date: input.date,
    amount: input.amount,
    category: `${formData.get('category') || 'Other'}`.trim(),
    description: input.description,
    paid_by: 'First Chord',
    reimbursable: formData.get('reimbursable') === 'on' ? 'yes' : 'no',
    linked_area: `${formData.get('linked_area') || ''}`.trim(),
    notes: `${formData.get('notes') || ''}`.trim(),
    created_at: now.toISOString(),
    created_by: session.user.email || '',
  });

  revalidatePath('/admin/finance');
}

async function deleteExpenseLogAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');
  const expenseId = `${formData.get('expense_id') || ''}`.trim();
  if (!expenseId) throw new Error('Missing expense id');
  await deleteExpenseLogRow(expenseId);
  revalidatePath('/admin/finance');
}

export default async function AdminFinancePage({ searchParams }) {
  const params = (await searchParams) || {};
  const view = ['overview', 'details', 'spend'].includes(`${params.view || ''}`)
    ? `${params.view || ''}`
    : 'overview';

  if (view === 'overview') {
    const [forecastRows, collectedRows, waitingRows] = await Promise.all([
      getStripeForecastMonthlyRows(),
      getStripeCollectedMonthlyRows(),
      getWaitingListStateRows(),
    ]);
    const stripeReconciliation = buildStripeReconciliation({ forecastRows, collectedRows, waitingRows });
    const openForecastRow = findMonthlyStripeForecast(forecastRows, { month: currentMonthKey() });
    const openStripeForecast = openForecastRow ? {
      month: openForecastRow.month,
      forecastedAt: openForecastRow.forecasted_at,
      method: openForecastRow.method,
      forecastTotal: Number.parseFloat(openForecastRow.forecast_total),
      coveragePct: Number.parseFloat(openForecastRow.coverage_pct),
      billedStudentCount: Number.parseInt(openForecastRow.billed_student_count, 10) || 0,
      zeroExpectedCount: Number.parseInt(openForecastRow.zero_expected_count, 10) || 0,
      confidence: buildStripeForecastConfidence(openForecastRow),
    } : null;

    return (
      <AdminFinanceView
        view="overview"
        stripeReconciliation={stripeReconciliation}
        openStripeForecast={openStripeForecast}
      />
    );
  }

  const [
    students,
    scheduleRows,
    tutorPayRows,
    expenseRows,
    expenseLogRows,
    snapshotRows,
    waitingRows,
    archiveRows,
    stripeCacheRows,
  ] = await Promise.all([
    getOperationalAdminStudents(),
    getScheduleContextRows(),
    getTutorPayRows(),
    getExpenseRows(),
    getExpenseLogRows(),
    getFinanceSnapshotRows(),
    getWaitingListStateRows(),
    getStudentsArchiveRows(),
    getStripeAmountsCacheRows(),
  ]);

  const scheduleByMmsId = enrichScheduleContextsWithSharedSlots(scheduleRows);
  const enriched = students.map((student) => ({
    ...student,
    scheduleContext: scheduleByMmsId.get(student.mmsId) || student.scheduleContext || null,
  }));
  const tutorPay = parseTutorPay(tutorPayRows);
  const stripeActuals = buildStripeAmountsMap(stripeCacheRows);
  const overview = buildFinanceOverview(enriched, {
    tutorPay,
    expenseRows,
    expenseLogRows,
    stripeAmounts: stripeActuals.amounts,
  });
  const coverage = buildFinanceCoverage(enriched, { tutorPay });
  const trend = buildFinanceTrend(snapshotRows, { period: 'weekly', limit: 12 });
  const roster = buildRosterMovement({
    onboardedDates: onboardedDatesFromWaitingState(waitingRows),
    leftDates: leftDatesFromArchive(archiveRows),
    months: 6,
  });
  const spend = overview.actualSpend || buildExpenseLogSummary(expenseLogRows);
  const attentionItems = [
    coverage.flagCounts.noSchedule ? {
      title: `${coverage.flagCounts.noSchedule} active student${coverage.flagCounts.noSchedule === 1 ? '' : 's'} missing schedule context`,
      href: '/admin/capacity',
    } : null,
    coverage.flagCounts.noRevenuePrice || coverage.flagCounts.noDuration ? {
      title: `${(coverage.flagCounts.noRevenuePrice || 0) + (coverage.flagCounts.noDuration || 0)} pricing input gap${((coverage.flagCounts.noRevenuePrice || 0) + (coverage.flagCounts.noDuration || 0)) === 1 ? '' : 's'}`,
      href: '/admin/students',
    } : null,
    coverage.tutorsNotInPayTable.length ? {
      title: `${coverage.tutorsNotInPayTable.length} tutor${coverage.tutorsNotInPayTable.length === 1 ? '' : 's'} using the default hourly rate`,
      href: '/admin/finance/payroll',
    } : null,
    stripeActuals.staleCount ? {
      title: `${stripeActuals.staleCount} stale Stripe amount row${stripeActuals.staleCount === 1 ? '' : 's'}`,
    } : null,
    spend.futureEntries.length ? {
      title: `${spend.futureEntries.length} future-dated spend entr${spend.futureEntries.length === 1 ? 'y' : 'ies'} to correct`,
      href: '/admin/finance?view=spend',
    } : null,
  ].filter(Boolean);

  return (
    <AdminFinanceView
      view={view}
      totals={overview.totals}
      revenue={overview.revenue}
      cost={overview.cost}
      expenses={overview.expenses}
      coverage={coverage}
      trend={trend}
      attentionItems={attentionItems}
      roster={roster}
      spend={spend}
      today={new Date().toISOString().slice(0, 10)}
      addExpenseLogAction={addExpenseLogAction}
      deleteExpenseLogAction={deleteExpenseLogAction}
    />
  );
}
