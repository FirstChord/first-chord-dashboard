/** @fileoverview Pure £0 payroll close-out rules; a no-pay boundary is never payment evidence. */
import { CONFIRMATION_SYSTEM_START } from './payroll-cycle-helpers.mjs';

const clean = (value) => `${value ?? ''}`.trim();
const tutorKey = (row) => clean(row.tutor_short_name ?? row.tutorShortName ?? row.tutor).toLowerCase();
const date = (value) => clean(value).slice(0, 10);

export function noPaymentDueFingerprint(attendanceRows = [], { teacherId = '', periodStart = '', periodEnd = '' } = {}) {
  const lessons = attendanceRows
    .filter((row) => clean(row.TeacherID ?? row.Teacher?.ID) === clean(teacherId)
      && date(row.EventStartDate) >= periodStart && date(row.EventStartDate) <= periodEnd)
    .map((row) => [row.ID ?? row.AttendanceID, row.EventID, row.StudentID ?? row.Student?.ID,
      row.EventStartDate, row.EventDuration ?? row.Duration, row.AttendanceStatus,
      row.OriginalTeacherID ?? row.OriginalTeacher?.ID].map(clean))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Store the canonical evidence itself, not a truncated digest: MMS weeks are
  // small and an exact comparison has no collision or browser crypto dependency.
  return JSON.stringify([clean(teacherId), periodStart, periodEnd, lessons]);
}

// Only no-pay periods after the latest real paid boundary are live blockers.
// Once a later payment has settled, older corrections require explicit
// reconciliation; they must not silently rewrite an already-paid statement.
export function activeNoPaymentDueRuns(savedRuns = [], shortName = '', throughDate = '') {
  const key = clean(shortName).toLowerCase();
  const matching = savedRuns.filter((row) => tutorKey(row) === key);
  const lastPaidThrough = matching.filter((row) => ['paid', 'paid_through'].includes(clean(row.status).toLowerCase()))
    .map((row) => date(row.period_end ?? row.periodEnd)).filter(Boolean).sort().at(-1) || '';
  return matching.filter((row) => clean(row.status).toLowerCase() === 'no_payment_due'
    && date(row.period_end ?? row.periodEnd) > lastPaidThrough
    && (!throughDate || date(row.period_end ?? row.periodEnd) <= throughDate))
    .sort((a, b) => date(a.period_end ?? a.periodEnd).localeCompare(date(b.period_end ?? b.periodEnd)));
}

export function noPaymentDueConflict(savedRuns = [], attendanceRows = [], {
  tutorShortName = '', teacherId = '', rangeStart = '', rangeEnd = '', throughDate = '',
} = {}) {
  for (const run of activeNoPaymentDueRuns(savedRuns, tutorShortName, throughDate)) {
    const start = date(run.period_start ?? run.periodStart);
    const end = date(run.period_end ?? run.periodEnd);
    if (!start || !end || !rangeStart || !rangeEnd || start < rangeStart || end > rangeEnd) continue;
    const actual = noPaymentDueFingerprint(attendanceRows, { teacherId, periodStart: start, periodEnd: end });
    if (actual !== clean(run.no_payment_due_fingerprint ?? run.noPaymentDueFingerprint)) {
      return { payrollId: clean(run.payroll_id ?? run.payrollId), periodStart: start, periodEnd: end,
        payDate: date(run.pay_date ?? run.payDate) };
    }
  }
  return null;
}

export function validateNoPaymentDue({ preview, reason = '' } = {}) {
  const why = clean(reason);
  if (why.length < 4 || why.length > 240) throw new Error('Give a short reason for this £0 period (4–240 characters).');
  if (!preview || preview.status !== 'draft' || preview.payModel !== 'hourly'
    || preview.periodStart < CONFIRMATION_SYSTEM_START || preview.isCutover
    || preview.periodOpen || !preview.cadenceDue || preview.windowEmpty || preview.windowCapped || preview.windowDays > 35
    || preview.legacyNeedsReconciliation || preview.cutoverNeedsStart || preview.priorRunPending
    || preview.overlapsPaid || preview.overlapsNoPaymentDue || preview.overlapsOutstanding
    || preview.noPaymentDueConflict || preview.reviewPastCount
    || preview.lessonCount !== 0 || preview.expectedAmount !== 0
    || preview.adjustmentAmount !== 0 || preview.finalAmount !== 0) {
    throw new Error('This period is not a checked £0 period. Refresh MMS and resolve any lessons or earlier statements first.');
  }
  return why;
}
