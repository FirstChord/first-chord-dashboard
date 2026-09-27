import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManualCutoverConfirmationWaiver, buildManualCutoverEmailConfirmation, buildManualCutoverPayment } from '../../lib/admin/payroll-manual-settlement-helpers.mjs';
import { hasCutoverConfirmationWaiver, isPaidCutoverFollowUpOpen, normalisePayrollRunRow } from '../../lib/admin/payroll-helpers.mjs';
import { requiresPayrollConfirmation } from '../../lib/admin/payroll-cycle-helpers.mjs';
import { canRespondToPaidStatement, getPayrollWorkflowState, isPayrollRunReadyForPayment } from '../../lib/admin/payroll-workflow-helpers.mjs';
import { selectPayableReviewedRuns } from '../../lib/admin/wise-helpers.mjs';

const row = {
  payroll_id: 'payroll_calum_2026-09-18_2026-09-20',
  period_start: '2026-09-18',
  period_end: '2026-09-20',
  status: 'reviewed',
  final_amount: '60',
  payment_route: 'confirmation',
  tutor: 'Calum Steel',
  tutor_short_name: 'Calum',
  statement_sent_at: '2026-09-23T19:25:31Z',
};

const input = {
  expectedAmount: '60',
  paymentDate: '2026-09-24',
  actorEmail: 'admin@example.com',
  now: '2026-09-24T12:00:00Z',
};

test('external payment leaves confirmation outstanding and never enters Wise', () => {
  const paid = buildManualCutoverPayment(row, input);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.tutor_response || '', '');
  assert.equal(paid.paid_at, '2026-09-24');
  assert.equal(paid.paid_via, 'manual');
  assert.equal(paid.paid_by, 'admin@example.com');
  assert.equal(paid.statement_sent_at, row.statement_sent_at);
  assert.equal(getPayrollWorkflowState(paid).key, 'paid_awaiting');
  assert.equal(canRespondToPaidStatement(paid), true);
  assert.equal(canRespondToPaidStatement({ ...paid, paid_via: 'wise' }), false);
  assert.equal(canRespondToPaidStatement({ ...paid, period_end: '2026-09-27' }), false);
  assert.equal(isPayrollRunReadyForPayment(paid), false);
  assert.deepEqual(selectPayableReviewedRuns([paid]).rows, []);
});

test('a later email confirmation records source without a second payment', () => {
  const paid = buildManualCutoverPayment(row, input);
  const confirmed = buildManualCutoverEmailConfirmation(paid, {
    confirmationDate: '2026-09-24', actorEmail: 'admin@example.com', now: input.now,
  });
  assert.equal(confirmed.tutor_response, 'confirmed');
  assert.equal(confirmed.tutor_response_source, 'email_admin_recorded');
  assert.equal(confirmed.tutor_responded_at, '2026-09-24');
  assert.equal(confirmed.paid_at, paid.paid_at);
  assert.equal(confirmed.status, 'paid');
  assert.equal(getPayrollWorkflowState(confirmed).key, 'paid');
  assert.deepEqual(selectPayableReviewedRuns([confirmed]).rows, []);
  assert.equal(buildManualCutoverEmailConfirmation(paid, { actorEmail: 'admin@example.com', now: input.now }).tutor_responded_at, '');
});

test('paid cutover query remains visible but still cannot enter Wise', () => {
  const disputed = { ...buildManualCutoverPayment(row, input), tutor_response: 'disputed' };
  assert.equal(getPayrollWorkflowState(disputed).key, 'paid_query');
  assert.equal(isPayrollRunReadyForPayment(disputed), false);
  assert.deepEqual(selectPayableReviewedRuns([disputed]).rows, []);
});

test('payment and email-confirmation guards reject stale or invalid records', () => {
  assert.throws(() => buildManualCutoverPayment(row, { ...input, expectedAmount: '61' }), /amount changed/u);
  assert.throws(() => buildManualCutoverPayment({ ...row, status: 'paid' }, input), /open reviewed/u);
  assert.throws(() => buildManualCutoverPayment({ ...row, period_end: '2026-09-27' }, input), /cutover/u);
  assert.throws(() => buildManualCutoverPayment(row, { ...input, paymentDate: '2026-09-25' }), /actual/u);
  assert.throws(() => buildManualCutoverPayment(row, { ...input, actorEmail: '' }), /admin identity/u);
  const paid = buildManualCutoverPayment(row, input);
  assert.throws(() => buildManualCutoverEmailConfirmation(row, { actorEmail: 'admin@example.com' }), /separately paid/u);
  assert.throws(() => buildManualCutoverEmailConfirmation(paid, { actorEmail: 'admin@example.com', confirmationDate: '2026-09-31', now: input.now }), /actual/u);
  assert.throws(() => buildManualCutoverEmailConfirmation({ ...paid, tutor_response: 'confirmed' }, { actorEmail: 'admin@example.com' }), /already confirmed/u);
});

