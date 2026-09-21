'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

const toneClass = {
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  attention: 'bg-blue-500',
  waiting: 'bg-slate-400',
  ready: 'bg-emerald-500',
  complete: 'bg-slate-300',
  idle: 'bg-sky-300',
};

export default function TutorSelector({ rows = [], selectedTutor = '', payDate = '' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const ordered = [...rows].sort((a, b) => `${a.tutor}`.localeCompare(`${b.tutor}`));

  function selectTutor(tutor) {
    const query = new URLSearchParams();
    if (payDate) query.set('payDate', payDate);
    query.set('tutor', tutor);
    startTransition(() => router.replace(`/admin/finance/payroll?${query.toString()}`, { scroll: false }));
  }

  return (
    <nav aria-label="Choose tutor" className={`rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-opacity ${pending ? 'opacity-70' : ''}`}>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {ordered.map((row) => {
          const selected = row.tutorShortName === selectedTutor;
          return (
            <button
              key={row.payrollId}
              type="button"
              onClick={() => selectTutor(row.tutorShortName)}
              aria-current={selected ? 'true' : undefined}
              className={`min-w-[9rem] shrink-0 rounded-xl px-3 py-2.5 text-left transition ${
                selected ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={`h-2 w-2 rounded-full ${toneClass[row.workflow?.tone] || 'bg-slate-300'}`} aria-hidden />
                {row.tutorShortName || row.tutor}
              </span>
              <span className={`mt-1 block text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{row.workflow?.label || 'Needs review'}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
