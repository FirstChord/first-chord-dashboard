'use client';

import { useState } from 'react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { usePressedAction } from '@/components/admin/ui/usePressedAction';
import { buildStripeStudentDashboardLink } from '@/lib/admin/stripe-dashboard-helpers.mjs';
import { findStudentById, formatTargetDate } from '@/lib/admin/planning-client-helpers.mjs';
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

export default function FirstLessonLoopPanel({ item, studentOptions = [], onStep, onStatus, onRemind, onRefresh, isPending = false }) {
  const [studentOpen, setStudentOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderDate, setReminderDate] = useState(item.status === 'waiting' ? item.targetDate : '');
  const [actionError, setActionError] = useState('');
  const { press, pendingFor } = usePressedAction(isPending);
  const loop = item.firstLessonLoop;
  if (!loop) return <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">First-lesson context could not be loaded. Refresh before closing this follow-up.</p>;
  const student = findStudentById(studentOptions, item.linkedStudentId) || null;
  const stripeLink = loop.payment.dashboardLink || buildStripeStudentDashboardLink(student || {});
  const accessUrl = `/admin/workflows/student-notes-access?student=${encodeURIComponent(item.linkedStudentId || '')}`;
  const continuing = loop.progress.paymentDecision === 'continue_weekly';
  const stopping = loop.progress.paymentDecision === 'stop';
  const completed = (loop.checks || []).filter((check) => check.complete);
  const waiting = item.status === 'waiting' && !loop.isDue;

  const decisionControls = (
    <div className="flex flex-wrap gap-2">
      <ActionButton size="compact" variant={continuing ? 'success' : 'secondary'} disabled={isPending || !loop.canRecordDecision} onClick={press('continue', () => onStep(item, { step: 'payment_decision', value: 'continue_weekly' }))} pending={pendingFor('continue')} pendingLabel="Saving…">Continuing weekly</ActionButton>
      <ActionButton size="compact" variant={stopping ? 'success' : 'secondary'} disabled={isPending || !loop.canRecordDecision} onClick={press('stop', () => onStep(item, { step: 'payment_decision', value: 'stop' }))} pending={pendingFor('stop')} pendingLabel="Saving…">Not continuing</ActionButton>
    </div>
  );

  return (
    <section className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{loop.canClose ? 'Ready to close' : waiting && loop.onlyPaymentRemaining ? `Stripe follow-up · ${formatTargetDate(item.targetDate)}` : `${loop.remainingCount} ${loop.remainingCount === 1 ? 'thing' : 'things'} left`}</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="quiet" size="compact" disabled={!item.linkedStudentId} onClick={() => setStudentOpen(true)}>Student details</ActionButton>
          <ActionButton variant="quiet" size="compact" disabled={isPending} pending={pendingFor('refresh')} pendingLabel="Refreshing…" onClick={press('refresh', () => onRefresh?.(item))}>Refresh checks</ActionButton>
        </div>
      </div>
      {!loop.canRecordDecision ? <p className="text-xs text-slate-600">Follow-up opens {formatTargetDate(item.targetDate)}. You can prepare the group and access checks now.</p> : null}

      {loop.progress.paymentDecision === 'pending' ? (
        <div className="space-y-2 border-b border-slate-100 pb-3">
          <p className="text-sm font-medium text-slate-900">After lesson one, are they continuing?</p>
          <p className="text-xs text-slate-600">Check in with the parent or student, then record the decision.</p>
          {decisionControls}
        </div>
      ) : null}

      {continuing && !loop.payment.complete ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">Record the Stripe subscription</p>
          <p className="text-xs text-slate-600">{waiting && loop.onlyPaymentRemaining ? `Other checks are complete. This returns to Due today on ${formatTargetDate(item.targetDate)}.` : 'Link an existing subscription, or finish setup in Stripe. A future billing date can be checked in Student details.'}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={stripeLink.href} target="_blank" rel="noreferrer" size="compact">{stripeLink.label}</ButtonLink>
            {loop.onlyPaymentRemaining && loop.payment.mode === 'stripe' ? <ActionButton variant="secondary" size="compact" disabled={isPending} onClick={() => { setReminderOpen((open) => !open); setActionError(''); }} aria-expanded={reminderOpen}>{waiting ? 'Change reminder' : 'Remind me later'}</ActionButton> : null}
          </div>
          {reminderOpen ? (
            <form className="space-y-2 pt-1" onSubmit={async (event) => {
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
                <ActionButton type="submit" size="compact" disabled={isPending} pending={pendingFor('reminder')} pendingLabel="Saving…">Save reminder</ActionButton>
                <ActionButton variant="quiet" size="compact" disabled={isPending} onClick={() => setReminderOpen(false)}>Cancel</ActionButton>
              </div>
              {actionError ? <p role="alert" className="text-xs text-red-700">{actionError}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}

      {stopping && !loop.progress.cancellationHandled ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">Check that payment is safely stopped</p>
          <p className="text-xs text-slate-600">Confirm the subscription was cancelled, or that no subscription ever started.</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={stripeLink.href} target="_blank" rel="noreferrer" size="compact" variant="secondary">{stripeLink.label}</ButtonLink>
            <ActionButton size="compact" disabled={isPending} pending={pendingFor('cancelled')} pendingLabel="Saving…" onClick={press('cancelled', () => onStep(item, { step: 'cancellation_handled', value: 'true' }))}>Confirm handled</ActionButton>
          </div>
        </div>
      ) : null}

      {!loop.progress.whatsappGroups ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">Check both WhatsApp groups</p><p className="mt-1 text-xs text-slate-600">Parent/student, tutor, Finn, Tom and Fennella in the lesson group; student in the community group.</p></div>
          <ActionButton size="compact" disabled={isPending} pending={pendingFor('groups')} pendingLabel="Saving…" onClick={press('groups', () => onStep(item, { step: 'whatsapp_groups', value: 'true' }))}>Confirm groups</ActionButton>
        </div>
      ) : null}

      {!loop.studentAccess.complete ? (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-900">Complete student access</p>
          <p className="text-xs text-slate-600">Portal link, protected notes and access message.</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={accessUrl} variant="secondary" size="compact">Open access workflow</ButtonLink>
            <ActionButton size="compact" disabled={isPending} pending={pendingFor('access')} pendingLabel="Saving…" onClick={press('access', () => onStep(item, { step: 'student_access', value: 'true' }))}>Confirm access</ActionButton>
          </div>
        </div>
      ) : null}

      {loop.canClose ? <ActionButton disabled={isPending} pending={pendingFor('close')} pendingLabel="Closing…" onClick={press('close', () => onStatus(item, 'done'))}>Close follow-up</ActionButton> : null}
      {completed.length ? (
        <details className="border-t border-slate-100 pt-2 text-xs text-slate-600">
          <summary className="cursor-pointer py-2 font-medium">{completed.length} {completed.length === 1 ? 'check' : 'checks'} complete · Review or change</summary>
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
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer py-2">Lesson context</summary>
        <p className="mt-1 leading-5">{lessonEvidenceCopy(loop.lessonEvidence, loop.metadata)}</p>
      </details>
      {studentOpen ? <StudentPlanningPanel mmsId={item.linkedStudentId} initialStudent={student} onClose={() => setStudentOpen(false)} onUpdated={() => onRefresh?.(item)} /> : null}
    </section>
  );
}
