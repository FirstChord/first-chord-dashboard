import Link from 'next/link';
import { formatPayrollDate, hasCutoverConfirmationWaiver, isPaidCutoverFollowUpOpen } from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { getPayrollWorkflowState } from '@/lib/admin/payroll-workflow-helpers.mjs';
import { requiresPayrollConfirmation } from '@/lib/admin/payroll-cycle-helpers.mjs';
import AdjustWindowForm from './adjust-window-form';
import PayrollSaveButtons from './save-buttons';
import PayrollReviewForm from './review-form';
import AttendanceDecision from './attendance-decision';
import { SubmitButton } from '@/components/admin/ui/SubmitButton';
import { decideRecordsNudge, payrollRecordReadiness } from '@/lib/admin/payroll-record-readiness.mjs';
import RecordsNudgeButton from './records-nudge-button';

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

export default function PayrollTutorCard({ row, payDate, reviewPayrollAction, recordNoPaymentDueAction, reopenNoPaymentDueAction, recordNoteExceptionAction, recordManualCutoverPaymentAction, recordManualCutoverConfirmationAction }) {
  const calculatedFinal = row.recalculatedFinalAmount
    ?? Math.round((row.expectedAmount + row.adjustmentAmount) * 100) / 100;
  const owed = row.owedAmount ?? (row.status === 'paid' ? 0 : (row.finalAmount || calculatedFinal));
  const reviewPast = (row.reviewSlots || []).filter((slot) => slot.timing === 'past');
  const reviewUpcoming = (row.reviewSlots || []).filter((slot) => slot.timing === 'upcoming');
  const workflow = row.workflow || getPayrollWorkflowState(row);
  const recordReadiness = payrollRecordReadiness(row);
  const recordNudge = decideRecordsNudge({ row, contactEmail: row.contactEmail, verifiedAt: row.contactEmailVerifiedAt });
  const recordContext = { payrollId: row.payrollId, tutorShortName: row.tutorShortName, payDate: row.payDate, periodStart: row.periodStart, periodEnd: row.periodEnd };
  const approval = row.deferredDelivery;
  const autoPending = ['preparing', 'waiting', 'claimed'].includes(approval?.status);
  const zeroAmount = row.status === 'draft' && row.payModel === 'hourly' && !row.isCutover
    && row.lessonCount === 0 && row.expectedAmount === 0 && row.adjustmentAmount === 0 && row.finalAmount === 0;
  const zeroCandidate = !autoPending && zeroAmount && !row.periodOpen
    && row.cadenceDue && row.windowBasis !== 'override' && !row.windowEndCustom
    && !row.windowEmpty && !row.windowCapped && !row.legacyNeedsReconciliation
    && !row.priorRunPending && !row.overlapsPaid && !row.overlapsNoPaymentDue && !row.overlapsOutstanding
    && !row.noPaymentDueConflict && !reviewPast.length
    && workflow.key !== 'data_unavailable';
  const reviewBlocked = Boolean(autoPending || zeroAmount || row.status === 'no_payment_due' || row.noPaymentDueConflict || row.overlapsNoPaymentDue || !recordReadiness.ready || reviewPast.length || row.overlapsPaid || row.overlapsOutstanding || row.priorRunPending || row.periodOpen || !row.cadenceDue || row.cutoverNeedsStart || row.legacyNeedsReconciliation || row.cutoverNothingOwed || row.windowCapped || workflow.key === 'data_unavailable');
  const periodCorrection = ['cutover_start', 'window_conflict', 'statement_overlap'].includes(workflow.key) || row.windowCapped;
  const showAttendance = workflow.key === 'attendance' && row.cadenceDue;
  const statementUrl = `/admin/finance/payroll/statement?pid=${encodeURIComponent(row.payrollId)}`;
  const workflowClass = {
    danger: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    attention: 'border-blue-200 bg-blue-50 text-blue-800',
    waiting: 'border-slate-200 bg-slate-100 text-slate-700',
    ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    complete: 'border-slate-200 bg-slate-50 text-slate-500',
  }[workflow.tone] || 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <article id="payroll-tutor-card" data-tutor={row.tutorShortName} tabIndex={-1} aria-labelledby="payroll-tutor-heading" className="scroll-mt-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 rounded-[1.4rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <a href="#payroll-queue" className="mb-4 inline-block text-sm text-slate-500 underline-offset-4 hover:underline">← Tutors</a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="payroll-tutor-heading" className="text-lg font-semibold text-slate-900">{row.tutor}</h3>
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
          <p className="text-2xl font-semibold text-slate-900">{formatMoney(row.status === 'paid' ? row.finalAmount : owed)}</p>
          {row.status === 'paid' ? (
            <p className="text-xs text-emerald-700">Paid{row.paidAt ? ` · ${formatPayrollDate(row.paidAt)}` : ''}{row.paidVia === 'manual' ? ' · recorded separately' : ''}</p>
          ) : (
            <p className="text-xs text-slate-500">{row.status === 'draft' ? 'Estimate' : 'Reviewed amount'}</p>
          )}

        </div>
      </div>

      {row.status === 'draft' && !row.isCutover && row.nextCadencePayDate ? (
        <p className="mt-3 text-sm text-slate-500">Statement due {formatPayrollDate(row.nextCadencePayDate)} · {row.invoiceCadence === 'biweekly' ? 'Every two weeks' : row.invoiceCadence === 'weekly' ? 'Weekly' : row.invoiceCadence}</p>
      ) : null}
      {row.isCutover ? <p className="mt-3 text-sm text-slate-500">One-off settlement through 20 September</p> : null}

      {row.legacyNeedsReconciliation ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4">
          <p className="text-sm text-amber-950">{row.lastPaidThrough ? `Last payment covers up to ${formatPayrollDate(row.lastPaidThrough)}.` : 'The last paid-through date is missing.'}</p>
          <Link className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800" href={`/admin/finance/payroll?payDate=2026-09-21&tutor=${encodeURIComponent(row.tutorShortName)}`}>Check cutover payment →</Link>
        </div>
      ) : null}
      {row.cutoverNeedsStart ? <p className="mt-4 text-sm text-amber-900">Enter the day after the last paid-through date in the period controls below.</p> : null}
      {row.priorRunPending ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
          <p>Finish the statement for {formatPayrollDate(row.priorRunPending.periodStart)}–{formatPayrollDate(row.priorRunPending.periodEnd)} first.</p>
          <Link href={`/admin/finance/payroll?payDate=${row.priorRunPending.cycleDate}&tutor=${encodeURIComponent(row.tutorShortName)}`} className="rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white">Open earlier statement →</Link>
        </div>
      ) : null}
      {row.overlapsPaid ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">Already paid {row.overlapsPaid.isBoundary ? 'through ' : `${formatPayrollDate(row.overlapsPaid.periodStart)}–`}{formatPayrollDate(row.overlapsPaid.periodEnd)}. Change the period below to avoid paying twice.</p> : null}
      {row.overlapsOutstanding ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">Overlaps the open statement for {formatPayrollDate(row.overlapsOutstanding.periodStart)}–{formatPayrollDate(row.overlapsOutstanding.periodEnd)}. Correct the period below.</p> : null}
      {row.amountConflict ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">Conflicting statements: {row.amountConflict.amounts.map((amount) => formatMoney(amount)).join(' versus ')}. Reconcile the originals before payment.</p> : null}
      {row.attendanceChanged ? <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Attendance changed: reviewed {formatMoney(row.finalAmount)} → recalculated {formatMoney(calculatedFinal)}. Check the lessons before saving the correction.</p> : null}
      {row.noPaymentDueConflict ? (
        <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
          Attendance changed in the £0 period {formatPayrollDate(row.noPaymentDueConflict.periodStart)}–{formatPayrollDate(row.noPaymentDueConflict.periodEnd)}. Payment is held.{' '}
          {row.status === 'no_payment_due' && row.noPaymentDueConflict.laterReviewed ? (
            <span className="block mt-2">A later statement is already open. Reconcile it before reopening this week.</span>
          ) : row.status === 'no_payment_due' ? (
            <PayrollReviewForm action={reopenNoPaymentDueAction} className="mt-3">
              <input type="hidden" name="payroll_id" value={row.payrollId} />
              <input type="hidden" name="expected_updated_at" value={row.updatedAt} />
              <SubmitButton className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Reopen £0 period</SubmitButton>
            </PayrollReviewForm>
          ) : <Link className="font-semibold underline" href={`/admin/finance/payroll?payDate=${row.noPaymentDueConflict.payDate}&tutor=${encodeURIComponent(row.tutorShortName)}`}>Open the £0 period →</Link>}
        </div>
      ) : null}
      {row.status === 'no_payment_due' && !row.noPaymentDueConflict ? <p className="mt-4 text-sm text-slate-600">No statement or payment created. {row.noPaymentDueReason}</p> : null}
      {zeroAmount && !zeroCandidate && (row.windowBasis === 'override' || row.windowEndCustom) ? <p className="mt-4 text-sm text-slate-600">Clear custom dates to close the full £0 period.</p> : null}
      {row.overlapsNoPaymentDue ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">This period overlaps a closed £0 week. Adjust the dates before reviewing.</p> : null}
      {row.tutorResponse === 'disputed' ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900"><strong>Tutor query</strong>{row.tutorNote ? `: “${row.tutorNote}”` : ''}. Payment is held.</p> : null}
      {row.windowCapped ? <p className="mt-4 text-sm text-amber-900">The preview cannot cover the full unpaid period. Check the start date below.</p> : null}
      {workflow.key === 'data_unavailable' ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">Attendance unavailable. Refresh MMS before reviewing or paying.</p> : null}
      {workflow.key === 'recipient_missing' ? <p className="mt-4 text-sm text-amber-900">Add the verified recipient ID in Tutor_Wise, then refresh. This tutor is excluded from the payment file.</p> : null}
      {workflow.key === 'delivery_unknown' ? <p className="mt-4 text-sm text-amber-900">Check Gmail Sent before sharing again: the last delivery is unconfirmed.</p> : null}
      {workflow.key === 'confirmation_time' ? <p className="mt-4 text-sm text-amber-900">The confirmation time is missing. Verify the response before payment.</p> : null}
      {['awaiting', 'paid_awaiting', 'next_week', 'ready'].includes(workflow.key) ? <p className="mt-4 text-sm text-slate-600">{workflow.key === 'paid_awaiting' ? 'Payment recorded. Waiting for the tutor’s confirmation.' : workflow.key === 'ready' ? 'Confirmed. Check the ready batch above.' : workflow.nextAction}</p> : null}
      {row.windowEmpty || row.cutoverNothingOwed || row.cutoverPaidThrough ? <p className="mt-4 text-sm text-slate-600">No new payment needed for this period.{row.manualPaidThrough ? ` Paid through ${formatPayrollDate(row.manualPaidThrough)}.` : ''}</p> : null}
      {row.periodOpen && row.cadenceDue && !row.legacyNeedsReconciliation && !row.priorRunPending ? <p className="mt-3 text-sm text-slate-500">Review opens after {formatPayrollDate(row.periodEnd)}.</p> : null}
      {row.status === 'reviewed' || row.status === 'paid' ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href={statementUrl} className={workflow.key === 'send' ? 'rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800' : 'text-sm font-medium text-blue-700 hover:underline'}>{workflow.key === 'send' ? 'Review and send →' : row.status === 'paid' ? 'View receipt →' : 'View statement →'}</Link>
          {['awaiting', 'send'].includes(workflow.key) ? <Link href={`${statementUrl}#whatsapp-reminder`} className="text-sm font-medium text-blue-700 hover:underline">{workflow.key === 'send' ? 'Share in WhatsApp →' : 'Remind in WhatsApp →'}</Link> : null}
          {row.tutorResponse === 'disputed' ? <Link href={`${statementUrl}#whatsapp-query`} className="text-sm font-medium text-amber-700 hover:underline">Reply to query in WhatsApp →</Link> : null}
        </div>
      ) : null}

      {approval && ['preparing', 'waiting', 'claimed', 'held', 'unknown'].includes(approval.status) ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p>{approval.status === 'waiting' ? 'Statement will be emailed once this period’s records are complete.' : approval.reason || 'Delivery was interrupted. Check the statement and Gmail Sent.'}</p>
        {['waiting', 'preparing', 'held'].includes(approval.status) ? <div className="mt-2"><RecordsNudgeButton key={approval.id} context={recordContext} approval={approval} /></div> : null}
      </div> : null}
      {row.status === 'draft' && !row.periodOpen && (recordReadiness.missingAttendance.length || recordReadiness.missingNotes.length) ? (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Finish lesson records">
          <h4 className="font-semibold">{recordReadiness.ready ? 'School note exception recorded' : 'Finish records before the statement'}</h4>
          {!recordReadiness.ready ? <p className="mt-1 text-xs">Tutor: finish in <a className="underline" href="https://firstchord.co.uk/dashboard" target="_blank" rel="noreferrer">Practice Chat via the tutor dashboard ↗</a>. School: fix a known anomaly at source or record why one practice note is not required.</p> : null}
          <ul className="mt-3 space-y-1 text-xs">
            {recordReadiness.missingAttendance.map((item) => <li key={`a-${item.attendanceId || item.startAt}-${item.studentId}`}>Attendance · {formatPayrollDate(item.startAt, { withTime: true })} · {item.studentName || 'Student unknown'}</li>)}
            {recordReadiness.unresolvedNotes.map((item) => <li key={`n-${item.attendanceId || item.startAt}-${item.studentId}`}>Practice note · {formatPayrollDate(item.startAt, { withTime: true })} · {item.studentName || 'Student unknown'}{item.studentId ? <> · <a className="underline" href={mmsStudentUrl(item.studentId)} target="_blank" rel="noreferrer">Check in MMS ↗</a></> : null}</li>)}
          </ul>
          {recordReadiness.exceptions.filter((entry) => recordReadiness.missingNotes.some((item) => item.attendanceId === entry.attendanceId)).map((entry) => {
            const item = recordReadiness.missingNotes.find((missing) => missing.attendanceId === entry.attendanceId);
            return <p key={entry.attendanceId} className="mt-2 text-xs">Note not required · {item?.studentName || 'Student'} · {entry.reason} · {entry.actor} · {formatPayrollDate(entry.recordedAt)}</p>;
          })}
          {recordReadiness.uncertain.length ? <p className="mt-2 text-xs font-semibold">An exact MMS lesson ID or date is missing. Check at school before emailing.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!autoPending && recordNudge.ok && !row.legacyNeedsReconciliation && !row.priorRunPending ? <RecordsNudgeButton key={row.payrollId} context={recordContext} allowDeferred={row.allowDeferred && !row.isCutover && row.windowBasis !== 'override'} /> : null}
            {!autoPending && row.allowDeferred && recordNudge.reason === 'already_sent' && !row.isCutover && row.windowBasis !== 'override' ? <RecordsNudgeButton key={`${row.payrollId}-approve`} context={recordContext} alreadySent /> : null}
            {recordNudge.reason === 'already_sent' ? <span className="text-xs">Checklist emailed{row.recordsNudgeSentAt ? ` ${formatPayrollDate(row.recordsNudgeSentAt)}` : ''}.</span> : null}
            {recordNudge.reason === 'check_gmail' ? <span className="text-xs font-semibold">Check Gmail Sent. Delivery is uncertain; no automatic retry.</span> : null}
            {recordNudge.reason === 'unverified_contact' ? <Link className="text-xs underline" href="/admin/finance/payroll/settings">Verify the tutor’s payroll email ↗</Link> : null}
          </div>
          {!autoPending && recordReadiness.unresolvedNotes.filter((item) => item.attendanceId).length ? (
            <details className="mt-3 border-t border-amber-200 pt-2">
              <summary className="cursor-pointer text-xs font-semibold">School-side note exception</summary>
              <p className="mt-2 text-xs">Use only if the note genuinely is not required. This does not mark it complete in MMS.</p>
              {recordReadiness.unresolvedNotes.filter((item) => item.attendanceId).map((item) => (
                <PayrollReviewForm key={item.attendanceId} action={recordNoteExceptionAction} className="mt-2 flex flex-wrap items-end gap-2">
                  {Object.entries(recordContext).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
                  <input type="hidden" name="attendanceId" value={item.attendanceId} />
                  <label className="min-w-56 flex-1 text-xs">{formatPayrollDate(item.startAt, { withTime: true })} · {item.studentName || 'Student'}
                    <input name="reason" required minLength={8} maxLength={400} placeholder="Why is the note not required?" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-2 text-xs" />
                  </label>
                  <SubmitButton className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold">Record exception</SubmitButton>
                </PayrollReviewForm>
              ))}
            </details>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4 space-y-3">
        {/* Lead with statuses payroll cannot yet classify; only genuinely unmarked rows need an MMS write. */}
        {reviewPast.length ? (
          <details open={showAttendance} className="rounded-xl border border-slate-200 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">{reviewPast.length} lesson{reviewPast.length === 1 ? '' : 's'} to check</summary>
            <p className="mt-3 text-xs text-slate-500">Choose the actual lesson outcome. Changes save to MMS.</p>
            <SlotListBody slots={reviewPast} withDecision />
          </details>
        ) : null}

        <details className="group rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">
            Lessons and calculation
            <span className="text-xs font-medium text-slate-400 group-open:hidden">Show</span>
            <span className="hidden text-xs font-medium text-slate-400 group-open:inline">Hide</span>
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">{row.lessonCount} payable lessons · {minutesLabel(row.teachingMinutes)}</p>
            {reviewUpcoming.length ? (
              <CollapsibleSlotList title="Upcoming (not yet taught)" slots={reviewUpcoming} />
            ) : null}
            <CollapsibleSlotList title="Payable from MMS attendance" slots={row.payableSlots} empty="No payable lessons found for this period." />
            {row.excludedSlots?.length ? (
              <CollapsibleSlotList title="Not counted: absent / cancelled" slots={row.excludedSlots} empty="None." />
            ) : null}
          </div>
        </details>
      </div>

      {zeroCandidate ? (
        <PayrollReviewForm action={recordNoPaymentDueAction} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">No payment due this period</p>
          <p className="mt-1 text-xs text-slate-600">Close this £0 week without emailing a statement or recording a payment. Attendance is checked again before saving.</p>
          {Object.entries({ payroll_id: row.payrollId, tutor_short_name: row.tutorShortName, pay_date: row.payDate,
            period_start: row.periodStart, period_end: row.periodEnd, expected_updated_at: row.createdAt ? row.updatedAt : '' }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <label className="mt-3 block text-xs font-medium text-slate-700">Reason
            <input name="reason" required minLength={4} maxLength={240} placeholder="Another tutor covered this week" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
          <SubmitButton className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Close £0 period</SubmitButton>
        </PayrollReviewForm>
      ) : null}

      {row.status !== 'paid' && row.status !== 'no_payment_due' && !zeroCandidate ? (
      <details id="payroll-review-options" open={(!reviewBlocked && row.status === 'draft') || row.attendanceChanged || periodCorrection} className="mt-4">
      <summary className="cursor-pointer text-sm text-slate-600">{reviewBlocked ? 'Statement and period options' : row.status === 'draft' ? 'Review statement' : 'Correct statement'}</summary>
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
            blocked={reviewBlocked}
          />
        </div>
        <details open={periodCorrection} className="group mt-3 border-t border-slate-200 pt-3">
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
        <PayrollReviewForm action={recordManualCutoverPaymentAction} className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
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
            <SubmitButton className="mt-3" pendingLabel="Recording payment…" variant="warning">Record already paid</SubmitButton>
          </details>
        </PayrollReviewForm>
      ) : null}
      {hasCutoverConfirmationWaiver(row) && !row.tutorResponse ? (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Cutoff confirmation waived by admin on {formatPayrollDate(row.cutoverConfirmationWaivedAt)}. {row.cutoverConfirmationWaiverReason} No tutor confirmation was recorded; the next statement still requires confirmation.
        </p>
      ) : null}
      {isPaidCutoverFollowUpOpen(row) ? (
        <PayrollReviewForm action={recordManualCutoverConfirmationAction} className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
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
            <SubmitButton className="mt-3" pendingLabel="Recording confirmation…">Record email confirmation</SubmitButton>
          </details>
        </PayrollReviewForm>
      ) : null}
    </article>
  );
}
