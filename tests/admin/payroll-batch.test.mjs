import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWiseBatch, parseTutorWise, selectPayableReviewedRuns } from '../../lib/admin/wise-helpers.mjs';
import { payrollBatchFingerprint, verifyPayrollBatchToken } from '../../lib/admin/payroll-batch-helpers.mjs';
import { preparePayrollBatch, recordPayrollBatchPaid } from '../../lib/admin/payroll-batch-runner.mjs';

const now = new Date('2026-09-30T08:00:00Z');
const actor = 'admin@example.test';
const secret = 'test-only-payroll-signature';
function fixture() {
  let runs = ['A', 'B'].map((tutor) => ({ payroll_id: `run-${tutor}`, tutor, tutor_short_name: tutor, period_start: '2026-09-21', period_end: '2026-09-27', status: 'reviewed', final_amount: '24', expected_amount: '24', payment_route: 'confirmation', tutor_response: 'confirmed', tutor_responded_at: '2026-09-29T12:00:00Z', reviewed_at: '2026-09-28T10:00:00Z' }));
  const wise = ['A', 'B'].map((tutor) => ({ tutor, recipient_id: `recipient-${tutor}`, name: tutor }));
  const batch = buildWiseBatch({ rows: selectPayableReviewedRuns(runs, { now }).rows, wiseByKey: parseTutorWise(wise) });
  let checks = 0;
  const options = { actor, secret, now, loadRuns: async () => structuredClone(runs), loadWise: async () => wise,
    checkAttendance: async () => { checks += 1; }, expectedFingerprint: payrollBatchFingerprint(batch), expectedIds: batch.includedPayrollIds };
  const saveRun = async (row) => { runs = runs.map((entry) => entry.payroll_id === row.payroll_id ? row : entry); };
  return { options, saveRun, mutate: (fn) => { runs = fn(runs); }, rows: () => runs, checks: () => checks };
}
test('download checks attendance and signs the exact reviewed amounts; recording is idempotent', async () => {
  const f = fixture(); const result = await preparePayrollBatch(f.options);
  assert.equal(f.checks(), 2); assert.equal(result.totalAmount, 48); assert.match(result.csv, /24.00/);
  const paid = await recordPayrollBatchPaid({ ...f.options, token: result.token, saveRun: f.saveRun });
  assert.equal(paid.recorded.length, 2); assert.ok(f.rows().every((row) => row.status === 'paid'));
  assert.equal((await recordPayrollBatchPaid({ ...f.options, token: result.token, saveRun: f.saveRun })).recorded.length, 0);
});
test('an added ready tutor cannot silently alter a selected downloaded batch', async () => {
  const f = fixture(); f.mutate((rows) => [...rows, { ...rows[0], payroll_id: 'run-C', tutor: 'C', tutor_short_name: 'C' }]);
  const result = await preparePayrollBatch(f.options);
  assert.equal(result.tutors.length, 2);
});
test('changes to money, recipients, confirmation or attendance prevent the file', async () => {
  for (const change of [{ final_amount: '25' }, { tutor_response: 'disputed' }, { tutor_response: '' }]) {
    const f = fixture(); f.mutate((rows) => [{ ...rows[0], ...change }, rows[1]]);
    await assert.rejects(() => preparePayrollBatch(f.options), /batch has changed/);
  }
  const f = fixture(); await assert.rejects(() => preparePayrollBatch({ ...f.options, checkAttendance: async () => { throw new Error('Attendance changed'); } }), /Attendance changed/);
  const g = fixture(); await assert.rejects(() => preparePayrollBatch({ ...g.options, loadWise: async () => [{ tutor: 'A', recipient_id: 'changed' }] }), /batch has changed/);
});
test('changes during a provider check fail before download', async () => {
  const f = fixture(); await assert.rejects(() => preparePayrollBatch({ ...f.options, checkAttendance: async () => { f.mutate((rows) => [{ ...rows[0], tutor_responded_at: '2026-09-30T07:00:00Z' }, rows[1]]); } }), /changed during/);
});
test('an invalid, expired or other-admin token cannot record payment', async () => {
  const f = fixture(); const { token } = await preparePayrollBatch(f.options);
  assert.equal(verifyPayrollBatchToken(`${token}x`, { secret, actor }), null);
  assert.equal(verifyPayrollBatchToken(token, { secret, actor: 'other@example.test', now: now.getTime() }), null);
  assert.equal(verifyPayrollBatchToken(token, { secret, actor, now: now.getTime() + 8 * 86400000 }), null);
  await assert.rejects(() => recordPayrollBatchPaid({ ...f.options, token: 'bad', saveRun: f.saveRun }));
  assert.ok(f.rows().every((row) => row.status === 'reviewed'));
});
test('a dispute after download refuses all writes, even if another tutor is still eligible', async () => {
  const f = fixture(); const { token } = await preparePayrollBatch(f.options);
  f.mutate((rows) => [rows[0], { ...rows[1], tutor_response: 'disputed' }]);
  await assert.rejects(() => recordPayrollBatchPaid({ ...f.options, token, saveRun: f.saveRun }), /changed/);
  assert.ok(f.rows().every((row) => row.status === 'reviewed'));
});
test('a partial Sheets failure reports unfinished recording and retry never repays or rewrites paid rows', async () => {
  const f = fixture(); const { token } = await preparePayrollBatch(f.options); let writes = 0;
  const result = await recordPayrollBatchPaid({ ...f.options, token, saveRun: async (row) => { if (++writes === 2) throw new Error('Unavailable'); await f.saveRun(row); } });
  assert.equal(result.ok, false); assert.deepEqual(result.recorded, ['run-A']);
  assert.deepEqual((await recordPayrollBatchPaid({ ...f.options, token, saveRun: f.saveRun })).recorded, ['run-B']);
});

test('a changed amount after download refuses payment recording before any row is written', async () => {
  const f = fixture(); const { token } = await preparePayrollBatch(f.options);
  f.mutate((rows) => [{ ...rows[0], final_amount: '240' }, rows[1]]);
  await assert.rejects(() => recordPayrollBatchPaid({ ...f.options, token, saveRun: f.saveRun }));
  assert.ok(f.rows().every((row) => row.status === 'reviewed'));
});
