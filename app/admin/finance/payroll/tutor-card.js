import Link from 'next/link';
import { formatPayrollDate, PAYROLL_CUTOVER_PERIOD_END, PAYROLL_NEW_SYSTEM_START } from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { getPayrollWorkflowState } from '@/lib/admin/payroll-workflow-helpers.mjs';
import { requiresPayrollConfirmation } from '@/lib/admin/payroll-cycle-helpers.mjs';
import AdjustWindowForm from './adjust-window-form';
import PayrollSaveButtons from './save-buttons';
import PayrollReviewForm from './review-form';
import AttendanceDecision from './attendance-decision';

function minutesLabel(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m ? ` ${m}m` : ''}`;
}

function mmsStudentUrl(studentId) {
  // #AttendanceNotes opens the student's attendance log directly — where the
  // unrecorded lesson gets marked.
  return `https://app.mymusicstaff.com/Teacher/v2/en/students/details?id=${encodeURIComponent(studentId)}#AttendanceNotes`;
}

// Deep links into MMS so an unrecorded lesson can be fixed at source (MMS owns
// attendance) without the dashboard ever writing it.
function FixInMms({ slot }) {
  const students = (slot.students || []).filter((student) => student.studentId);
  if (!students.length) return null;
  const labelEach = students.length > 1;
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {students.map((student) => (
        <a
          key={student.studentId}
          href={mmsStudentUrl(student.studentId)}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900"
        >
          Fix {labelEach ? `${student.studentName || 'student'} ` : ''}in MMS ↗
        </a>
      ))}
    </span>
  );
}

function SlotLine({ slot, withFix = false, withDecision = false }) {
  return (
    <li className="rounded-xl bg-slate-50 px-3 py-2">
      <span className="font-medium text-slate-800">{formatPayrollDate(slot.startAt, { withTime: true })}</span>
      {' · '}
      {slot.durationMinutes || '?'} mins
      {slot.studentCount > 1 ? ` · group of ${slot.studentCount}` : ''}
      {slot.isCover ? ' · cover' : ''}
      {(slot.state !== 'payable' || slot.isPaidAbsence) && slot.statusLabel ? ` · ${slot.statusLabel}` : ''}
      {' · '}
      {slot.students.map((student) => student.studentName).filter(Boolean).join(', ') || 'Student unknown'}
      {slot.amount !== null ? ` · ${formatMoney(slot.amount)}` : ' · unpriced'}
      {withFix ? <FixInMms slot={slot} /> : null}
      {withDecision ? slot.students
        .filter((student) => `${student.status || ''}`.trim().toLowerCase() === 'unrecorded')
        .map((student) => (
          <AttendanceDecision
            key={student.attendanceId || student.studentId}
            studentId={student.studentId}
            studentName={student.studentName}
            eventId={slot.eventId}
            attendanceId={student.attendanceId}
            pauseEvidence={student.pauseEvidence || null}
          />
        )) : null}
    </li>
  );
}

