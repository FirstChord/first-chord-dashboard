/** @fileoverview Pure calendar and confirmation policy for the Monday statement and Wednesday payment cycle. */
export const CONFIRMATION_SYSTEM_START = '2026-09-21';

export function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function shiftPayrollDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function currentPayrollMonday(now = new Date()) {
  const today = londonDate(now);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftPayrollDate(today, -((day + 6) % 7));
}

export function requiresPayrollConfirmation(row = {}) {
  const start = `${row.period_start ?? row.periodStart ?? ''}`;
  const end = `${row.period_end ?? row.periodEnd ?? ''}`;
  return end === '2026-09-20' || start >= CONFIRMATION_SYSTEM_START
    || `${row.payment_route ?? row.paymentRoute ?? ''}` === 'confirmation';
}

export function buildPayrollReminder({ tutor = '', periodStart = '', periodEnd = '', statementUrl = '', revised = false } = {}) {
  if (!statementUrl) return '';
  const date = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [
    `Hi ${tutor.split(' ')[0] || 'there'},`,
    revised ? `Your revised First Chord pay statement for ${date(periodStart)}–${date(periodEnd)} is ready.` : `A quick reminder to check your First Chord pay statement for ${date(periodStart)}–${date(periodEnd)}.`,
    'Please use the private link to confirm it or raise a query before 9am on Wednesday (UK time). Unconfirmed statements carry over to the following week’s payment run.',
    statementUrl,
    'Thanks!',
  ].join('\n\n');
}

// Proposed operational cutoff for this unpublished rollout; documented and tested
// in London local time, including DST. No timer sends email or executes payment.
export const PAYROLL_CONFIRMATION_CUTOFF_HOUR = 9;
export function isRegularPayrollStatement(row = {}) {
  return `${row.period_start ?? row.periodStart ?? ''}` >= CONFIRMATION_SYSTEM_START;
}
export function regularPayrollPaymentTiming(row = {}, { now = new Date() } = {}) {
  const paymentDate = shiftPayrollDate(currentPayrollMonday(now), 2);
  if (!isRegularPayrollStatement(row)) return { eligible: true, paymentDate };
  const response = `${row.tutor_response ?? row.tutorResponse ?? ''}`;
  const respondedAt = row.tutor_responded_at ?? row.tutorRespondedAt;
  if (response !== 'confirmed') return { eligible: false, paymentDate, reason: 'unconfirmed' };
  if (!respondedAt || !Number.isFinite(Date.parse(respondedAt)) || Date.parse(respondedAt) > new Date(now).getTime()) return { eligible: false, paymentDate, reason: 'missing_confirmation_time' };
  const confirmedDate = londonDate(respondedAt);
  const confirmedClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(respondedAt));
  let due = shiftPayrollDate(currentPayrollMonday(respondedAt), 2);
  if (confirmedDate > due || (confirmedDate === due && confirmedClock >= `${PAYROLL_CONFIRMATION_CUTOFF_HOUR}`.padStart(2, '0') + ':00')) due = shiftPayrollDate(due, 7);
  return { eligible: due <= paymentDate, paymentDate: due < paymentDate ? paymentDate : due, reason: due > paymentDate ? 'next_week' : '' };
}
