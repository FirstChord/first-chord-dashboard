'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CopyButton from '@/components/admin/ui/CopyButton';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { buildPayrollReminder } from '@/lib/admin/payroll-cycle-helpers.mjs';

export default function PayrollReminder({ payrollId, fingerprint, tutor, periodStart, periodEnd, statementUrl, alreadySent }) {
  const router = useRouter();
  const [revised, setRevised] = useState(false);
  const [copied, setCopied] = useState(false);
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
  return <details className="rounded-2xl border border-slate-200 bg-white p-5" id="whatsapp-reminder">
    <summary className="cursor-pointer text-sm font-semibold text-slate-800">Private WhatsApp reminder</summary>
    <p className="mt-3 text-sm text-slate-600">Send only to {tutor} in a private one-to-one chat. This link contains their pay statement.</p>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={revised} onChange={(event) => { setRevised(event.target.checked); setCopied(false); setSent(false); }} />This is a revised statement</label>
    <div className="relative mt-3 rounded-xl bg-slate-50 p-4 pt-14"><CopyButton className="absolute right-3 top-3" text={text} label="Copy reminder" onCopied={onCopied} /><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{text}</p></div>
    {copied ? <div className="mt-3 space-y-3"><a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-blue-700">Open WhatsApp →</a><p className="text-xs text-slate-500">Choose the tutor’s private chat and press Send in WhatsApp. Copying or opening does not send it.</p><ActionButton onClick={confirmSent} pending={pending} disabled={sent} success={sent} pendingLabel="Recording…" successLabel="Private message recorded ✓">I sent this privately</ActionButton></div> : null}
    {alreadySent ? <p className="mt-3 text-xs text-slate-500">The original statement delivery remains recorded. This reminder does not change confirmation or payment.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p> : null}
  </details>;
}
