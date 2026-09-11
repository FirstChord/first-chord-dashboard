'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, KeyRound, Loader2, Search } from 'lucide-react';
import {
  buildNotesGroupDescription,
  buildNotesRolloutMessage,
  canActivateNotesAccess,
  deriveNotesAccessProgress,
  redactNotesCodeFromMessage,
} from '@/lib/admin/student-notes-access-helpers.mjs';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy';

const FILTERS = [
  ['working', 'Working queue'],
  ['mine', 'Mine'],
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['needs_follow_up', 'Follow-up'],
  ['completed', 'Completed'],
  ['all', 'All'],
];

function statusLabel(state) {
  if (state.workflowStatus === 'completed' && state.protectionEnabled) return 'Protected';
  if (state.workflowStatus === 'needs_follow_up') return 'Needs follow-up';
  if (state.pendingCredentialId) {
    const done = Number(Boolean(state.descriptionConfirmedAt)) + Number(Boolean(state.messageSentAt));
    return `${done} of 2 confirmations`;
  }
  if (state.workflowStatus === 'in_progress') return 'Started';
  return 'Not started';
}

function statusClasses(state) {
  if (state.workflowStatus === 'completed' && state.protectionEnabled) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (state.workflowStatus === 'needs_follow_up') return 'border-amber-200 bg-amber-50 text-amber-950';
  if (state.workflowStatus === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

export default function AdminStudentNotesAccessPageClient({
  initialWorkflow,
  actorEmail,
  initialStudentMmsId = '',
}) {
  const [records, setRecords] = useState(initialWorkflow.records || []);
  const initialSelected = records.find((record) => record.student.mmsId === initialStudentMmsId)?.student.mmsId
    || records.find((record) => record.state.workflowStatus !== 'completed')?.student.mmsId
    || records[0]?.student.mmsId
    || '';
  const [selectedMmsId, setSelectedMmsId] = useState(initialSelected);
  const [filter, setFilter] = useState('working');
  const [query, setQuery] = useState('');
  const [codes, setCodes] = useState({});
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');

  const progress = deriveNotesAccessProgress(records);
  const selected = records.find((record) => record.student.mmsId === selectedMmsId) || records[0] || null;
  const code = selected ? codes[selected.student.mmsId] || '' : '';
  const claimedByMe = Boolean(selected && selected.state.claimedBy === actorEmail);
  const message = selected && code
    ? buildNotesRolloutMessage({
        studentName: selected.student.studentName,
        code,
        friendlyUrl: selected.student.friendlyUrl,
        reset: selected.state.protectionEnabled,
      })
    : '';

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesSearch = !search || [
        record.student.studentName,
        record.student.parentName,
        record.student.tutorName,
        record.student.mmsId,
      ].join(' ').toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      if (filter === 'working') return record.state.workflowStatus !== 'completed';
      if (filter === 'mine') return record.state.claimedBy === actorEmail;
      return record.state.workflowStatus === filter;
    });
  }, [records, filter, query, actorEmail]);

  function updateRecord(state) {
    setRecords((current) => current.map((record) => (
      record.student.mmsId === state.studentMmsId ? { ...record, state } : record
    )));
  }

  async function perform(action, extras = {}) {
    if (!selected) return null;
    setPendingAction(action);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/student-notes-rollout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentMmsId: selected.student.mmsId,
          action,
          expectedUpdatedAt: selected.state.updatedAt,
          pendingCredentialId: selected.state.pendingCredentialId,
          ...extras,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || 'Action failed');
        return null;
      }
      updateRecord(payload.state);
      if (payload.code) {
        setCodes((current) => ({ ...current, [selected.student.mmsId]: payload.code }));
      }
      if (payload.auditWarning) setNotice(payload.auditWarning);
      else setNotice('Saved');

      if (action === 'activate') {
        setCodes((current) => ({ ...current, [selected.student.mmsId]: '' }));
        const next = records.find((record) => (
          record.student.mmsId !== selected.student.mmsId
          && record.state.workflowStatus !== 'completed'
        ));
        if (next) setSelectedMmsId(next.student.mmsId);
      }
      return payload;
    } catch (requestError) {
      setError(requestError.message || 'Action failed');
      return null;
    } finally {
      setPendingAction('');
    }
  }

  async function handleCopy(kind, value) {
    await copyText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? '' : current)), 1800);
    if (kind === 'message' && selected) {
      logCommunicationCopy({
        category: 'parent',
        channel: 'whatsapp',
        mmsId: selected.student.mmsId,
        studentName: selected.student.studentName,
        body: redactNotesCodeFromMessage(value, code),
        source: 'student_notes_rollout',
      });
    }
  }

  if (!selected) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Student Notes Privacy</h2>
        <p className="mt-2 text-sm text-slate-600">No eligible student profiles were found.</p>
      </section>
    );
  }

  return (
    <div className="space-y-7">
      <section>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Summer rollout</p>
        <h2 className="mt-2 fc-display text-3xl text-slate-900">Student Notes Privacy</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Work through each family, put their code in the WhatsApp group description, explain the change, then activate the notes lock.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Protected', progress.completed, 'border-emerald-200 bg-emerald-50'],
          ['In progress', progress.inProgress, 'border-blue-200 bg-blue-50'],
          ['Remaining', progress.remaining, 'border-slate-200 bg-white'],
          ['Needs follow-up', progress.followUp, 'border-amber-200 bg-amber-50'],
        ].map(([label, value, classes]) => (
          <div key={label} className={`rounded-2xl border p-5 ${classes}`}>
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
            {label === 'Protected' ? <p className="mt-1 text-xs text-slate-500">of {progress.total} profiles</p> : null}
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search student or tutor"
              className="min-w-0 flex-1 text-sm outline-none"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  filter === value ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Showing {filteredRecords.length} of {records.length}</p>
          <div className="mt-4 max-h-[720px] space-y-2 overflow-auto">
            {filteredRecords.map((record) => (
              <button
                key={record.student.mmsId}
                type="button"
                onClick={() => {
                  setSelectedMmsId(record.student.mmsId);
                  setError('');
                  setNotice('');
                  setFollowUpNote(record.state.followUpNote || '');
                }}
                className={`w-full rounded-xl border p-3 text-left ${
                  record.student.mmsId === selected.student.mmsId ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{record.student.studentName}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(record.state)}`}>
                    {statusLabel(record.state)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{record.student.tutorName || 'Tutor unknown'}</p>
                {record.state.claimedBy ? <p className="mt-1 truncate text-xs text-slate-500">With {record.state.claimedBy}</p> : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-5">
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{selected.student.studentName}</h3>
                {selected.student.isTestStudent ? (
                  <span className="mt-2 inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900">
                    Test student
                  </span>
                ) : null}
                <p className="mt-1 text-sm text-slate-600">
                  {selected.student.parentName || 'Parent not recorded'} · {selected.student.tutorName || 'Tutor unknown'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {selected.student.friendlyUrl ? `firstchord.co.uk/${selected.student.friendlyUrl}` : selected.student.mmsId}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/students/${selected.student.mmsId}`}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Student record
                </Link>
                {selected.student.friendlyUrl ? (
                  <a
                    href={`/${selected.student.friendlyUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    Open profile
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          {error || notice ? (
            <div className={`rounded-xl border p-4 text-sm ${error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
              {error || notice}
            </div>
          ) : null}

          {!selected.state.claimedBy ? (
            <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <h3 className="font-semibold text-blue-950">1. Claim this family</h3>
              <p className="mt-2 text-sm text-blue-900">This lets the rest of the team see that you are handling it.</p>
              <button
                type="button"
                onClick={() => perform('claim')}
                disabled={Boolean(pendingAction)}
                className="mt-4 rounded-full bg-blue-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pendingAction === 'claim' ? 'Starting…' : 'Start this student'}
              </button>
            </section>
          ) : !claimedByMe ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h3 className="font-semibold text-amber-950">Currently with {selected.state.claimedBy}</h3>
              <p className="mt-2 text-sm text-amber-900">Take over only if you have agreed to continue this family.</p>
              <button
                type="button"
                onClick={() => perform('takeover')}
                disabled={Boolean(pendingAction)}
                className="mt-4 rounded-full border border-amber-300 bg-white px-5 py-2 text-sm font-semibold text-amber-950"
              >
                Take over
              </button>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">2. Prepare the access code</h3>
                    <p className="mt-1 text-sm text-slate-600">Codes can be revealed again by authenticated administrators.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => perform('release')}
                    disabled={Boolean(pendingAction)}
                    className="text-sm text-slate-500 underline"
                  >
                    Release claim
                  </button>
                </div>
                {!selected.state.pendingCredentialId ? (
                  <div className="mt-4 space-y-3">
                    {code ? (
                      <code className="inline-block rounded-xl bg-slate-100 px-4 py-3 text-lg font-semibold text-slate-900">
                        {code}
                      </code>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {selected.state.protectionEnabled && !code ? (
                        <button
                          type="button"
                          onClick={() => perform('reveal')}
                          disabled={Boolean(pendingAction)}
                          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium"
                        >
                          Reveal current code
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => perform('generate')}
                        disabled={Boolean(pendingAction)}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        <KeyRound className="h-4 w-4" />
                        {selected.state.protectionEnabled ? 'Generate replacement code' : 'Generate code'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="rounded-xl bg-slate-100 px-4 py-3 text-lg font-semibold text-slate-900">
                        {code || 'Code hidden'}
                      </code>
                      {!code ? (
                        <button type="button" onClick={() => perform('reveal')} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium">
                          Reveal code
                        </button>
                      ) : null}
                      <button type="button" onClick={() => perform('generate')} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium">
                        Replace code
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {selected.state.pendingCredentialId ? (
                <>
                  <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-900">3. Update the WhatsApp group description</h3>
                    {code ? (
                      <button
                        type="button"
                        onClick={() => handleCopy('description', buildNotesGroupDescription(code, selected.student.friendlyUrl))}
                        className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm"
                      >
                        <span className="whitespace-pre-line">{buildNotesGroupDescription(code, selected.student.friendlyUrl)}</span>
                        {copied === 'description' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                    ) : <p className="mt-3 text-sm text-amber-800">Reveal the code before copying the description.</p>}
                    <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(selected.state.descriptionConfirmedAt)}
                        disabled={Boolean(selected.state.descriptionConfirmedAt || pendingAction)}
                        onChange={() => perform('confirm_description')}
                        className="mt-0.5 h-4 w-4 rounded"
                      />
                      <span>I have saved this code in the family’s WhatsApp group description.</span>
                    </label>
                  </section>

                  <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-900">4. Explain the change</h3>
                    {message ? (
                      <>
                        <div className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{message}</div>
                        <button
                          type="button"
                          onClick={() => handleCopy('message', message)}
                          className="mt-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900"
                        >
                          {copied === 'message' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {copied === 'message' ? 'Copied' : 'Copy WhatsApp message'}
                        </button>
                      </>
                    ) : <p className="mt-3 text-sm text-amber-800">Reveal the code to prepare the family message.</p>}
                    <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(selected.state.messageSentAt)}
                        disabled={Boolean(selected.state.messageSentAt || pendingAction)}
                        onChange={() => perform('confirm_sent')}
                        className="mt-0.5 h-4 w-4 rounded"
                      />
                      <span>I have sent this message to the family’s WhatsApp group.</span>
                    </label>
                  </section>

                  <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <h3 className="font-semibold text-emerald-950">5. Activate and complete</h3>
                    <p className="mt-2 text-sm text-emerald-900">
                      Activation locks only Practice Chat notes. The profile link and everything else stay unchanged.
                    </p>
                    <button
                      type="button"
                      onClick={() => perform('activate')}
                      disabled={!canActivateNotesAccess(selected.state) || Boolean(pendingAction)}
                      className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-800 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {pendingAction === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Activate notes and mark complete
                    </button>
                  </section>
                </>
              ) : null}

              {selected.state.workflowStatus !== 'completed' ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-semibold text-amber-950">Cannot finish this family?</h3>
                  <textarea
                    value={followUpNote}
                    onChange={(event) => setFollowUpNote(event.target.value)}
                    rows={2}
                    placeholder="Missing WhatsApp group, contact needs checking…"
                    className="mt-3 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => perform('needs_follow_up', { followUpNote })}
                    disabled={Boolean(pendingAction)}
                    className="mt-3 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                  >
                    Mark needs follow-up
                  </button>
                </section>
              ) : null}
            </>
          )}
        </main>
      </section>
    </div>
  );
}
