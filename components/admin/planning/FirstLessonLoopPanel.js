'use client';

import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { buildStripeCustomerDashboardUrl } from '@/lib/admin/stripe-dashboard-helpers.mjs';
import { findStudentById, formatTargetDate, studentHref } from '@/lib/admin/planning-client-helpers.mjs';

function EvidenceCard({ label, value, detail = '', tone = 'neutral' }) {
  const toneClasses = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50/70'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50/70'
      : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p> : null}
    </div>
  );
}

function lessonEvidenceCopy(evidence = {}, planned = {}) {
  if (evidence.state === 'observed') {
    return {
      value: `On the calendar${evidence.localTime ? ` at ${evidence.localTime}` : ''}`,
      detail: evidence.rawAttendanceStatus
        ? `Attendance label: ${evidence.rawAttendanceStatus}. This is context, not proof the lesson happened.`
        : 'Seen in the verified lesson mirror.',
      tone: 'good',
    };
  }
  if (evidence.state === 'not_observed') {
    return { value: 'Not seen in the latest mirror', detail: 'Check MMS if the planned date or time changed.', tone: 'warning' };
  }
  if (evidence.state === 'ambiguous') {
    return { value: 'More than one match', detail: 'The dashboard has left this uncertain; check MMS.', tone: 'warning' };
  }
  const plannedText = [planned.lessonDate, planned.lessonTime].filter(Boolean).join(' at ');
  return { value: plannedText || 'Planned lesson not recorded', detail: 'Live lesson evidence is not currently available.', tone: 'neutral' };
}

