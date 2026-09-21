'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SendStatementEmailButton({
  payrollId = '',
  recipient = '',
  verified = false,
  deliveryStatus = '',
  sentAt = '',
} = {}) {
  const router = useRouter();
  const [state, setState] = useState({ sending: false, message: '', error: '' });
  const needsFollowUp = ['sending', 'unknown'].includes(deliveryStatus);

  if (sentAt || ['sent', 'manual'].includes(deliveryStatus)) {
    return <p className="text-sm font-semibold text-emerald-800">Sent ✓ {recipient ? `to ${recipient}` : ''}</p>;
  }
  if (needsFollowUp) {
    return <p className="text-sm font-semibold text-amber-800">Check the musiclessons@ Sent folder before retrying; the previous Gmail result is uncertain.</p>;
  }
  if (!recipient || !verified) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-amber-800">{recipient ? 'Verify this payroll email before sending.' : 'Add this tutor’s payroll contact email first.'}</p>
        <Link href="/admin/finance/payroll/settings" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Open delivery settings</Link>
      </div>
    );
  }

  async function sendEmail() {
    if (state.sending) return;
    setState({ sending: true, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/payroll/send-statement-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payrollId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (['delivery_unknown', 'manual_follow_up'].includes(data.reason)) router.refresh();
        throw new Error(data.error || 'The email could not be sent.');
      }
      setState({ sending: false, message: `Sent to ${data.recipient}.`, error: '' });
      router.refresh();
    } catch (error) {
      setState({ sending: false, message: '', error: error.message });
    }
  }

  return (
    <div>
      <button type="button" onClick={sendEmail} disabled={state.sending} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
        {state.sending ? 'Sending…' : `Send email to ${recipient}`}
      </button>
      <p className="mt-2 text-xs text-slate-500">This page is the final preview. One click sends the private link; it never pays the tutor.</p>
      {state.message ? <p className="mt-2 text-xs font-semibold text-emerald-800" role="status">{state.message}</p> : null}
      {state.error ? <p className="mt-2 text-xs font-semibold text-rose-800" role="alert">{state.error}</p> : null}
    </div>
  );
}
