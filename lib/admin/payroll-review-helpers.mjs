/** @fileoverview Pure fail-closed guards for an admin-reviewed payroll form against current saved and MMS evidence. */
export function validatePayrollReview({ existing, expectedUpdatedAt = '', preview, expectedAmount, lessonCount, teachingMinutes }) {
  if (existing && `${existing.updated_at || ''}` !== `${expectedUpdatedAt}`) throw new Error('This statement changed while you were reviewing it. Reopen it before saving.');
  if (!preview || preview.reviewPastCount || preview.overlapsPaid || preview.overlapsOutstanding || preview.priorRunPending || preview.periodOpen || !preview.cadenceDue || preview.cutoverNeedsStart || preview.legacyNeedsReconciliation || preview.windowCapped)
    throw new Error('Attendance or period evidence needs attention before this statement can be reviewed.');
  if (Math.round(Number(expectedAmount) * 100) !== Math.round(preview.expectedAmount * 100)
    || Number(lessonCount) !== preview.lessonCount || Number(teachingMinutes) !== preview.teachingMinutes)
    throw new Error('The lesson calculation changed. Refresh payroll and review the new amount.');
}
