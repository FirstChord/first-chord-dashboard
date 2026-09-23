'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Copies a given string (statement text or the share link) to the clipboard,
// with a brief "Copied ✓" confirmation.
export default function CopyStatementButton({ text = '', label = 'Copy', className = '', markSentPayrollId = '' }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [markedSent, setMarkedSent] = useState(false);
  const [error, setError] = useState('');

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setHasCopied(true);
      setError('');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link. Please try again.');
    }
  }

  async function markSent() {
    if (!markSentPayrollId || !hasCopied || markingSent) return;
    setMarkingSent(true);
    setError('');
    try {
      const response = await fetch('/api/admin/payroll/statement-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payrollId: markSentPayrollId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('Could not mark the statement sent.');
      setMarkedSent(true);
      router.refresh();
    } catch (cause) {
      setError(cause.message || 'Could not mark the statement sent.');
    } finally {
      setMarkingSent(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        className={className || 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]'}
      >
        {copied ? 'Copied ✓' : label}
      </button>
      {markSentPayrollId && hasCopied ? (
        <button
          type="button"
          onClick={markSent}
          disabled={markingSent || markedSent}
          aria-busy={markingSent}
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-60"
        >
          {markedSent ? 'Marked sent ✓' : markingSent ? 'Saving…' : 'I shared this link privately'}
        </button>
      ) : null}
      {error ? <p className="w-full text-xs font-semibold text-rose-800" role="alert">{error}</p> : null}
    </div>
  );
}
