'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';

import { FINANCE_DIFFERENCE_LABELS } from '@/lib/admin/finance-review-labels.mjs';

export default function FinanceDifferences({ differences = [], month = '' }) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const categories = [...new Set(differences.map((item) => item.category))];
  const visible = differences.filter((item) => (category === 'all' || item.category === category)
    && `${item.studentName} ${item.mmsId}`.toLowerCase().includes(search.toLowerCase().trim()));
  return (
    <details id="review-differences" className="mt-5 border-t border-slate-100 pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Review all {differences.length} student differences</summary>
      <p className="mt-3 text-sm text-slate-600">These describe the frozen prediction and paid invoices created in {month}. Causes need checking; current student records may have changed.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Category<select className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option value={value} key={value}>{FINANCE_DIFFERENCE_LABELS[value] || value}</option>)}</select></label>
        <label className="text-sm text-slate-700">Search students<input className="mt-1 block w-full rounded-xl border border-slate-300 p-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student name" /></label>
      </div>
      <p className="mt-3 text-sm text-slate-500" role="status">Showing {visible.length} of {differences.length}</p>
      <div className="mt-3 divide-y divide-slate-100">
        {visible.map((item) => {
          const units = item.weeklyAmount > 0 && Number.isFinite(item.difference) ? Math.abs(item.difference) / item.weeklyAmount : null;
          return <div key={item.mmsId} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={`/admin/students/${encodeURIComponent(item.mmsId)}`} className="font-medium text-blue-800 underline underline-offset-4">{item.studentName || item.mmsId}</Link>
              <span className="font-semibold tabular-nums text-slate-900">{Number.isFinite(item.difference) ? `${item.difference > 0 ? '+' : item.difference < 0 ? '−' : ''}${formatMoney(Math.abs(item.difference))}` : 'Unpriced'}</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{FINANCE_DIFFERENCE_LABELS[item.category] || item.category}</p>
            <p className="mt-1 text-sm text-slate-500">Frozen forecast {formatMoney(item.expectedAmount)} · paid invoices {formatMoney(item.actualAmount)} · {item.invoiceCount} invoice(s)</p>
            <p className="mt-1 text-xs text-slate-500">{item.basis ? `Forecast basis: ${item.basis.replaceAll('_', ' ')}` : 'No forecast item'}{Number.isFinite(item.expectedOccurrences) ? ` · ${item.expectedOccurrences} predicted occurrence(s)` : ''}{item.forecastConfidence ? ` · ${item.forecastConfidence} input confidence` : ''}</p>
            {item.frozenLifecycle ? <p className="mt-1 text-xs text-slate-500">At lock: {item.frozenLifecycle} · {item.frozenExpectation}</p> : null}
            {item.frozenPauses?.length ? <p className="mt-1 text-xs text-slate-500">Frozen pause window(s): {item.frozenPauses.map((window) => window.join(' → ')).join('; ')}</p> : null}
            {item.current ? <p className="mt-2 text-xs text-blue-800">Current record: {item.current.missing ? 'not on the current roster' : `${item.current.lifecycle} · ${item.current.expectation} · ${item.current.frequency}`}</p> : null}
            {item.cachedBilling?.map((billing, index) => <p key={index} className="mt-1 text-xs text-blue-800">Cached billing: {formatMoney(billing.weekly)} normalised weekly · paused {billing.paused} · checked {billing.checkedAt}. Cached evidence may have changed since lock.</p>)}
            {item.paidDays?.length ? <p className="mt-1 text-xs text-slate-500">Invoice creation days: {item.paidDays.join(', ')}. These are not payment dates.</p> : null}
            {item.category === 'invoice_occurrence_timing' && Number.isFinite(units) ? <p className="mt-2 text-xs text-amber-800">Difference equals {Math.round(units)} lesson-price unit(s). Check billing dates, cadence, pauses and unpaid invoices before attributing the cause.</p> : null}
          </div>;
        })}
        {!visible.length ? <p className="py-4 text-sm text-slate-500">No student differences match these filters.</p> : null}
      </div>
    </details>
  );
}
