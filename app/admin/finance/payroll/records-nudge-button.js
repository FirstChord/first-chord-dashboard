'use client';

import { useState } from 'react';

export default function RecordsNudgeButton({ context }) {
  const [state, setState] = useState({ sending: false, message: '' });
  async function send() {
    if (state.sending) return;
    setState({ sending: true, message: '' });
    try {
      const response = await fetch('/api/admin/payroll/send-records-nudge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(context),
      });
      const result = await response.json();
      if (!response.ok) { setState({ sending: false, message: result.error || 'Could not send the checklist.' }); return; }
      setState({ sending: false, message: `Sent to ${result.recipient}.` });
      window.location.reload();
    } catch { setState({ sending: false, message: 'Could not confirm delivery. Check Gmail Sent before trying again.' }); }
  }
  return <div className="flex flex-col items-start gap-1">
    <button type="button" onClick={send} disabled={state.sending} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50" aria-busy={state.sending}>{state.sending ? 'Sending…' : 'Email tutor checklist'}</button>
    {state.message ? <p role="status" className="text-xs text-slate-700">{state.message}</p> : null}
  </div>;
}
