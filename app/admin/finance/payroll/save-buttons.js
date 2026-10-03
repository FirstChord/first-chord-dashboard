'use client';

import { useFormStatus } from 'react-dom';
import { useState } from 'react';

// Mark reviewed / Mark paid buttons with real feedback: the clicked button
// depresses and shows a spinner + "Saving…" while the server action runs
// (useFormStatus), and once saved the button reflects the persisted state with a
// tick ("Reviewed ✓" / "Paid ✓") — the component remounts on revalidation, so
// the tick is driven by the actual saved status, not a transient toast.
export default function PayrollSaveButtons({ status, blocked = false, attendanceChanged = false }) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState('');

  const isReviewed = status === 'reviewed' || status === 'paid';

  function Spinner() {
    return (
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="flex items-end">
      <button
        name="status"
        value="reviewed"
        onClick={() => setClicked('reviewed')}
        disabled={pending || blocked}
        title={blocked ? 'Resolve the attendance, notes or period warning first' : ''}
        aria-busy={pending && clicked === 'reviewed'}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && clicked === 'reviewed' ? (
          <><Spinner /> Saving…</>
        ) : attendanceChanged ? (
          'Save corrected amount'
        ) : isReviewed ? (
          'Save changes'
        ) : (
          'Review and generate statement'
        )}
      </button>
    </div>
  );
}
