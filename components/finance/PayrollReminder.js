'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CopyButton from '@/components/admin/ui/CopyButton';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { buildPayrollReminder } from '@/lib/admin/payroll-cycle-helpers.mjs';
import { buildWhatsappShareUrl } from '@/lib/admin/incoming-message-helpers.mjs';

export default function PayrollReminder({ payrollId, fingerprint, tutor, periodStart, periodEnd, statementUrl, alreadySent }) {
  const router = useRouter();
  const [revised, setRevised] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const text = buildPayrollReminder({ tutor, periodStart, periodEnd, statementUrl, revised });
  async function record(action) {
    const response = await fetch('/api/admin/payroll/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payrollId, fingerprint, action, revised }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not record the reminder.');
  }
  async function onCopied() {
    setCopied(true); setError('');
    try { await record('copied'); } catch (cause) { setError(`Copied, but ${cause.message}`); }
  }
  async function confirmSent() {
    setPending(true); setError('');
    try { await record('sent'); setSent(true); router.refresh(); }
    catch (cause) { setError(cause.message); } finally { setPending(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5" id="whatsapp-reminder">
    <h3 className="text-sm font-semibold text-slate-800">Private WhatsApp reminder</h3>
    <p className="mt-2 text-sm text-slate-600">Check the message, then choose {tutor}’s private one-to-one chat. The link contains their pay statement; never post it in a group.</p>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={revised} onChange={(event) => { setRevised(event.target.checked); setCopied(false); setOpened(false); setSent(false); }} />This is a revised statement</label>
    <details className="mt-3 rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">Preview message and private link</summary><div className="relative mt-3 pt-12"><CopyButton className="absolute right-0 top-0" text={text} label="Copy reminder" onCopied={onCopied} /><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{text}</p></div></details>
    <a href={buildWhatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" onClick={() => { setOpened(true); setError(''); }} className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open WhatsApp with message →</a>
    <p className="mt-2 text-xs text-slate-500">WhatsApp opens with the message filled in. Choose the private chat and press Send there; opening this link does not send it.</p>
    {copied || opened ? <div className="mt-3"><ActionButton onClick={confirmSent} pending={pending} disabled={sent} success={sent} pendingLabel="Recording…" successLabel="Private message recorded ✓">I sent this privately</ActionButton></div> : null}
    {alreadySent ? <p className="mt-3 text-xs text-slate-500">The original statement delivery remains recorded. This reminder does not change confirmation or payment.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p> : null}
  </section>;
}
