'use client';

import { Archive, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { ConfirmButton } from '@/components/admin/ui/ConfirmButton';
import CopyButton from '@/components/admin/ui/CopyButton';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';
import { WELCOME_CALL_PROMPTS } from '@/lib/admin/onboarding-message-helpers.mjs';
import { isStudentOwnContact } from '@/lib/admin/planning-client-helpers.mjs';
import {
  buildWaitingLearnerSummary,
  formatWaitingDuration,
} from '@/lib/admin/waiting-card-helpers.mjs';
import {
  getWaitingRestoreStatus,
  getWaitingStatusLabel,
  isActiveWaitingStatus,
  WAITING_STATUS_OPTIONS,
} from '@/lib/admin/waiting-status.mjs';

function getAgeBadge(ageInDays) {
  if (ageInDays == null) {
    return { label: formatWaitingDuration(ageInDays), className: 'bg-slate-100 text-slate-700' };
  }

  if (ageInDays >= 90) {
    return { label: formatWaitingDuration(ageInDays), className: 'bg-red-100 text-red-900' };
  }

  if (ageInDays >= 60) {
    return { label: formatWaitingDuration(ageInDays), className: 'bg-amber-100 text-amber-900' };
  }

  return { label: formatWaitingDuration(ageInDays), className: 'bg-emerald-100 text-emerald-900' };
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

function formatMatchedInstruments(instruments = []) {
  return instruments.map((instrument) => instrument.charAt(0).toUpperCase() + instrument.slice(1)).join(', ');
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

function TutorDayRows({ student, days = [] }) {
  return (
    <div className="divide-y divide-sky-100">
      {days.map((day) => (
        <div
          key={`${student.mmsId}-${day.weekday}`}
          className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)]"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">{day.weekday}</p>
            {day.dayFits ? (
              <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                Preferred day
              </span>
            ) : null}
          </div>
          <div className="space-y-2.5">
            {day.tutors.map((tutor) => (
              <div key={`${day.weekday}-${tutor.teacherId || tutor.teacherName}`}>
                <p className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{tutor.teacherName}</span>
                  {tutor.matchedInstruments?.length ? (
                    <span className="text-xs text-slate-500"> · {formatMatchedInstruments(tutor.matchedInstruments)}</span>
                  ) : null}
                  {tutor.fitsAvailability ? (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Fits stated availability
                    </span>
                  ) : null}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tutor.slots.map((slot) => (
                    <ButtonLink
                      key={`${slot.startTime}-${slot.durationMinutes}-${slot.nextDate || 'no-date'}`}
                      href={buildOnboardSlotHref(student, tutor, slot)}
                      variant="blue"
                      size="compact"
                    >
                      {slot.startTime} · {slot.durationMinutes} mins
                    </ButtonLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  const [actionState, setActionState] = useState({ pendingId: '', savedId: '', error: '' });
  const [refreshState, setRefreshState] = useState({
    pending: false,
    error: '',
    capacityContext: initialCapacityContext,
  });

  useEffect(() => {
    setStudents(prepareStudents(initialStudents, initialInactiveStudents));
  }, [initialStudents, initialInactiveStudents]);

  useEffect(() => {
    setRefreshState((current) => ({
      ...current,
      capacityContext: initialCapacityContext,
    }));
  }, [initialCapacityContext]);
  function handleWelcomeMessageCopied(student) {
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
    setActionState({ pendingId: student.mmsId, savedId: '', error: '' });

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
        setActionState({ pendingId: '', savedId: '', error: payload.error || 'Waiting update failed' });
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
      setActionState({ pendingId: '', savedId: student.mmsId, error: '' });
    } catch (error) {
      setActionState({ pendingId: '', savedId: '', error: error.message || 'Waiting update failed' });
    }
  }

  async function handlePark(student) {
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
    setActionState((current) => ({
      ...current,
      savedId: current.savedId === mmsId ? '' : current.savedId,
    }));
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
              <ActionButton
                onClick={handleRefreshCapacity}
                pending={refreshState.pending}
                pendingLabel="Refreshing…"
                variant="secondary"
              >
                Refresh free slots
              </ActionButton>
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
          const saved = actionState.savedId === student.mmsId;
          const learnerSummary = buildWaitingLearnerSummary(student);
          const studentIsContact = isStudentOwnContact(student);
          const contactName = studentIsContact
            ? student.fullName || student.parentName
            : student.parentName;
          const primaryMatchDays = student.capacityMatchDays?.slice(0, 3) || [];
          const additionalMatchDays = student.capacityMatchDays?.slice(3) || [];

          return (
            <div key={student.mmsId} className="rounded-[1.6rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)] backdrop-blur-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-slate-900">{student.fullName || student.mmsId}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-700">{learnerSummary.headline}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                      {getWaitingStatusLabel(student.savedWaitingStatus)}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 font-medium ${ageBadge.className}`}>{ageBadge.label}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <CopyButton
                    text={student.welcomeGroupMessage}
                    label="Copy welcome message"
                    size="default"
                    onCopied={() => handleWelcomeMessageCopied(student)}
                  />
                  <ButtonLink
                    href={`/admin/onboard?mmsId=${encodeURIComponent(student.mmsId)}`}
                  >
                    Onboard
                  </ButtonLink>
                  <ConfirmButton
                    confirmMessage={`Park ${student.fullName || student.mmsId} from the active waiting list? (Nothing is deleted from MMS.)`}
                    onConfirm={() => handlePark(student)}
                    pending={pending}
                    pendingLabel="Parking…"
                    variant="warning"
                    icon={<Archive aria-hidden="true" className="h-4 w-4" />}
                  >
                    Park
                  </ConfirmButton>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)]">
                <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">At a glance</h4>
                  <div className="mt-2 divide-y divide-slate-200">
                    {learnerSummary.facts.map((fact) => (
                      <div key={fact.key} className="grid gap-1 py-3 first:pt-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{fact.label}</p>
                        <p className="text-sm leading-5 text-slate-800">{fact.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {studentIsContact ? 'Student contact' : 'Parent contact'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium text-slate-900">{contactName || 'Name not provided'}</span>
                      {student.contactNumber ? (
                        <a className="text-blue-700 hover:underline" href={`tel:${student.contactNumber}`}>
                          {student.contactNumber}
                        </a>
                      ) : null}
                      {student.parentEmail ? (
                        <a className="break-all text-blue-700 hover:underline" href={`mailto:${student.parentEmail}`}>
                          {student.parentEmail}
                        </a>
                      ) : null}
                      {!student.contactNumber && !student.parentEmail ? (
                        <span className="text-slate-600">No phone or email provided</span>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-800">
                        Tutors with matching free slots
                      </h4>
                      <p className="mt-1 text-xs leading-5 text-sky-900">{student.capacityMatchReason}</p>
                    </div>
                    {primaryMatchDays.length ? (
                      <span className="shrink-0 text-xs text-sky-800">Times open onboarding</span>
                    ) : null}
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
                  {primaryMatchDays.length ? (
                    <div className="mt-3">
                      <TutorDayRows student={student} days={primaryMatchDays} />
                      {additionalMatchDays.length ? (
                        <details className="mt-3 border-t border-sky-100 pt-3">
                          <summary className="cursor-pointer text-sm font-medium text-sky-900 hover:text-sky-700">
                            Show {additionalMatchDays.length} more {additionalMatchDays.length === 1 ? 'day' : 'days'}
                          </summary>
                          <div className="mt-3">
                            <TutorDayRows student={student} days={additionalMatchDays} />
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : student.capacityMatchStatus === 'instrument_unknown' ? (
                    <p className="mt-3 text-sm text-slate-700">
                      Add or clarify the instrument in the MMS sign-up note before trusting slot suggestions.
                    </p>
                  ) : null}
                </section>
              </div>

              <details
                open={student.waitingStatus === 'welcome_call_booked'}
                className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3"
              >
                <summary className="cursor-pointer text-sm font-semibold text-violet-950">
                  Welcome call pointers
                  <span className="ml-2 font-normal text-violet-800">Goals · lesson details · payment · WhatsApp and access</span>
                </summary>
                <ol className="mt-3 grid gap-2 md:grid-cols-2">
                  {WELCOME_CALL_PROMPTS.map((prompt, index) => (
                    <li key={prompt} className="flex gap-2 rounded-lg bg-white/60 px-3 py-2 text-sm leading-5 text-slate-700">
                      <span className="font-semibold text-violet-800">{index + 1}.</span>
                      <span>{prompt}</span>
                    </li>
                  ))}
                </ol>
              </details>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_14rem_auto] xl:items-end">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Waiting note</span>
                    <textarea
                      value={student.waitingNote}
                      onChange={(event) => updateLocalStudent(student.mmsId, { waitingNote: event.target.value })}
                      rows={2}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      placeholder="Called, left voicemail. Asked for Friday. Added to welcome group..."
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
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
                  <ActionButton
                    onClick={() => handleSave(student)}
                    pending={pending}
                    success={saved}
                    pendingLabel="Saving…"
                    successLabel="Saved ✓"
                    variant="secondary"
                  >
                    Save changes
                  </ActionButton>
                </div>
              </div>

              <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">
                  Original MMS sign-up
                </summary>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>MMS ID: {student.mmsId}</span>
                  <span>Added: {formatDate(student.dateStarted)}</span>
                  <span>Waiting state updated: {formatDateTime(student.waitingUpdatedAt)}</span>
                  <span>Instrument source: {student.instrumentRaw || 'Not found in MMS note'}</span>
                </div>
                {student.note ? (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    {student.note}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">No MMS sign-up note is available.</p>
                )}
              </details>
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
                    <ActionButton
                      onClick={() => handleSave(student, { status: restoreStatus })}
                      pending={pending}
                      pendingLabel="Restoring…"
                      variant="secondary"
                      className="shrink-0"
                      icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                    >
                      Return to contacted
                    </ActionButton>
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
