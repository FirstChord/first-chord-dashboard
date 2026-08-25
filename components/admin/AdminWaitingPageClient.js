'use client';

import Link from 'next/link';
import { Archive, Check, Copy, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AgeChip } from '@/components/admin/ui/AgeChip';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';
import { WELCOME_CALL_PROMPTS } from '@/lib/admin/onboarding-message-helpers.mjs';
import {
  getWaitingRestoreStatus,
  getWaitingStatusLabel,
  isActiveWaitingStatus,
  WAITING_STATUS_OPTIONS,
} from '@/lib/admin/waiting-status.mjs';

function getAgeBadge(ageInDays) {
  if (ageInDays == null) {
    return { label: 'Unknown age', className: 'bg-slate-100 text-slate-700' };
  }

  if (ageInDays >= 90) {
    return { label: `${ageInDays} days`, className: 'bg-red-100 text-red-900' };
  }

  if (ageInDays >= 60) {
    return { label: `${ageInDays} days`, className: 'bg-amber-100 text-amber-900' };
  }

  return { label: `${ageInDays} days`, className: 'bg-emerald-100 text-emerald-900' };
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatInstrumentList(instruments = []) {
  return instruments.length ? instruments.join(', ') : 'Unknown';
}

function formatMatchedInstruments(instruments = []) {
  return instruments.map((instrument) => instrument.charAt(0).toUpperCase() + instrument.slice(1)).join(', ');
}

function buildMmsNoteFacts(student) {
  const parsed = student.parsedNote || {};
  return [
    parsed.age ? { label: 'Age', value: parsed.age } : null,
    parsed.experience ? { label: 'Experience', value: parsed.experience } : null,
    parsed.genres ? { label: 'Genres', value: parsed.genres } : null,
    parsed.songs ? { label: 'Songs', value: parsed.songs } : null,
  ].filter(Boolean);
}

function buildParkedWaitingNote(existingNote = '', now = new Date()) {
  const line = `Parked from active waiting list on ${now.toISOString().slice(0, 10)}`;
  const trimmed = `${existingNote || ''}`.trim();
  if (!trimmed) return line;
  if (trimmed.includes(line)) return trimmed;
  return `${trimmed}\n${line}`;
}

function mergeRefreshedStudents(currentStudents, refreshedStudents) {
  const currentByMmsId = new Map(currentStudents.map((student) => [student.mmsId, student]));

  return refreshedStudents.map((student) => {
    const current = currentByMmsId.get(student.mmsId);
    if (!current) {
      return { ...student, savedWaitingStatus: student.waitingStatus };
    }

    return {
      ...student,
      waitingNote: current.waitingNote,
      waitingStatus: current.waitingStatus,
      savedWaitingStatus: student.waitingStatus,
      waitingUpdatedAt: current.waitingUpdatedAt,
    };
  });
}

function buildOnboardSlotHref(student, tutor, slot) {
  const params = new URLSearchParams({ mmsId: student.mmsId });

  if (slot.nextDate) params.set('lessonDate', slot.nextDate);
  if (slot.eventId) params.set('freeEventId', slot.eventId);
  if (slot.startTime) params.set('lessonTime', slot.startTime);
  if (slot.durationMinutes) params.set('lessonLength', slot.durationMinutes);
  if (tutor.teacherId) params.set('teacherId', tutor.teacherId);
  if (tutor.teacherName) params.set('tutorName', tutor.teacherName);

  return `/admin/onboard?${params.toString()}`;
}

function prepareStudents(activeStudents = [], inactiveStudents = []) {
  return [...activeStudents, ...inactiveStudents].map((student) => ({
    ...student,
    savedWaitingStatus: student.waitingStatus,
  }));
}

export default function AdminWaitingPageClient({
  initialStudents,
  initialInactiveStudents = [],
  initialCapacityContext = null,
}) {
  const [students, setStudents] = useState(() => prepareStudents(initialStudents, initialInactiveStudents));
  const [actionState, setActionState] = useState({ pendingId: '', error: '' });
  const [refreshState, setRefreshState] = useState({
    pending: false,
    error: '',
    capacityContext: initialCapacityContext,
  });
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    setStudents(prepareStudents(initialStudents, initialInactiveStudents));
  }, [initialStudents, initialInactiveStudents]);

  useEffect(() => {
    setRefreshState((current) => ({
      ...current,
      capacityContext: initialCapacityContext,
    }));
  }, [initialCapacityContext]);

  async function handleCopy(student) {
    try {
      await navigator.clipboard.writeText(student.welcomeGroupMessage);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = student.welcomeGroupMessage;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    setCopiedId(student.mmsId);
    window.setTimeout(() => setCopiedId((current) => (current === student.mmsId ? '' : current)), 1800);
    logCommunicationCopy({
      category: 'waiting',
      mmsId: student.mmsId,
      studentName: student.fullName || '',
      body: student.welcomeGroupMessage,
      source: 'waiting_welcome',
    });
  }

  async function handleSave(student, updates = {}) {
    const nextStatus = updates.status ?? student.waitingStatus;
    const nextNote = updates.note ?? student.waitingNote;
    setActionState({ pendingId: student.mmsId, error: '' });

    try {
      const response = await fetch('/api/admin/waiting/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mmsId: student.mmsId,
          studentName: student.fullName,
          parentName: student.parentName,
          parentEmail: student.parentEmail,
          dateStarted: student.dateStarted,
          status: nextStatus,
          note: nextNote,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setActionState({ pendingId: '', error: payload.error || 'Waiting update failed' });
        return;
      }

      setStudents((current) => current.map((entry) => {
        if (entry.mmsId !== student.mmsId) return entry;

        const wasActive = isActiveWaitingStatus(entry.savedWaitingStatus);
        const isActive = isActiveWaitingStatus(payload.state.status);
        return {
          ...entry,
          waitingStatus: payload.state.status,
          savedWaitingStatus: payload.state.status,
          waitingNote: payload.state.note,
          waitingUpdatedAt: payload.state.updatedAt,
          ...(!wasActive && isActive ? {
            capacityMatches: [],
            capacityMatchDays: [],
            capacityMatchStatus: 'refresh_required',
            capacityMatchReason: 'Refresh free slots to calculate current matches.',
          } : {}),
        };
      }));
      setActionState({ pendingId: '', error: '' });
    } catch (error) {
      setActionState({ pendingId: '', error: error.message || 'Waiting update failed' });
    }
  }

  async function handlePark(student) {
    const confirmed = window.confirm(
      `Park ${student.fullName || student.mmsId} from the active waiting list? (Nothing is deleted from MMS.)`,
    );
    if (!confirmed) return;

    await handleSave(student, {
      status: 'closed',
      note: buildParkedWaitingNote(student.waitingNote),
    });
  }

  async function handleRefreshCapacity() {
    setRefreshState((current) => ({ ...current, pending: true, error: '' }));

    try {
      const response = await fetch('/api/admin/waiting/capacity', {
        method: 'POST',
      });
      const payload = await response.json();

      if (!response.ok) {
        setRefreshState((current) => ({
          ...current,
          pending: false,
          error: payload.error || 'Capacity refresh failed',
        }));
        return;
      }

      setStudents((current) => mergeRefreshedStudents(
        current,
        [...(payload.students || []), ...(payload.inactiveStudents || [])],
      ));
      setRefreshState({
        pending: false,
        error: '',
        capacityContext: payload.capacityContext || null,
      });
    } catch (error) {
      setRefreshState((current) => ({
        ...current,
        pending: false,
        error: error.message || 'Capacity refresh failed',
      }));
    }
  }

  function updateLocalStudent(mmsId, updates) {
    setStudents((current) => current.map((entry) => (
      entry.mmsId === mmsId
        ? { ...entry, ...updates }
        : entry
    )));
  }

  const activeStudents = students.filter((student) => isActiveWaitingStatus(student.savedWaitingStatus));
  const inactiveStudents = students.filter((student) => !isActiveWaitingStatus(student.savedWaitingStatus));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">New enquiries</p>
            <h2
              className="mt-2 fc-display text-3xl text-slate-900"
            >
              Waiting List
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              MMS students with status <code>Waiting</code>, newest first, limited to the last 120 days.
            </p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-white/80 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Free-slot matches</p>
                <p className="mt-1 text-sm text-slate-600">
                  {refreshState.capacityContext?.fetchedAt
                    ? `Checked ${formatDateTime(refreshState.capacityContext.fetchedAt)}`
                    : 'Not checked yet'}
                  {refreshState.capacityContext?.slotCount != null
                    ? ` · ${refreshState.capacityContext.slotCount} MMS Free events`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefreshCapacity}
                disabled={refreshState.pending}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshState.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {refreshState.pending ? 'Refreshing…' : 'Refresh free slots'}
              </button>
            </div>
            {refreshState.error ? (
              <p className="mt-2 text-sm text-red-700">{refreshState.error}</p>
            ) : null}
            {!refreshState.error && refreshState.capacityContext?.error ? (
              <p className="mt-2 text-sm text-amber-700">{refreshState.capacityContext.error}</p>
            ) : null}
          </div>
        </div>
      </div>

      {actionState.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionState.error}
        </div>
      ) : null}

      <div className="space-y-4">
        {activeStudents.map((student) => {
          const ageBadge = getAgeBadge(student.ageInDays);
          const pending = actionState.pendingId === student.mmsId;
          const mmsNoteFacts = buildMmsNoteFacts(student);

          return (
            <div key={student.mmsId} className="rounded-[1.6rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)] backdrop-blur-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{student.fullName || student.mmsId}</div>
                  <div className="text-xs text-slate-500">{student.mmsId}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full px-2.5 py-1 font-medium ${ageBadge.className}`}>{ageBadge.label}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Instrument: {formatInstrumentList(student.instruments)}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Added: {formatDate(student.dateStarted)}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Updated: {formatDateTime(student.waitingUpdatedAt)}</span>
                    <AgeChip updatedAt={student.waitingUpdatedAt} className="px-2.5 py-1" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleCopy(student)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
                      copiedId === student.mmsId
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {copiedId === student.mmsId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedId === student.mmsId ? 'Copied' : 'Copy welcome group message'}
                  </button>
                  <Link
                    href={`/admin/onboard?mmsId=${encodeURIComponent(student.mmsId)}`}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Onboard
                  </Link>
                  <button
                    type="button"
                    onClick={() => handlePark(student)}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                    Park
                  </button>
                </div>
              </div>

              <details
                open={student.waitingStatus === 'welcome_call_booked'}
                className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3"
              >
                <summary className="cursor-pointer text-sm font-semibold text-violet-950">
                  Welcome call prompts
                </summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                  {WELCOME_CALL_PROMPTS.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ol>
              </details>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_1.2fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Parent contact</p>
                  <p className="mt-2 text-sm text-slate-900">{student.parentName || '—'}</p>
                  <p className="mt-1 text-sm text-slate-700">{student.parentEmail || '—'}</p>
                  <p className="mt-1 text-sm text-slate-700">{student.contactNumber || '—'}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Waiting note</span>
                    <textarea
                      value={student.waitingNote}
                      onChange={(event) => updateLocalStudent(student.mmsId, { waitingNote: event.target.value })}
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      placeholder="Called, left voicemail. Asked for Friday. Added to welcome group..."
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Status</span>
                    <select
                      value={student.waitingStatus}
                      onChange={(event) => updateLocalStudent(student.mmsId, { waitingStatus: event.target.value })}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      {WAITING_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSave(student)}
                    disabled={pending}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {pending ? 'Saving…' : 'Save waiting state'}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">MMS sign-up context</p>
                    <p className="mt-2 text-sm text-slate-700">
                      Instrument source: {student.instrumentRaw || 'No instrument found in MMS note'}
                    </p>
                  </div>
                  {student.note ? (
                    <details className="md:max-w-xl">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">
                        Full MMS note
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {student.note}
                      </pre>
                    </details>
                  ) : null}
                </div>
                {mmsNoteFacts.length ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {mmsNoteFacts.map((fact) => (
                      <div key={fact.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">{fact.label}</p>
                        <p className="mt-1 text-sm text-slate-700">{fact.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs uppercase tracking-wide text-sky-700">Possible slots</p>
                  <p className="text-xs text-sky-800">{student.capacityMatchReason}</p>
                </div>
                {student.uncoveredInstruments?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {student.coveredInstruments?.map((instrument) => (
                      <span key={`covered-${instrument}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {instrument} ✓
                      </span>
                    ))}
                    {student.uncoveredInstruments.map((entry) => (
                      <span key={`uncovered-${entry.instrument}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {entry.instrument}: {entry.reason === 'not_taught' ? 'not taught here' : 'no free slot'}
                      </span>
                    ))}
                  </div>
                ) : null}
                {student.availabilityDays?.length || student.availabilityTimes?.length ? (
                  <p className="mt-2 text-xs text-sky-800">
                    Prefers: {[
                      student.availabilityDays?.length ? student.availabilityDays.join(', ') : '',
                      student.availabilityTimes?.length
                        ? student.availabilityTimes.map((bucket) => (bucket === 'evening' ? 'evenings' : 'earlier')).join(' / ')
                        : '',
                    ].filter(Boolean).join(' · ')} — matching slots ranked first.
                  </p>
                ) : null}
                {student.capacityMatchDays?.length ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
                    {student.capacityMatchDays.map((day) => (
                      <div
                        key={`${student.mmsId}-${day.weekday}`}
                        className={`rounded-lg border bg-white/80 px-3 py-2 ${day.dayFits ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-sky-200'}`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{day.weekday}</p>
                        <div className="mt-1.5 space-y-1.5">
                          {day.tutors.map((tutor) => (
                            <div key={`${day.weekday}-${tutor.teacherId || tutor.teacherName}`} className="text-sm text-slate-700">
                              <p>
                                <span className="font-medium text-slate-900">{tutor.teacherName}</span>
                                {tutor.matchedInstruments?.length ? (
                                  <span className="text-xs text-slate-500"> ({formatMatchedInstruments(tutor.matchedInstruments)})</span>
                                ) : null}
                                {tutor.fitsAvailability ? (
                                  <span className="ml-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">fits availability</span>
                                ) : null}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {tutor.slots.map((slot) => (
                                  <Link
                                    key={`${slot.startTime}-${slot.durationMinutes}-${slot.nextDate || 'no-date'}`}
                                    href={buildOnboardSlotHref(student, tutor, slot)}
                                    className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 transition hover:border-sky-300 hover:bg-sky-100"
                                  >
                                    {slot.startTime} ({slot.durationMinutes} mins)
                                  </Link>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-700">
                    {student.capacityMatchStatus === 'instrument_unknown'
                      ? 'Add or clarify the instrument in the MMS sign-up note before trusting slot suggestions.'
                      : student.capacityMatchReason}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {!activeStudents.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-5 py-8 text-center text-sm text-slate-600">
            No active waiting enquiries.
          </div>
        ) : null}
      </div>

      {inactiveStudents.length ? (
        <details className="group rounded-[1.6rem] border border-slate-200 bg-white/80 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Inactive waiting records</h3>
              <p className="mt-1 text-sm text-slate-600">
                No response, parked and onboarded records stay visible here and do not count toward active capacity.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {inactiveStudents.length}
            </span>
          </summary>

          <div className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
            {inactiveStudents.map((student) => {
              const restoreStatus = getWaitingRestoreStatus(student.savedWaitingStatus);
              const pending = actionState.pendingId === student.mmsId;

              return (
                <div key={student.mmsId} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{student.fullName || student.mmsId}</p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {getWaitingStatusLabel(student.savedWaitingStatus)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {student.mmsId} · Updated {formatDateTime(student.waitingUpdatedAt)}
                    </p>
                    {student.waitingNote ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{student.waitingNote}</p>
                    ) : null}
                  </div>
                  {restoreStatus ? (
                    <button
                      type="button"
                      onClick={() => handleSave(student, { status: restoreStatus })}
                      disabled={pending}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {pending ? 'Restoring…' : 'Return to contacted'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
