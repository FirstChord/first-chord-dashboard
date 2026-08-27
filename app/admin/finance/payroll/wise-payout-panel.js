'use client';

import { useState } from 'react';

// "Pay out via Wise": download the batch CSV, then (only after downloading and
// paying in Wise) flip exactly that batch to paid. The batch-paid button stays
// disabled until the CSV is downloaded this session, and confirms before firing.
export default function WisePayoutPanel({
  includedCount = 0,
  includedTutors = [],
  totalLabel = '',
  missingNames = [],
  amountConflicts = [],
  disputed = [],
  mmsChanges = [],
  confirmations = null,
  payDate,
  downloadHref,
  payrollIds = [],
  markBatchPaidAction,
  embedded = false,
}) {
  const [downloaded, setDownloaded] = useState(false);

  function confirmBatchPaid(event) {
    const ok = window.confirm(
      `Mark ${includedCount} tutor${includedCount === 1 ? '' : 's'} as paid (${totalLabel})?\n\n`
        + 'Only do this after you have downloaded the CSV, uploaded it to Wise, and approved the payment there. '
        + 'This records them as paid in the dashboard.',
    );
    if (!ok) event.preventDefault();
  }

  return (
    <section className={embedded ? '' : 'rounded-[1.6rem] border border-slate-200 bg-white/90 p-5 shadow-sm'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pay out via Wise</p>
          <p className="mt-1 text-sm text-slate-600">
            {includedCount
              ? <>Generate a Wise batch CSV for <strong>{includedCount}</strong> reviewed tutor{includedCount === 1 ? '' : 's'} · {totalLabel}.</>
              : 'Mark tutor rows reviewed to include them in a Wise batch CSV.'}
          </p>
          <p className="mt-1 text-[0.7rem] leading-4 text-slate-400">
            Order: download the CSV → upload &amp; approve in Wise → mark the batch paid. The dashboard never sends money.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {includedCount ? (
            <a
              href={downloadHref}
              onClick={() => setDownloaded(true)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Download Wise CSV
            </a>
          ) : (
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-400">
              Download Wise CSV
            </span>
          )}

          <form action={markBatchPaidAction} onSubmit={confirmBatchPaid}>
            <input type="hidden" name="payDate" value={payDate} />
            <input type="hidden" name="payrollIds" value={payrollIds.join(',')} />
            <button
              type="submit"
              disabled={!includedCount || !downloaded}
              title={!downloaded ? 'Download the Wise CSV first' : ''}
              className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
            >
              Mark batch paid{includedCount ? ` (${includedCount})` : ''}
            </button>
          </form>
        </div>
      </div>

      {includedCount && !downloaded ? (
        <p className="mt-3 text-xs text-slate-500">
          Download the CSV and pay the tutors in Wise first — then “Mark batch paid” unlocks.
        </p>
      ) : null}

      {confirmations && (confirmations.confirmed || confirmations.disputed || confirmations.awaiting) ? (
        <p className="mt-3 text-xs text-slate-500">
          Tutor confirmations: <span className="font-semibold text-emerald-700">{confirmations.confirmed} confirmed</span>
          {' · '}<span className="font-semibold text-slate-600">{confirmations.awaiting} awaiting</span>
          {confirmations.disputed ? <> · <span className="font-semibold text-rose-700">{confirmations.disputed} disputed</span></> : null}
        </p>
      ) : null}

      {disputed.length ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">Held out of this batch — a tutor flagged their statement:</p>
          <ul className="mt-1 list-disc pl-5">
            {disputed.map((entry) => (
              <li key={entry.tutor}>{entry.tutor}{entry.note ? `: “${entry.note}”` : ''}</li>
            ))}
          </ul>
          Resolve it with them, update and resend the statement if the figure changed, then ask them to confirm it.
        </div>
      ) : null}

      {mmsChanges.length ? (
        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <p className="font-semibold">Held out of this batch — refreshed MMS attendance changed:</p>
          <ul className="mt-1 list-disc pl-5">
            {mmsChanges.map((entry) => (
              <li key={entry.tutor}>
                {entry.tutor}: {entry.reviewedAmount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
                {' → '}{entry.recalculatedAmount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
              </li>
            ))}
          </ul>
          Check the lessons and save the corrected amount to include the tutor again.
        </div>
      ) : null}

      {missingNames.length ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No Wise recipient on file for {missingNames.join(', ')} — add them to the `Tutor_Wise` sheet to include them. They are not in the CSV and won’t be marked paid.
        </div>
      ) : null}

      {amountConflicts.length ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">Duplicate reviewed rows disagree on amount — the latest is used, but check before paying:</p>
          <ul className="mt-1 list-disc pl-5">
            {amountConflicts.map((conflict) => (
              <li key={conflict.tutor}>
                {conflict.tutor}: {conflict.amounts.map((amount) => `£${amount.toFixed(2)}`).join(' vs ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Currently in Ready to pay
        </p>
        {includedTutors.length ? (
          <>
            <p className="mt-1 text-xs text-slate-500">These tutors are included in the Wise CSV.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {includedTutors.map((entry) => (
                <li
                  key={entry.tutor}
                  className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-slate-900">{entry.tutor}</span>
                  <span className="font-semibold tabular-nums text-emerald-800">
                    {entry.owedAmount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No tutors are ready to pay yet.</p>
        )}
      </div>
    </section>
  );
}
