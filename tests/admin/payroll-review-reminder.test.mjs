import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayrollReview } from '../../lib/admin/payroll-review-helpers.mjs';
import { recordPayrollReminder } from '../../lib/admin/payroll-reminder-runner.mjs';
import { payrollStatementFingerprint } from '../../lib/admin/payroll-batch-helpers.mjs';

test('review refuses missing evidence, stale forms and mismatched calculations', () => {
  const args = { existing: { updated_at: 'new' }, expectedUpdatedAt: 'new', preview: { cadenceDue: true, expectedAmount: 24, lessonCount: 2, teachingMinutes: 60 }, expectedAmount: '24', lessonCount: '2', teachingMinutes: '60' };
  assert.doesNotThrow(() => validatePayrollReview(args));
  assert.throws(() => validatePayrollReview({ ...args, expectedUpdatedAt: 'old' }), /changed/);
  assert.throws(() => validatePayrollReview({ ...args, preview: null }), /evidence/);
  assert.throws(() => validatePayrollReview({ ...args, expectedAmount: '20' }), /calculation changed/);
  for (const key of ['reviewPastCount', 'overlapsPaid', 'overlapsOutstanding', 'priorRunPending', 'periodOpen', 'cutoverNeedsStart', 'windowCapped'])
    assert.throws(() => validatePayrollReview({ ...args, preview: { ...args.preview, [key]: 1 } }), /evidence/);
});
test('copy audits intent only; an explicit private-send confirmation may record first delivery', async () => {
  const row = { payroll_id: 'one', status: 'reviewed', final_amount: '24' };
  const events = []; const deliveries = [];
  const args = { payrollId: 'one', fingerprint: payrollStatementFingerprint(row), actor: 'admin@example.test', loadRuns: async () => [row],
    markSent: async (input) => { deliveries.push(input); return { ok: true }; }, appendEvent: async (event) => events.push(event) };
  await recordPayrollReminder({ ...args, action: 'copied' });
  assert.equal(deliveries.length, 0); assert.equal(events[0].eventType, 'payroll_reminder_copied');
  await recordPayrollReminder({ ...args, action: 'sent' });
  assert.equal(deliveries.length, 1); assert.equal(events[1].eventType, 'payroll_reminder_sent_admin_confirmed');
  assert.doesNotMatch(JSON.stringify(events), /https:|statementUrl|£/);
  await assert.rejects(() => recordPayrollReminder({ ...args, action: 'sent', loadRuns: async () => [{ ...row, tutor_response: 'disputed' }] }));
  assert.equal(deliveries.length, 1);
});
