'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, Mic } from 'lucide-react';

// One line until a tutor wants it, then one textarea and two camera buttons.
//
// Phone-first on purpose. The photo is on the tutor's phone, not on the desktop
// beside Practice Chat, so `capture` opens the camera directly and the whole
// panel has to work at phone width. If this takes more taps than sending the
// photo on WhatsApp, it will not be used.
const ERROR_TEXT = {
  tutor_auth_not_enforced: 'Newsletter items need the signed-in dashboard. Open it from the canonical First Chord link.',
  token_required: 'This page needs refreshing before it can save.',
  token_secret_missing: 'Not available on this dashboard.',
  drive_not_configured: 'Photo upload is not switched on yet — you can still write a note.',
  unsupported_media_type: 'That file type is not supported. A photo, voice note or video, please.',
  media_too_large: 'That file is too large to upload here.',
  media_empty: 'That file looked empty.',
  too_many_media_items: 'That is as many files as one item can hold.',
  attached_failed: 'The file reached First Chord but could not be linked. Do not re-send it — tell Finn.',
  fc_identity_unresolved: 'This student is not fully set up for the newsletter yet. Tell Finn.',
  fc_identity_conflict: 'This student has an ID mismatch. Tell Finn.',
};

function errorText(code) {
  return ERROR_TEXT[code] || 'That did not save. Nothing was lost — try again.';
}

function newTicket() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default function NewsletterCapture({ student }) {
  const [issue, setIssue] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // One ticket per compose, so a retried save or upload lands on the same row
  // instead of recording the same moment twice.
  const ticketRef = useRef(newTicket());

  const studentId = student?.mms_id || '';
  const token = student?.noteAccessToken || student?.note_access_token || '';

  useEffect(() => {
    setOpen(false);
    setError('');
    setSaved(false);
    ticketRef.current = newTicket();

    if (!studentId || !token) {
      setIssue(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/newsletter/current?${new URLSearchParams({ student: studentId, token })}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setIssue(data.success && data.open ? data : null);
        setText(data?.student?.tutorText || '');
      })
      .catch(() => { if (!cancelled) setIssue(null); });
    return () => { cancelled = true; };
  }, [studentId, token]);

  if (!issue) return null;

  const mine = issue.student;
  const isPriority = Boolean(mine?.requested);
  const alreadyIn = Boolean(mine && (mine.tutorText || mine.media?.length));

  async function refresh() {
    const res = await fetch(`/api/newsletter/current?${new URLSearchParams({ student: studentId, token })}`);
    const data = await res.json();
    if (data.success && data.open) setIssue(data);
  }

  async function save({ nothing = false } = {}) {
    setBusy(nothing ? 'nothing' : 'save');
    setError('');
    try {
      const res = await fetch('/api/newsletter/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          mmsId: studentId,
          issueMonth: issue.month,
          itemId: mine?.itemId || '',
          captureTicket: mine?.itemId ? '' : ticketRef.current,
          ...(nothing ? { tutorResponse: 'nothing_this_month' } : { tutorText: text }),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(errorText(data.code)); return; }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      await refresh();
      if (nothing) setOpen(false);
    } catch {
      setError(errorText());
    } finally {
      setBusy('');
    }
  }

  async function upload(file, kind) {
    if (!file) return;
    setBusy(kind);
    setError('');
    try {
      const params = new URLSearchParams({
        student: studentId,
        token,
        issueMonth: issue.month,
        ticket: newTicket(),
      });
      if (mine?.itemId) params.set('itemId', mine.itemId);

      // The raw file as the body — no multipart — so the server can stream it
      // straight to Drive without holding a video in memory.
      const res = await fetch(`/api/newsletter/media?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!data.success) { setError(errorText(data.code)); return; }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      await refresh();
    } catch {
      setError(errorText());
    } finally {
      setBusy('');
    }
  }

  if (!open) {
    return (
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-green-200/70 bg-white/80 px-4 text-left text-sm font-semibold text-[#2F6B3D] shadow-sm transition hover:bg-white sm:w-auto"
        >
          <span>
            {alreadyIn ? 'Newsletter item added' : 'Add newsletter item'}
            {isPriority && !alreadyIn ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                Priority this month
              </span>
            ) : null}
          </span>
          {alreadyIn ? <Check aria-hidden="true" className="h-4 w-4 text-emerald-700" /> : null}
        </button>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-green-200/70 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[#2F6B3D]">
          Newsletter · {issue.monthLabel}
          {isPriority ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
              Priority
            </span>
          ) : null}
        </h3>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800">
            <Check aria-hidden="true" className="h-3.5 w-3.5" /> Saved
          </span>
        ) : null}
      </div>

      {issue.question ? (
        <p className="mt-1 text-xs italic leading-5 text-slate-600">“{issue.question}”</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {error}
        </p>
      ) : null}

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="A little win, some news, exam or piece progress…"
        className="mt-2 w-full rounded-xl border border-green-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-[#2F6B3D]/50"
      />

      {mine?.mediaSummary ? (
        <p className="mt-1.5 text-xs font-semibold text-slate-600">Attached: {mine.mediaSummary}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy === 'save'}
          onClick={() => save()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2F6B3D] px-5 text-sm font-bold text-white transition hover:bg-[#245230] disabled:opacity-60"
        >
          {busy === 'save' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          Save
        </button>

        {/* accept+capture opens the camera straight away on a phone. */}
        <FilePick
          label="Photo or video"
          icon={<Camera aria-hidden="true" className="h-4 w-4" />}
          accept="image/*,video/*"
          capture="environment"
          busy={busy === 'photo'}
          onPick={(file) => upload(file, 'photo')}
        />
        <FilePick
          label="Voice note"
          icon={<Mic aria-hidden="true" className="h-4 w-4" />}
          accept="audio/*"
          busy={busy === 'audio'}
          onPick={(file) => upload(file, 'audio')}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {isPriority && !alreadyIn ? (
          <button
            type="button"
            disabled={busy === 'nothing'}
            onClick={() => save({ nothing: true })}
            className="min-h-9 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-60"
          >
            Nothing this month
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-9 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>

      {/* Said once, at the moment a tutor is about to send a picture of a child —
          not as a standing paragraph. */}
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Photos go straight into First Chord’s Drive. Fenella asks the family before
        anything is published.
      </p>
    </section>
  );
}

function FilePick({ label, icon, accept, capture, busy, onPick }) {
  const inputRef = useRef(null);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-green-200/70 bg-white px-4 text-sm font-semibold text-[#2F6B3D] transition hover:bg-green-50 disabled:opacity-60"
      >
        {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : icon}
        {busy ? 'Sending…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change.
          event.target.value = '';
          onPick(file);
        }}
      />
    </>
  );
}
