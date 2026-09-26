'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { formatPayrollDate } from '@/lib/admin/payroll-helpers.mjs';

const STORAGE_KEY = 'fc-payroll-downloaded-batch-v1';
export default function WisePayoutPanel({ includedCount = 0, includedTutors = [], totalLabel = '', missingNames = [], amountConflicts = [], disputed = [], mmsChanges = [], payDate, fingerprint, payrollIds = [] }) {
  const router = useRouter();
  const [batch, setBatch] = useState(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); if (saved?.token && saved?.tutors) setBatch(saved); } catch {}
  }, []);
  async function post(body) {
    const response = await fetch('/api/admin/payroll/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'The batch could not be prepared.');
    return result;
  }
  async function download() {
    setPending('download'); setError(''); setSuccess(false);
    try {
      const result = await post({ action: 'download', expectedFingerprint: fingerprint, expectedIds: payrollIds });
      const next = { token: result.token, tutors: result.tutors, totalAmount: result.totalAmount, csv: result.csv, payDate };
      // Persist the exact file and statement set before offering its handoff.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setBatch(next); setConfirmed(false); saveFile(next);
    } catch (cause) { setError(cause.message); } finally { setPending(''); }
  }
  function saveFile(value) {
    const url = URL.createObjectURL(new Blob([value.csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `wise-batch-${value.payDate}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function markPaid() {
    if (!confirmed || !batch) return;
    setPending('record'); setError('');
    try {
      await post({ action: 'record_paid', token: batch.token, confirmedPaid: true });
      sessionStorage.removeItem(STORAGE_KEY); setBatch(null); setConfirmed(false); setSuccess(true); router.refresh();
    } catch (cause) { setError(cause.message); } finally { setPending(''); }
  }
  const tutors = batch?.tutors || includedTutors;
  return <section className="space-y-4">
    <p className="text-sm text-slate-600">{batch ? `Downloaded batch · ${tutors.length} tutors · ${formatMoney(batch.totalAmount)}` : `${includedCount} tutor${includedCount === 1 ? '' : 's'} · ${totalLabel}`}</p>
    <ul className="divide-y divide-slate-100">{tutors.map((entry) => <li key={entry.payrollId || entry.tutor} className="flex items-center justify-between gap-4 py-3 text-sm">
      <span><span className="font-semibold text-slate-900">{entry.tutor}</span><span className="mt-1 block text-xs text-slate-500">{formatPayrollDate(entry.periodStart)}–{formatPayrollDate(entry.periodEnd)}{entry.recipientName !== entry.tutor ? ` · Wise: ${entry.recipientName}` : ''}</span></span>
      <span className="font-semibold tabular-nums">{formatMoney(entry.owedAmount)}</span>
    </li>)}</ul>
    {batch ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold">Finish this downloaded batch before preparing another.</p>
      <p className="mt-1 text-sm text-slate-600">Upload it to Wise, verify the recipients and amounts, and approve the transfers there.</p>
      <div className="mt-3 flex flex-wrap gap-3"><ActionButton variant="secondary" onClick={() => saveFile(batch)}>Download same CSV</ActionButton></div>
      <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I checked Wise and all payments in this exact batch were approved.</label>
      <ActionButton onClick={markPaid} disabled={!confirmed} pending={pending === 'record'} pendingLabel="Recording payment…">{confirmed ? 'Record batch paid' : 'Confirm the Wise payments first'}</ActionButton>
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-slate-500">File not used?</summary><p className="my-2">Only discard if none of these payments were approved in Wise. If some were paid, keep this record and reconcile those payments first.</p><ActionButton variant="quiet" onClick={() => { if (window.confirm('None of this batch was paid in Wise? Discarding does not cancel any transfer.')) { sessionStorage.removeItem(STORAGE_KEY); setBatch(null); setConfirmed(false); } }}>Discard unused file</ActionButton></details>
    </div> : <ActionButton onClick={download} disabled={!includedCount} pending={pending === 'download'} pendingLabel="Checking statements with MMS…">{includedCount ? 'Download Wise CSV' : 'No confirmed payments ready'}</ActionButton>}
    {success ? <p role="status" className="text-sm text-green-800">Payment recorded. The paid statements are now in history.</p> : null}
    {error ? <p role="alert" className="text-sm text-rose-800">{error}</p> : null}
    {missingNames.length ? <p className="text-sm text-amber-800">Wise recipient needed: {missingNames.join(', ')}. Excluded from the file.</p> : null}
    {amountConflicts.length ? <p className="text-sm text-amber-800">Conflicting reviewed amounts: {amountConflicts.map((entry) => entry.tutor).join(', ')}. Resolve before payment; excluded from the file.</p> : null}
    {disputed.length ? <p className="text-sm text-slate-600">Queries held out: {disputed.map((entry) => entry.tutor).join(', ')}.</p> : null}
    {mmsChanges.length ? <p className="text-sm text-amber-800">Attendance changed: {mmsChanges.map((entry) => entry.tutor).join(', ')}. Review the correction before payment.</p> : null}
  </section>;
}
