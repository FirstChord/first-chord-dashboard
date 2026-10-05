/** @fileoverview Pure exact-period approval scope and fail-closed decisions for deferred payroll statements. */
import { payrollRecordReadiness } from './payroll-record-readiness.mjs';
import { validatePayrollReview } from './payroll-review-helpers.mjs';
import { createHash } from 'node:crypto';

const clean = (value) => `${value ?? ''}`.trim();
const digest = (value) => createHash('sha256').update(clean(value)).digest('hex');

export function deferredPayrollScope({ row, existing = {}, standardWindow, active = false }) {
  const structure = [...(row.payableSlots || []), ...(row.reviewSlots || []), ...(row.excludedSlots || [])]
    .flatMap((slot) => (slot.students || []).map((student) => [
      clean(slot.eventId), clean(slot.teacherId), clean(slot.originalTeacherId), clean(slot.startAt),
      slot.durationMinutes, clean(student.attendanceId), clean(student.studentId),
    ])).map((item) => JSON.stringify(item)).sort();
  return {
    payrollId: row.payrollId, tutorShortName: row.tutorShortName, teacherId: row.teacherId,
    payDate: row.payDate, periodStart: row.periodStart, periodEnd: row.periodEnd,
    payModel: row.payModel, hourlyRate: row.hourlyRate, invoiceCadence: row.invoiceCadence,
    email: clean(row.contactEmail).toLowerCase(), verifiedAt: clean(row.contactEmailVerifiedAt),
    adjustment: row.adjustmentAmount, notes: digest(existing?.notes), invoiceStatus: clean(existing?.invoice_status),
    exceptions: digest(existing?.record_exceptions_json), active,
    standardStart: standardWindow?.periodStart || '', standardEnd: standardWindow?.periodEnd || '', structure,
  };
}

export function deferredPayrollEligibility({ row, scope }) {
  const slots = [...(row.payableSlots || []), ...(row.reviewSlots || []), ...(row.excludedSlots || [])];
  if (!scope.active || row.payModel !== 'hourly' || row.isCutover || row.status !== 'draft'
    || row.periodOpen || !row.cadenceDue || row.windowEmpty || row.windowCapped
    || row.legacyNeedsReconciliation || row.cutoverNeedsStart || row.priorRunPending
    || row.overlapsPaid || row.overlapsOutstanding || row.overlapsNoPaymentDue || row.noPaymentDueConflict
    || row.tutorResponse || row.statementSentAt || row.statementDeliveryStatus
    || scope.standardStart !== row.periodStart || scope.standardEnd !== row.periodEnd
    || !scope.email || !Number.isFinite(Date.parse(scope.verifiedAt))
    || slots.some((slot) => !(slot.students || []).length)
    || !scope.structure.length || scope.structure.some((item) => {
      const fields = JSON.parse(item);
      return !fields[0] || !fields[1] || !Number.isFinite(Date.parse(fields[3])) || !(fields[4] > 0) || !fields[5] || !fields[6];
    })) return { ok: false, reason: 'period_check' };
  // Only genuinely unrecorded attendance is allowed to wait. Unknown/provider
  // statuses must not be treated as an invitation to automatically approve pay.
  if ((row.reviewSlots || []).some((slot) => !(slot.students || []).length
    || slot.students.some((student) => clean(student.status).toLowerCase() !== 'unrecorded')))
    return { ok: false, reason: 'uncertain_record' };
  const readiness = payrollRecordReadiness(row);
  if (readiness.uncertain.length) return { ok: false, reason: 'uncertain_record' };
  return { ok: true, readiness };
}

export function decideDeferredPayroll({ job, evidence, now = new Date() }) {
  if (!job || job.status !== 'waiting') return { action: 'ignore' };
  if (!Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at) <= now.getTime()) return { action: 'hold', reason: 'Approval expired. Review this period manually.' };
  const scope = deferredPayrollScope(evidence);
  if (Object.keys(scope).some((key) => JSON.stringify(scope[key]) !== JSON.stringify(job.scope?.[key]))) return { action: 'hold', reason: 'The period, lessons, settings or school adjustments changed. Review manually.' };
  const allowed = deferredPayrollEligibility({ row: evidence.row, scope });
  if (!allowed.ok) return { action: 'hold', reason: 'Payroll evidence needs a school check. Review this period manually.' };
  // Approval is never evidence that the checklist reached Gmail. Its saved
  // receipt must still exist; deleted/uncertain draft tracking comes to staff.
  if (evidence.existing?.records_nudge_status !== 'sent'
    || clean(evidence.existing?.records_nudge_to).toLowerCase() !== scope.email
    || !Number.isFinite(Date.parse(evidence.existing?.records_nudge_sent_at)))
    return { action: 'hold', reason: 'Checklist delivery tracking changed. Check Gmail Sent before continuing.' };
  if (!allowed.readiness.ready) return { action: 'wait' };
  const row = evidence.row;
  if (!(row.recalculatedFinalAmount > 0)) return { action: 'hold', reason: 'No payment is due. Close the £0 period manually.' };
  try {
    validatePayrollReview({ existing: evidence.existing, expectedUpdatedAt: evidence.existing?.updated_at || '', preview: row,
      expectedAmount: row.expectedAmount, lessonCount: row.lessonCount, teachingMinutes: row.teachingMinutes });
  } catch { return { action: 'hold', reason: 'Payroll evidence needs a school check. Review this period manually.' }; }
  return { action: 'send' };
}

export function buildDeferredReviewedRun({ row, existing }, actor, now = new Date()) {
  const at = now.toISOString();
  return { ...existing,
    payroll_id: row.payrollId, tutor_short_name: row.tutorShortName, tutor: row.tutor, teacher_id: row.teacherId,
    pay_date: row.payDate, period_start: row.periodStart, period_end: row.periodEnd,
    invoice_cadence: row.invoiceCadence, pay_model: row.payModel,
    lesson_count: row.lessonCount, review_lesson_count: 0, teaching_minutes: row.teachingMinutes,
    expected_amount: row.expectedAmount, adjustment_amount: row.adjustmentAmount, final_amount: row.recalculatedFinalAmount,
    status: 'reviewed', payment_route: 'confirmation', reviewed_at: at, reviewed_by: actor,
    source: 'mms_attendance_preview', created_at: existing?.created_at || at, updated_at: at,
    paid_at: '', paid_by: '', paid_via: '', tutor_response: '', tutor_responded_at: '', tutor_note: '', tutor_response_source: '',
  };
}
