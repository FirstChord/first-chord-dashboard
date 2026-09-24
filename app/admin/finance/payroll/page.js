import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import Link from 'next/link';
import { Suspense, cache } from 'react';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { getPauseHistoryRows, getPayrollRunRows, getStudentsSheetRows, getTutorLifecycleRows, getTutorPayRows, getTutorWiseRows, upsertPayrollRunRow } from '@/lib/admin/sheets';
import { peekPayrollAttendanceAge, searchAttendanceForPayroll } from '@/lib/admin/mms';
import { parseTutorPay } from '@/lib/admin/cost-helpers.mjs';
import {
  buildPayrollAttendanceQuery,
  buildPayrollPreview,
  formatPayrollDate,
  nextMonday,
  isPayrollCutoverPeriod,
  isPayrollPeriodOpen,
  findBlockingReviewedRun,
  selectPayrollRosterRows,
  PAYROLL_CUTOVER_PERIOD_END,
  PAYROLL_CUTOVER_RUN_DATE,
  PAYROLL_NEW_SYSTEM_START,
} from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { parseTutorWise, buildWiseBatch, selectPayableReviewedRuns } from '@/lib/admin/wise-helpers.mjs';
import { getPayrollWorkflowState, hasMaterialTutorStatementChange } from '@/lib/admin/payroll-workflow-helpers.mjs';
import { buildManualCutoverEmailConfirmation, buildManualCutoverPayment } from '@/lib/admin/payroll-manual-settlement-helpers.mjs';
import { findPauseHistoryCoverageForLesson } from '@/lib/admin/pause-helpers.mjs';
import AdjustWindowForm from './adjust-window-form';
import WisePayoutPanel from './wise-payout-panel';
import PayrollSaveButtons from './save-buttons';
import TutorSelector from './tutor-selector';
import AttendanceDecision from './attendance-decision';

export const dynamic = 'force-dynamic';

