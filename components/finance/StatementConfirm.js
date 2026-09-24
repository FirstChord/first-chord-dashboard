'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Confirm / dispute controls on the public statement link (Phase 2). Posts the
// signed token back — no login. On success it flips to a thank-you state.
export default function StatementConfirm({ token, initialResponse = '', initialNote = '', alreadyPaid = false, locked = false }) {
  const router = useRouter();
  const [response, setResponse] = useState(initialResponse);
  const [note, setNote] = useState(initialNote);
  const [showDispute, setShowDispute] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  async function submit(value) {
    setPending(value);
    setError('');
    try {
      const res = await fetch('/api/pay/statement/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, response: value, note: value === 'disputed' ? note : '' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong — please let First Chord know.');
        return;
      }
      setResponse(value);
      setShowDispute(false);
      // Refresh the server-rendered record above so a PDF saved immediately
      // after this action includes the confirmation status and date.
      router.refresh();
    } catch {
      setError('Could not reach the server — please try again.');
    } finally {
      setPending('');
    }
  }

  if (response === 'confirmed') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {alreadyPaid ? 'Thanks — you’ve confirmed the statement for the payment already made. ✓' : 'Thanks — you’ve confirmed this statement. First Chord will process your payment. ✓'}
        {!locked ? <button type="button" onClick={() => setShowDispute(true)} className="ml-2 text-emerald-800 underline">
          Actually, something’s off
        </button> : null}
        {showDispute ? <DisputeBox note={note} setNote={setNote} onSubmit={() => submit('disputed')} pending={pending === 'disputed'} /> : null}
      </div>
    );
  }

  if (response === 'disputed') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {alreadyPaid ? 'Thanks for flagging this — First Chord will review the statement and payment already made.' : 'Thanks for flagging this — First Chord has been notified and will be in touch before any payment.'}
        {!locked ? <button type="button" onClick={() => submit('confirmed')} disabled={pending === 'confirmed'} className="ml-2 text-amber-900 underline disabled:opacity-60">
          It’s fine now — confirm
        </button> : null}
      </div>
    );
  }

  if (locked) return <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">This pay record has already been settled. Contact First Chord if anything needs correcting.</div>;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 text-sm">
      <p className="font-semibold text-slate-800">Does this look right?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit('confirmed')}
          disabled={Boolean(pending)}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending === 'confirmed' ? 'Saving…' : 'Confirm — looks right'}
        </button>
        <button
          type="button"
          onClick={() => setShowDispute((open) => !open)}
          disabled={Boolean(pending)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          Something’s off
        </button>
      </div>
      {showDispute ? <DisputeBox note={note} setNote={setNote} onSubmit={() => submit('disputed')} pending={pending === 'disputed'} /> : null}
      {error ? <p className="mt-2 text-rose-700">{error}</p> : null}
    </div>
  );
}

function DisputeBox({ note, setNote, onSubmit, pending }) {
  return (
    <div className="mt-3">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What looks wrong? (e.g. a lesson missing, wrong amount)"
        rows={3}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || !note.trim()}
        className="mt-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send to First Chord'}
      </button>
    </div>
  );
}
