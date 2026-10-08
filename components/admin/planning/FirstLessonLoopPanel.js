'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { usePressedAction } from '@/components/admin/ui/usePressedAction';
import { buildStripeStudentDashboardLink } from '@/lib/admin/stripe-dashboard-helpers.mjs';
import { dueChipLabel, findStudentById, formatTargetDate } from '@/lib/admin/planning-client-helpers.mjs';
import StudentPlanningPanel from './StudentPlanningPanel';

function lessonEvidenceCopy(evidence = {}, planned = {}) {
  if (evidence.state === 'observed') {
    return evidence.rawAttendanceStatus
      ? `On the calendar. Attendance label: ${evidence.rawAttendanceStatus}; check the lesson outcome with the family.`
      : 'On the verified lesson calendar.';
  }
  if (evidence.state === 'not_observed') return 'Not seen in the latest mirror; check MMS if the planned lesson changed.';
  if (evidence.state === 'ambiguous') return 'More than one calendar match; check MMS.';
  return [planned.lessonDate, planned.lessonTime].filter(Boolean).join(' at ') || 'Planned lesson not recorded; live lesson evidence is unavailable.';
}

export default function FirstLessonLoopPanel({ item, studentOptions = [], onStep, onStatus, onRemind, onRefresh, onEdit, onArchive, history, isPending = false }) {
  const [studentOpen, setStudentOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderDate, setReminderDate] = useState(item.status === 'waiting' ? item.targetDate : '');
  const [actionError, setActionError] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  const actionsId = useId();
  useEffect(() => {
    if (!actionsOpen) return undefined;
    function dismiss(event) {
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return;
        actionsRef.current?.querySelector('button')?.focus();
      } else if (actionsRef.current?.contains(event.target)) return;
      setActionsOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [actionsOpen]);
  const { press, pendingFor } = usePressedAction(isPending);
  const loop = item.firstLessonLoop;
  const student = findStudentById(studentOptions, item.linkedStudentId) || null;
  const stripeLink = loop?.payment.dashboardLink || buildStripeStudentDashboardLink(student || {});
  const accessUrl = `/admin/workflows/student-notes-access?student=${encodeURIComponent(item.linkedStudentId || '')}`;
  const continuing = loop?.progress.paymentDecision === 'continue_weekly';
  const stopping = loop?.progress.paymentDecision === 'stop';
  const completed = (loop?.checks || []).filter((check) => check.complete);
  const waiting = item.status === 'waiting' && !loop?.isDue;

  const remainingLabel = loop?.canClose ? 'Ready to close' : loop ? `${loop.remainingCount} remaining` : 'Checks unavailable';
  const studentName = student?.fullName || item.title.replace(/^First-lesson check-in\s*[—–-]\s*/u, '') || 'Student';
  const due = dueChipLabel(item.targetDate);
  const header = (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-semibold leading-snug text-slate-900">{studentName}</h3>
          <p className="mt-1 text-sm text-slate-600">{continuing && loop?.onlyPaymentRemaining ? 'Stripe follow-up' : 'First-lesson check-in'} · {remainingLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ActionButton variant="quiet" className="!shadow-none" disabled={!item.linkedStudentId} onClick={() => setStudentOpen(true)}>Student details</ActionButton>
          <ActionButton variant="quiet" className="!shadow-none" disabled={isPending} pending={pendingFor('refresh')} pendingLabel="Refreshing…" onClick={press('refresh', () => onRefresh?.(item))}>Refresh checks</ActionButton>
          <div ref={actionsRef} className="relative">
            <ActionButton variant="quiet" className="!shadow-none" aria-label="More card actions" aria-expanded={actionsOpen} aria-controls={actionsId} onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal aria-hidden="true" className="h-5 w-5" /></ActionButton>
            {actionsOpen ? <div id={actionsId} className="absolute right-0 top-full z-10 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <ActionButton variant="quiet" className="w-full !justify-start !shadow-none" disabled={isPending} onClick={() => { setActionsOpen(false); onEdit?.(item); }}>Edit</ActionButton>
              <ActionButton variant="quiet" className="w-full !justify-start !text-red-700 !shadow-none" disabled={isPending} pending={pendingFor('archive')} pendingLabel="Removing…" onClick={press('archive', () => onArchive?.(item))}>Remove</ActionButton>
            </div> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className={`rounded-full px-2.5 py-1 font-medium ${due.startsWith('Overdue') ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{item.status === 'waiting' ? `Reminder ${formatTargetDate(item.targetDate)}` : due}</span>
        <span>{item.owner || 'Unassigned'}</span>
      </div>
    </header>
  );

  if (!loop) return (
    <section>
      {header}
      <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">First-lesson context could not be loaded. Refresh before closing this follow-up.</p>
      <details className="mt-2 text-sm text-slate-600">
        <summary className="cursor-pointer py-3 focus-visible:outline-sky-500">Context &amp; history</summary>
        {history}
      </details>
      {studentOpen ? <StudentPlanningPanel mmsId={item.linkedStudentId} initialStudent={student} onClose={() => setStudentOpen(false)} onUpdated={() => onRefresh?.(item)} /> : null}
    </section>
  );

  const decisionControls = (
    <div className="flex flex-wrap gap-2">
      <ActionButton size="compact" variant={continuing ? 'success' : 'secondary'} disabled={isPending || !loop.canRecordDecision} onClick={press('continue', () => onStep(item, { step: 'payment_decision', value: 'continue_weekly' }))} pending={pendingFor('continue')} pendingLabel="Saving…">Continuing weekly</ActionButton>
      <ActionButton size="compact" variant={stopping ? 'success' : 'secondary'} disabled={isPending || !loop.canRecordDecision} onClick={press('stop', () => onStep(item, { step: 'payment_decision', value: 'stop' }))} pending={pendingFor('stop')} pendingLabel="Saving…">Not continuing</ActionButton>
    </div>
  );

  return (
    <section>
      {header}
      <div className="divide-y divide-slate-100 border-y border-slate-100">
        {!loop.canRecordDecision ? <p className="py-3 text-sm text-slate-600">Follow-up opens {formatTargetDate(item.targetDate)}. You can prepare the group and access checks now.</p> : null}

        {loop.progress.paymentDecision === 'pending' ? (
          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">After lesson one, are they continuing?</p>
              <p className="mt-1 text-sm text-slate-600">Check in with the parent or student, then record the decision.</p>
            </div>
            {decisionControls}
          </div>
        ) : null}

        {continuing && !loop.payment.complete ? (
          <div className="py-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Stripe subscription</p>
                <p className="mt-1 text-sm text-slate-600">{waiting && loop.onlyPaymentRemaining ? `Check again ${formatTargetDate(item.targetDate)}; other checks are complete.` : loop.payment.mode === 'stripe' ? 'No subscription linked. Link or finish setup in Stripe.' : 'Payment mode unavailable. Review Student details.'}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <ButtonLink href={stripeLink.href} target="_blank" rel="noreferrer" variant="secondary">{stripeLink.label}</ButtonLink>
                {loop.onlyPaymentRemaining && loop.payment.mode === 'stripe' ? <ActionButton variant="quiet" className="!shadow-none" disabled={isPending} onClick={() => { setReminderOpen((open) => !open); setActionError(''); }} aria-expanded={reminderOpen}>{waiting ? 'Change reminder' : 'Remind me later'}</ActionButton> : null}
              </div>
            </div>
            {reminderOpen ? (
              <form className="space-y-2 pt-3" onSubmit={async (event) => {
                event.preventDefault();
                setActionError('');
                const saved = await press('reminder', () => onRemind?.(item, reminderDate))();
                if (saved) setReminderOpen(false);
                else setActionError('Reminder could not be saved. Check the error on this card and try again.');
              }}>
                <label className="block text-xs font-medium text-slate-600">Bring this back on
                  <input type="date" required value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={isPending} pending={pendingFor('reminder')} pendingLabel="Saving…">Save reminder</ActionButton>
                  <ActionButton variant="quiet" className="!shadow-none" disabled={isPending} onClick={() => setReminderOpen(false)}>Cancel</ActionButton>
                </div>
                {actionError ? <p role="alert" className="text-xs text-red-700">{actionError}</p> : null}
              </form>
            ) : null}
          </div>
        ) : null}

        {stopping && !loop.progress.cancellationHandled ? (
          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">Stop payment</p>
            <p className="mt-1 text-sm text-slate-600">Confirm it was cancelled, or never started.</p></div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={stripeLink.href} target="_blank" rel="noreferrer" variant="secondary">{stripeLink.label}</ButtonLink>
              <ActionButton variant="secondary" disabled={isPending} pending={pendingFor('cancelled')} pendingLabel="Saving…" onClick={press('cancelled', () => onStep(item, { step: 'cancellation_handled', value: 'true' }))}>Confirm handled</ActionButton>
            </div>
          </div>
        ) : null}

        {!loop.progress.whatsappGroups ? (
          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">WhatsApp groups</p><p className="mt-1 text-sm text-slate-600">Parent/student, tutor, Finn, Tom and Fennella in the lesson group; student in the community group.</p></div>
            <ActionButton variant="secondary" disabled={isPending} pending={pendingFor('groups')} pendingLabel="Saving…" onClick={press('groups', () => onStep(item, { step: 'whatsapp_groups', value: 'true' }))}>Confirm groups</ActionButton>
          </div>
        ) : null}

        {!loop.studentAccess.complete ? (
          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Student access</p>
              <p className="mt-1 text-sm text-slate-600">Portal, protected notes and access message.</p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              <ButtonLink href={accessUrl} variant="secondary">Open access workflow</ButtonLink>
              <ActionButton variant="quiet" className="!shadow-none !font-normal" disabled={isPending} pending={pendingFor('access')} pendingLabel="Saving…" onClick={press('access', () => onStep(item, { step: 'student_access', value: 'true' }))}>Already done? Confirm access</ActionButton>
            </div>
          </div>
        ) : null}
      </div>

      {loop.canClose ? <ActionButton className="mt-4" disabled={isPending} pending={pendingFor('close')} pendingLabel="Closing…" onClick={press('close', () => onStatus(item, 'done'))}>Close follow-up</ActionButton> : null}
      <div className="grid gap-x-6 pt-2 sm:grid-cols-2">
        {completed.length ? (
          <details className="min-w-0 text-sm text-slate-600">
            <summary className="cursor-pointer py-3 font-medium focus-visible:outline-sky-500">{completed.length} {completed.length === 1 ? 'check' : 'checks'} complete</summary>
            <div className="mt-2 space-y-3">
              {completed.map((check) => (
                <div key={check.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>✓ {check.label}</span>
                  {check.key === 'decision' ? decisionControls : null}
                  {check.key === 'groups' ? <ActionButton size="compact" variant="quiet" disabled={isPending} pending={pendingFor('undo-groups')} pendingLabel="Saving…" onClick={press('undo-groups', () => onStep(item, { step: 'whatsapp_groups', value: 'false' }))}>Undo</ActionButton> : null}
                  {check.key === 'access' ? loop.studentAccess.source === 'portal_workflow' ? <ButtonLink href={accessUrl} size="compact" variant="quiet">Access workflow</ButtonLink> : <ActionButton size="compact" variant="quiet" disabled={isPending} pending={pendingFor('undo-access')} pendingLabel="Saving…" onClick={press('undo-access', () => onStep(item, { step: 'student_access', value: 'false' }))}>Undo</ActionButton> : null}
                  {check.key === 'payment' && stopping ? <ActionButton size="compact" variant="quiet" disabled={isPending} pending={pendingFor('undo-cancelled')} pendingLabel="Saving…" onClick={press('undo-cancelled', () => onStep(item, { step: 'cancellation_handled', value: 'false' }))}>Undo</ActionButton> : null}
                  {check.key === 'payment' && continuing && loop.payment.mode !== 'manual' ? <ButtonLink href={stripeLink.href} target="_blank" rel="noreferrer" size="compact" variant="quiet">{stripeLink.label}</ButtonLink> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <details className="min-w-0 text-sm text-slate-600">
          <summary className="cursor-pointer py-3 focus-visible:outline-sky-500">Context &amp; history</summary>
          <p className="mt-1 leading-5">{lessonEvidenceCopy(loop.lessonEvidence, loop.metadata)}</p>
          {history}
        </details>
      </div>
      {studentOpen ? <StudentPlanningPanel mmsId={item.linkedStudentId} initialStudent={student} onClose={() => setStudentOpen(false)} onUpdated={() => onRefresh?.(item)} /> : null}
    </section>
  );
}