async function savePayrollRunAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    throw new Error('Not authorised');
  }

  const now = new Date().toISOString();
  // Reviewing never originates a payment; payment markers have separate actions.
  const status = `${formData.get('existing_status') || ''}`.trim() === 'paid' ? 'paid' : 'reviewed';
  const existingCreatedAt = `${formData.get('created_at') || ''}`.trim();
  const expectedAmount = Number.parseFloat(`${formData.get('expected_amount') || '0'}`) || 0;
  const adjustmentAmount = Number.parseFloat(`${formData.get('adjustment_amount') || '0'}`) || 0;
  const finalAmount = Math.round((expectedAmount + adjustmentAmount) * 100) / 100;
  const payrollId = `${formData.get('payroll_id') || ''}`.trim();
  const tutor = `${formData.get('tutor') || ''}`.trim();
  const tutorShortName = `${formData.get('tutor_short_name') || ''}`.trim();
  const periodEnd = `${formData.get('period_end') || ''}`.trim();
  if (isPayrollPeriodOpen(periodEnd)) {
    throw new Error('This payroll period is still open and cannot be reviewed yet.');
  }
  const paymentRoute = isPayrollCutoverPeriod({ periodEnd })
    ? 'confirmation'
    : (`${formData.get('payment_route') || 'normal'}`.trim() === 'confirmation' ? 'confirmation' : 'normal');
  const nextStatement = {
    period_start: `${formData.get('period_start') || ''}`.trim(),
    period_end: periodEnd,
    lesson_count: `${formData.get('lesson_count') || '0'}`.trim(),
    teaching_minutes: `${formData.get('teaching_minutes') || '0'}`.trim(),
    expected_amount: expectedAmount,
    adjustment_amount: adjustmentAmount,
    final_amount: finalAmount,
    payment_route: paymentRoute,
  };
  const existingRuns = await getPayrollRunRows();
  const existingRun = existingRuns.find((row) => `${row.payroll_id ?? row.payrollId ?? ''}`.trim() === payrollId) || null;
  if (existingRun?.status === 'paid' && (status !== 'paid' || hasMaterialTutorStatementChange(existingRun, nextStatement))) {
    throw new Error('This statement is already paid. Its period and amount cannot be changed by saving an old form.');
  }
  const blockingRun = findBlockingReviewedRun(existingRuns, { tutorShortName, tutor, payrollId });
  if (blockingRun) {
    throw new Error(`Finish the earlier statement ending ${blockingRun.periodEnd} before reviewing this period.`);
  }
  const statementChanged = status === 'reviewed'
    && existingRun
    && hasMaterialTutorStatementChange(existingRun, nextStatement);
  const reviewedAt = statementChanged || !`${formData.get('reviewed_at') || ''}`.trim()
    ? now
    : `${formData.get('reviewed_at') || now}`.trim();
  await upsertPayrollRunRow({
    payroll_id: payrollId,
    pay_date: `${formData.get('pay_date') || ''}`.trim(),
    period_start: `${formData.get('period_start') || ''}`.trim(),
    period_end: periodEnd,
    tutor,
    tutor_short_name: tutorShortName,
    teacher_id: `${formData.get('teacher_id') || ''}`.trim(),
    invoice_cadence: `${formData.get('invoice_cadence') || ''}`.trim(),
    pay_model: `${formData.get('pay_model') || ''}`.trim(),
    lesson_count: `${formData.get('lesson_count') || '0'}`.trim(),
    review_lesson_count: `${formData.get('review_lesson_count') || '0'}`.trim(),
    teaching_minutes: `${formData.get('teaching_minutes') || '0'}`.trim(),
    expected_amount: expectedAmount,
    adjustment_amount: adjustmentAmount,
    final_amount: finalAmount,
    status,
    invoice_status: `${formData.get('invoice_status') || ''}`.trim(),
    payment_route: paymentRoute,
    statement_sent_at: statementChanged ? '' : `${formData.get('statement_sent_at') || ''}`.trim(),
    statement_sent_by: statementChanged ? '' : `${formData.get('statement_sent_by') || ''}`.trim(),
    statement_delivery_status: statementChanged ? '' : `${formData.get('statement_delivery_status') || ''}`.trim(),
    statement_delivery_channel: statementChanged ? '' : `${formData.get('statement_delivery_channel') || ''}`.trim(),
    statement_delivery_to: statementChanged ? '' : `${formData.get('statement_delivery_to') || ''}`.trim(),
    statement_delivery_attempted_at: statementChanged ? '' : `${formData.get('statement_delivery_attempted_at') || ''}`.trim(),
    statement_delivery_message_id: statementChanged ? '' : `${formData.get('statement_delivery_message_id') || ''}`.trim(),
    statement_delivery_error: statementChanged ? '' : `${formData.get('statement_delivery_error') || ''}`.trim(),
    notes: `${formData.get('notes') || ''}`.trim(),
    reviewed_at: status === 'reviewed' ? reviewedAt : `${formData.get('reviewed_at') || now}`.trim(),
    reviewed_by: status === 'reviewed' ? session.user.email || '' : `${formData.get('reviewed_by') || session.user.email || ''}`.trim(),
    paid_at: status === 'paid' ? `${formData.get('paid_at') || now}`.trim() : '',
    paid_by: status === 'paid' ? `${formData.get('paid_by') || session.user.email || ''}`.trim() : '',
    tutor_response: statementChanged ? '' : `${formData.get('tutor_response') || ''}`.trim(),
    tutor_responded_at: statementChanged ? '' : `${formData.get('tutor_responded_at') || ''}`.trim(),
    tutor_note: statementChanged ? '' : `${formData.get('tutor_note') || ''}`.trim(),
    tutor_response_source: statementChanged ? '' : `${formData.get('tutor_response_source') || ''}`.trim(),
    paid_via: `${formData.get('paid_via') || ''}`.trim(),
    source: 'mms_attendance_preview',
    created_at: existingCreatedAt || now,
    updated_at: now,
  });

  revalidatePath('/admin/finance/payroll');
  // Do not make the form POST wait for the entire payroll workspace to render
  // again. That render reads several provider-backed sources and can be slow
  // even though the reviewed row is already safely persisted, leaving the
  // button apparently stuck on "Saving…". The frozen statement is both the
  // proof that the write completed and the next step in the workflow.
  redirect(`/admin/finance/payroll/statement?pid=${encodeURIComponent(payrollId)}`);
}

async function recordManualCutoverPaymentAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');
  if (formData.get('payment_verified') !== 'yes') throw new Error('Verify the external payment first.');

  const payrollId = `${formData.get('payroll_id') || ''}`.trim();
  const runs = await getPayrollRunRows();
  const row = runs.find((entry) => `${entry.payroll_id || ''}`.trim() === payrollId);
  if (!row) throw new Error('Statement not found.');
  const updated = buildManualCutoverPayment(row, {
    expectedAmount: formData.get('expected_amount'),
    paymentDate: formData.get('payment_date'),
    actorEmail: session.user.email,
  });
  await upsertPayrollRunRow(updated);
  revalidatePath('/admin/finance/payroll');
  redirect(`/admin/finance/payroll/statement?pid=${encodeURIComponent(payrollId)}`);
}

async function recordManualCutoverConfirmationAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');
  if (formData.get('email_verified') !== 'yes') throw new Error('Verify the tutor email reply first.');

  const payrollId = `${formData.get('payroll_id') || ''}`.trim();
  const runs = await getPayrollRunRows();
  const row = runs.find((entry) => `${entry.payroll_id || ''}`.trim() === payrollId);
  if (!row) throw new Error('Statement not found.');
  const updated = buildManualCutoverEmailConfirmation(row, {
    confirmationDate: formData.get('confirmation_date'),
    actorEmail: session.user.email,
  });
  await upsertPayrollRunRow(updated);
  revalidatePath('/admin/finance/payroll');
  redirect(`/admin/finance/payroll/statement?pid=${encodeURIComponent(payrollId)}`);
}

// Flip exactly the reviewed rows that were in the Wise batch to paid, in one go.
// Operates on the persisted Payroll_Runs rows by id; only reviewed rows flip,
// so a draft/already-paid row can't be caught up by accident.
async function markBatchPaidAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    throw new Error('Not authorised');
  }

  const ids = `${formData.get('payrollIds') || ''}`
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return;

  const now = new Date().toISOString();
  const existing = await getPayrollRunRows();
  const byId = new Map(existing.map((row) => [`${row.payroll_id ?? ''}`.trim(), row]));
  let markedCount = 0;

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    if (`${row.status ?? ''}`.trim() !== 'reviewed') continue;
    await upsertPayrollRunRow({
      ...row,
      status: 'paid',
      paid_at: now,
      paid_by: session.user.email || '',
      paid_via: 'wise',
      updated_at: now,
    });
    markedCount += 1;
  }

  revalidatePath('/admin/finance/payroll');
  const payDate = `${formData.get('payDate') || ''}`.trim().slice(0, 10);
  const query = new URLSearchParams({ payDate: /^\d{4}-\d{2}-\d{2}$/u.test(payDate) ? payDate : nextMonday(), paid: markedCount ? '1' : '0' });
  redirect(`/admin/finance/payroll?${query}`);
}