const waiverInput = { actor: 'Admin (explicit instruction)', reason: 'Already paid; collect confirmation on the first regular statement.', now: '2026-09-27T12:00:00Z' };

test('admin waiver closes only the paid cutoff follow-up, preserving payment and response truth', () => {
  const paid = buildManualCutoverPayment(row, input);
  const waived = buildManualCutoverConfirmationWaiver(paid, waiverInput);
  for (const [key, value] of Object.entries(paid)) {
    if (key !== 'updated_at') assert.equal(waived[key], value, key);
  }
  assert.equal(waived.tutor_response || '', '');
  assert.equal(waived.tutor_responded_at || '', '');
  assert.equal(waived.cutover_confirmation_waived_at, waiverInput.now);
  assert.equal(waived.cutover_confirmation_waived_by, waiverInput.actor);
  assert.equal(waived.cutover_confirmation_waiver_reason, waiverInput.reason);
  assert.equal(hasCutoverConfirmationWaiver(waived), true);
  assert.equal(isPaidCutoverFollowUpOpen(waived), false);
  assert.equal(getPayrollWorkflowState(waived).key, 'paid');
  assert.match(getPayrollWorkflowState(waived).label, /waived/u);
  assert.equal(isPayrollRunReadyForPayment(waived), false);
  assert.deepEqual(selectPayableReviewedRuns([waived]).rows, []);
  assert.equal(canRespondToPaidStatement(waived), true);
  const normalised = normalisePayrollRunRow(waived);
  assert.equal(normalised.cutoverConfirmationWaivedAt, waiverInput.now);
  assert.equal(isPaidCutoverFollowUpOpen(normalised), false);
  assert.equal(buildManualCutoverConfirmationWaiver(waived, { ...waiverInput, now: '2026-09-28T12:00:00Z' }), waived);
});

test('late real responses take precedence over a waiver and ordinary statements still need confirmation', () => {
  const waived = buildManualCutoverConfirmationWaiver(buildManualCutoverPayment(row, input), waiverInput);
  assert.equal(getPayrollWorkflowState({ ...waived, tutor_response: 'disputed' }).key, 'paid_query');
  assert.equal(isPaidCutoverFollowUpOpen({ ...waived, tutor_response: 'unknown' }), true);
  assert.equal(getPayrollWorkflowState({ ...waived, tutor_response: 'confirmed' }).key, 'paid');
  const regular = { ...waived, status: 'reviewed', period_start: '2026-09-21', period_end: '2026-09-27' };
  assert.equal(hasCutoverConfirmationWaiver(regular), false);
  assert.equal(requiresPayrollConfirmation(regular), true);
  assert.equal(isPayrollRunReadyForPayment(regular), false);
  assert.deepEqual(selectPayableReviewedRuns([regular]).rows, []);
});

test('missing waiver evidence fails closed and unsafe waiver requests are rejected', () => {
  const paid = buildManualCutoverPayment(row, input);
  const waived = buildManualCutoverConfirmationWaiver(paid, waiverInput);
  for (const key of ['cutover_confirmation_waived_at', 'cutover_confirmation_waived_by', 'cutover_confirmation_waiver_reason']) {
    assert.equal(hasCutoverConfirmationWaiver({ ...waived, [key]: '' }), false);
    assert.equal(getPayrollWorkflowState({ ...waived, [key]: '' }).key, 'paid_awaiting');
  }
  assert.equal(hasCutoverConfirmationWaiver({ ...waived, cutover_confirmation_waived_at: 'not a date' }), false);
  for (const invalid of [row, { ...paid, paid_via: 'wise' }, { ...paid, period_end: '2026-09-27' }, { ...paid, tutor_response: 'confirmed' }, { ...paid, tutor_response: 'disputed' }]) {
    assert.throws(() => buildManualCutoverConfirmationWaiver(invalid, waiverInput));
  }
  for (const invalid of [{ ...waiverInput, actor: '' }, { ...waiverInput, reason: '' }, { ...waiverInput, now: 'invalid' }]) {
    assert.throws(() => buildManualCutoverConfirmationWaiver(paid, invalid));
  }
});
