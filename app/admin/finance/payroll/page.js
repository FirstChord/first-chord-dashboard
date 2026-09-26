import { currentPayrollMonday, requiresPayrollConfirmation } from '@/lib/admin/payroll-cycle-helpers.mjs';
import { ADMIN_TUTORS } from '@/lib/admin/tutors-data.js';
import { validatePayrollReview } from '@/lib/admin/payroll-review-helpers.mjs';
import { payrollBatchFingerprint } from '@/lib/admin/payroll-batch-helpers.mjs';
import { buildPayrollQueue, payrollWorkspaceAttendanceQuery } from '@/lib/admin/payroll-queue-helpers.mjs';
import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import Link from 'next/link';
import { Suspense, cache } from 'react';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import PayrollTutorCard from './tutor-card';
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
  isPayrollPeriodOpen,
  findBlockingReviewedRun,
  selectPayrollRosterRows,
  PAYROLL_CUTOVER_PERIOD_END,
  PAYROLL_CUTOVER_RUN_DATE,
} from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { parseTutorWise, buildWiseBatch, selectPayableReviewedRuns } from '@/lib/admin/wise-helpers.mjs';
import { hasMaterialTutorStatementChange } from '@/lib/admin/payroll-workflow-helpers.mjs';
import { buildManualCutoverEmailConfirmation, buildManualCutoverPayment } from '@/lib/admin/payroll-manual-settlement-helpers.mjs';
import { findPauseHistoryCoverageForLesson } from '@/lib/admin/pause-helpers.mjs';
import WisePayoutPanel from './wise-payout-panel';
import TutorSelector from './tutor-selector';

export const dynamic = 'force-dynamic';