function minutesLabel(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m ? ` ${m}m` : ''}`;
}

function pickSheetValue(row, keys) {
  for (const key of keys) {
    const value = `${row?.[key] || ''}`.trim();
    if (value) return value;
  }
  return '';
}

function addPauseEvidenceToPayrollRows(rows = [], studentRows = [], pauseRows = []) {
  const studentsById = new Map(studentRows.map((student) => {
    const mmsId = pickSheetValue(student, ['mms_id', 'MMS ID', 'MMS Id', 'Student ID']);
    return [mmsId, {
      studentName: [pickSheetValue(student, ['Student forename']), pickSheetValue(student, ['Student Surname'])].filter(Boolean).join(' '),
      email: pickSheetValue(student, ['Email']),
      stripeSubscriptionId: pickSheetValue(student, ['stripe_subscription_id']),
    }];
  }).filter(([mmsId]) => mmsId));

  return rows.map((row) => ({
    ...row,
    reviewSlots: (row.reviewSlots || []).map((slot) => ({
      ...slot,
      students: (slot.students || []).map((student) => {
        const context = studentsById.get(student.studentId) || {};
        return {
          ...student,
          pauseEvidence: findPauseHistoryCoverageForLesson({
            studentEmail: context.email || '',
            studentName: context.studentName || student.studentName || '',
            stripeSubscriptionId: context.stripeSubscriptionId || '',
            lessonDate: slot.lessonDate,
            pauseRows,
          }),
        };
      }),
    })),
  }));
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

function PayrollTutorCard({ row, payDate }) {
  const calculatedFinal = row.recalculatedFinalAmount
    ?? Math.round((row.expectedAmount + row.adjustmentAmount) * 100) / 100;
  const owed = row.owedAmount ?? (row.status === 'paid' ? 0 : (row.finalAmount || calculatedFinal));
  const basisLabel = { since_paid: 'since last paid', since_pending: 'after earlier statement', first_run: 'default window', override: 'custom window' }[row.windowBasis] || row.windowBasis || '';
  const reviewPast = (row.reviewSlots || []).filter((slot) => slot.timing === 'past');
  const reviewUpcoming = (row.reviewSlots || []).filter((slot) => slot.timing === 'upcoming');
  const workflow = getPayrollWorkflowState(row);
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
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
              {row.isCutover ? 'one-off cutover' : row.invoiceCadence}
            </span>
            {row.payModel === 'salary' ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs text-violet-700">salary</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {formatPayrollDate(row.periodStart)} - {formatPayrollDate(row.periodEnd)} · {row.windowDays} days{basisLabel ? ` · ${basisLabel}` : ''}{row.windowEndCustom ? ' · custom end' : ''}
          </p>
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
              {workflow.key === 'send' ? 'Send statement' : 'View statement'} →
            </Link>
          ) : null}
        </div>
      </div>

      {row.isCutover ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <p className="font-semibold">One-off payroll cutover</p>
          <p className="mt-1">This closes legacy pay through {formatPayrollDate(PAYROLL_CUTOVER_PERIOD_END)}. New Monday-based periods start {formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}. Tutor confirmation is required before payment.</p>
        </div>
      ) : null}

      <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${workflowClass}`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">Next</p>
          <p className="mt-0.5 text-sm font-semibold">{workflow.nextAction}</p>
        </div>
        <span className="text-xs font-medium">
          {row.paymentRoute === 'confirmation' ? 'Tutor confirmation' : 'Pay normally'}
        </span>
      </div>

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
      {row.windowEmpty ? (
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
          {reviewPast.length} taught lesson{reviewPast.length === 1 ? '' : 's'} not yet marked in MMS — record {reviewPast.length === 1 ? 'it' : 'them'} before trusting this figure.
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
      {row.tutorResponse === 'confirmed' ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {row.tutorResponseSource === 'email_admin_recorded' ? 'Email confirmation recorded by admin' : 'Confirmed ✓ by tutor'}{row.tutorRespondedAt ? ` · ${formatPayrollDate(row.tutorRespondedAt)}` : ''}.
        </div>
      ) : row.tutorResponse === 'disputed' ? (
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
        {/* Lead with the genuine open loop: taught but not yet recorded in MMS. */}
        {reviewPast.length ? (
          <SlotList title="Needs recording" slots={reviewPast} withDecision />
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

      {!(row.status === 'paid' && row.paidVia === 'manual') ? (
      <form action={savePayrollRunAction} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
        ].map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value ?? ''} />
        ))}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block sm:min-w-64">
            <span className="text-xs font-semibold text-slate-600">Payment route</span>
            {row.isCutover ? (
              <>
                <input type="hidden" name="payment_route" value="confirmation" />
                <div className="mt-1 w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-900">Tutor confirmation required</div>
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
            blocked={row.status === 'draft' && Boolean(reviewPast.length || row.overlapsPaid || row.overlapsOutstanding || row.priorRunPending || row.periodOpen || !row.cadenceDue || row.cutoverNeedsStart || row.cutoverNothingOwed)}
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
      </form>
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

// Preserve the cycle date and any window override across a refresh round-trip;
// `refresh` itself is deliberately dropped.
function buildPayrollQuery(params = {}) {
  const query = new URLSearchParams();
  for (const key of ['payDate', 'tutor', 'start', 'end']) {
    const value = `${params[key] || ''}`.trim();
    if (value) query.set(key, value);
  }
  return query.toString();
}

// Everything below the page header, memoised per request so the streamed
// summary line and the workspace share one set of fetches rather than each
// paying for its own. Arguments are primitives on purpose: React's cache() keys
// on argument identity, so an options object would miss on every call.
const loadPayrollWorkspace = cache(async (payDate, tutorParam, startParam, endParam) => {
  // Per-tutor window override: ?tutor=<shortName>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>
  // (one tutor at a time). end lets an invoice that closes earlier in the week stop short.
  const overrides = tutorParam && (startParam || endParam)
    ? { [tutorParam]: { start: startParam, end: endParam } }
    : {};

  const [tutorPayRows, savedRuns, tutorWiseRows, studentRows, pauseRows, lifecycleRows] = await Promise.all([
    getTutorPayRows(),
    getPayrollRunRows(),
    getTutorWiseRows(),
    getStudentsSheetRows(),
    getPauseHistoryRows(),
    getTutorLifecycleRows(),
  ]);

  // allowExpired: a save re-renders this whole page inside its own POST, and the
  // button's spinner lasts exactly as long as that render. Blocking here on a
  // ~950-row MMS fetch was the difference between a ~1s save and a ~7s one, so
  // this render always takes whatever is cached — however old — and lets the
  // refresh run behind the request. `?refresh=1` is the deliberate wait.
  const attendanceQuery = buildPayrollAttendanceQuery(payDate);
  let attendanceRows = [];
  let loadError = '';
  try {
    attendanceRows = await searchAttendanceForPayroll({ ...attendanceQuery, allowExpired: true });
  } catch (error) {
    loadError = error.message || 'Could not load MMS attendance for payroll.';
  }
  const attendanceAge = peekPayrollAttendanceAge(attendanceQuery);

  const preview = buildPayrollPreview({
    attendanceRows,
    tutorPay: parseTutorPay(tutorPayRows),
    savedRuns,
    overrides,
    payDate,
  });
  // Salaried tutors (Finn/Tom/Fennella) are paid a fixed wage, not per-lesson via
  // this Wise reconciliation — keep them off the payroll page entirely. Totals and
  // the Wise batch already exclude salary, so this is display-only.
  const activeRows = addPauseEvidenceToPayrollRows(selectPayrollRosterRows(preview.rows, lifecycleRows, savedRuns), studentRows, pauseRows)
    .filter((row) => row.payModel !== 'salary');
  const reviewLessonCount = activeRows.reduce((total, row) => total + row.reviewLessonCount, 0);
  // A refreshed correction must go back through the existing human save step.
  // Hold every saved row for that tutor out of this rendered Wise batch so an
  // older duplicate window cannot become the fallback payment by accident.
  const attendanceChangedRows = activeRows.filter((row) => row.attendanceChanged);
  const heldTutorKeys = new Set(attendanceChangedRows.map((row) => `${row.tutorShortName || row.tutor}`.trim().toLowerCase()));
  const heldPayrollIds = savedRuns
    .filter((row) => heldTutorKeys.has(`${row.tutor_short_name ?? row.tutorShortName ?? row.tutor ?? row.Tutor ?? ''}`.trim().toLowerCase()))
    .map((row) => `${row.payroll_id ?? row.payrollId ?? ''}`.trim())
    .filter(Boolean);
  const heldPayrollIdSet = new Set(heldPayrollIds);
  // Wise batch comes straight from saved reviewed rows (window-independent), so
  // a tutor reviewed under an adjusted window still lands in the CSV.
  const { rows: payableRows, amountConflicts, disputed } = selectPayableReviewedRuns(
    savedRuns.filter((row) => !heldPayrollIdSet.has(`${row.payroll_id ?? row.payrollId ?? ''}`.trim())),
  );
  const wiseBatch = buildWiseBatch({ rows: payableRows, wiseByKey: parseTutorWise(tutorWiseRows) });
  const wiseCsvParams = new URLSearchParams({ payDate });
  if (heldPayrollIds.length) wiseCsvParams.set('excludePayrollIds', heldPayrollIds.join(','));
  // Confirmation can remain open after an externally paid cutoff, but that
  // row is still excluded from Wise because its payment status is paid.
  const confirmationRows = activeRows.filter((row) => row.paymentRoute === 'confirmation'
    && (row.status === 'reviewed' || (row.status === 'paid' && row.paidVia === 'manual' && row.tutorResponse !== 'confirmed')));
  const confirmations = {
    confirmed: confirmationRows.filter((row) => row.tutorResponse === 'confirmed').length,
    disputed: confirmationRows.filter((row) => row.tutorResponse === 'disputed').length,
    awaiting: confirmationRows.filter((row) => !row.tutorResponse).length,
  };
  const workspaceRows = activeRows.map((row) => ({ ...row, workflow: getPayrollWorkflowState(row) }));
  const cutoverProgress = payDate === PAYROLL_CUTOVER_RUN_DATE ? {
    total: workspaceRows.length,
    complete: workspaceRows.filter((row) => ['paid', 'nothing_due'].includes(row.workflow.key)).length,
    prepare: workspaceRows.filter((row) => ['cutover_start', 'attendance', 'mms_changed', 'review', 'window_conflict', 'statement_overlap'].includes(row.workflow.key)).length,
    send: workspaceRows.filter((row) => row.workflow.key === 'send').length,
    waiting: workspaceRows.filter((row) => ['awaiting', 'paid_awaiting'].includes(row.workflow.key)).length,
    queries: workspaceRows.filter((row) => ['disputed', 'paid_query'].includes(row.workflow.key)).length,
    ready: workspaceRows.filter((row) => row.workflow.key === 'ready').length,
  } : null;
  const selectedRow = workspaceRows.find((row) => row.tutorShortName === tutorParam)
    || workspaceRows.find((row) => !['paid', 'ready'].includes(row.workflow.key))
    || workspaceRows[0]
    || null;
  const selectedTutor = selectedRow?.tutorShortName || '';
  const selectorRows = workspaceRows.map(({ payrollId, tutor, tutorShortName, workflow }) => ({ payrollId, tutor, tutorShortName, workflow }));

  return {
    preview,
    reviewLessonCount,
    selectedRow,
    selectedTutor,
    selectorRows,
    wiseBatch,
    wiseCsvParams,
    confirmations,
    attendanceChangedRows,
    amountConflicts,
    disputed,
    loadError,
    attendanceAge,
    cutoverProgress,
  };
});

// Rounded age of the attendance the page is showing, but only once it is past
// the point where the cache would previously have forced a wait — under that,
// the data is current enough that saying anything is noise.
function staleAttendanceLabel(attendanceAge) {
  if (!attendanceAge?.isExpired) return '';
  const minutes = Math.round(attendanceAge.age / 60000);
  if (minutes < 90) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

export default async function AdminPayrollPage({ searchParams }) {
  const params = (await searchParams) || {};
  const payDate = `${params.payDate || nextMonday()}`.slice(0, 10);
  const tutorParam = `${params.tutor || ''}`.trim();
  const startParam = `${params.start || ''}`.slice(0, 10);
  const endParam = `${params.end || ''}`.slice(0, 10);

  // `?refresh=1` is the deliberate "I just recorded a lesson in MMS" escape
  // hatch — the one place waiting is honest, because you asked for fresh rows.
  // It runs before any streaming begins so redirect() can still send a real
  // redirect instead of having to unwind a part-sent response.
  const forceRefresh = `${params.refresh || ''}` === '1';
  let refreshError = '';
  if (forceRefresh) {
    try {
      await searchAttendanceForPayroll({ ...buildPayrollAttendanceQuery(payDate), forceRefresh: true });
    } catch (error) {
      refreshError = error.message || 'Could not load MMS attendance for payroll.';
    }
    // Drop `refresh` from the URL once it has done its job, otherwise every later
    // save re-renders this page with refresh=1 still set and refetches MMS every
    // time — exactly the cost the cache exists to avoid. Must sit outside the try:
    // redirect() signals by throwing, and the catch above would swallow it.
    if (!refreshError) {
      const cleanQuery = buildPayrollQuery(params);
      redirect(`/admin/finance/payroll?${[cleanQuery, 'refreshed=1'].filter(Boolean).join('&')}`);
    }
  }

  // The shell — title, cycle date, refresh — renders immediately from the URL
  // alone. Everything that needs Sheets or MMS streams in below it, so the page
  // is never a blank wait for its slowest fetch.
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b border-slate-200 pb-6">
        <Link href="/admin/finance" className="text-sm font-medium text-blue-700">← Finance</Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-center gap-3 text-[2rem] font-semibold tracking-[-0.035em] text-slate-950">
              Payroll
              <ScopeBadge>Nothing is paid automatically</ScopeBadge>
            </h2>
            <Suspense fallback={<p className="mt-2 h-5 w-80 max-w-full animate-pulse rounded bg-slate-100" />}>
              <PayrollSummaryLine payDate={payDate} tutor={tutorParam} start={startParam} end={endParam} />
            </Suspense>
          </div>
          <form className="flex items-end gap-2">
            <label>
              <span className="text-xs font-semibold text-slate-500">Cycle date</span>
              <input type="date" name="payDate" defaultValue={payDate} className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Load</button>
          </form>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Changed attendance in MMS? Refresh before reviewing the amount.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/finance/payroll/settings" className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            Tutor delivery settings
          </Link>
          <Link href={`/admin/finance/payroll?payDate=${PAYROLL_CUTOVER_RUN_DATE}`} className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 shadow-sm hover:bg-blue-100">
            Cutover through {formatPayrollDate(PAYROLL_CUTOVER_PERIOD_END)}
          </Link>
          <Link
            href={`/admin/finance/payroll?${[buildPayrollQuery(params), 'refresh=1'].filter(Boolean).join('&')}`}
            prefetch={false}
            className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 shadow-sm hover:bg-blue-100"
            title="Use after recording attendance in MMS"
          >
            ↻ Refresh MMS &amp; recalculate
          </Link>
        </div>
      </div>

      {`${params.refreshed || ''}` === '1' ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          MMS attendance refreshed. Draft totals are recalculated; any reviewed amount affected by a correction is marked below for you to check and save.
        </section>
      ) : null}

      {`${params.paid || ''}` === '1' ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          Payroll rows marked paid. Check the refreshed Ready to pay list before preparing another Wise batch.
        </section>
      ) : null}
      {`${params.paid || ''}` === '0' ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          No reviewed rows were marked paid. Refresh the Wise batch before trying again.
        </section>
      ) : null}

      {refreshError ? (
        <section className="rounded-[1.6rem] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          MMS payroll attendance could not be refreshed: {refreshError}
        </section>
      ) : null}

      <Suspense fallback={<PayrollWorkspaceFallback />}>
        <PayrollWorkspace payDate={payDate} tutor={tutorParam} start={startParam} end={endParam} />
      </Suspense>
    </div>
  );
}

async function PayrollSummaryLine({ payDate, tutor, start, end }) {
  const { reviewLessonCount, wiseBatch, confirmations, attendanceAge } = await loadPayrollWorkspace(payDate, tutor, start, end);
  const stale = staleAttendanceLabel(attendanceAge);
  return (
    <p className="mt-2 text-sm text-slate-500">
      {formatMoney(wiseBatch.totalAmount)} ready · {reviewLessonCount} lesson{reviewLessonCount === 1 ? '' : 's'} need review · {confirmations.awaiting} awaiting
      {stale ? <span className="text-slate-400"> · MMS attendance from {stale}, refreshing</span> : null}
    </p>
  );
}

function PayrollWorkspaceFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading payroll">
      <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white/60" />
      <div className="h-96 animate-pulse rounded-[1.4rem] border border-slate-200 bg-white/60" />
    </div>
  );
}