function ConfirmationRow({ title, detail, complete, children, onUndo, pending }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${complete ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{complete ? '✓ ' : ''}{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {children}
          {complete && onUndo ? (
            <ActionButton size="compact" variant="quiet" disabled={pending} onClick={onUndo}>Undo</ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function FirstLessonLoopPanel({
  item,
  studentOptions = [],
  onStep,
  onStatus,
  isPending = false,
}) {
  const loop = item.firstLessonLoop;
  if (!loop) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        First-lesson context could not be loaded. Refresh before closing this follow-up.
      </div>
    );
  }
  const student = findStudentById(studentOptions, item.linkedStudentId) || null;
  const stripeUrl = buildStripeCustomerDashboardUrl(student?.stripeCustomerId);
  const accessUrl = `/admin/workflows/student-notes-access?student=${encodeURIComponent(item.linkedStudentId || '')}`;
  const evidence = lessonEvidenceCopy(loop.lessonEvidence, loop.metadata);
  const continuing = loop.progress.paymentDecision === 'continue_weekly';
  const stopping = loop.progress.paymentDecision === 'stop';
  const accessFromWorkflow = loop.studentAccess.source === 'portal_workflow';

  return (
    <section className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/30 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-950">Close the first-lesson loop</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            The evidence below helps you check; the decisions remain yours.
          </p>
        </div>
        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${loop.canClose ? 'bg-emerald-100 text-emerald-900' : 'bg-white text-slate-700'}`}>
          {loop.canClose ? 'Ready to close' : `Next: ${loop.nextAction}`}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <EvidenceCard label="First lesson" {...evidence} />
        <EvidenceCard
          label="Payment record"
          value={loop.payment.mode === 'manual'
            ? 'Manual payer'
            : loop.payment.subscriptionRecorded
              ? 'Subscription recorded'
              : loop.payment.customerRecorded
                ? 'Customer recorded; no subscription'
                : 'No Stripe link recorded'}
          detail="Recorded dashboard linkage only; this is not a live Stripe status check."
          tone={loop.payment.mode === 'manual' || loop.payment.subscriptionRecorded ? 'good' : 'warning'}
        />
        <EvidenceCard
          label="Student access"
          value={loop.studentAccess.complete ? 'Complete' : 'Needs confirmation'}
          detail={accessFromWorkflow ? 'Verified by the Student Access workflow.' : 'Portal link, protected notes and access message.'}
          tone={loop.studentAccess.complete ? 'good' : 'warning'}
        />
      </div>

      {!loop.isDue ? (
        <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
          Follow-up opens {item.targetDate ? formatTargetDate(item.targetDate) : 'after lesson one'}; you can prepare the access and group checks now, but it cannot close early.
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        <ConfirmationRow
          title="1. Continue or stop"
          detail="After speaking to them, record whether the weekly subscription continues."
          complete={continuing || stopping}
          pending={isPending}
        >
          <ActionButton
            size="compact"
            variant={continuing ? 'success' : 'secondary'}
            success={continuing}
            disabled={isPending || !loop.isDue}
            onClick={() => onStep(item, { step: 'payment_decision', value: 'continue_weekly' })}
          >Continuing weekly</ActionButton>
          <ActionButton
            size="compact"
            variant={stopping ? 'success' : 'secondary'}
            success={stopping}
            disabled={isPending || !loop.isDue}
            onClick={() => onStep(item, { step: 'payment_decision', value: 'stop' })}
          >Not continuing</ActionButton>
        </ConfirmationRow>

        {stopping ? (
          <ConfirmationRow
            title="2. Payment safely stopped"
            detail="Confirm the Stripe subscription was cancelled, or that no subscription ever started."
            complete={loop.progress.cancellationHandled}
            pending={isPending}
            onUndo={() => onStep(item, { step: 'cancellation_handled', value: 'false' })}
          >
            {stripeUrl ? <ButtonLink href={stripeUrl} target="_blank" rel="noreferrer" variant="secondary" size="compact">Open Stripe ↗</ButtonLink> : null}
            <ButtonLink href={studentHref(item.linkedStudentId)} variant="quiet" size="compact">Student record</ButtonLink>
            {!loop.progress.cancellationHandled ? (
              <ActionButton size="compact" disabled={isPending} onClick={() => onStep(item, { step: 'cancellation_handled', value: 'true' })}>
                Confirm handled
              </ActionButton>
            ) : null}
          </ConfirmationRow>
        ) : null}

        <ConfirmationRow
          title={`${stopping ? '3' : '2'}. WhatsApp groups checked`}
          detail="Parent/student, tutor, Finn, Tom and Fennella are in the lesson group; the student is also in the community group."
          complete={loop.progress.whatsappGroups}
          pending={isPending}
          onUndo={() => onStep(item, { step: 'whatsapp_groups', value: 'false' })}
        >
          {!loop.progress.whatsappGroups ? (
            <ActionButton size="compact" disabled={isPending} onClick={() => onStep(item, { step: 'whatsapp_groups', value: 'true' })}>
              Confirm groups
            </ActionButton>
          ) : null}
        </ConfirmationRow>

        <ConfirmationRow
          title={`${stopping ? '4' : '3'}. Student access complete`}
          detail={accessFromWorkflow
            ? 'The dedicated workflow already verifies protection and the access message.'
            : 'Confirm they have the portal link and understand protected practice notes.'}
          complete={loop.studentAccess.complete}
          pending={isPending}
          onUndo={!accessFromWorkflow ? () => onStep(item, { step: 'student_access', value: 'false' }) : null}
        >
          <ButtonLink href={accessUrl} variant="secondary" size="compact">Open access workflow</ButtonLink>
          {!loop.studentAccess.complete ? (
            <ActionButton size="compact" disabled={isPending} onClick={() => onStep(item, { step: 'student_access', value: 'true' })}>
              Confirm access
            </ActionButton>
          ) : null}
        </ConfirmationRow>
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-slate-800">
          {loop.canClose ? 'All required loops are closed.' : loop.nextAction}
        </p>
        <ActionButton
          pending={isPending}
          pendingLabel="Closing…"
          success={false}
          disabled={!loop.canClose}
          onClick={() => onStatus(item, 'done')}
        >
          {loop.canClose ? 'Close follow-up' : 'Finish checks first'}
        </ActionButton>
      </div>
    </section>
  );
}
