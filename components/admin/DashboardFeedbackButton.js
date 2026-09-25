'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bug, CheckCircle2, Lightbulb, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TYPES = [
  {
    value: 'glitch',
    label: 'Something’s broken',
    icon: Bug,
    placeholder: 'What went wrong, and what were you trying to do?',
  },
  {
    value: 'improvement',
    label: 'Could be better',
    icon: Lightbulb,
    placeholder: 'What feels awkward, slow, confusing, or missing?',
  },
];

export default function DashboardFeedbackButton() {
  const pathname = usePathname();
  const triggerRef = useRef(null);
  const textareaRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('glitch');
  const [message, setMessage] = useState('');
  const [state, setState] = useState({ pending: false, error: '', report: null });
  const selectedType = TYPES.find((entry) => entry.value === type) || TYPES[0];

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    function onKeyDown(event) {
      if (event.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  // `close` only uses stable state setters and the trigger ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The login screen shares the admin layout, but there is no authenticated
  // creator yet and middleware will refuse the write. Do not offer a dead-end
  // report control until the admin is inside the dashboard.
  if (pathname === '/admin/login') return null;

  function show() {
    setState({ pending: false, error: '', report: null });
    setOpen(true);
  }

  function close() {
    const wasSaved = Boolean(state.report);
    setOpen(false);
    setState({ pending: false, error: '', report: null });
    if (wasSaved) {
      setMessage('');
      setType('glitch');
    }
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  async function submit(event) {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setState({ pending: false, error: 'Add a short description before sending.', report: null });
      textareaRef.current?.focus();
      return;
    }

    setState({ pending: true, error: '', report: null });
    try {
      const response = await fetch('/api/admin/dashboard-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: cleanMessage, pagePath: pathname || '/admin' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'The report could not be saved.');
      }
      setState({ pending: false, error: '', report: data.report });
      setMessage('');
    } catch (error) {
      setState({ pending: false, error: error.message || 'The report could not be saved.', report: null });
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300/80 bg-amber-50/90 px-3 text-sm font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
      >
        <Bug className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Report a glitch</span>
        <span className="sm:hidden">Report</span>
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/35 p-4 pt-[10vh] backdrop-blur-[1px] sm:items-center sm:pt-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-feedback-title"
            className="w-full max-w-lg rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Quick report</p>
                <h2 id="dashboard-feedback-title" className="mt-1 text-xl font-semibold text-slate-950">
                  What did you notice?
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  We’ll attach this page and put the note into Planning for triage.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close report"
                className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {state.report ? (
              <div className="mt-6" aria-live="polite">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
                    <div>
                      <p className="font-semibold text-emerald-950">Saved for triage</p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        It’s now in Planning → Dashboard reports, where it can be fixed, clarified, or parked.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Done
                  </button>
                  <Link
                    href="/admin/planning?filter=dashboard_feedback"
                    onClick={close}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    View reports
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <fieldset>
                  <legend className="text-sm font-semibold text-slate-800">What kind of note is this?</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {TYPES.map((entry) => {
                      const Icon = entry.icon;
                      const selected = type === entry.value;
                      return (
                        <label
                          key={entry.value}
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                            selected
                              ? 'border-amber-400 bg-amber-50 text-amber-950'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="dashboard-feedback-type"
                            value={entry.value}
                            checked={selected}
                            onChange={() => setType(entry.value)}
                            className="sr-only"
                          />
                          <Icon className="h-4 w-4" aria-hidden />
                          {entry.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-800">A quick description</span>
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    rows={6}
                    placeholder={selectedType.placeholder}
                    className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>Page attached: {pathname || '/admin'}</span>
                  {message.length > 1_600 ? <span>{message.length.toLocaleString('en-GB')} / 2,000</span> : null}
                </div>

                {state.error ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={state.pending}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={state.pending || !message.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {state.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {state.pending ? 'Saving…' : 'Save report'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
