/** @fileoverview Audits explicit private reminder handoffs with injected storage; copying never records delivery. */
import { payrollStatementFingerprint } from './payroll-batch-helpers.mjs';
export async function recordPayrollReminder({ payrollId, fingerprint, action, revised = false, actor, loadRuns, markSent, appendEvent, now = new Date() }) {
  if (!['copied', 'sent'].includes(action)) throw new Error('Choose a reminder action.');
  const row = (await loadRuns()).find((entry) => entry.payroll_id === payrollId);
  if (!row || row.status !== 'reviewed' || row.tutor_response === 'disputed' || payrollStatementFingerprint(row) !== fingerprint)
    throw new Error('The statement changed or has an unresolved query. Reopen and check it before sharing.');
  if (action === 'sent' && !row.statement_sent_at) {
    const result = await markSent({ payrollId, actorEmail: actor });
    if (!result.ok) throw new Error('Could not record statement delivery. Check its current state.');
  }
  await appendEvent({ occurredAt: new Date(now).toISOString(), actorEmail: actor,
    entityType: 'payroll', entityId: payrollId, eventType: action === 'sent' ? 'payroll_reminder_sent_admin_confirmed' : 'payroll_reminder_copied',
    payloadJson: JSON.stringify({ channel: 'private_whatsapp', revised: revised === true }) });
  return { ok: true };
}