function CutoverGuide({ progress }) {
  if (!progress) return null;
  const pct = progress.total ? Math.round((progress.complete / progress.total) * 100) : 0;
  const stages = [
    ['Prepare', progress.prepare, 'Check dates, attendance and amount'],
    ['Send', progress.send, 'Statement ready to email'],
    ['Waiting', progress.waiting, 'Tutor has not replied yet'],
    ['Queries', progress.queries, 'Correction or conversation needed'],
    ['Ready to pay', progress.ready, 'Confirmed and available for Wise'],
  ];
  return (
    <section className="rounded-[1.4rem] border border-blue-200 bg-blue-50/80 p-5 text-blue-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">One-off cutover queue</p>
          <h3 className="mt-1 text-lg font-semibold">{progress.complete} of {progress.total} tutors complete</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-blue-900">Choose a tutor below and follow the single <strong>Next</strong> instruction: check → review → send → confirm → pay and record payment. If already paid separately, record that payment now and keep confirmation outstanding. Nothing emails or pays automatically.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-blue-900">{pct}% complete</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-blue-100" aria-label={`${pct}% of tutor cutovers complete`}>
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map(([label, count, hint]) => (
          <div key={label} className="rounded-xl border border-blue-100 bg-white/80 px-3 py-2.5">
            <p className="text-sm font-semibold">{count} · {label}</p>
            <p className="mt-0.5 text-[0.68rem] leading-4 text-slate-500">{hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

async function PayrollWorkspace({ payDate, tutor, start, end }) {
  const {
    selectedRow,
    selectedTutor,
    selectorRows,
    wiseBatch,
    wiseCsvParams,
    confirmations,
    attendanceChangedRows,
    amountConflicts,
    disputed,
    loadError,
    cutoverProgress,
  } = await loadPayrollWorkspace(payDate, tutor, start, end);

  return (
    <>
      {loadError ? (
        <section className="rounded-[1.6rem] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          MMS payroll attendance could not be loaded: {loadError}
        </section>
      ) : null}

      <CutoverGuide progress={cutoverProgress} />

      <section className="space-y-4">
        <TutorSelector rows={selectorRows} selectedTutor={selectedTutor} payDate={payDate} />
        {selectedRow ? (
          <PayrollTutorCard key={selectedRow.payrollId} row={selectedRow} payDate={payDate} />
        ) : (
          <div className="rounded-[1.6rem] border border-slate-200 bg-white/90 p-6 text-sm text-slate-500">
            No payroll rows found for this period.
          </div>
        )}
      </section>

      <details className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" open={Boolean(wiseBatch.includedCount)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800">
          Ready to pay · {wiseBatch.includedCount} tutor{wiseBatch.includedCount === 1 ? '' : 's'} · {formatMoney(wiseBatch.totalAmount)}
          <span className="text-xs text-slate-400 group-open:hidden">Show</span>
          <span className="hidden text-xs text-slate-400 group-open:inline">Hide</span>
        </summary>
        <div className="mt-4">
          <WisePayoutPanel
            includedCount={wiseBatch.includedCount}
            includedTutors={wiseBatch.includedTutors}
            totalLabel={formatMoney(wiseBatch.totalAmount)}
            missingNames={wiseBatch.missing.map((entry) => entry.tutor).filter(Boolean)}
            payDate={payDate}
            downloadHref={`/admin/finance/payroll/wise-csv?${wiseCsvParams.toString()}`}
            payrollIds={wiseBatch.includedPayrollIds}
            amountConflicts={amountConflicts}
            disputed={disputed}
            mmsChanges={attendanceChangedRows.map((row) => ({
              tutor: row.tutor,
              reviewedAmount: row.finalAmount,
              recalculatedAmount: row.recalculatedFinalAmount,
            }))}
            confirmations={confirmations}
            markBatchPaidAction={markBatchPaidAction}
            embedded
          />
        </div>
      </details>
    </>
  );
}
