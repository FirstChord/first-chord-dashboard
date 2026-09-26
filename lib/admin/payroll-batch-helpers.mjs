/** @fileoverview Pure signed batch snapshots binding the reviewed payment file to exact payroll statements. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function payrollStatementFingerprint(row) {
  return digest(['payroll_id', 'tutor_short_name', 'period_start', 'period_end', 'expected_amount', 'adjustment_amount', 'final_amount', 'lesson_count', 'teaching_minutes', 'payment_route', 'reviewed_at', 'tutor_response', 'tutor_responded_at']
    .map((key) => `${row[key] ?? ''}`));
}
export function payrollBatchFingerprint(batch) {
  return digest({ csvRows: batch.csvRows, ids: [...batch.includedPayrollIds].sort() });
}
export function createPayrollBatchToken({ batch, runs, actor, secret, now = Date.now() }) {
  if (!secret || !actor || !batch.includedCount) throw new Error('A reviewed batch and signing key are required.');
  const byId = new Map(runs.map((row) => [row.payroll_id, row]));
  const payload = {
    purpose: 'payroll-batch-v1', actor, createdAt: now,
    rows: batch.includedPayrollIds.map((id) => ({ id, fingerprint: payrollStatementFingerprint(byId.get(id)) })),
    fingerprint: payrollBatchFingerprint(batch),
    tutors: batch.includedTutors, totalAmount: batch.totalAmount,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyPayrollBatchToken(token, { secret, actor, now = Date.now() }) {
  if (!secret || typeof token !== 'string' || token.length > 100000) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.purpose !== 'payroll-batch-v1' || payload.actor !== actor || !Array.isArray(payload.rows) || !payload.rows.length
      || !Number.isFinite(payload.createdAt) || payload.createdAt > now || now - payload.createdAt > 7 * 86400000) return null;
    return payload;
  } catch { return null; }
}
