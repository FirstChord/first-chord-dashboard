'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RecordsNudgeButton({ context, allowDeferred = false, alreadySent = false, approval = null }) {
  const router = useRouter();
  const [sendWhenReady, setSendWhenReady] = useState(false);
  const [state, setState] = useState({ sending: false, message: '' });
  async function send() {
    if (state.sending) return;
    setState({ sending: true, message: '' });
    try {
      const response = await fetch(approval ? '/api/admin/payroll/cancel-deferred' : '/api/admin/payroll/send-records-nudge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(approval ? { id: approval.id } : { ...context, sendWhenReady: alreadySent || sendWhenReady }),
      });
      const result = await response.json();
      if (!response.ok) { setState({ sending: false, message: result.error || (approval ? 'Could not cancel the approval.' : 'Could not send the checklist.') }); return; }
      setState({ sending: false, message: approval ? 'Automatic send cancelled.' : result.deferred ? 'Approved for this period. Waiting for complete records.' : `Sent to ${result.recipient}.` });
      router.refresh();
    } catch { setState({ sending: false, message: approval ? 'Could not confirm cancellation. Refresh before continuing.' : 'Could not confirm delivery. Check Gmail Sent before trying again.' }); }
  }
  return <div className="flex flex-col items-start gap-1">
    {allowDeferred && !alreadySent && !approval ? <label className="mb-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={sendWhenReady} onChange={(event) => setSendWhenReady(event.target.checked)} disabled={state.sending} />Send this period’s statement once records are complete</label> : null}
    <button type="button" onClick={send} disabled={state.sending} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50" aria-busy={state.sending}>{state.sending ? (approval ? 'Cancelling…' : 'Sending…') : approval ? 'Cancel automatic send' : alreadySent ? 'Approve send when ready' : sendWhenReady ? 'Ask for records, then send when ready' : 'Email tutor checklist'}</button>
    {state.message ? <p role="status" className="text-xs text-slate-700">{state.message}</p> : null}
  </div>;
}
