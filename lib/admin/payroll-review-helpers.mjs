/** @fileoverview Pure fail-closed guards for an admin-reviewed payroll form against current saved and MMS evidence. */
import { payrollRecordReadiness } from './payroll-record-readiness.mjs';
export function validatePayrollReview({ existing, expectedUpdatedAt = '', preview, expectedAmount, lessonCount, teachingMinutes }) {
  if (existing && `${existing.updated_at || ''}` !== `${expectedUpdatedAt}`) throw new Error('This statement changed while you were reviewing it. Reopen it before saving.');
  if (!preview || preview.status === 'no_payment_due' || preview.reviewPastCount || preview.overlapsPaid || preview.overlapsNoPaymentDue || preview.noPaymentDueConflict || preview.overlapsOutstanding || preview.priorRunPending || preview.periodOpen || !preview.cadenceDue || preview.cutoverNeedsStart || preview.legacyNeedsReconciliation || preview.windowCapped)
    throw new Error('Attendance or period evidence needs attention before this statement can be reviewed.');
  if (!preview.isCutover && preview.payModel === 'hourly' && preview.lessonCount === 0 && preview.expectedAmount === 0 && preview.adjustmentAmount === 0)
    throw new Error('No payment is due. Close this £0 period without generating a statement.');
  if (!payrollRecordReadiness(preview).ready)
    throw new Error('Finish the missing attendance or practice notes, or record a specific school-side note exception, before reviewing this statement.');
  if (Math.round(Number(expectedAmount) * 100) !== Math.round(preview.expectedAmount * 100)
    || Number(lessonCount) !== preview.lessonCount || Number(teachingMinutes) !== preview.teachingMinutes)
    throw new Error('The lesson calculation changed. Refresh payroll and review the new amount.');
}