async function savePayrollRunAction(formData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    throw new Error('Not authorised');
  }

  const now = new Date().toISOString();
  // Reviewing never originates a payment; payment markers have separate actions.
  const status = 'reviewed';
  const expectedAmount = Number.parseFloat(`${formData.get('expected_amount') || '0'}`) || 0;
  const adjustmentAmount = Number.parseFloat(`${formData.get('adjustment_amount') || '0'}`) || 0;
  const finalAmount = Math.round((expectedAmount + adjustmentAmount) * 100) / 100;
  const payrollId = `${formData.get('payroll_id') || ''}`.trim();
  const tutorShortName = `${formData.get('tutor_short_name') || ''}`.trim();
  const identity = ADMIN_TUTORS[tutorShortName];
  if (!identity?.teacherId) throw new Error('Choose a recognised payroll tutor.');
  const tutor = identity.fullName;
  const periodEnd = `${formData.get('period_end') || ''}`.trim();
  if (isPayrollPeriodOpen(periodEnd)) {
    throw new Error('This payroll period is still open and cannot be reviewed yet.');
  }
  const paymentRoute = requiresPayrollConfirmation({ periodStart: formData.get('period_start'), periodEnd })
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
  const existingRuns = await getPayrollRunRows({ force: true });
  const existingRun = existingRuns.find((row) => `${row.payroll_id ?? row.payrollId ?? ''}`.trim() === payrollId) || null;
  if (existingRun?.status === 'paid') {
    throw new Error('This statement is already paid. Its period and amount cannot be changed by saving an old form.');
  }
  const blockingRun = findBlockingReviewedRun(existingRuns, { tutorShortName, tutor, payrollId });
  if (blockingRun) {
    throw new Error(`Finish the earlier statement ending ${blockingRun.periodEnd} before reviewing this period.`);
  }
  const days = (Date.parse(periodEnd) - Date.parse(nextStatement.period_start)) / 86400000;
  if (!Number.isFinite(days) || days < 0 || days > 366 || !Number.isFinite(finalAmount)) throw new Error('Check the statement dates and amount.');
  const attendanceRows = await searchAttendanceForPayroll({
    startDate: nextStatement.period_start, endDate: periodEnd,
    teacherIds: [identity.teacherId], forceRefresh: true,
  });
  const freshPreview = buildPayrollPreview({ attendanceRows, savedRuns: existingRuns,
    tutorPay: parseTutorPay(await getTutorPayRows()), payDate: `${formData.get('pay_date') || ''}`,
    overrides: { [tutorShortName]: { start: nextStatement.period_start, end: periodEnd } }, maxLookbackDays: 366,
  }).rows.find((row) => row.payrollId === payrollId);
  validatePayrollReview({ existing: existingRun, expectedUpdatedAt: formData.get('expected_updated_at'), preview: freshPreview,
    expectedAmount, lessonCount: nextStatement.lesson_count, teachingMinutes: nextStatement.teaching_minutes });
  const statementChanged = status === 'reviewed'
    && existingRun
    && hasMaterialTutorStatementChange(existingRun, nextStatement);
  const latestRun = (await getPayrollRunRows({ force: true })).find((row) => row.payroll_id === payrollId);
  if (`${latestRun?.updated_at || ''}` !== `${existingRun?.updated_at || ''}`) throw new Error('The statement changed during the attendance check. Reopen it before saving.');
  const reviewedAt = statementChanged ? now : (existingRun?.reviewed_at || now);
  await upsertPayrollRunRow({
    payroll_id: payrollId,
    pay_date: `${formData.get('pay_date') || ''}`.trim(),
    period_start: `${formData.get('period_start') || ''}`.trim(),
    period_end: periodEnd,
    tutor,
    tutor_short_name: tutorShortName,
    teacher_id: identity.teacherId,
    invoice_cadence: freshPreview.invoiceCadence,
    pay_model: freshPreview.payModel,
    lesson_count: `${formData.get('lesson_count') || '0'}`.trim(),
    review_lesson_count: `${formData.get('review_lesson_count') || '0'}`.trim(),
    teaching_minutes: `${formData.get('teaching_minutes') || '0'}`.trim(),
    expected_amount: expectedAmount,
    adjustment_amount: adjustmentAmount,
    final_amount: finalAmount,
    status,
    invoice_status: `${formData.get('invoice_status') || ''}`.trim(),
    payment_route: paymentRoute,
    statement_sent_at: statementChanged ? '' : `${existingRun?.statement_sent_at || ''}`.trim(),
    statement_sent_by: statementChanged ? '' : `${existingRun?.statement_sent_by || ''}`.trim(),
    statement_delivery_status: statementChanged ? '' : `${existingRun?.statement_delivery_status || ''}`.trim(),
    statement_delivery_channel: statementChanged ? '' : `${existingRun?.statement_delivery_channel || ''}`.trim(),
    statement_delivery_to: statementChanged ? '' : `${existingRun?.statement_delivery_to || ''}`.trim(),
    statement_delivery_attempted_at: statementChanged ? '' : `${existingRun?.statement_delivery_attempted_at || ''}`.trim(),
    statement_delivery_message_id: statementChanged ? '' : `${existingRun?.statement_delivery_message_id || ''}`.trim(),
    statement_delivery_error: statementChanged ? '' : `${existingRun?.statement_delivery_error || ''}`.trim(),
    notes: `${formData.get('notes') || ''}`.trim(),
    reviewed_at: status === 'reviewed' ? reviewedAt : `${formData.get('reviewed_at') || now}`.trim(),
    reviewed_by: status === 'reviewed' ? session.user.email || '' : `${formData.get('reviewed_by') || session.user.email || ''}`.trim(),
    paid_at: '',
    paid_by: '',
    tutor_response: statementChanged ? '' : `${existingRun?.tutor_response || ''}`.trim(),
    tutor_responded_at: statementChanged ? '' : `${existingRun?.tutor_responded_at || ''}`.trim(),
    tutor_note: statementChanged ? '' : `${existingRun?.tutor_note || ''}`.trim(),
    tutor_response_source: statementChanged ? '' : `${existingRun?.tutor_response_source || ''}`.trim(),
    paid_via: '',
    source: 'mms_attendance_preview',
    created_at: existingRun?.created_at || now,
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

async function reviewPayrollAction(previous, formData) {
  'use server';
  try { return await savePayrollRunAction(formData); }
  catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error.message || 'The statement could not be saved. Please reopen it.' };
  }
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
  const attendanceQuery = payrollWorkspaceAttendanceQuery(buildPayrollAttendanceQuery(payDate), savedRuns);
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
    maxLookbackDays: 366,
    preferOutstanding: payDate !== PAYROLL_CUTOVER_RUN_DATE,
  });
  // Salaried tutors (Finn/Tom/Fennella) are paid a fixed wage, not per-lesson via
  // this Wise reconciliation — keep them off the payroll page entirely. Totals and
  // the Wise batch already exclude salary, so this is display-only.
  const activeRows = addPauseEvidenceToPayrollRows(selectPayrollRosterRows(preview.rows, lifecycleRows, savedRuns), studentRows, pauseRows)
    .filter((row) => row.payModel !== 'salary');
  // A refreshed correction must go back through the existing human save step.
  // Hold every saved row for that tutor out of this rendered Wise batch so an
  // older duplicate window cannot become the fallback payment by accident.
  const attendanceChangedRows = activeRows.filter((row) => row.attendanceChanged || (row.status === 'reviewed' && row.reviewPastCount > 0));
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
  const wiseBatch = buildWiseBatch({ rows: loadError ? [] : payableRows, wiseByKey: parseTutorWise(tutorWiseRows) });
  const workspaceRows = buildPayrollQueue(activeRows, { missing: wiseBatch.missing, amountConflicts, attendanceUnavailable: Boolean(loadError) });
  const cutoverProgress = payDate === PAYROLL_CUTOVER_RUN_DATE ? {
    total: workspaceRows.length,
    complete: workspaceRows.filter((row) => ['paid', 'nothing_due', 'paid_through'].includes(row.workflow.key)).length,
    prepare: workspaceRows.filter((row) => ['cutover_start', 'attendance', 'mms_changed', 'review', 'window_conflict', 'statement_overlap'].includes(row.workflow.key)).length,
    send: workspaceRows.filter((row) => row.workflow.key === 'send').length,
    waiting: workspaceRows.filter((row) => ['awaiting', 'paid_awaiting'].includes(row.workflow.key)).length,
    queries: workspaceRows.filter((row) => ['disputed', 'paid_query'].includes(row.workflow.key)).length,
    ready: workspaceRows.filter((row) => row.workflow.key === 'ready').length,
  } : null;
  const selectedRow = workspaceRows.find((row) => row.tutorShortName === tutorParam)
    || workspaceRows.find((row) => row.group === 'handle')
    || workspaceRows.find((row) => row.group === 'waiting')
    || workspaceRows.find((row) => row.group === 'ready')
    || workspaceRows[0]
    || null;
  const selectedTutor = selectedRow?.tutorShortName || '';
  const selectorRows = workspaceRows;

  return {
    preview,
    cutoverOpen: savedRuns.filter((row) => row.period_end === PAYROLL_CUTOVER_PERIOD_END && (row.status === 'reviewed' || (row.status === 'paid' && row.paid_via === 'manual' && row.tutor_response !== 'confirmed'))).length,
    history: savedRuns.filter((row) => row.status === 'paid').sort((a, b) => `${b.paid_at}`.localeCompare(`${a.paid_at}`)).slice(0, 100),
    selectedRow,
    selectedTutor,
    selectorRows,
    wiseBatch,
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
  const payDate = `${params.payDate || currentPayrollMonday()}`.slice(0, 10);
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
      await searchAttendanceForPayroll({ ...payrollWorkspaceAttendanceQuery(buildPayrollAttendanceQuery(payDate), await getPayrollRunRows()), forceRefresh: true });
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
          <p className="text-sm text-slate-500">Cycle of {formatPayrollDate(payDate)}</p>
        </div>
      </header>

      <details className="rounded-xl border border-slate-200 px-4 py-2">
        <summary className="cursor-pointer text-sm text-slate-600">Settings, refresh and cutover</summary>
        <div className="mt-3 space-y-3">
          <form className="flex items-end gap-2">
            <label>
              <span className="text-xs font-semibold text-slate-500">Cycle date</span>
              <input type="date" name="payDate" defaultValue={payDate} className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Load</button>
          </form>
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
      </details>

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
  const { attendanceAge } = await loadPayrollWorkspace(payDate, tutor, start, end);
  const stale = staleAttendanceLabel(attendanceAge);
  return (
    <p className="mt-2 text-sm text-slate-500">
      Monday statements · Wednesday payments · Unconfirmed statements carry forward
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
          <p className="mt-1 max-w-2xl text-sm leading-6 text-blue-900">Choose a remaining tutor and follow the single <strong>Next</strong> instruction: check → review → send → confirm → pay and record payment. Already-paid statements awaiting confirmation stay in this queue. Historical paid-through boundaries and finished tutors are grouped below. Nothing emails or pays automatically.</p>
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
    attendanceChangedRows,
    amountConflicts,
    disputed,
    loadError,
    cutoverProgress,
    history,
    cutoverOpen,
  } = await loadPayrollWorkspace(payDate, tutor, start, end);

  return (
    <>
      {loadError ? (
        <section className="rounded-[1.6rem] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          MMS payroll attendance could not be loaded: {loadError}
        </section>
      ) : null}

      <CutoverGuide progress={cutoverProgress} />
      {!cutoverProgress && cutoverOpen ? <p className="text-sm text-slate-600">{cutoverOpen} cutover statement{cutoverOpen === 1 ? '' : 's'} still open · <Link className="text-blue-700" href={`/admin/finance/payroll?payDate=${PAYROLL_CUTOVER_RUN_DATE}`}>Open cutover reconciliation</Link></p> : null}

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
            payrollIds={wiseBatch.includedPayrollIds}
            amountConflicts={amountConflicts}
            disputed={disputed}
            mmsChanges={attendanceChangedRows.map((row) => ({
              tutor: row.tutor,
              reviewedAmount: row.finalAmount,
              recalculatedAmount: row.recalculatedFinalAmount,
            }))}
            fingerprint={payrollBatchFingerprint(wiseBatch)}
          />
        </div>
      </details>
      <section className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)]">
        <TutorSelector rows={selectorRows} selectedTutor={selectedTutor} payDate={payDate}  />
        {selectedRow ? (
          <PayrollTutorCard key={selectedRow.payrollId} row={selectedRow} payDate={payDate} reviewPayrollAction={reviewPayrollAction} recordManualCutoverPaymentAction={recordManualCutoverPaymentAction} recordManualCutoverConfirmationAction={recordManualCutoverConfirmationAction} />
        ) : (
          <div className="rounded-[1.6rem] border border-slate-200 bg-white/90 p-6 text-sm text-slate-500">
            No payroll rows found for this period.
          </div>
        )}
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm text-slate-600">Payment history · latest {history.length}</summary>
        <ul className="mt-3 divide-y divide-slate-100">{history.map((run) => <li key={run.payroll_id} className="flex justify-between gap-4 py-3 text-sm"><Link className="text-blue-700" href={`/admin/finance/payroll/statement?pid=${encodeURIComponent(run.payroll_id)}`}>{run.tutor} · {formatPayrollDate(run.period_start)}–{formatPayrollDate(run.period_end)}</Link><span>{formatMoney(run.final_amount)} · paid {formatPayrollDate(run.paid_at)}</span></li>)}</ul>
        {!history.length ? <p className="mt-2 text-sm text-slate-500">No recorded payments yet.</p> : null}
      </details>
    </>
  );
}
