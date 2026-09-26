/** @fileoverview Pure payroll queue grouping that preserves statement identity, payment blockers and quiet upcoming work. */
import { getPayrollWorkflowState } from './payroll-workflow-helpers.mjs';

export function buildPayrollQueue(rows = [], { missing = [], amountConflicts = [], attendanceUnavailable = false, now = new Date() } = {}) {
  return rows.map((row) => {
    let workflow = getPayrollWorkflowState(row, { now });
    const amountConflict = amountConflicts.find((entry) => entry.tutor === row.tutor) || null;
    if (row.status !== 'paid' && !['paid_through', 'nothing_due'].includes(workflow.key)) {
      if (attendanceUnavailable) workflow = { key: 'data_unavailable', label: 'Attendance unavailable', nextAction: 'Refresh MMS before reviewing or paying', tone: 'warning', readyForPayment: false };
      else if (amountConflict) workflow = { key: 'amount_conflict', label: 'Conflicting amounts', nextAction: 'Resolve the duplicate statements before paying', tone: 'danger', readyForPayment: false };
      else if (workflow.readyForPayment && missing.some((entry) => entry.tutor === row.tutor)) workflow = { key: 'recipient_missing', label: 'Wise recipient needed', nextAction: 'Add the verified Wise recipient before payment', tone: 'warning', readyForPayment: false };
    }
    const group = ['paid', 'nothing_due', 'paid_through'].includes(workflow.key) ? 'history'
      : ['not_due', 'period_open'].includes(workflow.key) ? 'upcoming'
        : ['awaiting', 'paid_awaiting', 'next_week'].includes(workflow.key) ? 'waiting'
          : workflow.readyForPayment ? 'ready' : 'handle';
    return { ...row, workflow, group, amountConflict };
  }).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.tutor.localeCompare(b.tutor));
}

export function payrollWorkspaceAttendanceQuery(baseQuery, savedRuns = []) {
  const starts = savedRuns.filter((row) => row.status === 'reviewed').map((row) => row.period_start).filter(Boolean).sort();
  const startDate = starts[0] && starts[0] < baseQuery.startDate ? starts[0] : baseQuery.startDate;
  const spanDays = (Date.parse(baseQuery.endDate) - Date.parse(startDate)) / 86400000;
  if (!Number.isFinite(spanDays) || spanDays > 366) throw new Error('An outstanding statement needs historical attendance reconciliation before this batch can be prepared.');
  return { ...baseQuery, startDate };
}
