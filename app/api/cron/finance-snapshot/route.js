/** @fileoverview Scheduled endpoint composing the nightly Finance_Snapshot row from students, schedules, pay, expenses, and Stripe amounts. */
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  getScheduleContextRows,
  getTutorPayRows,
  getExpenseRows,
  getExpenseLogRows,
  getWaitingListStateRows,
  getStudentsArchiveRows,
  getStripeAmountsCacheRows,
  getFinanceSnapshotRows,
  appendFinanceSnapshotRow,
} from '@/lib/admin/sheets';
import { buildStripeAmountsMap } from '@/lib/admin/stripe-amounts-helpers.mjs';
import { enrichScheduleContextsWithSharedSlots } from '@/lib/admin/schedule-context-helpers.mjs';
import { parseTutorPay } from '@/lib/admin/cost-helpers.mjs';
import { archivedDatesFromArchive, countDatesInRange, onboardedDatesFromWaitingState } from '@/lib/admin/roster-movement.mjs';
import { buildFinanceOverview, buildFinanceSnapshotRow } from '@/lib/admin/finance-helpers.mjs';
import { createFinanceSnapshotPostHandler } from '@/lib/admin/finance-snapshot-endpoint.mjs';

// Append-only finance run-rate snapshot, called by a GitHub Action cron (weekly +
// monthly). Secret-authenticated (mirrors the schedule-refresh pattern) since there is
// no admin session. Read-only over the data already loaded; the only write is the
// append to Finance_Snapshot. Builds the seasonal time series (e.g. summer drop-off).

async function buildCurrentFinanceSnapshotRow({ periodType, at }) {
  const [students, scheduleRows, tutorPayRows, expenseRows, expenseLogRows, waitingStateRows, archiveRows, stripeCacheRows] = await Promise.all([
    getOperationalAdminStudents(),
    getScheduleContextRows(),
    getTutorPayRows(),
    getExpenseRows(),
    getExpenseLogRows(),
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
  // Stripe actuals where fresh (14-day guard) — the snapshot's source column flips
  // to 'mixed' once any student is priced from the cache.
  const stripeActuals = buildStripeAmountsMap(stripeCacheRows);
  const overview = buildFinanceOverview(enriched, {
    tutorPay,
    expenseRows,
    expenseLogRows,
    stripeAmounts: stripeActuals.amounts,
  });

  // Gross roster flows during this period (weekly = trailing 7 days, monthly = trailing month).
  const fromISO = new Date(at.getTime() - (periodType === 'monthly' ? 31 : 7) * 24 * 60 * 60 * 1000).toISOString();
  const roster = {
    onboarded: countDatesInRange(onboardedDatesFromWaitingState(waitingStateRows), { fromISO, toISO: at.toISOString() }),
    left: countDatesInRange(archivedDatesFromArchive(archiveRows), { fromISO, toISO: at.toISOString() }),
  };
  return buildFinanceSnapshotRow(overview, { periodType, at, roster });
}

export const POST = createFinanceSnapshotPostHandler({
  getSnapshotRows: getFinanceSnapshotRows,
  buildSnapshotRow: buildCurrentFinanceSnapshotRow,
  appendSnapshotRow: appendFinanceSnapshotRow,
});
