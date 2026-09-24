import { formatPayrollDate, PAYROLL_NEW_SYSTEM_START } from '@/lib/admin/payroll-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';

function hoursLabel(minutes) {
  const m = Number(minutes) || 0;
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h${rem ? ` ${rem}m` : ''}`;
}

function recordDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `${value}`;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  });
}

function recordStatus(statement) {
  if (statement.status === 'paid' && statement.paidVia === 'manual' && statement.tutorResponse === 'disputed') return 'Paid · query raised';
  if (statement.status === 'paid' && statement.paidVia === 'manual' && !statement.tutorResponse) return 'Paid · awaiting confirmation';
  if (statement.status === 'paid') return 'Paid';
  if (statement.tutorResponse === 'confirmed') return 'Confirmed';
  if (statement.tutorResponse === 'disputed') return 'Query raised';
  if (statement.paymentRoute === 'confirmation') return 'Awaiting confirmation';
  return 'Approved';
}

// Presentational, read-only statement card. Shared by the admin view and the
// public signed-link view so the tutor sees exactly what the admin sees.
export default function TutorStatementView({ statement }) {
  if (!statement) return null;
  const lines = statement.lines || [];
  const isReceipt = statement.documentType === 'receipt' || statement.status === 'paid';
  return (
    <article className="rounded-[1.4rem] border border-slate-200 bg-white/95 p-6 shadow-sm print:break-inside-avoid print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">First Chord Music School</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{statement.isCutover ? 'Cutover ' : ''}{isReceipt ? 'payment receipt' : 'payment statement'}</h2>
          <p className="mt-1 text-lg font-semibold text-slate-800">{statement.tutor}</p>
          <p className="text-sm text-slate-500">
            {formatPayrollDate(statement.periodStart)} – {formatPayrollDate(statement.periodEnd)} · {statement.isCutover ? 'one-off cutover' : statement.cadence}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${isReceipt ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
          {recordStatus(statement)}
        </span>
      </div>

      {statement.isCutover ? (
        <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          This one-off statement closes legacy pay through {formatPayrollDate(statement.periodEnd)}. New Monday-based periods begin {formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}.
        </p>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-xs sm:grid-cols-3 print:border print:border-slate-200 print:bg-white">
        <div>
          <dt className="text-slate-400">Reference</dt>
          <dd className="mt-0.5 break-all font-semibold text-slate-700">{statement.reference || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Issued</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">{recordDate(statement.issuedAt)}</dd>
        </div>
        {statement.tutorResponse === 'confirmed' ? (
          <div>
            <dt className="text-slate-400">Confirmed</dt>
            <dd className="mt-0.5 font-semibold text-slate-700">{recordDate(statement.tutorRespondedAt)}</dd>
          </div>
        ) : null}
        {isReceipt ? (
          <div>
            <dt className="text-slate-400">Paid</dt>
            <dd className="mt-0.5 font-semibold text-slate-700">{recordDate(statement.paidAt)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
        <table className="w-full text-sm">
          <tbody>
            {lines.length ? lines.map((line, index) => (
              <tr key={`${line.date}-${index}`} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatPayrollDate(line.date, { withTime: true })}</td>
                <td className="px-4 py-2 text-slate-900">
                  {line.student}
                  {line.isGroup ? <span className="ml-1 text-slate-400">(group)</span> : null}
                  {line.isCover ? <span className="ml-1 text-slate-400">(cover)</span> : null}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{line.minutes} min</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-slate-900">{line.amount !== null ? formatMoney(line.amount) : '—'}</td>
              </tr>
            )) : (
              <tr><td className="px-4 py-3 text-slate-400">No payable lessons found for this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
        <span className="text-sm font-semibold text-slate-700">{statement.lessonCount} lessons · {hoursLabel(statement.teachingMinutes)}</span>
        <span className="text-2xl font-bold text-slate-900">{formatMoney(statement.total)}</span>
      </div>

      {statement.hasUnrecorded ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Some lessons in this period aren’t yet marked in the register, so this figure may still change.
        </p>
      ) : null}

      <p className="mt-5 text-sm text-slate-500">
        {isReceipt
          ? 'This receipt records the payment marked as paid by First Chord for the lessons above. If anything looks wrong, please tell us.'
          : 'If anything looks off, just reply and we’ll sort it before payment. Thank you!'}
      </p>
      <p className="mt-2 text-[0.7rem] leading-4 text-slate-400">
        This First Chord payment record does not replace an invoice the tutor may be required to provide.
      </p>
    </article>
  );
}
