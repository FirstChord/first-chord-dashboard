/** @fileoverview Audits private payroll reminder and query-reply handoffs; copying never records delivery. */
import { payrollStatementFingerprint } from './payroll-batch-helpers.mjs';
import { isPayrollCutoverPeriod } from './payroll-helpers.mjs';
export async function recordPayrollReminder({ payrollId, fingerprint, action, revised = false, actor, loadRuns, markSent, appendEvent, now = new Date() }) {
  if (!['copied', 'sent', 'query_copied', 'query_sent'].includes(action)) throw new Error('Choose a reminder action.');
  const row = (await loadRuns()).find((entry) => entry.payroll_id === payrollId);
  const isQueryReply = action.startsWith('query_');
  const queryAllowed = row?.tutor_response === 'disputed' && (row.status === 'reviewed'
    || (row.status === 'paid' && row.paid_via === 'manual' && isPayrollCutoverPeriod({ periodEnd: row.period_end })));
  if (!row || payrollStatementFingerprint(row) !== fingerprint
    || (isQueryReply ? !queryAllowed : row.status !== 'reviewed' || row.tutor_response === 'disputed'))
    throw new Error('The statement changed or has an unresolved query. Reopen and check it before sharing.');
  if (action === 'sent' && !row.statement_sent_at) {
    const result = await markSent({ payrollId, actorEmail: actor });
    if (!result.ok) throw new Error('Could not record statement delivery. Check its current state.');
  }
  const eventType = {
    copied: 'payroll_reminder_copied', sent: 'payroll_reminder_sent_admin_confirmed',
    query_copied: 'payroll_query_reply_copied', query_sent: 'payroll_query_reply_sent_admin_confirmed',
  }[action];
  await appendEvent({ occurredAt: new Date(now).toISOString(), actorEmail: actor,
    entityType: 'payroll', entityId: payrollId, eventType,
    payloadJson: JSON.stringify({ channel: 'private_whatsapp', revised: !isQueryReply && revised === true }) });
  return { ok: true };
}
