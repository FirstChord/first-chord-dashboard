import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollPreview } from '../../lib/admin/payroll-helpers.mjs';
import { getPayrollWorkflowState } from '../../lib/admin/payroll-workflow-helpers.mjs';
import { validatePayrollReview } from '../../lib/admin/payroll-review-helpers.mjs';
import { buildPayrollQueue, payrollWorkspaceAttendanceQuery } from '../../lib/admin/payroll-queue-helpers.mjs';
import { selectPayableReviewedRuns } from '../../lib/admin/wise-helpers.mjs';
import { noPaymentDueFingerprint, validateNoPaymentDue } from '../../lib/admin/payroll-zero-period-helpers.mjs';

const teacherId = 'tch_zMX5Jc';
const paidCutover = { payroll_id: 'calum-cutover', tutor_short_name: 'Calum', status: 'paid',
  period_start: '2026-09-18', period_end: '2026-09-20', pay_date: '2026-09-21' };
const range = { startDate: '2026-09-21', endDate: '2026-10-04' };
const noPay = { payroll_id: 'payroll_calum_2026-09-21_2026-09-27', tutor_short_name: 'Calum',
  teacher_id: teacherId, status: 'no_payment_due', pay_date: '2026-09-28',
  period_start: '2026-09-21', period_end: '2026-09-27', final_amount: '0',
  no_payment_due_reason: 'Another tutor covered',
  no_payment_due_fingerprint: noPaymentDueFingerprint([], { teacherId, periodStart: '2026-09-21', periodEnd: '2026-09-27' }) };
const rowFor = (payDate, savedRuns, attendanceRows = [], attendanceRange = range) => buildPayrollPreview({
  payDate, savedRuns, attendanceRows, attendanceRange, now: new Date('2026-10-12T12:00:00Z'),
}).rows.find((row) => row.tutorShortName === 'Calum');

test('a checked zero week closes without inventing payment and advances only coverage', () => {
  const candidate = rowFor('2026-09-28', [paidCutover]);
  assert.equal(candidate.periodStart, '2026-09-21');
  assert.equal(validateNoPaymentDue({ preview: candidate, reason: 'Another tutor covered' }), 'Another tutor covered');
  assert.throws(() => validatePayrollReview({ preview: candidate, expectedAmount: 0, lessonCount: 0, teachingMinutes: 0 }), /Close this £0 period/);
  const closed = rowFor('2026-09-28', [paidCutover, noPay]);
  assert.equal(closed.status, 'no_payment_due');
  assert.equal(closed.periodStart, '2026-09-21');
  assert.equal(closed.paidAt, '');
  assert.equal(closed.owedAmount, 0);
  assert.equal(getPayrollWorkflowState(closed).key, 'no_payment_due');
  assert.equal(buildPayrollQueue([closed])[0].group, 'history');
  assert.equal(selectPayableReviewedRuns([noPay]).rows.length, 0);
  const next = rowFor('2026-10-05', [paidCutover, noPay]);
  assert.equal(next.periodStart, '2026-09-28');
  assert.equal(next.lastPaidThrough, '2026-09-20');
  assert.equal(next.coverageThrough, '2026-09-27');
  assert.equal(next.status, 'draft');
});

test('a correction to a closed £0 week holds a later statement for review', () => {
  const changed = [{ ID: 'a1', EventID: 'e1', TeacherID: teacherId, EventStartDate: '2026-09-24T16:00:00',
    EventDuration: 30, AttendanceStatus: 'Present', StudentID: 's1' }];
  const closed = rowFor('2026-09-28', [paidCutover, noPay], changed);
  assert.equal(closed.noPaymentDueConflict?.payrollId, noPay.payroll_id);
  assert.equal(getPayrollWorkflowState(closed).key, 'no_pay_changed');
  const later = rowFor('2026-10-05', [paidCutover, noPay], changed);
  assert.equal(later.noPaymentDueConflict?.periodEnd, '2026-09-27');
  assert.throws(() => validatePayrollReview({ preview: later, expectedAmount: 0, lessonCount: 0, teachingMinutes: 0 }), /needs attention/);
  const reopened = rowFor('2026-09-28', [paidCutover, { ...noPay, status: 'draft' }], changed);
  assert.equal(reopened.periodStart, '2026-09-21');
  assert.equal(reopened.lessonCount, 1);
  assert.equal(reopened.noPaymentDueConflict, null);
  const laterReviewed = { payroll_id: 'later', tutor_short_name: 'Calum', status: 'reviewed',
    pay_date: '2026-10-05', period_start: '2026-09-28', period_end: '2026-10-04' };
  const blockedCloseout = rowFor('2026-09-28', [paidCutover, noPay, laterReviewed], changed);
  assert.equal(blockedCloseout.payrollId, noPay.payroll_id);
  assert.equal(blockedCloseout.noPaymentDueConflict.laterReviewed, true);
  assert.equal(rowFor('2026-09-28', [paidCutover, { ...noPay, status: 'draft', no_payment_due_at: '2026-10-05T10:00:00Z' }, laterReviewed], changed).periodStart, '2026-09-21');
});

test('source fingerprint is order independent and changes with attendance status', () => {
  const a = { ID: 'a', TeacherID: teacherId, EventStartDate: '2026-09-23T12:00:00', AttendanceStatus: 'AbsentNotice' };
  const b = { ID: 'b', TeacherID: teacherId, EventStartDate: '2026-09-24T12:00:00', AttendanceStatus: 'TeacherAbsentNoMakeup' };
  const period = { teacherId, periodStart: '2026-09-21', periodEnd: '2026-09-27' };
  assert.equal(noPaymentDueFingerprint([a, b], period), noPaymentDueFingerprint([b, a], period));
  assert.notEqual(noPaymentDueFingerprint([a, b], period), noPaymentDueFingerprint([{ ...a, AttendanceStatus: 'Present' }, b], period));
});

test('active £0 evidence extends fresh MMS query, but settled historical markers do not', () => {
  const base = { startDate: '2026-09-28', endDate: '2026-10-04', teacherIds: [teacherId] };
  assert.equal(payrollWorkspaceAttendanceQuery(base, [paidCutover, noPay]).startDate, '2026-09-21');
  assert.equal(payrollWorkspaceAttendanceQuery(base, [paidCutover, noPay,
    { tutor_short_name: 'Calum', status: 'paid', period_end: '2026-10-04' }]).startDate, '2026-09-28');
});
