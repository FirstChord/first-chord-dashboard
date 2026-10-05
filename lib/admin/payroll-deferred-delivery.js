/** @fileoverview Explicit admin approval/cancellation and fresh-source wiring for exact-period automatic payroll statement delivery. */
import { loadDeferredPayrollEvidence, sendPayrollRecordsNudge } from './payroll-record-actions.js';
import { createPayrollDeliveryStore, withPayrollDeliveryLock, payrollDeferredEnabled } from './payroll-delivery-store.mjs';
import { runDeferredPayrollChecks, prepareDeferredPayroll, cancelDeferredPayrollApproval } from './payroll-deferred-runner.mjs';
import { getPayrollRunRows, getTutorPayRows, getTutorLifecycleRows, upsertPayrollRunRow } from './sheets.js';
import { buildPayrollPreview, findBlockingReviewedRun, selectPayrollRosterRows } from './payroll-helpers.mjs';
import { parseTutorPay } from './cost-helpers.mjs';
import { decideDeferredPayroll } from './payroll-deferred-helpers.mjs';
import { activeNoPaymentDueRuns } from './payroll-zero-period-helpers.mjs';
import { sendTutorStatementEmail } from './tutor-statement-email.js';

export async function approveDeferredPayroll({ context, actor, env = process.env }) {
  if (!payrollDeferredEnabled(env)) return { ok: false, reason: 'disabled' };
  if (!actor) throw new Error('Sign in again before approving an automatic statement send.');
  const store = createPayrollDeliveryStore({ env });
  return withPayrollDeliveryLock(context.tutorShortName, async () => {
    const evidence = await loadDeferredPayrollEvidence(context);
    return prepareDeferredPayroll({ store, evidence, actor,
      nudge: () => sendPayrollRecordsNudge({ context, actor, env, deliveryLockHeld: true }) });
  }, { env });
}

export async function cancelDeferredPayroll({ id, actor, env = process.env }) {
  if (!payrollDeferredEnabled(env) || !actor) throw new Error('Automatic statement sending is unavailable.');
  const store = createPayrollDeliveryStore({ env });
  const job = await store.get(id);
  if (!job) throw new Error('Approval not found. Refresh payroll.');
  return withPayrollDeliveryLock(job.tutor_short_name, async () => {
    return cancelDeferredPayrollApproval({ store, id, actor });
  }, { env });
}

export async function checkDeferredPayroll({ env = process.env } = {}) {
  if (!payrollDeferredEnabled(env)) return { disabled: true, checked: 0, sent: 0 };
  const store = createPayrollDeliveryStore({ env });
  await store.parkInterrupted();
  return runDeferredPayrollChecks({ store, lock: (tutor, operation) => withPayrollDeliveryLock(tutor, operation, { env }),
    loadEvidence: loadDeferredPayrollEvidence,
    review: async (payload, evidence, job) => {
      const [latest, payRows, lifecycle] = await Promise.all([getPayrollRunRows({ force: true }), getTutorPayRows({ force: true }), getTutorLifecycleRows({ force: true })]);
      const current = latest.find((row) => row.payroll_id === payload.payroll_id);
      const markerVersion = (runs) => activeNoPaymentDueRuns(runs, payload.tutor_short_name, payload.period_end)
        .map((row) => `${row.payroll_id}|${row.updated_at}|${row.no_payment_due_fingerprint}`).join(';');
      if (`${current?.updated_at || ''}` !== `${evidence.existing?.updated_at || ''}` || markerVersion(latest) !== markerVersion(evidence.runs)) throw new Error('Payroll changed during the source check');
      const args = { attendanceRows: evidence.attendanceRows, attendanceRange: evidence.attendanceRange,
        savedRuns: latest, tutorPay: parseTutorPay(payRows), payDate: payload.pay_date, maxLookbackDays: 366 };
      const row = buildPayrollPreview({ ...args, overrides: { [payload.tutor_short_name]: { start: payload.period_start, end: payload.period_end } } })
        .rows.find((entry) => entry.payrollId === payload.payroll_id);
      if (!row || findBlockingReviewedRun(latest, { tutorShortName: row.tutorShortName, tutor: row.tutor, payrollId: row.payrollId })) throw new Error('An earlier statement needs attention');
      const checked = { row, existing: current,
        standardWindow: buildPayrollPreview(args).rows.find((entry) => entry.tutorShortName === row.tutorShortName),
        active: selectPayrollRosterRows([row], lifecycle, []).length === 1 };
      if (decideDeferredPayroll({ job: { ...job, status: 'waiting' }, evidence: checked }).action !== 'send') throw new Error('The approved settings changed');
      await upsertPayrollRunRow(payload);
    },
    send: (options) => sendTutorStatementEmail({ ...options, env }),
  });
}
