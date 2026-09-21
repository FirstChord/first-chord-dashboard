import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPayrollWorkflowState,
  hasMaterialTutorStatementChange,
  isPayrollRunReadyForPayment,
  normalisePayrollPaymentRoute,
} from '../../lib/admin/payroll-workflow-helpers.mjs';

test('normal payment remains the safe transitional default', () => {
  assert.equal(normalisePayrollPaymentRoute(''), 'normal');
  assert.equal(isPayrollRunReadyForPayment({ status: 'reviewed' }), true);
  assert.equal(getPayrollWorkflowState({ status: 'reviewed' }).key, 'ready');
});

test('confirmation route waits for a tutor response before payment', () => {
  const reviewed = { status: 'reviewed', paymentRoute: 'confirmation' };
  assert.equal(getPayrollWorkflowState(reviewed).key, 'send');
  assert.equal(getPayrollWorkflowState({ ...reviewed, statementSentAt: '2026-07-12T10:00:00Z' }).key, 'awaiting');
  assert.equal(isPayrollRunReadyForPayment({ ...reviewed, tutorResponse: '' }), false);
  assert.equal(isPayrollRunReadyForPayment({ ...reviewed, tutorResponse: 'confirmed' }), true);
});

test('disputes and attendance exceptions take precedence over payment readiness', () => {
  assert.equal(isPayrollRunReadyForPayment({ status: 'reviewed', tutorResponse: 'disputed' }), false);
  assert.equal(getPayrollWorkflowState({ status: 'reviewed', paymentRoute: 'normal', tutorResponse: 'disputed' }).key, 'disputed');
  assert.equal(getPayrollWorkflowState({ status: 'draft', reviewPastCount: 1 }).key, 'attendance');
  assert.equal(getPayrollWorkflowState({ status: 'paid' }).key, 'paid');
});

test('a refreshed MMS correction sends a reviewed run back for an explicit save', () => {
  const state = getPayrollWorkflowState({ status: 'reviewed', paymentRoute: 'normal', attendanceChanged: true });
  assert.equal(state.key, 'mms_changed');
  assert.equal(state.readyForPayment, false);
});

test('a clean draft with an incomplete cadence reads as not due, while attendance still wins', () => {
  assert.equal(getPayrollWorkflowState({ status: 'draft', cadenceDue: false }).key, 'not_due');
  assert.equal(getPayrollWorkflowState({ status: 'draft', cadenceDue: false, reviewPastCount: 1 }).key, 'attendance');
});

test('material statement changes require a fresh tutor response', () => {
  const existing = {
    period_start: '2026-07-01',
    period_end: '2026-07-12',
    lesson_count: '8',
    teaching_minutes: '240',
    expected_amount: '96',
    adjustment_amount: '0',
    final_amount: '96',
    payment_route: 'confirmation',
  };
  assert.equal(hasMaterialTutorStatementChange(existing, { ...existing }), false);
  assert.equal(hasMaterialTutorStatementChange(existing, { ...existing, final_amount: '97' }), true);
  assert.equal(hasMaterialTutorStatementChange(existing, { ...existing, period_end: '2026-07-13' }), true);
  assert.equal(hasMaterialTutorStatementChange(existing, { ...existing, payment_route: 'normal' }), true);
  assert.equal(hasMaterialTutorStatementChange(
    { ...existing, notes: 'old', invoice_status: 'missing' },
    { ...existing, notes: 'new', invoice_status: 'received' },
  ), false);
});
