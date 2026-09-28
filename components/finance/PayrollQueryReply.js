'use client';

import { useState } from 'react';
import CopyButton from '@/components/admin/ui/CopyButton';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { buildPayrollQueryReply } from '@/lib/admin/payroll-cycle-helpers.mjs';
import { buildWhatsappShareUrl } from '@/lib/admin/incoming-message-helpers.mjs';

export default function PayrollQueryReply({ payrollId, fingerprint, tutor, periodStart, periodEnd }) {
  const [text, setText] = useState(() => buildPayrollQueryReply({ tutor, periodStart, periodEnd }));
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function record(action) {
    const response = await fetch('/api/admin/payroll/reminder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payrollId, fingerprint, action }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not record the WhatsApp handoff.');
  }

  async function onCopied() {
    setCopied(true); setError('');
    try { await record('query_copied'); } catch (cause) { setError(`Copied, but ${cause.message}`); }
  }

  async function confirmSent() {
    setPending(true); setError('');
    try { await record('query_sent'); setSent(true); }
    catch (cause) { setError(cause.message); } finally { setPending(false); }
  }

  return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5" id="whatsapp-query">
    <h3 className="text-sm font-semibold text-amber-950">Reply to the tutor’s query in WhatsApp</h3>
    <p className="mt-2 text-sm text-amber-900">Check or edit this reply before opening WhatsApp, or reply by email as usual. This message does not include the queried statement link or mark the query resolved.</p>
    <label className="mt-3 block text-sm font-medium text-amber-950" htmlFor="payroll-query-reply">Message for {tutor}</label>
    <textarea id="payroll-query-reply" rows={6} value={text} maxLength={1200} onChange={(event) => { setText(event.target.value); setCopied(false); setOpened(false); setSent(false); }} className="mt-2 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm leading-6 text-slate-800" />
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {text.trim() ? <a href={buildWhatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" onClick={() => { setOpened(true); setError(''); }} className="inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open WhatsApp with reply →</a>
        : <span aria-disabled="true" className="inline-flex min-h-10 items-center rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500">Write a reply first</span>}
      <CopyButton text={text} label="Copy reply" onCopied={onCopied} />
    </div>
    <p className="mt-2 text-xs text-amber-900">Choose {tutor}’s private one-to-one chat, then press Send in WhatsApp. Do not share the disputed statement in a group.</p>
    {copied || opened ? <div className="mt-3"><ActionButton onClick={confirmSent} pending={pending} disabled={sent} success={sent} pendingLabel="Recording…" successLabel="Reply recorded ✓">I sent this privately</ActionButton></div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p> : null}
  </section>;
}
