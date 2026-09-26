/** @fileoverview Dependency-injected payment preparation and partial-safe recording for an exact downloaded batch; never sends money. */
import { buildWiseBatch, parseTutorWise, selectPayableReviewedRuns, toWiseCsv } from './wise-helpers.mjs';
import { createPayrollBatchToken, payrollBatchFingerprint, payrollStatementFingerprint, verifyPayrollBatchToken } from './payroll-batch-helpers.mjs';
import { isPayrollRunReadyForPayment } from './payroll-workflow-helpers.mjs';

export async function preparePayrollBatch({ loadRuns, loadWise, checkAttendance, expectedFingerprint, expectedIds = [], actor, secret, now = new Date() }) {
  const [runs, wise] = await Promise.all([loadRuns(), loadWise()]);
  const wanted = new Set(expectedIds);
  const selected = (all) => selectPayableReviewedRuns(all, { now }).rows.filter((row) => row.allPayrollIds.every((id) => wanted.has(id)));
  const rows = selected(runs);
  const batch = buildWiseBatch({ rows, wiseByKey: parseTutorWise(wise) });
  if (!batch.includedCount || payrollBatchFingerprint(batch) !== expectedFingerprint) {
    throw new Error('The batch has changed. Refresh payroll and review the updated list before downloading.');
  }
  // Validate the exact reviewed statements against fresh MMS before creating a file.
  const included = new Set(batch.includedPayrollIds);
  for (const run of runs.filter((row) => included.has(row.payroll_id))) await checkAttendance(run, runs);
  // Provider reads may have taken time: refuse a changed response/amount/recipient.
  const [latest, latestWise] = await Promise.all([loadRuns(), loadWise()]);
  const current = buildWiseBatch({ rows: selected(latest), wiseByKey: parseTutorWise(latestWise) });
  if (payrollBatchFingerprint(current) !== expectedFingerprint || runs.filter((row) => included.has(row.payroll_id)).some((row) =>
    payrollStatementFingerprint(row) !== payrollStatementFingerprint(latest.find((entry) => entry.payroll_id === row.payroll_id) || {}))) {
    throw new Error('A statement changed during the check. Refresh payroll before downloading.');
  }
  return { csv: toWiseCsv(batch.csvRows), token: createPayrollBatchToken({ batch, runs: latest, actor, secret, now: new Date(now).getTime() }),
    tutors: batch.includedTutors, totalAmount: batch.totalAmount };
}

export async function recordPayrollBatchPaid({ token, actor, secret, loadRuns, saveRun, now = new Date() }) {
  const snapshot = verifyPayrollBatchToken(token, { secret, actor, now: new Date(now).getTime() });
  if (!snapshot) throw new Error('The downloaded batch record is missing or expired. Reconcile the payment record before preparing another payment.');
  const rows = await loadRuns();
  const byId = new Map(rows.map((row) => [row.payroll_id, row]));
  // All validation happens before the first write. Retrying a partial write only
  // records rows still reviewed; it never restores a paid row to the batch.
  for (const item of snapshot.rows) {
    const row = byId.get(item.id);
    if (!row || payrollStatementFingerprint(row) !== item.fingerprint || !['reviewed', 'paid'].includes(row.status))
      throw new Error('A downloaded statement has changed. Check the actual Wise payment and resolve it before recording this batch.');
    if (row.status === 'reviewed' && !isPayrollRunReadyForPayment(row, { now })) throw new Error('A statement is no longer ready. Check Wise and resolve its current state.');
    if (row.status === 'paid' && row.paid_via !== 'wise') throw new Error('A statement was recorded as paid separately. Check the actual payment before continuing.');
  }
  const recorded = [];
  for (const item of snapshot.rows) {
    const row = byId.get(item.id);
    if (row.status === 'paid') continue;
    try {
      await saveRun({ ...row, status: 'paid', paid_at: new Date(now).toISOString(), paid_by: actor, paid_via: 'wise', updated_at: new Date(now).toISOString() });
      recorded.push(item.id);
    } catch {
      return { ok: false, recorded, error: 'Some payment records could not be saved. Keep this batch open and retry recording after checking the records; do not pay it again.' };
    }
  }
  return { ok: true, recorded };
}
