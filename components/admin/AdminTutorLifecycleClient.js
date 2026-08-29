'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { ConfirmButton } from '@/components/admin/ui/ConfirmButton';

function formatDate(value = '') {
  if (!value) return 'No date set';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value = '') {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function phaseTone(phase = '') {
  return {
    established: 'bg-emerald-100 text-emerald-800',
    starting: 'bg-blue-100 text-blue-800',
    planned: 'bg-violet-100 text-violet-800',
    winding_down: 'bg-amber-100 text-amber-900',
    uncertain: 'bg-rose-100 text-rose-800',
  }[phase] || 'bg-slate-100 text-slate-700';
}

function deliveryLabel(status = '') {
  return {
    sent: 'sent',
    completed: 'completed',
    follow_up: 'needs follow-up',
  }[status] || status.replaceAll('_', ' ') || 'recorded';
}

function attentionTone(severity = '') {
  return severity === 'urgent'
    ? 'border-rose-200 bg-rose-50 text-rose-950'
    : 'border-amber-200 bg-amber-50 text-amber-950';
}

function AttentionItem({ item }) {
  return (
    <section className={`mt-3 rounded-xl border p-3 ${attentionTone(item.severity)}`} aria-label={item.severity === 'urgent' ? 'Urgent handover attention' : 'Handover attention'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{item.title}</p>
          <p className="mt-1 text-sm leading-5 opacity-90">{item.detail}</p>
        </div>
        {item.dueDate ? <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">By {formatDate(item.dueDate)}</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.recommendedWorkflow?.href ? (
          <ButtonLink href={item.recommendedWorkflow.href} variant={item.severity === 'urgent' ? 'danger' : 'warning'} size="compact">
            {item.recommendedWorkflow.label}
          </ButtonLink>
        ) : null}
        <details className="text-xs">
          <summary className="min-h-8 cursor-pointer rounded-lg px-2 py-1.5 font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">What clears this?</summary>
          <p className="mt-1 max-w-xl leading-5 opacity-80">{item.clearsWhen}</p>
        </details>
      </div>
    </section>
  );
}

function RelationshipCard({ relationship }) {
  const schedule = relationship.schedule || {};
  const note = relationship.latestPracticeNote;
  const conflicts = relationship.provenance?.conflicts || [];
  const attentionItems = relationship.attentionItems || [];

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {relationship.adminStudentHref ? (
            <a href={relationship.adminStudentHref} className="font-semibold text-slate-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
              {relationship.student.displayName}
            </a>
          ) : <p className="font-semibold text-slate-900">{relationship.student.displayName}</p>}
          <p className="mt-0.5 text-sm text-slate-600">{relationship.student.instrument || 'Instrument not recorded'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${phaseTone(relationship.phase.code)}`} title={relationship.phase.reason}>
          {relationship.phase.label}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 text-sm text-slate-700">
        <p>
          <span className="font-medium text-slate-900">Lesson:</span>{' '}
          {schedule.nextLessonAt
            ? `${formatDateTime(schedule.nextLessonAt)}${schedule.durationMinutes ? ` · ${schedule.durationMinutes} mins` : ''}`
            : 'No current lesson confirmed'}
        </p>
        <p>
          <span className="font-medium text-slate-900">Practice note:</span>{' '}
          {note
            ? `${formatDate(note.lessonDate)} · ${deliveryLabel(note.deliveryStatus)}`
            : 'None recorded for this pairing'}
        </p>
      </div>

      {attentionItems.map((item) => <AttentionItem key={item.code} item={item} />)}

      {relationship.conditions?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {relationship.conditions.map((item) => (
            <span key={item.code} className={`rounded-full px-2 py-1 text-xs font-medium ${item.severity === 'review' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      {conflicts.length ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">{conflicts[0].detail}</p>
      ) : null}
    </article>
  );
}

function warningLines(warnings = {}) {
  return [
    [warnings.assignedStudents?.length || 0, 'student assignment'],
    [warnings.upcomingLessons?.length || 0, 'upcoming lesson in schedule cache'],
    [warnings.unpaidPayroll?.length || 0, 'unpaid payroll run'],
    [warnings.openPlanning?.length || 0, 'open planning item'],
    [warnings.openAbsences?.length || 0, 'open absence record'],
  ].filter(([count]) => count > 0);
}

function hasReachedFinalTeachingDate(value = '') {
  return Boolean(value) && value <= new Date().toISOString().slice(0, 10);
}

export default function AdminTutorLifecycleClient({ initialTutors = [], relationshipSummary = {}, derivedAt = '' }) {
  const router = useRouter();
  const [tutors, setTutors] = useState(initialTutors);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(initialTutors.map((tutor) => [tutor.teacherId, {
    finalTeachingDate: tutor.finalTeachingDate || '',
    replacementTutorShortName: tutor.replacementTutorShortName || '',
    note: tutor.lifecycleNote || '',
  }])));
  const [context, setContext] = useState(null);
  const [message, setMessage] = useState({ error: '', success: '' });
  const [pendingAction, setPendingAction] = useState('');
  const [, startTransition] = useTransition();
  const activeTutors = useMemo(() => tutors.filter((tutor) => tutor.lifecycleStatus !== 'retired'), [tutors]);
  const listedTutors = useMemo(() => tutors.filter((tutor) => (
    tutor.lifecycleStatus !== 'retired' || tutor.teachingRelationshipSummary?.total > 0
  )), [tutors]);

  useEffect(() => {
    setTutors(initialTutors);
    setDrafts(Object.fromEntries(initialTutors.map((tutor) => [tutor.teacherId, {
      finalTeachingDate: tutor.finalTeachingDate || '',
      replacementTutorShortName: tutor.replacementTutorShortName || '',
      note: tutor.lifecycleNote || '',
    }])));
  }, [initialTutors]);

  function updateDraft(teacherId, key, value) {
    setDrafts((current) => ({ ...current, [teacherId]: { ...current[teacherId], [key]: value } }));
  }

  function save(tutor, action) {
    const draft = drafts[tutor.teacherId] || {};
    const actionId = `${tutor.teacherId}:${action}`;
    setPendingAction(actionId);
    startTransition(async () => {
      try {
        setMessage({ error: '', success: '' });
        const response = await fetch('/api/admin/tutors/lifecycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId: tutor.teacherId, action, ...draft }),
        });
        const data = await response.json();
        if (!response.ok) {
          setMessage({ error: data.error || 'Could not save tutor lifecycle.', success: '' });
          return;
        }
        setTutors((current) => current.map((entry) => entry.teacherId === tutor.teacherId ? { ...entry, ...data.tutor } : entry));
        setContext((current) => current?.tutor?.teacherId === tutor.teacherId ? { ...current, tutor: { ...current.tutor, ...data.tutor } } : current);
        setMessage({ error: '', success: `${data.tutor.fullName} is now ${data.tutor.lifecycleStatus}.` });
        router.refresh();
      } catch {
        setMessage({ error: 'Could not reach the tutor lifecycle service. Try again.', success: '' });
      } finally {
        setPendingAction('');
      }
    });
  }

  function review(tutor) {
    const actionId = `${tutor.teacherId}:review`;
    setPendingAction(actionId);
    startTransition(async () => {
      try {
        setMessage({ error: '', success: '' });
        const response = await fetch(`/api/admin/tutors/lifecycle?teacherId=${encodeURIComponent(tutor.teacherId)}`);
        const data = await response.json();
        if (!response.ok) {
          setMessage({ error: data.error || 'Could not load retirement checks.', success: '' });
          return;
        }
        setContext(data);
      } catch {
        setMessage({ error: 'Could not reach the retirement checks. Try again.', success: '' });
      } finally {
        setPendingAction('');
      }
    });
  }

  return (
    <div className="space-y-5">
      {message.error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message.error}</p> : null}
      {message.success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message.success}</p> : null}

      <section className="rounded-[1.3rem] border border-blue-100 bg-blue-50/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">Teaching relationships</h3>
            <p className="mt-1 text-sm text-slate-600">
              Rebuilt from student assignments, tutor status, the lesson schedule cache and practice-note delivery.
              {derivedAt ? ` Viewed ${formatDateTime(derivedAt)}.` : ''}
            </p>
          </div>
          <p className="text-2xl font-bold text-slate-900">{relationshipSummary.total || 0} <span className="text-sm font-medium text-slate-600">current</span></p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-800">{relationshipSummary.byPhase?.established || 0} established</span>
          <span className="rounded-full bg-blue-100 px-3 py-1.5 text-blue-800">{relationshipSummary.byPhase?.starting || 0} starting</span>
          <span className="rounded-full bg-violet-100 px-3 py-1.5 text-violet-800">{relationshipSummary.byPhase?.planned || 0} planned</span>
          {relationshipSummary.paused ? <span className="rounded-full bg-slate-200 px-3 py-1.5 text-slate-700">{relationshipSummary.paused} paused</span> : null}
          {relationshipSummary.handoversOpen ? <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{relationshipSummary.handoversOpen} handover{relationshipSummary.handoversOpen === 1 ? '' : 's'} open</span> : null}
          {relationshipSummary.urgentAttention ? <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-800">{relationshipSummary.urgentAttention} urgent</span> : null}
          {relationshipSummary.needsReview ? <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-800">{relationshipSummary.needsReview} need review</span> : null}
        </div>
        {relationshipSummary.unmatchedAssignments?.length ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {relationshipSummary.unmatchedAssignments.length} student assignment{relationshipSummary.unmatchedAssignments.length === 1 ? '' : 's'} use a tutor name that is not in the canonical roster.
          </p>
        ) : null}
      </section>

      {context ? (
        <section className="rounded-[1.3rem] border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Retirement checks · {context.tutor.fullName}</h3>
              <p className="mt-1 text-sm text-slate-600">Warnings inform the handover; they do not block retirement.</p>
            </div>
            <ActionButton onClick={() => setContext(null)} variant="quiet" size="compact">Close</ActionButton>
          </div>
          {warningLines(context.warnings).length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {warningLines(context.warnings).map(([count, label]) => <li key={label}>{count} {label}{count === 1 ? '' : 's'}</li>)}
            </ul>
          ) : <p className="mt-3 text-sm text-emerald-800">No dashboard checks are outstanding.</p>}
          <ConfirmButton
            confirmMessage={`Retire ${context.tutor.fullName}? Warnings stay visible but will not block this.`}
            onConfirm={() => save(context.tutor, 'retire')}
            pending={pendingAction === `${context.tutor.teacherId}:retire`}
            disabled={Boolean(pendingAction) || context.tutor.lifecycleStatus === 'retired' || !hasReachedFinalTeachingDate(context.tutor.finalTeachingDate)}
            pendingLabel="Retiring…"
            variant="danger"
            className="mt-4"
          >
            {context.tutor.lifecycleStatus === 'retired' ? 'Retired' : hasReachedFinalTeachingDate(context.tutor.finalTeachingDate) ? 'Retire tutor' : `Available after ${formatDate(context.tutor.finalTeachingDate)}`}
          </ConfirmButton>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[1.4rem] border border-blue-100 bg-white/90 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Active and leaving</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {listedTutors.map((tutor) => {
            const draft = drafts[tutor.teacherId] || {};
            const leaving = tutor.lifecycleStatus === 'leaving';
            const retired = tutor.lifecycleStatus === 'retired';
            return (
              <article key={tutor.teacherId} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-900">{tutor.fullName}</h4>
                    <p className="mt-1 text-sm text-slate-600">{tutor.shortName} · {tutor.instruments.join(', ')}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${retired ? 'bg-rose-100 text-rose-800' : leaving ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
                    {retired ? 'Retired · assignments remain' : leaving ? `Leaving · ${formatDate(tutor.finalTeachingDate)}` : 'Active'}
                  </span>
                </div>
                {tutor.teachingRelationshipSummary?.attention ? (
                  <p className={`mt-3 text-sm font-semibold ${tutor.teachingRelationshipSummary.urgentAttention ? 'text-rose-700' : 'text-amber-800'}`}>
                    {tutor.teachingRelationshipSummary.attention} relationship{tutor.teachingRelationshipSummary.attention === 1 ? '' : 's'} need{tutor.teachingRelationshipSummary.attention === 1 ? 's' : ''} handover attention
                  </p>
                ) : null}
                {tutor.teachingRelationships?.length ? (
                  <details defaultOpen={Boolean(tutor.teachingRelationshipSummary?.attention)} className="group mt-4 rounded-xl border border-slate-200 bg-slate-50/70">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 active:bg-slate-200 [&::-webkit-details-marker]:hidden">
                      <span>{tutor.teachingRelationshipSummary.total} current student{tutor.teachingRelationshipSummary.total === 1 ? '' : 's'}</span>
                      <span className="text-xs font-medium text-slate-500 group-open:hidden">Show relationships ↓</span>
                      <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Hide relationships ↑</span>
                    </summary>
                    <div className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2 xl:grid-cols-3">
                      {tutor.teachingRelationships.map((relationship) => (
                        <RelationshipCard key={relationship.relationshipId || `${tutor.teacherId}:${relationship.student.displayName}`} relationship={relationship} />
                      ))}
                    </div>
                  </details>
                ) : <p className="mt-4 text-sm text-slate-500">No current student assignments found.</p>}
                {!leaving && !retired ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-[12rem_12rem_1fr_auto]">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final teaching date<input type="date" value={draft.finalTeachingDate} onChange={(event) => updateDraft(tutor.teacherId, 'finalTeachingDate', event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Handover to<select value={draft.replacementTutorShortName} onChange={(event) => updateDraft(tutor.teacherId, 'replacementTutorShortName', event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"><option value="">Not set</option>{activeTutors.filter((entry) => entry.teacherId !== tutor.teacherId).map((entry) => <option key={entry.teacherId} value={entry.shortName}>{entry.fullName}</option>)}</select></label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Handover note<input value={draft.note} onChange={(event) => updateDraft(tutor.teacherId, 'note', event.target.value)} placeholder="Optional context" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label>
                    <ActionButton
                      disabled={Boolean(pendingAction)}
                      pending={pendingAction === `${tutor.teacherId}:mark_leaving`}
                      pendingLabel="Saving…"
                      onClick={() => save(tutor, 'mark_leaving')}
                      variant="warning"
                      className="self-end"
                    >
                      Mark leaving
                    </ActionButton>
                  </div>
                ) : leaving ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton disabled={Boolean(pendingAction)} pending={pendingAction === `${tutor.teacherId}:review`} pendingLabel="Loading…" onClick={() => review(tutor)} variant="secondary">Review warnings</ActionButton>
                    <ActionButton disabled={Boolean(pendingAction)} pending={pendingAction === `${tutor.teacherId}:restore_active`} pendingLabel="Saving…" onClick={() => save(tutor, 'restore_active')} variant="secondary">Keep active</ActionButton>
                  </div>
                ) : <ActionButton disabled={Boolean(pendingAction)} pending={pendingAction === `${tutor.teacherId}:restore_active`} pendingLabel="Saving…" onClick={() => save(tutor, 'restore_active')} variant="secondary" className="mt-4">Restore active</ActionButton>}
              </article>
            );
          })}
        </div>
      </section>

      {tutors.some((tutor) => tutor.lifecycleStatus === 'retired' && !tutor.teachingRelationshipSummary?.total) ? <section className="rounded-[1.3rem] border border-slate-200 bg-slate-50 p-5"><h3 className="font-semibold text-slate-900">Retired</h3><div className="mt-3 flex flex-wrap gap-2">{tutors.filter((tutor) => tutor.lifecycleStatus === 'retired' && !tutor.teachingRelationshipSummary?.total).map((tutor) => <ActionButton key={tutor.teacherId} disabled={Boolean(pendingAction)} pending={pendingAction === `${tutor.teacherId}:restore_active`} pendingLabel="Saving…" onClick={() => save(tutor, 'restore_active')} variant="secondary">Restore {tutor.fullName}</ActionButton>)}</div></section> : null}
    </div>
  );
}
