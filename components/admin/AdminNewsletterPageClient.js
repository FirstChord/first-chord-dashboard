'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';

const ERROR_TEXT = {
  fc_identity_unresolved: 'That student has no First Chord ID yet, so nothing can be recorded against them. Add them to the portal registry first.',
  fc_identity_conflict: 'That student’s First Chord ID differs between the Students sheet and the registry. Resolve that on Issues before using them here.',
  student_not_found: 'That student is no longer in the operational list.',
  item_not_found: 'That contribution has been removed. Reload the page.',
  invalid_deadline: 'That deadline is not a real date.',
  invalid_issue_month: 'That month is not valid.',
  consent_needed: 'Ask permission for that picture before selecting it.',
  consent_waiting: 'That permission request has not been answered yet.',
  consent_blocked: 'Permission was declined for that picture.',
  media_not_supported: 'Files cannot be uploaded yet — note that a picture exists and keep the file where it is.',
  write_failed: 'That did not save. Nothing was changed — try again.',
  read_failed: 'The newsletter could not be loaded.',
  unauthorized: 'Your session has expired. Reload the page.',
};

function errorText(code) {
  return ERROR_TEXT[code] || 'That did not save. Nothing was changed — try again.';
}

const CONSENT_ANSWER_OPTIONS = [
  { value: 'no', label: 'No' },
  { value: 'yes_once', label: 'Yes' },
  { value: 'yes_ongoing', label: 'Yes + future' },
];