function SlotListBody({ slots = [], empty = 'None', withFix = false, withDecision = false }) {
  const first = slots.slice(0, 6);
  const rest = slots.slice(6);
  if (!slots.length) {
    return <p className="mt-2 text-xs text-slate-400">{empty}</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
      {first.map((slot) => (
        <SlotLine key={`${slot.eventId || slot.startAt}-${slot.studentCount}-${slot.state}`} slot={slot} withFix={withFix} withDecision={withDecision} />
      ))}
      {rest.length ? (
        <li>
          <details className="group">
            <summary className="cursor-pointer list-none rounded-xl bg-slate-100 px-3 py-2 text-slate-500 hover:bg-slate-200">
              + {rest.length} more <span className="group-open:hidden">(show)</span><span className="hidden group-open:inline">(hide)</span>
            </summary>
            <ul className="mt-1.5 space-y-1.5">
              {rest.map((slot) => (
                <SlotLine key={`${slot.eventId || slot.startAt}-${slot.studentCount}-${slot.state}`} slot={slot} withFix={withFix} withDecision={withDecision} />
              ))}
            </ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}

function SlotList({ title, slots = [], empty = 'None', note = '', withFix = false, withDecision = false }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      {note ? <p className="mt-1 text-[0.7rem] leading-4 text-slate-400">{note}</p> : null}
      <SlotListBody slots={slots} empty={empty} withFix={withFix} withDecision={withDecision} />
    </div>
  );
}

// Quiet, collapsed-by-default version for lists the dashboard is confident about
// (payable from MMS, absent/cancelled) — the card should lead with what needs review.
function CollapsibleSlotList({ title, slots = [], empty = 'None', note = '' }) {
  return (
    <details className="group rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {title}{slots.length ? ` (${slots.length})` : ''}
        </span>
        <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">
          <span className="group-open:hidden">show</span>
          <span className="hidden group-open:inline">hide</span>
        </span>
      </summary>
      {note ? <p className="mt-2 text-[0.7rem] leading-4 text-slate-400">{note}</p> : null}
      <SlotListBody slots={slots} empty={empty} />
    </details>
  );
}

export default function PayrollTutorCard({ row, payDate, reviewPayrollAction, recordManualCutoverPaymentAction, recordManualCutoverConfirmationAction }) {
  const calculatedFinal = row.recalculatedFinalAmount
    ?? Math.round((row.expectedAmount + row.adjustmentAmount) * 100) / 100;
  const owed = row.owedAmount ?? (row.status === 'paid' ? 0 : (row.finalAmount || calculatedFinal));
  const reviewPast = (row.reviewSlots || []).filter((slot) => slot.timing === 'past');
  const reviewUpcoming = (row.reviewSlots || []).filter((slot) => slot.timing === 'upcoming');
  const workflow = row.workflow || getPayrollWorkflowState(row);
  const workflowClass = {
    danger: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    attention: 'border-blue-200 bg-blue-50 text-blue-800',
    waiting: 'border-slate-200 bg-slate-100 text-slate-700',
    ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    complete: 'border-slate-200 bg-slate-50 text-slate-500',
  }[workflow.tone] || 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <article className="rounded-[1.4rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{row.tutor}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${workflowClass}`}>
              {workflow.label}
            </span>

            {row.payModel === 'salary' ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs text-violet-700">salary</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {row.cutoverPaidThrough
              ? `Paid through ${formatPayrollDate(row.manualPaidThrough)} · historical payment boundary`
              : `${formatPayrollDate(row.periodStart)} - ${formatPayrollDate(row.periodEnd)} · ${row.lessonCount} lessons${row.windowEndCustom ? ' · custom period' : ''}`}
          </p>
          {row.adjustmentAmount ? <p className="mt-1 text-xs text-slate-600">Includes {formatMoney(row.adjustmentAmount)} adjustment{row.notes ? ` · ${row.notes}` : ''}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-slate-900">{formatMoney(owed)}</p>
          {row.status === 'paid' ? (
            <p className="text-xs text-emerald-700">paid {formatMoney(row.finalAmount)}{row.paidAt ? ` · ${formatPayrollDate(row.paidAt)}` : ''}{row.paidVia === 'manual' ? ' · recorded separately' : ''}</p>
          ) : (
            <p className="text-xs text-slate-500">{row.lessonCount} payable · {minutesLabel(row.teachingMinutes)}</p>
          )}
          {row.status === 'reviewed' || row.status === 'paid' ? (
            <Link
              href={`/admin/finance/payroll/statement?pid=${encodeURIComponent(row.payrollId)}`}
              className={`mt-2 inline-flex rounded-xl px-3 py-2 text-sm font-semibold transition ${workflow.key === 'send' ? 'bg-slate-950 text-white hover:bg-slate-800' : 'text-blue-700 hover:bg-blue-50'}`}
            >
              {workflow.key === 'send' ? 'Review and send' : 'View statement'} →
            </Link>
          ) : null}
          {row.status === 'reviewed' && row.tutorResponse !== 'disputed' && !row.attendanceChanged ? <Link href={`/admin/finance/payroll/statement?pid=${encodeURIComponent(row.payrollId)}#whatsapp-reminder`} className="mt-2 block text-sm text-blue-700">Private WhatsApp reminder →</Link> : null}
        </div>
      </div>

      {row.isCutover ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <p className="font-semibold">One-off payroll cutover</p>
          <p className="mt-1">{row.cutoverPaidThrough
            ? `Historical payment is recorded through ${formatPayrollDate(PAYROLL_CUTOVER_PERIOD_END)}; no new cutoff statement or payment is needed. New Monday-based periods start ${formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}.`
            : `This closes legacy pay through ${formatPayrollDate(PAYROLL_CUTOVER_PERIOD_END)}. New Monday-based periods start ${formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}. Tutor confirmation is required before payment.`}</p>
        </div>
      ) : null}

      <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${workflowClass}`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">Next</p>
          <p className="mt-0.5 text-sm font-semibold">{workflow.nextAction}</p>
        </div>
        <span className="text-xs font-medium">
          {row.status === 'draft' ? 'Estimate' : row.status === 'paid' ? 'Recorded payment' : 'Reviewed amount'}
        </span>
      </div>

      {row.amountConflict ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Saved statements disagree: {row.amountConflict.amounts.map((amount) => formatMoney(amount)).join(' versus ')}. Check the original statements and reconcile the duplicate records before payment.</p> : null}
      {workflow.key === 'recipient_missing' ? <p className="mt-4 text-sm text-slate-600">Add this tutor’s verified saved recipient ID in the Tutor_Wise sheet, then refresh Payroll. They are excluded from the payment file.</p> : null}

      {row.overlapsPaid ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {row.overlapsPaid.isBoundary
            ? `⚠ This window reaches before the reported paid-through boundary (${formatPayrollDate(row.overlapsPaid.periodEnd)}). Move its start forward to avoid double-paying.`
            : `⚠ This window overlaps an already-paid period (${formatPayrollDate(row.overlapsPaid.periodStart)} - ${formatPayrollDate(row.overlapsPaid.periodEnd)}). Risk of double-paying — move the window start forward.`}
        </div>
      ) : null}
      {row.isCutover && row.manualPaidThrough ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Historical paid-through boundary: {formatPayrollDate(row.manualPaidThrough)}. The earlier payment amount and date were not recorded here.
        </div>
      ) : null}
      {row.overlapsOutstanding ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          This window overlaps an earlier statement ({formatPayrollDate(row.overlapsOutstanding.periodStart)}–{formatPayrollDate(row.overlapsOutstanding.periodEnd)}). Finish that statement or move this window forward before reviewing.
        </div>
      ) : null}
      {row.priorRunPending ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div>
            <p className="font-semibold">Earlier statement still open</p>
            <p className="mt-1">Finish {formatPayrollDate(row.priorRunPending.periodStart)}–{formatPayrollDate(row.priorRunPending.periodEnd)} before reviewing this period.</p>
          </div>
          <Link href={`/admin/finance/payroll?payDate=${row.priorRunPending.cycleDate}&tutor=${encodeURIComponent(row.tutorShortName)}`} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100">
            Open earlier statement
          </Link>
        </div>
      ) : null}
      {row.windowEmpty && !row.cutoverPaidThrough ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Already paid through {formatPayrollDate(row.lastPaidThrough)} — nothing outstanding for this cycle date.
        </div>
      ) : null}
      {row.windowCapped ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Window capped at 35 days back. If this invoice covers more, set a custom window start.
        </div>
      ) : null}
      {row.cutoverNeedsStart ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Previous paid-through date is not recorded here.</p>
          <p className="mt-1">Open the period controls and set <strong>Window start</strong> to the day after this tutor was last paid. Review is blocked so the dashboard cannot guess historical coverage.</p>
        </div>
      ) : null}
      {row.cutoverNothingOwed ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Nothing is outstanding in this cutoff window, so no statement needs to be sent.
        </div>
      ) : null}
      {!row.cadenceDue && !row.windowEmpty ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-semibold">Not due this week · {row.invoiceCadence === 'biweekly' ? 'paid every two weeks' : row.invoiceCadence}</p>
          <p className="mt-1">The next complete pay window is due on {formatPayrollDate(row.nextCadencePayDate)}. This draft cannot be reviewed or emailed early.</p>
        </div>
      ) : null}
      {row.periodOpen && row.cadenceDue && !row.priorRunPending ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-semibold">This period is still open</p>
          <p className="mt-1">It includes lessons through {formatPayrollDate(row.periodEnd)}. Review becomes available after that day has finished.</p>
        </div>
      ) : null}
      {reviewPast.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {reviewPast.length} lesson status{reviewPast.length === 1 ? '' : 'es'} need review in MMS before trusting this figure. Record attendance only if genuinely unmarked.
          {reviewUpcoming.length ? ` (${reviewUpcoming.length} more upcoming — those resolve themselves.)` : ''}
        </div>
      ) : null}
      {row.attendanceChanged ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <p className="font-semibold">MMS attendance changed after this amount was reviewed.</p>
          <p className="mt-1">
            Reviewed amount: {formatMoney(row.finalAmount)} · refreshed calculation: {formatMoney(calculatedFinal)}.
            Check the lesson detail, then save the corrected amount before paying or resending the statement.
          </p>
        </div>
      ) : null}
      {row.tutorResponse === 'disputed' ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <strong>Tutor flagged this statement</strong>{row.tutorNote ? `: “${row.tutorNote}”` : '.'} Held out of the Wise batch until you resolve it.
        </div>
      ) : null}

      {row.status === 'paid' && row.paidVia === 'manual' && !row.tutorResponse ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Payment recorded separately; tutor confirmation is still outstanding. Their original private link remains usable and will not add another payment to Wise.
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {/* Lead with statuses payroll cannot yet classify; only genuinely unmarked rows need an MMS write. */}
        {reviewPast.length ? (
          <SlotList title="Needs attendance review" slots={reviewPast} withDecision />
        ) : null}

        <details className="group rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">
            Lesson detail
            <span className="text-xs font-medium text-slate-400 group-open:hidden">Show</span>
            <span className="hidden text-xs font-medium text-slate-400 group-open:inline">Hide</span>
          </summary>
          <div className="mt-4 space-y-3">
            {reviewUpcoming.length ? (
              <CollapsibleSlotList title="Upcoming — not yet taught" slots={reviewUpcoming} />
            ) : null}
            <CollapsibleSlotList title="Payable from MMS attendance" slots={row.payableSlots} empty="No payable lessons found for this period." />
            {row.excludedSlots?.length ? (
              <CollapsibleSlotList title="Not counted — absent / cancelled" slots={row.excludedSlots} empty="None." />
            ) : null}
          </div>
        </details>
      </div>

      {row.status !== 'paid' ? (
      <details open={row.status === 'draft' || row.attendanceChanged} className="mt-4">
      <summary className="cursor-pointer text-sm text-slate-600">{row.status === 'draft' ? 'Review statement' : 'Correct statement'}</summary>
      <PayrollReviewForm action={reviewPayrollAction} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        {[
          ['payroll_id', row.payrollId],
          ['pay_date', row.payDate],
          ['period_start', row.periodStart],
          ['period_end', row.periodEnd],
          ['tutor', row.tutor],
          ['tutor_short_name', row.tutorShortName],
          ['teacher_id', row.teacherId],
          ['invoice_cadence', row.invoiceCadence],
          ['pay_model', row.payModel],
          ['lesson_count', row.lessonCount],
          ['review_lesson_count', row.reviewLessonCount],
          ['teaching_minutes', row.teachingMinutes],
          ['expected_amount', row.expectedAmount],
          ['existing_status', row.status],
          ['statement_sent_at', row.statementSentAt],
          ['statement_sent_by', row.statementSentBy],
          ['statement_delivery_status', row.statementDeliveryStatus],
          ['statement_delivery_channel', row.statementDeliveryChannel],
          ['statement_delivery_to', row.statementDeliveryTo],
          ['statement_delivery_attempted_at', row.statementDeliveryAttemptedAt],
          ['statement_delivery_message_id', row.statementDeliveryMessageId],
          ['statement_delivery_error', row.statementDeliveryError],
          ['tutor_response', row.tutorResponse],
          ['tutor_responded_at', row.tutorRespondedAt],
          ['tutor_note', row.tutorNote],
          ['tutor_response_source', row.tutorResponseSource],
          ['paid_via', row.paidVia],
          ['reviewed_at', row.reviewedAt],
          ['reviewed_by', row.reviewedBy],
          ['paid_at', row.paidAt],
          ['paid_by', row.paidBy],
          ['created_at', row.createdAt],
          ['expected_updated_at', row.updatedAt],
        ].map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value ?? ''} />
        ))}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block sm:min-w-64">
            {!requiresPayrollConfirmation(row) ? <span className="text-xs font-semibold text-slate-600">Payment route</span> : null}
            {requiresPayrollConfirmation(row) ? (
              <>
                <input type="hidden" name="payment_route" value="confirmation" />
                <p className="text-xs text-slate-500">Tutor confirmation required before payment.</p>
              </>
            ) : (
              <select name="payment_route" defaultValue={row.paymentRoute || 'normal'} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="normal">Pay normally · confirmation optional</option>
                <option value="confirmation">Tutor confirmation required</option>
              </select>
            )}
          </label>
          <PayrollSaveButtons
            status={row.status}
            attendanceChanged={row.attendanceChanged}
            blocked={Boolean(reviewPast.length || row.overlapsPaid || row.overlapsOutstanding || row.priorRunPending || row.periodOpen || !row.cadenceDue || row.cutoverNeedsStart || row.cutoverNothingOwed || workflow.key === 'data_unavailable')}
          />
        </div>
        <details className="group mt-3 border-t border-slate-200 pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-500">
            <span>Adjustments, invoice tracking and period</span>
            <span
              aria-hidden="true"
              className="text-base leading-none text-slate-400 transition-transform duration-200 group-open:rotate-180"
            >
             ⌄
            </span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Tutor invoice</span>
              <select name="invoice_status" defaultValue={row.invoiceStatus || ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Not recorded</option>
                <option value="received">Received</option>
                <option value="missing">Expected</option>
                <option value="not_needed">Not required</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Adjustment</span>
              <input name="adjustment_amount" type="number" step="0.01" defaultValue={row.adjustmentAmount || 0} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-semibold text-slate-500">Notes</span>
              <input name="notes" defaultValue={row.notes || ''} placeholder="Optional note" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <div className="md:col-span-2">
              <AdjustWindowForm payDate={payDate} tutor={row.tutorShortName} start={row.periodStart} end={row.periodEnd} />
            </div>
          </div>
        </details>
      </PayrollReviewForm>
      </details>
      ) : null}
      {row.isCutover && row.status === 'reviewed' ? (
        <form action={recordManualCutoverPaymentAction} className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <input type="hidden" name="payroll_id" value={row.payrollId} />
          <input type="hidden" name="expected_amount" value={row.finalAmount} />
          <details>
            <summary className="cursor-pointer font-semibold">Already paid separately?</summary>
            <p className="mt-2">Only use this when you have already paid this exact {formatMoney(row.finalAmount)} statement separately from this batch. Tutor confirmation can still be gathered later. This records payment only; it sends no email and makes no payment.</p>
            <label className="mt-3 block">Date actually paid
              <input required name="payment_date" type="date" className="mt-1 block w-full rounded-xl border border-amber-300 bg-white px-3 py-2" />
            </label>
            <label className="mt-3 flex items-start gap-2">
              <input required name="payment_verified" value="yes" type="checkbox" className="mt-1" />
              <span>I checked the tutor, statement amount, date and separate payment record.</span>
            </label>
            <button type="submit" className="mt-3 rounded-xl bg-amber-900 px-4 py-2 font-semibold text-white hover:bg-amber-800">Record already paid</button>
          </details>
        </form>
      ) : null}
      {row.isCutover && row.status === 'paid' && row.paidVia === 'manual' && row.tutorResponse !== 'confirmed' ? (
        <form action={recordManualCutoverConfirmationAction} className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <input type="hidden" name="payroll_id" value={row.payrollId} />
          <details>
            <summary className="cursor-pointer font-semibold">Tutor confirmed by email?</summary>
            <p className="mt-2">If the tutor replied to confirm this exact statement, record that response here. If they use the private link instead, it records their confirmation directly. Neither path creates another payment.</p>
            <label className="mt-3 block">Date of email confirmation (if known)
              <input name="confirmation_date" type="date" className="mt-1 block w-full rounded-xl border border-blue-300 bg-white px-3 py-2" />
            </label>
            <label className="mt-3 flex items-start gap-2">
              <input required name="email_verified" value="yes" type="checkbox" className="mt-1" />
              <span>I checked the tutor’s email reply against this statement.</span>
            </label>
            <button type="submit" className="mt-3 rounded-xl bg-blue-900 px-4 py-2 font-semibold text-white hover:bg-blue-800">Record email confirmation</button>
          </details>
        </form>
      ) : null}
    </article>
  );
}
