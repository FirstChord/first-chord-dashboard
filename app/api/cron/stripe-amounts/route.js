/** @fileoverview Scheduled Stripe actuals refresh rebuilding the amounts cache and appending collected and forecast monthly rows. */
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  appendStripeForecastMonthlyRow,
  getPlanningItemRows,
  getScheduleContextRows,
  getStudentsArchiveRows,
  getStripeForecastMonthlyRows,
  replaceStripeAmountsCacheRows,
  upsertStripeCollectedMonthlyRow,
} from '@/lib/admin/sheets';
import { fetchAllActiveSubscriptions, fetchPaidInvoicesForMonth } from '@/lib/admin/stripe-batch';
import { buildStripeAmountsCacheRows, previousMonthKey, summariseCollectedInvoices } from '@/lib/admin/stripe-amounts-helpers.mjs';
import { createStripeAmountsPostHandler } from '@/lib/admin/stripe-amounts-endpoint.mjs';
import { enrichScheduleContextsWithSharedSlots } from '@/lib/admin/schedule-context-helpers.mjs';
import { buildStripeForecastRow, buildStripeMonthlyForecast } from '@/lib/admin/stripe-forecast-helpers.mjs';

// Stripe actuals refresh, called by GitHub Actions on the first of each month and
// Mondays before the finance snapshot. Before any Stripe read, it locks the
// current month's forecast using dashboard-owned roster, price, schedule,
// expectation and structured-pause evidence only. Provider facts are revealed
// afterward into separate cache rows.

async function buildCurrentStripeForecastRow({ month, forecastedAt }) {
  const [students, scheduleRows, planningRows] = await Promise.all([
    getOperationalAdminStudents(),
    getScheduleContextRows(),
    getPlanningItemRows(),
  ]);
  const scheduleByMmsId = enrichScheduleContextsWithSharedSlots(scheduleRows);
  const enriched = students.map((student) => ({
    ...student,
    scheduleContext: scheduleByMmsId.get(student.mmsId) || student.scheduleContext || null,
  }));
  return buildStripeForecastRow(buildStripeMonthlyForecast({
    students: enriched,
    planningRows,
    month,
    forecastedAt,
  }));
}

export const POST = createStripeAmountsPostHandler({
  getForecastRows: getStripeForecastMonthlyRows,
  buildForecastRow: buildCurrentStripeForecastRow,
  appendForecastRow: appendStripeForecastMonthlyRow,
  getStudents: getOperationalAdminStudents,
  getArchivedStudents: getStudentsArchiveRows,
  fetchSubscriptions: fetchAllActiveSubscriptions,
  buildCacheRows: buildStripeAmountsCacheRows,
  replaceCacheRows: replaceStripeAmountsCacheRows,
  previousMonth: previousMonthKey,
  fetchPaidInvoices: fetchPaidInvoicesForMonth,
  summariseInvoices: summariseCollectedInvoices,
  upsertCollectedMonth: upsertStripeCollectedMonthlyRow,
});