// A fresh ticket per compose, so a retried save updates one row rather than
// recording the same story twice. randomUUID needs a secure context; the
// fallback only has to be unique within one session.
function newCaptureTicket() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function StateChip({ state }) {
  const tone = {
    requested: 'border-amber-200 bg-amber-50 text-amber-900',
    captured: 'border-blue-200 bg-blue-50 text-blue-900',
    declined: 'border-slate-200 bg-slate-50 text-slate-600',
    selected: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    not_selected: 'border-slate-200 bg-slate-50 text-slate-600',
    needs_review: 'border-rose-200 bg-rose-50 text-rose-900',
  }[state] || 'border-slate-200 bg-slate-50 text-slate-600';

  const label = {
    requested: 'Nothing yet',
    captured: 'Arrived',
    declined: 'Nothing this month',
    selected: 'Using',
    not_selected: 'Not using',
    needs_review: 'Needs review',
  }[state] || state;

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function CopyButton({ body, label = 'Copy', onCopied, className = '' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // Older/locked-down browsers: the textarea fallback the rest of the
      // dashboard uses.
      const area = document.createElement('textarea');
      area.value = body;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    onCopied?.();
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#2F6B3D]/30 bg-white px-3 text-sm font-semibold text-[#2F6B3D] transition hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B3D]/45 ${className}`}
    >
      {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function AdminNewsletterPageClient({ initialWorkflow }) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelection, setPickerSelection] = useState(null);
  const [addFor, setAddFor] = useState('');
  const [addText, setAddText] = useState('');
  const [addHasMedia, setAddHasMedia] = useState(false);

  const { month, monthLabel, issue, items, counts, blockers, tutorGroups, students } = workflow;

  const [question, setQuestion] = useState(issue?.question || '');
  const [deadline, setDeadline] = useState(issue?.deadline || '');

  const requestedFcIds = useMemo(
    () => new Set(items.filter((item) => item.requestedAt).map((item) => item.fcStudentId)),
    [items],
  );

  // The picker starts from whoever is currently a priority, so an accidental
  // save cannot silently drop everybody.
  const selectedMmsIds = pickerSelection ?? students
    .filter((student) => requestedFcIds.has(student.fcStudentId))
    .map((student) => student.mmsId);

  const visibleStudents = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) => (
      student.studentName.toLowerCase().includes(needle)
      || student.tutorName.toLowerCase().includes(needle)
    ));
  }, [students, pickerSearch]);

  async function send(payload, busyKey) {
    setBusy(busyKey);
    setError('');
    try {
      const response = await fetch('/api/admin/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueMonth: month, ...payload }),
      });
      const data = await response.json();
      if (!data.success) {
        setError(errorText(data.code));
        return null;
      }
      setWorkflow(data.workflow);
      return data;
    } catch {
      setError(errorText('write_failed'));
      return null;
    } finally {
      setBusy('');
    }
  }

  const priorityItems = items.filter((item) => item.requestedAt);
  const extraItems = items.filter((item) => item.isExtra);
  const reviewItems = items.filter((item) => item.state === 'needs_review' && !item.requestedAt && !item.isExtra);

  return (
    <div className="space-y-8">
      <section className="border-b border-blue-200/70 pb-7">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Regular school routines</p>
        <h2 className="mt-2 fc-display text-3xl text-slate-900">
          Newsletter{' '}
          <ScopeBadge>Nothing is sent from here</ScopeBadge>
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          {monthLabel || month}
        </p>
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {/* --- the issue itself --- */}
      <section className="space-y-4 rounded-[1.2rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
        <h3 className="text-base font-semibold text-slate-900">This month</h3>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Question of the month</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="If your life had a theme song, what would play when you walk into a room?"
              className="mt-1 w-full rounded-xl border border-blue-200/70 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Deadline</span>
            <input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-blue-200/70 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-300"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy === 'issue'}
          onClick={() => send({ mode: 'save_issue', question, deadline }, 'issue')}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#2F6B3D] px-5 text-sm font-semibold text-white transition hover:bg-[#245230] disabled:opacity-60"
        >
          {busy === 'issue' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          {issue ? 'Save' : `Open ${monthLabel || month}`}
        </button>
      </section>

      {issue ? (
        <>
          {/* --- where it stands --- */}
          <section className="space-y-3 rounded-[1.2rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            <h3 className="text-base font-semibold text-slate-900">Where it stands</h3>
            <p className="text-sm text-slate-700">
              <strong>{counts.asked}</strong> asked · <strong>{counts.arrived}</strong> arrived ·{' '}
              <strong>{counts.outstanding}</strong> outstanding · <strong>{counts.extra}</strong> extra
              {counts.selected ? <> · <strong>{counts.selected}</strong> using</> : null}
            </p>
            {blockers.length ? (
              <ul className="space-y-1 text-sm text-slate-700">
                {blockers.map((blocker) => (
                  <li key={blocker.code} className="flex gap-2">
                    <span aria-hidden="true" className="text-amber-600">•</span>
                    <span>{blocker.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm font-medium text-emerald-800">
                <span aria-hidden="true">✓</span> Nothing outstanding — ready to put together.
              </p>
            )}
          </section>

          {/* --- priorities + the message to send --- */}
          <section className="space-y-4 rounded-[1.2rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Who you asked</h3>
              <button
                type="button"
                onClick={() => { setPickerOpen((open) => !open); setPickerSelection(null); }}
                className="inline-flex min-h-9 items-center rounded-full border border-blue-200/70 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-blue-50"
              >
                {pickerOpen ? 'Close' : 'Choose students'}
              </button>
            </div>

            {pickerOpen ? (
              <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
                <input
                  type="search"
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                  placeholder="Find a student or tutor"
                  className="h-10 w-full rounded-xl border border-blue-200/70 bg-white px-3 text-sm outline-none focus:border-blue-300"
                />
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {visibleStudents.map((student) => {
                    const checked = selectedMmsIds.includes(student.mmsId);
                    const blocked = Boolean(student.identityIssue);
                    return (
                      <li key={student.mmsId}>
                        <label className={`flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm ${blocked ? 'opacity-60' : 'hover:bg-white/80'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={blocked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...selectedMmsIds, student.mmsId]
                                : selectedMmsIds.filter((id) => id !== student.mmsId);
                              setPickerSelection(next);
                            }}
                            className="h-4 w-4 shrink-0 rounded border-slate-300"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-800">{student.studentName}</span>
                          <span className="shrink-0 text-xs text-slate-500">{student.tutorName}</span>
                          {blocked ? (
                            <span className="shrink-0 text-xs font-semibold text-rose-700">no FC ID</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  disabled={busy === 'priorities'}
                  onClick={async () => {
                    const saved = await send({ mode: 'set_priorities', mmsIds: selectedMmsIds }, 'priorities');
                    if (saved) { setPickerOpen(false); setPickerSelection(null); }
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#2F6B3D] px-5 text-sm font-semibold text-white transition hover:bg-[#245230] disabled:opacity-60"
                >
                  {busy === 'priorities' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  Save priorities
                </button>
              </div>
            ) : null}

            {tutorGroups.length ? (
              <ul className="space-y-3">
                {tutorGroups.map((group) => (
                  <li key={group.tutorName} className="rounded-xl border border-blue-100 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {group.tutorName}
                        <span className="ml-2 font-normal text-slate-600">
                          {group.students.map((student) => student.studentName).join(', ')}
                        </span>
                      </p>
                      <CopyButton
                        body={group.message}
                        label="Copy message"
                        onCopied={() => logCommunicationCopy({
                          category: 'newsletter',
                          channel: 'whatsapp',
                          studentName: group.tutorName,
                          body: group.message,
                          source: 'newsletter_tutor_request',
                        })}
                      />
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-500">Preview</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">{group.message}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">No priority students chosen yet.</p>
            )}
          </section>

          {/* --- what has arrived --- */}
          <section className="space-y-4 rounded-[1.2rem] border border-blue-100 bg-white/90 p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            <h3 className="text-base font-semibold text-slate-900">Contributions</h3>

            <ItemList
              heading="Priority students"
              items={priorityItems}
              empty="Nobody chosen yet."
              workflow={workflow}
              busy={busy}
              send={send}
              addFor={addFor}
              setAddFor={setAddFor}
              addText={addText}
              setAddText={setAddText}
              addHasMedia={addHasMedia}
              setAddHasMedia={setAddHasMedia}
            />

            <ItemList
              heading="Extras that turned up"
              items={extraItems}
              empty="Nothing unprompted yet."
              workflow={workflow}
              busy={busy}
              send={send}
              addFor={addFor}
              setAddFor={setAddFor}
              addText={addText}
              setAddText={setAddText}
              addHasMedia={addHasMedia}
              setAddHasMedia={setAddHasMedia}
            />

            {reviewItems.length ? (
              <ItemList
                heading="Needs review"
                items={reviewItems}
                empty=""
                workflow={workflow}
                busy={busy}
                send={send}
                addFor={addFor}
                setAddFor={setAddFor}
                addText={addText}
                setAddText={setAddText}
                addHasMedia={addHasMedia}
                setAddHasMedia={setAddHasMedia}
              />
            ) : null}

            <AddContribution
              students={students}
              busy={busy}
              send={send}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

function ItemList({
  heading, items, empty, busy, send,
  addFor, setAddFor, addText, setAddText, addHasMedia, setAddHasMedia,
}) {
  if (!items.length && !empty) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-700">{heading}</h4>
      {items.length ? (
        <ul className="divide-y divide-blue-100/80 overflow-hidden rounded-xl border border-blue-100">
          {items.map((item) => (
            <li key={item.itemId} className="bg-white p-4">
              <ItemRow
                item={item}
                busy={busy}
                send={send}
                editing={addFor === item.itemId}
                onEdit={() => {
                  setAddFor(addFor === item.itemId ? '' : item.itemId);
                  setAddText(item.tutorText || '');
                  setAddHasMedia(item.consent.required);
                }}
                addText={addText}
                setAddText={setAddText}
                addHasMedia={addHasMedia}
                setAddHasMedia={setAddHasMedia}
                onClose={() => setAddFor('')}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">{empty}</p>
      )}
    </div>
  );
}

function ItemRow({
  item, busy, send, editing, onEdit, addText, setAddText, addHasMedia, setAddHasMedia, onClose,
}) {
  const consent = item.consent;
  const consentBusy = busy === `consent:${item.itemId}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {item.studentName}
            {item.tutorName ? <span className="ml-2 font-normal text-slate-500">{item.tutorName}</span> : null}
          </p>
          {item.tutorText ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.tutorText}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StateChip state={item.state} />
          <button
            type="button"
            onClick={onEdit}
            className="min-h-9 rounded-full border border-blue-200/70 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-blue-50"
          >
            {item.tutorText ? 'Edit' : 'Add'}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
          <textarea
            value={addText}
            onChange={(event) => setAddText(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What happened?"
            className="w-full rounded-lg border border-blue-200/70 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={addHasMedia}
              onChange={(event) => setAddHasMedia(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Includes a photo, video or voice note
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === `save:${item.itemId}`}
              onClick={async () => {
                const saved = await send({
                  mode: 'record_contribution',
                  mmsId: item.mmsId,
                  itemId: item.itemId,
                  tutorText: addText,
                  hasMedia: addHasMedia,
                }, `save:${item.itemId}`);
                if (saved) onClose();
              }}
              className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#2F6B3D] px-4 text-sm font-semibold text-white transition hover:bg-[#245230] disabled:opacity-60"
            >
              {busy === `save:${item.itemId}` ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              Save
            </button>
            {!item.tutorText && item.requestedAt ? (
              <button
                type="button"
                disabled={busy === `none:${item.itemId}`}
                onClick={async () => {
                  const saved = await send({
                    mode: 'record_contribution',
                    mmsId: item.mmsId,
                    itemId: item.itemId,
                    tutorResponse: 'nothing_this_month',
                  }, `none:${item.itemId}`);
                  if (saved) onClose();
                }}
                className="min-h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Nothing this month
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-slate-500 transition hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Permission, only when a picture is involved. */}
      {consent.required ? (
        <div className={`space-y-2 rounded-xl border p-3 ${
          consent.status === 'cleared'
            ? 'border-emerald-200 bg-emerald-50/50'
            : consent.status === 'blocked'
              ? 'border-rose-200 bg-rose-50/50'
              : 'border-amber-200 bg-amber-50/50'
        }`}>
          <p className="text-sm font-semibold text-slate-800">
            {consent.status === 'cleared'
              ? (consent.standing
                ? 'Permission on file — this family said yes to future newsletters'
                : 'Permission given for this one')
              : consent.status === 'blocked'
                ? 'Permission declined — this picture cannot be used'
                : consent.status === 'waiting'
                  ? 'Waiting for a reply'
                  : 'Permission not asked yet'}
          </p>

          {item.priorDeclines ? (
            <p className="text-xs text-slate-600">
              This family has said no {item.priorDeclines} time{item.priorDeclines === 1 ? '' : 's'} before.
            </p>
          ) : null}

          {consent.status !== 'cleared' && item.consentMessage ? (
            <>
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">Message to send</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-slate-700">{item.consentMessage}</pre>
              </details>
              <CopyButton
                body={item.consentMessage}
                label="Copy & mark asked"
                onCopied={() => {
                  logCommunicationCopy({
                    category: 'newsletter',
                    channel: 'whatsapp',
                    mmsId: item.mmsId,
                    studentName: item.studentName,
                    body: item.consentMessage,
                    source: 'newsletter_media_consent',
                  });
                  send({ mode: 'record_consent', itemId: item.itemId, asked: true }, `consent:${item.itemId}`);
                }}
              />
            </>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Answer:</span>
            {CONSENT_ANSWER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={consentBusy}
                aria-pressed={item.consentAnswer === option.value}
                onClick={() => send({
                  mode: 'record_consent',
                  itemId: item.itemId,
                  answer: option.value,
                }, `consent:${item.itemId}`)}
                className={`min-h-9 rounded-full border px-3 text-sm font-semibold transition disabled:opacity-60 ${
                  item.consentAnswer === option.value
                    ? 'border-[#2F6B3D] bg-[#2F6B3D] text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Editorial choice, only once something has actually arrived. */}
      {item.capturedAt ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Use this?</span>
          {[
            { value: 'selected', label: 'Use it' },
            { value: 'not_selected', label: 'Not this time' },
            { value: '', label: 'Undecided' },
          ].map((option) => (
            <button
              key={option.value || 'none'}
              type="button"
              disabled={busy === `editorial:${item.itemId}`}
              aria-pressed={item.editorial === option.value}
              onClick={() => send({
                mode: 'set_editorial',
                itemId: item.itemId,
                editorial: option.value,
              }, `editorial:${item.itemId}`)}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold transition disabled:opacity-60 ${
                item.editorial === option.value
                  ? 'border-[#2F6B3D] bg-[#2F6B3D] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddContribution({ students, busy, send }) {
  const [open, setOpen] = useState(false);
  const [mmsId, setMmsId] = useState('');
  const [text, setText] = useState('');
  const [hasMedia, setHasMedia] = useState(false);

  const selectable = students.filter((student) => !student.identityIssue);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-10 rounded-full border border-blue-200/70 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-blue-50"
      >
        Add something for another student
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Student</span>
        <select
          value={mmsId}
          onChange={(event) => setMmsId(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-blue-200/70 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-300"
        >
          <option value="">Choose a student…</option>
          {selectable.map((student) => (
            <option key={student.mmsId} value={student.mmsId}>
              {student.studentName}{student.tutorName ? ` — ${student.tutorName}` : ''}
            </option>
          ))}
        </select>
      </label>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="What happened?"
        className="w-full rounded-lg border border-blue-200/70 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={hasMedia}
          onChange={(event) => setHasMedia(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Includes a photo, video or voice note
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!mmsId || !text.trim() || busy === 'add'}
          onClick={async () => {
            const saved = await send({
              mode: 'record_contribution',
              mmsId,
              tutorText: text,
              hasMedia,
              captureTicket: newCaptureTicket(),
            }, 'add');
            if (saved) { setOpen(false); setMmsId(''); setText(''); setHasMedia(false); }
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#2F6B3D] px-5 text-sm font-semibold text-white transition hover:bg-[#245230] disabled:opacity-60"
        >
          {busy === 'add' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-10 rounded-full px-3 text-sm font-semibold text-slate-500 transition hover:text-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
