'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { formatPayrollDate } from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';

export default function TutorSelector({ rows = [], selectedTutor = '', payDate = '' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function selectTutor(tutor) {
    const query = new URLSearchParams({ payDate, tutor });
    startTransition(() => router.replace(`/admin/finance/payroll?${query}`, { scroll: false }));
  }
  function list(group) {
    return <ul className="divide-y divide-slate-100">{group.map((row) => (
      <li key={row.payrollId}>
        <button type="button" onClick={() => selectTutor(row.tutorShortName)} aria-current={selectedTutor === row.tutorShortName ? 'true' : undefined}
          className={`w-full rounded-xl px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700 ${selectedTutor === row.tutorShortName ? 'bg-green-50' : 'hover:bg-slate-50'}`}>
          <span className="flex justify-between gap-3 text-sm font-semibold text-slate-900"><span>{row.tutor}</span><span className="shrink-0 tabular-nums">{formatMoney(row.finalAmount)}{row.status === 'draft' ? <span className="ml-1 text-xs font-normal text-slate-500">est.</span> : null}</span></span>
          <span className="mt-1 block text-xs text-slate-500">{formatPayrollDate(row.periodStart)}–{formatPayrollDate(row.periodEnd)}</span>
          <span className={`mt-1 block text-xs ${['danger', 'warning'].includes(row.workflow.tone) ? 'text-amber-800' : 'text-slate-600'}`}>{row.workflow.label}{row.group === 'upcoming' && row.nextCadencePayDate ? ` · ${formatPayrollDate(row.nextCadencePayDate)}` : ''}</span>
        </button>
      </li>
    ))}</ul>;
  }
  return <nav aria-label="Payroll queue" aria-busy={pending} className={`space-y-4 ${pending ? 'opacity-60' : ''}`}>
    {[
      ['handle', 'To handle'], ['waiting', 'Waiting for tutors'], ['ready', 'Ready to pay'], ['upcoming', 'Upcoming'], ['history', 'Complete'],
    ].map(([key, label]) => {
      const group = rows.filter((row) => row.group === key);
      if (!group.length) return null;
      if (['upcoming', 'history'].includes(key)) return <details key={key} className="rounded-2xl border border-slate-200 bg-white p-2"><summary className="cursor-pointer px-2 py-2 text-sm text-slate-600">{label} · {group.length}</summary>{list(group)}</details>;
      return <section key={key} className="rounded-2xl border border-slate-200 bg-white p-2"><h3 className="px-2 py-2 text-xs font-semibold text-slate-500">{label} · {group.length}</h3>{list(group)}</section>;
    })}
    {!rows.some((row) => row.group === 'handle') ? <p className="px-2 text-sm text-slate-500">Nothing needs your attention here.</p> : null}
  </nav>;
}
