/** @fileoverview Pure payment-route normalisation and readiness rules governing when a payroll run may be paid. */
import { isPayrollCutoverPeriod, isPayrollPeriodOpen } from './payroll-helpers.mjs';

export const PAYROLL_PAYMENT_ROUTES = [
  { value: 'normal', label: 'Pay normally' },
  { value: 'confirmation', label: 'Tutor confirmation' },
];

export function normalisePayrollPaymentRoute(value) {
  return `${value || ''}`.trim().toLowerCase() === 'confirmation' ? 'confirmation' : 'normal';
}

function clean(value) {
  return `${value ?? ''}`.trim();
}

function cents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

// Confirmation belongs to one exact statement. Editing admin-only notes or the
// invoice-tracking field does not change that statement; changing its period,
// lesson basis, amount or confirmation requirement does.
export function hasMaterialTutorStatementChange(existing = {}, next = {}) {
  const stringFields = [
    ['period_start', 'periodStart'],
    ['period_end', 'periodEnd'],
    ['lesson_count', 'lessonCount'],
    ['teaching_minutes', 'teachingMinutes'],
  ];
  if (stringFields.some(([snake, camel]) => (
    clean(existing[snake] ?? existing[camel]) !== clean(next[snake] ?? next[camel])
  ))) return true;

  const moneyFields = [
    ['expected_amount', 'expectedAmount'],
    ['adjustment_amount', 'adjustmentAmount'],
    ['final_amount', 'finalAmount'],
  ];
  if (moneyFields.some(([snake, camel]) => (
    cents(existing[snake] ?? existing[camel]) !== cents(next[snake] ?? next[camel])
  ))) return true;

  return normalisePayrollPaymentRoute(existing.payment_route ?? existing.paymentRoute)
    !== normalisePayrollPaymentRoute(next.payment_route ?? next.paymentRoute);
}

export function isPayrollRunReadyForPayment(row = {}, { now = new Date() } = {}) {
  const status = `${row.status || row.Status || ''}`.trim().toLowerCase();
  const response = `${row.tutor_response ?? row.tutorResponse ?? ''}`.trim().toLowerCase();
  if (status !== 'reviewed' || response === 'disputed') return false;
  if (isPayrollPeriodOpen(row.period_end ?? row.periodEnd, now)) return false;
  if (isPayrollCutoverPeriod({ periodEnd: row.period_end ?? row.periodEnd })) {
    return response === 'confirmed';
  }
  return normalisePayrollPaymentRoute(row.payment_route ?? row.paymentRoute) === 'normal'
    || response === 'confirmed';
}

export function getPayrollWorkflowState(row = {}) {
  const status = `${row.status || ''}`.trim().toLowerCase() || 'draft';
  const response = `${row.tutorResponse ?? row.tutor_response ?? ''}`.trim().toLowerCase();
  const route = normalisePayrollPaymentRoute(row.paymentRoute ?? row.payment_route);
  const cutover = row.isCutover || isPayrollCutoverPeriod({ periodEnd: row.period_end ?? row.periodEnd });

  if (status === 'paid') {
    return { key: 'paid', label: 'Paid', tone: 'complete', nextAction: 'Complete', readyForPayment: false };
  }
  if (row.overlapsPaid) {
    return { key: 'window_conflict', label: 'Check period', tone: 'danger', nextAction: 'Correct the pay period', readyForPayment: false };
  }
  if (row.overlapsOutstanding) {
    return { key: 'statement_overlap', label: 'Check period', tone: 'danger', nextAction: 'Remove the overlap with the earlier statement', readyForPayment: false };
  }
  if (row.priorRunPending) {
    const query = `${row.priorRunPending.tutorResponse || ''}`.trim().toLowerCase() === 'disputed';
    return { key: 'prior_pending', label: query ? 'Earlier query' : 'Earlier statement open', tone: query ? 'danger' : 'waiting', nextAction: query ? 'Resolve and resend the earlier statement' : 'Finish the earlier statement before reviewing this period', readyForPayment: false };
  }
  if (row.cutoverNeedsStart) {
    return { key: 'cutover_start', label: 'Set cutoff start', tone: 'warning', nextAction: 'Enter the day after this tutor was last paid through', readyForPayment: false };
  }
  if (Number(row.reviewPastCount || 0) > 0) {
    return { key: 'attendance', label: 'Needs review', tone: 'warning', nextAction: 'Record attendance in MMS', readyForPayment: false };
  }
  if (row.attendanceChanged) {
    return { key: 'mms_changed', label: 'MMS changed', tone: 'warning', nextAction: 'Check and save the corrected amount', readyForPayment: false };
  }
  if (status === 'draft' && row.cadenceDue === false) {
    return { key: 'not_due', label: 'Not due', tone: 'idle', nextAction: 'Wait for the complete pay window', readyForPayment: false };
  }
  if (status === 'draft' && row.periodOpen) {
    return { key: 'period_open', label: 'Period open', tone: 'idle', nextAction: 'Return after this Sunday has finished', readyForPayment: false };
  }
  if (status === 'draft' && row.cutoverNothingOwed) {
    return { key: 'nothing_due', label: 'Nothing due', tone: 'complete', nextAction: 'No cutoff statement needed', readyForPayment: false };
  }
  if (status !== 'reviewed') {
    return { key: 'review', label: 'Needs review', tone: 'attention', nextAction: 'Review and generate statement', readyForPayment: false };
  }
  if (response === 'disputed') {
    return { key: 'disputed', label: 'Tutor query', tone: 'danger', nextAction: 'Resolve the tutor query', readyForPayment: false };
  }
  if (route === 'normal' && !cutover) {
    return { key: 'ready', label: 'Ready to pay', tone: 'ready', nextAction: 'Include in the next payment', readyForPayment: true };
  }
  if (response === 'confirmed') {
    return { key: 'ready', label: 'Ready to pay', tone: 'ready', nextAction: 'Include in the next payment', readyForPayment: true };
  }
  if (!row.statementSentAt && !row.statement_sent_at) {
    return { key: 'send', label: 'Ready to send', tone: 'attention', nextAction: 'Send the pay statement', readyForPayment: false };
  }
  return { key: 'awaiting', label: 'Awaiting tutor', tone: 'waiting', nextAction: 'Waiting for tutor confirmation', readyForPayment: false };
}
