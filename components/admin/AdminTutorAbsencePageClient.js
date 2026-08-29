'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, Search, Trash2 } from 'lucide-react';
import {
  buildCoverAskMessage,
  buildTutorAbsenceMessage,
  formatTutorAbsenceDate,
  isTutorAbsencePaymentHandled,
  summariseTutorAbsenceState,
} from '@/lib/admin/tutor-absence-helpers.mjs';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ConfirmButton } from '@/components/admin/ui/ConfirmButton';
import { cardClasses } from '@/components/admin/ui/Card';

const PAYMENT_PAUSE_PWA_URL = process.env.NEXT_PUBLIC_PAYMENT_PAUSE_PWA_URL || 'https://payment-pause-pwa.web.app/';

function decisionLabel(decision = '') {
  if (decision === 'cancel_day') return 'Cancel day';
  if (decision === 'cover') return 'Cover lessons';
  return 'No decision yet';
}

function addDaysToDateInput(value = '', days = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildTutorAbsencePaymentPauseUrl({ lesson = {}, workflow = {} } = {}) {
  if (!lesson.studentMmsId || !workflow.selectedDate) return '';

  const url = new URL(PAYMENT_PAUSE_PWA_URL);
  const parentName = lesson.parentName || '';
  const params = {
    source: 'dashboard-tutor-absence',
    absenceId: workflow.absenceId || '',
    studentName: lesson.studentName || '',
    email: lesson.parentEmail || '',
    startDate: workflow.selectedDate,
    endDate: addDaysToDateInput(workflow.selectedDate, 3),
    reason: 'Teacher Holiday',
    mmsId: lesson.studentMmsId || '',
    customerId: lesson.stripeCustomerId || '',
    subscriptionId: lesson.stripeSubscriptionId || '',
    tutor: lesson.tutor || workflow.selectedTutor?.fullName || '',
    parentName,
  };

  Object.entries(params).forEach(([key, value]) => {
    if (`${value || ''}`.trim()) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

function paymentSummary(lesson = {}) {
  const mode = lesson.paymentMode || 'unknown';
  const expectation = lesson.paymentExpectation || 'not set';
  return `${mode} · ${expectation}`;
}

function resolveHint({ summary = {} } = {}) {
  return summary.resolutionHint || '';
}

function MessageButton({ body, copiedId, copyId, onCopy, context = null, label = 'Copy message' }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(copyId, body, context)}
      className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-blue-50"
    >
      {copiedId === copyId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
      {label}
    </button>
  );
}

export default function AdminTutorAbsencePageClient({ workflow }) {
  const router = useRouter();
  const [decision, setDecision] = useState(workflow.state.decision || '');
  const [coverTutorShortName, setCoverTutorShortName] = useState(workflow.state.coverTutorShortName || '');
  const [messageState, setMessageState] = useState(workflow.state.messageState || {});
  const [note, setNote] = useState(workflow.state.note || '');
  const [saveState, setSaveState] = useState({ pending: false, action: '', error: '', savedAt: '' });
  const [copiedId, setCopiedId] = useState('');
  const [paymentUpdateState, setPaymentUpdateState] = useState({ pendingId: '', error: '' });
  const [groupMessageState, setGroupMessageState] = useState({ pendingKey: '', error: '', markedKey: '' });
  const hasSavedAbsence = Boolean(workflow.state.createdAt || workflow.state.updatedAt || workflow.state.resolvedAt);

  const coverCandidates = workflow.coverCandidates || [];
  // A cover-bank candidate can sit outside the instrument-matched dropdown
  // (mismatched instrument, or an external with no MMS identity) but must
  // still be selectable — the bank informs the choice, it never restricts it.
  const candidateFallback = coverCandidates.find((candidate) => candidate.tutorKey === coverTutorShortName);
  const selectedCoverTutor = workflow.coverOptions.find((tutor) => tutor.shortName === coverTutorShortName)
    || (candidateFallback ? { shortName: candidateFallback.tutorKey, fullName: candidateFallback.tutorName } : null);
  const workflowChecklist = messageState.__workflow || {};
  const cancellationMessageGroups = useMemo(
    () => workflow.cancellationMessageGroups || [],
    [workflow.cancellationMessageGroups],
  );
  const groupedMessageEventIds = useMemo(() => new Set(
    cancellationMessageGroups.flatMap((group) => (
      group.occurrences || []
    ).map((occurrence) => occurrence.eventId).filter(Boolean)),
  ), [cancellationMessageGroups]);
  const summary = useMemo(() => summariseTutorAbsenceState({
    lessons: workflow.lessons,
    messageState,
    decision,
    coverTutorName: selectedCoverTutor?.fullName || '',
  }), [workflow.lessons, messageState, decision, selectedCoverTutor?.fullName]);

  function updateMessageState(eventId, patch) {
    setMessageState((current) => ({
      ...current,
      [eventId]: {
        ...(current[eventId] || {}),
        ...patch,
      },
    }));
    setSaveState({ pending: false, action: '', error: '', savedAt: '' });
  }

  function updateWorkflowChecklist(patch) {
    setMessageState((current) => ({
      ...current,
      __workflow: {
        ...(current.__workflow || {}),
        ...patch,
      },
    }));
    setSaveState({ pending: false, action: '', error: '', savedAt: '' });
  }

  function setAllMessaged() {
    const next = { __workflow: messageState.__workflow || {} };
    for (const lesson of workflow.lessons) {
      next[lesson.eventId] = {
        ...(messageState[lesson.eventId] || {}),
        messaged: true,
      };
    }
    setMessageState(next);
    setSaveState({ pending: false, action: '', error: '', savedAt: '' });
  }

  async function copyMessage(copyId, body, context = null) {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = body;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setCopiedId(copyId);
    window.setTimeout(() => setCopiedId((current) => (current === copyId ? '' : current)), 1800);
    if (context) {
      logCommunicationCopy({
        category: 'tutor_absence',
        mmsId: context.mmsId,
        studentName: context.studentName,
        body,
        source: 'tutor_absence',
      });
    }
  }

  async function markGroupMessaged(groupKey) {
    if (!groupKey) return;
    setGroupMessageState({ pendingKey: groupKey, error: '', markedKey: '' });
    try {
      const response = await fetch('/api/admin/tutor-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_group_messaged',
          groupKey,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Could not mark grouped message sent');
      }
      setGroupMessageState({ pendingKey: '', error: '', markedKey: groupKey });
      router.refresh();
    } catch (error) {
      setGroupMessageState({ pendingKey: '', error: error.message || 'Could not mark grouped message sent', markedKey: '' });
    }
  }

  async function setPausedExpected(lesson) {
    if (!lesson.studentMmsId) return;
    setPaymentUpdateState({ pendingId: lesson.eventId, error: '' });
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(lesson.studentMmsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentExpectation: 'stripe_paused_expected',
          auditContext: {
            source: 'admin_pause_workflow_action',
            actionLabel: 'Complete tutor absence payment pause',
            note: `Tutor absence: ${workflow.selectedTutor?.fullName || workflow.selectedTutor?.shortName || 'Tutor'} on ${workflow.selectedDate}`,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Payment expectation update failed');
      }

      updateMessageState(lesson.eventId, { paymentExpectationAligned: true });
      setPaymentUpdateState({ pendingId: '', error: '' });
    } catch (error) {
      setPaymentUpdateState({ pendingId: '', error: error.message || 'Payment expectation update failed' });
    }
  }

  async function saveAbsence(status = 'in_progress') {
    setSaveState({ pending: true, action: status, error: '', savedAt: '' });
    try {
      const response = await fetch('/api/admin/tutor-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          absenceId: workflow.absenceId,
          tutorShortName: workflow.selectedTutor?.shortName || '',
          tutorName: workflow.selectedTutor?.fullName || '',
          absenceDate: workflow.selectedDate,
          status,
          decision,
          coverTutorShortName: selectedCoverTutor?.shortName || '',
          coverTutorName: selectedCoverTutor?.fullName || '',
          affectedLessons: workflow.lessons,
          messageState,
          note,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveState({ pending: false, action: '', error: payload.error || 'Save failed', savedAt: '' });
        return;
      }
      setSaveState({ pending: false, action: '', error: '', savedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
    } catch (error) {
      setSaveState({ pending: false, action: '', error: error.message || 'Save failed', savedAt: '' });
    }
  }

  async function deleteAbsence() {
    setSaveState({ pending: true, action: 'delete', error: '', savedAt: '' });
    try {
      const response = await fetch('/api/admin/tutor-absence', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ absenceId: workflow.absenceId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveState({ pending: false, action: '', error: payload.error || 'Delete failed', savedAt: '' });
        return;
      }
      window.location.href = '/admin/workflows/tutor-absence';
    } catch (error) {
      setSaveState({ pending: false, action: '', error: error.message || 'Delete failed', savedAt: '' });
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Same-day operations</p>
        <h2
          className="mt-2 fc-display text-3xl text-slate-900"
        >
          Tutor Absence
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Pick the tutor and date, choose cancel or cover, copy parent messages, then mark the day handled.
        </p>
      </section>

      <section className={cardClasses()}>
        <form action="/admin/workflows/tutor-absence" className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tutor off</label>
            <select name="tutor" defaultValue={workflow.selectedTutor?.shortName || ''} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <option value="">Choose tutor</option>
              {workflow.tutors.map((tutor) => (
                <option key={tutor.shortName} value={tutor.shortName}>{tutor.fullName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
            <input name="date" type="date" defaultValue={workflow.selectedDate} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" />
          </div>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <Search className="h-4 w-4" />
            Find lessons
          </button>
        </form>
        {workflow.loadError ? <p className="mt-3 text-sm text-red-700">{workflow.loadError}</p> : null}
      </section>

      {workflow.selectedTutor ? (
        <section className="grid gap-4 md:grid-cols-4">
          <div className={cardClasses()}>
            <p className="text-sm text-slate-500">Tutor</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{workflow.selectedTutor.fullName}</p>
          </div>
          <div className={cardClasses()}>
            <p className="text-sm text-slate-500">Date</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{formatTutorAbsenceDate(workflow.selectedDate)}</p>
          </div>
          <div className={cardClasses()}>
            <p className="text-sm text-slate-500">Affected lessons</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{workflow.lessons.length}</p>
          </div>
          <div className={cardClasses()}>
            <p className="text-sm text-slate-500">Messages left</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{summary.remainingMessages}</p>
          </div>
        </section>
      ) : null}

      {workflow.selectedTutor && workflow.lessons.length ? (
        <section className={cardClasses()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Decision</h3>
              <p className="mt-1 text-sm text-slate-600">Keep the choice simple: cancel the day or cover the lessons.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{decisionLabel(decision)}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setDecision('cancel_day');
                setCoverTutorShortName('');
                setSaveState({ pending: false, action: '', error: '', savedAt: '' });
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${decision === 'cancel_day' ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              Cancel day
            </button>
            <button
              type="button"
              onClick={() => {
                setDecision('cover');
                setSaveState({ pending: false, action: '', error: '', savedAt: '' });
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${decision === 'cover' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              Find cover
            </button>
          </div>
          {decision === 'cover' ? (
            <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              {coverCandidates.length ? (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">From the cover bank</p>
                  <ul className="mt-2 space-y-2">
                    {coverCandidates.map((candidate) => {
                      const chosen = coverTutorShortName === candidate.tutorKey;
                      return (
                        <li
                          key={candidate.tutorKey}
                          className={`flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2 ${chosen ? 'border-emerald-400' : 'border-emerald-100'} ${candidate.alreadyTeaching ? 'opacity-70' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setCoverTutorShortName(chosen ? '' : candidate.tutorKey);
                              setSaveState({ pending: false, action: '', error: '', savedAt: '' });
                            }}
                            className="flex items-center gap-2 text-sm font-semibold text-slate-900"
                          >
                            {chosen ? <Check className="h-4 w-4 text-emerald-700" /> : null}
                            {candidate.tutorName}
                          </button>
                          {candidate.notice === 'same_day' ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Same-day OK</span>
                          ) : null}
                          {candidate.notice === 'needs_notice' ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Needs notice</span>
                          ) : null}
                          {candidate.alreadyTeaching ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Already teaching that day</span>
                          ) : null}
                          {candidate.matchedInstruments.length ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">{candidate.matchedInstruments.join(', ')}</span>
                          ) : null}
                          {candidate.tutorType === 'external' ? (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">External</span>
                          ) : null}
                          {candidate.notes ? (
                            <span className="max-w-[16rem] truncate text-xs text-slate-500">{candidate.notes}</span>
                          ) : null}
                          <span className="ml-auto">
                            <MessageButton
                              label="Copy ask"
                              copyId={`cover-ask-${candidate.tutorKey}`}
                              copiedId={copiedId}
                              onCopy={copyMessage}
                              context={{ mmsId: '', studentName: candidate.tutorName }}
                              body={buildCoverAskMessage({
                                candidateName: candidate.tutorName,
                                absentTutorName: workflow.selectedTutor?.fullName || '',
                                absenceDate: workflow.selectedDate,
                                lessons: workflow.lessons,
                              })}
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Cover tutor</label>
              <select
                value={coverTutorShortName}
                onChange={(event) => {
                  setCoverTutorShortName(event.target.value);
                  setSaveState({ pending: false, action: '', error: '', savedAt: '' });
                }}
                className="mt-2 w-full max-w-md rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Choose cover tutor</option>
                {workflow.coverOptions.map((tutor) => (
                  <option key={tutor.shortName} value={tutor.shortName}>
                    {tutor.fullName} ({tutor.matchedInstruments.join(', ')})
                  </option>
                ))}
              </select>
              {!workflow.coverOptions.length ? <p className="mt-2 text-sm text-amber-800">No same-instrument cover tutors found from the current tutor instrument map.</p> : null}
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-medium text-emerald-950">
                  <input
                    type="checkbox"
                    checked={Boolean(workflowChecklist.coverTutorConfirmed)}
                    onChange={(event) => updateWorkflowChecklist({ coverTutorConfirmed: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-800"
                  />
                  Cover tutor confirmed
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-medium text-emerald-950">
                  <input
                    type="checkbox"
                    checked={Boolean(workflowChecklist.coverTutorBriefed)}
                    onChange={(event) => updateWorkflowChecklist({ coverTutorBriefed: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-800"
                  />
                  Notes/context passed on
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-medium text-emerald-950">
                  <input
                    type="checkbox"
                    checked={Boolean(workflowChecklist.calendarUpdated)}
                    onChange={(event) => updateWorkflowChecklist({ calendarUpdated: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-800"
                  />
                  MMS/calendar updated or not needed
                </label>
              </div>
              <p className="mt-3 text-xs leading-5 text-emerald-900">
                Cover lessons should not trigger payment pauses. Only use the cancel path if a specific lesson is not going ahead.
              </p>
            </div>
          ) : null}
          {decision === 'cancel_day' ? (
            <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-amber-950">Hand this cancellation to Planning</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Save the decision, then use the grouped structured pause cards in Planning for the parent message and payment action. This dated absence will close automatically when those are complete.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {false && decision === 'cancel_day' && cancellationMessageGroups.length ? (
        <section className={cardClasses('border-indigo-100 bg-indigo-50/50')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Period parent messages</h3>
              <p className="mt-1 text-sm text-slate-600">
                Use these first when the same student is affected across several cancelled dates. The dated records stay separate underneath, but the parent gets one clear message for the block.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-800">
              {cancellationMessageGroups.length} grouped message{cancellationMessageGroups.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {cancellationMessageGroups.map((group) => (
              <div key={group.groupKey} className="rounded-2xl border border-indigo-100 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{group.studentName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {group.missedDates.map(formatTutorAbsenceDate).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs font-medium text-indigo-800">
                      {group.messagedCount} / {group.occurrenceCount} dates marked messaged
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageButton
                      body={group.message}
                      copiedId={copiedId}
                      copyId={group.groupKey}
                      onCopy={copyMessage}
                      context={{ mmsId: group.studentMmsId, studentName: group.studentName }}
                      label="Copy period message"
                    />
                    <button
                      type="button"
                      onClick={() => markGroupMessaged(group.groupKey)}
                      disabled={group.allMessaged || groupMessageState.pendingKey === group.groupKey}
                      className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {groupMessageState.pendingKey === group.groupKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {group.allMessaged ? 'Parents messaged ✓' : 'Mark parents messaged'}
                    </button>
                  </div>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">{group.message}</pre>
              </div>
            ))}
          </div>
          {groupMessageState.error ? (
            <p className="mt-3 text-sm font-semibold text-red-700">{groupMessageState.error}</p>
          ) : null}
        </section>
      ) : null}

      {workflow.selectedTutor && decision !== 'cancel_day' ? (
        <section className={cardClasses()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Affected Lessons</h3>
              <p className="mt-1 text-sm text-slate-600">
                {decision === 'cancel_day' && cancellationMessageGroups.length
                  ? 'Use the period messages above for repeated absences. Individual messages here are fallback controls for one-off edits or special cases.'
                  : 'Parent messages stay manual: copy, send in WhatsApp, then mark messaged.'}
              </p>
            </div>
            {workflow.lessons.length ? (
              <button type="button" onClick={setAllMessaged} className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50">
                Mark all messaged
              </button>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {workflow.lessons.length ? workflow.lessons.map((lesson) => {
              const message = buildTutorAbsenceMessage({
                lesson,
                tutorName: workflow.selectedTutor.fullName,
                absenceDate: workflow.selectedDate,
                decision,
                coverTutorName: selectedCoverTutor?.fullName || '',
              });
              const state = messageState[lesson.eventId] || {};
              const pauseUrl = buildTutorAbsencePaymentPauseUrl({ lesson, workflow });
              const alreadyPausedExpected = lesson.paymentExpectation === 'stripe_paused_expected';
              const paymentHandled = isTutorAbsencePaymentHandled(lesson, state);
              const hasPeriodMessage = groupedMessageEventIds.has(lesson.eventId);

              return (
                <div key={lesson.eventId} className={`rounded-2xl border p-4 ${hasPeriodMessage ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-900">{lesson.lessonTime} · {lesson.studentName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {lesson.instrument || 'Instrument unknown'} · {lesson.durationMinutes || '—'} mins · Parent: {lesson.parentName || 'not visible'}
                      </p>
                      {hasPeriodMessage ? (
                        <p className="mt-2 inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-900">
                          Covered by a period message above
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <MessageButton
                        body={message}
                        copiedId={copiedId}
                        copyId={lesson.eventId}
                        onCopy={copyMessage}
                        context={{ mmsId: lesson.studentMmsId, studentName: lesson.studentName }}
                        label={hasPeriodMessage ? 'Copy individual fallback' : 'Copy message'}
                      />
                      <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(state.messaged)}
                          onChange={(event) => updateMessageState(lesson.eventId, { messaged: event.target.checked })}
                        />
                        Messaged
                      </label>
                    </div>
                  </div>
                  {decision === 'cancel_day' ? (
                    <div className="mt-4 rounded-xl border border-amber-100 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-amber-950">Payment pause</p>
                          <p className="mt-1 text-xs text-amber-800">{paymentSummary(lesson)}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentHandled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                          {paymentHandled ? 'Handled' : 'Needs payment check'}
                        </span>
                      </div>
                      {alreadyPausedExpected ? (
                        <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900">
                          The student is marked paused expected, but that undated flag does not prove this absence is covered. Check the payment tool for these dates, or explicitly mark the action not needed with a reason.
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {pauseUrl ? (
                          <a
                            href={pauseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-50"
                          >
                            Open payment pause tool
                          </a>
                        ) : null}
                        <label className="inline-flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950">
                          <input
                            type="checkbox"
                            checked={Boolean(state.pauseToolRan)}
                            disabled={Boolean(state.pauseSkipped)}
                            onChange={(event) => updateMessageState(lesson.eventId, { pauseToolRan: event.target.checked })}
                          />
                          Pause tool run
                        </label>
                        <button
                          type="button"
                          onClick={() => setPausedExpected(lesson)}
                          disabled={Boolean(state.pauseSkipped) || paymentUpdateState.pendingId === lesson.eventId || Boolean(state.paymentExpectationAligned)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {paymentUpdateState.pendingId === lesson.eventId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {state.paymentExpectationAligned ? 'Payment expectation aligned ✓' : 'Confirm paused expectation'}
                        </button>
                        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(state.pauseSkipped)}
                            onChange={(event) => updateMessageState(lesson.eventId, {
                              pauseSkipped: event.target.checked,
                              pauseToolRan: event.target.checked ? false : state.pauseToolRan,
                              paymentExpectationAligned: event.target.checked ? false : state.paymentExpectationAligned,
                            })}
                          />
                          Not needed
                        </label>
                      </div>
                      {state.pauseSkipped ? (
                        <input
                          value={state.pauseSkipReason || ''}
                          onChange={(event) => updateMessageState(lesson.eventId, { pauseSkipReason: event.target.value })}
                          placeholder="Why payment pause is not needed"
                          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                No student lessons found for this tutor/date.
              </div>
            )}
          </div>
          {paymentUpdateState.error ? (
            <p className="mt-3 text-sm font-semibold text-red-700">{paymentUpdateState.error}</p>
          ) : null}
        </section>
      ) : null}

      {workflow.selectedTutor ? (
        <section className={cardClasses()}>
          <h3 className="text-lg font-semibold text-slate-900">Save & Close</h3>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setSaveState({ pending: false, action: '', error: '', savedAt: '' });
            }}
            rows={3}
            placeholder="Internal note from WhatsApp or decision context"
            className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton
              type="button"
              onClick={() => saveAbsence(
                decision === 'cancel_day'
                  ? 'pause_handoff'
                  : summary.remainingMessages ? 'parents_to_message' : 'in_progress',
              )}
              pending={saveState.pending && saveState.action !== 'resolved' && saveState.action !== 'delete'}
              disabled={saveState.pending}
              variant="blue"
              pendingLabel="Saving…"
            >
              {decision === 'cancel_day' ? 'Save & hand to pause cards' : 'Save progress'}
            </ActionButton>
            <ActionButton
              type="button"
              onClick={() => saveAbsence('resolved')}
              pending={saveState.pending && saveState.action === 'resolved'}
              disabled={saveState.pending || !summary.canResolve}
              variant="green"
              icon={<Check className="h-4 w-4" />}
              pendingLabel="Resolving…"
            >
              Resolve absence
            </ActionButton>
            {hasSavedAbsence ? (
              <ConfirmButton
                confirmMessage="Delete this logged tutor absence date? Use this when the tutor is no longer off and the date should disappear from the workflow."
                onConfirm={deleteAbsence}
                pending={saveState.pending && saveState.action === 'delete'}
                disabled={saveState.pending}
                variant="red"
                icon={<Trash2 className="h-4 w-4" />}
                pendingLabel="Deleting…"
              >
                Delete logged date
              </ConfirmButton>
            ) : null}
            {saveState.savedAt ? <span className="text-sm text-emerald-700">Saved at {saveState.savedAt}</span> : null}
            {saveState.error ? <span className="text-sm text-red-700">{saveState.error}</span> : null}
          </div>
          {resolveHint({ decision, summary, selectedCoverTutor }) && workflow.lessons.length ? (
            <p className="mt-3 text-sm text-amber-800">{resolveHint({ decision, summary, selectedCoverTutor })}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
