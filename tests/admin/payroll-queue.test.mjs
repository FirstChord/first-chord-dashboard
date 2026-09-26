import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollQueue, payrollWorkspaceAttendanceQuery } from '../../lib/admin/payroll-queue-helpers.mjs';
import { currentPayrollMonday, buildPayrollReminder, requiresPayrollConfirmation, regularPayrollPaymentTiming } from '../../lib/admin/payroll-cycle-helpers.mjs';
import { getPayrollWorkflowState, isPayrollRunReadyForPayment } from '../../lib/admin/payroll-workflow-helpers.mjs';

const current = { tutor: 'Tutor One', tutorShortName: 'One', periodStart: '2026-09-21', periodEnd: '2026-09-27', status: 'reviewed', paymentRoute: 'normal' };
const now = new Date('2026-09-30T08:00:00Z');
test('Wednesday retains the completed Monday cycle, including the UK midnight boundary', () => {
  assert.equal(currentPayrollMonday(now), '2026-09-28');
  assert.equal(currentPayrollMonday(new Date('2026-09-27T23:30:00Z')), '2026-09-28');
  assert.equal(currentPayrollMonday(new Date('2026-10-25T23:30:00Z')), '2026-10-19');
});
test('new-system statements cannot bypass confirmation with a legacy normal route', () => {
  assert.equal(requiresPayrollConfirmation(current), true);
  assert.equal(isPayrollRunReadyForPayment(current, { now }), false);
  assert.equal(getPayrollWorkflowState(current).key, 'send');
  assert.equal(getPayrollWorkflowState({ ...current, statementSentAt: '2026-09-28' }).key, 'awaiting');
  assert.equal(isPayrollRunReadyForPayment({ ...current, tutorResponse: 'confirmed', tutorRespondedAt: '2026-09-29T12:00:00Z' }, { now }), true);
});
test('readiness never hides missing recipients, conflicts or unavailable attendance', () => {
  const row = { ...current, tutorResponse: 'confirmed', tutorRespondedAt: '2026-09-29T12:00:00Z' };
  assert.equal(buildPayrollQueue([row], { now, missing: [{ tutor: row.tutor }] })[0].workflow.key, 'recipient_missing');
  assert.equal(buildPayrollQueue([row], { now, amountConflicts: [{ tutor: row.tutor }] })[0].workflow.key, 'amount_conflict');
  assert.equal(buildPayrollQueue([row], { now, attendanceUnavailable: true })[0].group, 'handle');
  assert.equal(buildPayrollQueue([{ ...current, statementSentAt: '2026-09-28' }])[0].group, 'waiting');
  assert.equal(buildPayrollQueue([{ ...current, statementDeliveryStatus: 'unknown' }])[0].workflow.key, 'delivery_unknown');
});
test('attendance refresh includes carried statements and refuses unbounded reads', () => {
  const base = { startDate: '2026-09-01', endDate: '2026-10-04' };
  assert.equal(payrollWorkspaceAttendanceQuery(base, [{ status: 'reviewed', period_start: '2026-08-20' }]).startDate, '2026-08-20');
  assert.throws(() => payrollWorkspaceAttendanceQuery(base, [{ status: 'reviewed', period_start: '2024-01-01' }]));
});
test('private reminder names the period and carry-forward rule without money or student detail', () => {
  const text = buildPayrollReminder({ tutor: 'Alex Example', periodStart: '2026-09-21', periodEnd: '2026-09-27', statementUrl: 'https://example.test/private', revised: true });
  assert.match(text, /revised/);
  assert.match(text, /21 Sept.*27 Sept/);
  assert.match(text, /carry over/);
  assert.match(text, /https:\/\/example.test\/private/);
  assert.doesNotMatch(text, /£/);
});

test('Wednesday cutoff carries late confirmations forward, with UK daylight savings handled', () => {
  const before = { ...current, tutorResponse: 'confirmed', tutorRespondedAt: '2026-09-30T07:59:59Z' };
  const late = { ...before, tutorRespondedAt: '2026-09-30T08:00:00Z' };
  assert.equal(regularPayrollPaymentTiming(before, { now }).eligible, true);
  assert.deepEqual(regularPayrollPaymentTiming(late, { now }), { eligible: false, paymentDate: '2026-10-07', reason: 'next_week' });
  assert.equal(isPayrollRunReadyForPayment(late, { now }), false);
  assert.equal(isPayrollRunReadyForPayment(late, { now: new Date('2026-10-05T12:00:00Z') }), true);
  assert.equal(getPayrollWorkflowState(late, { now }).key, 'next_week');
  assert.equal(regularPayrollPaymentTiming({ ...late, tutorRespondedAt: '2026-10-28T08:59:59Z' }, { now: new Date('2026-10-28T10:00:00Z') }).eligible, true);
  assert.equal(regularPayrollPaymentTiming({ ...late, tutorRespondedAt: '2026-10-28T09:00:00Z' }, { now: new Date('2026-10-28T10:00:00Z') }).eligible, false);
  assert.equal(regularPayrollPaymentTiming({ ...late, tutorRespondedAt: '' }, { now }).reason, 'missing_confirmation_time');
});
