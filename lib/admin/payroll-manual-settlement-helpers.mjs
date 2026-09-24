/** @fileoverview Validates separate admin-attested cutover payment and later email confirmation facts. */
import { isPayrollCutoverPeriod } from './payroll-helpers.mjs';

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function validPastDate(value, today) {
  const date = `${value || ''}`.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return false;
  return new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date && date <= today;
}

function requireCutover(row, actorEmail) {
  if (!isPayrollCutoverPeriod({ periodEnd: row.period_end ?? row.periodEnd })) {
    throw new Error('This action is only for the one-off payroll cutover.');
  }
  if (!`${actorEmail || ''}`.trim()) throw new Error('An admin identity is required.');
}

export function buildManualCutoverPayment(row = {}, {
  expectedAmount,
  paymentDate,
  actorEmail,
  now = new Date().toISOString(),
} = {}) {
  if (`${row.status || ''}`.trim() !== 'reviewed') throw new Error('Only an open reviewed statement can be marked paid.');
  requireCutover(row, actorEmail);
  if (cents(row.final_amount ?? row.finalAmount) <= 0 || cents(expectedAmount) !== cents(row.final_amount ?? row.finalAmount)) {
    throw new Error('The saved statement amount changed. Reload and check it before recording payment.');
  }
  if (!validPastDate(paymentDate, now.slice(0, 10))) {
    throw new Error('Enter the actual payment date (not a future date).');
  }

  return {
    ...row,
    status: 'paid',
    paid_at: paymentDate,
    paid_by: actorEmail.trim(),
    paid_via: 'manual',
    updated_at: now,
  };
}

export function buildManualCutoverEmailConfirmation(row = {}, {
  confirmationDate = '',
  actorEmail,
  now = new Date().toISOString(),
} = {}) {
  if (`${row.status || ''}`.trim() !== 'paid' || `${row.paid_via || ''}`.trim() !== 'manual') {
    throw new Error('Only a separately paid cutover can use this confirmation path.');
  }
  requireCutover(row, actorEmail);
  if (`${row.tutor_response || ''}`.trim() === 'confirmed') throw new Error('This statement is already confirmed.');
  if (confirmationDate && !validPastDate(confirmationDate, now.slice(0, 10))) {
    throw new Error('Enter the actual email confirmation date, or leave it blank if unknown.');
  }

  return {
    ...row,
    tutor_response: 'confirmed',
    tutor_responded_at: `${confirmationDate || ''}`.trim(),
    tutor_response_source: 'email_admin_recorded',
    tutor_note: '',
    updated_at: now,
  };
}
