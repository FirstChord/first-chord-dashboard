import Link from 'next/link';
import SaveSpendButton from '@/components/admin/SaveSpendButton';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { EXPENSE_LOG_CATEGORIES } from '@/lib/admin/cost-helpers.mjs';

function viewHref(view, extras = {}) {
  const query = new URLSearchParams({ view, ...extras });
  return `/admin/finance?${query.toString()}`;
}

function ViewNav({ active = 'overview' }) {
  const items = [
    ['overview', 'Overview'],
    ['details', 'Evidence'],
    ...(active === 'spend' ? [['spend', 'Spend']] : []),
  ];
  return (
    <nav aria-label="Finance views" className="inline-flex rounded-full border border-slate-200 bg-white/75 p-1 shadow-sm">
      {items.map(([value, label]) => (
        <Link
          key={value}
          href={viewHref(value)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${active === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function FinanceHeader({ view }) {
  const description = view === 'details'
    ? 'Underlying estimates, checks and history for investigation.'
    : view === 'spend'
      ? 'Record actual spending as it happens.'
      : 'Only proved signals and useful finance work appear here.';
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="fc-display text-3xl text-slate-900">Finance</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      <ViewNav active={view} />
    </header>
  );
}

function ActionLink({ href, children, primary = false }) {
  return (
    <Link
      href={href}
      className={`rounded-xl border px-4 py-3 text-center text-sm font-semibold transition ${primary ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
    >
      {children}
    </Link>
  );
}

function formatSignedMoney(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value))}`;
}

function formatMonth(month = '') {
  const date = new Date(`${month}-01T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatForecastLockTime(value = '') {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/London',
      });
}

const ATTRIBUTION_LABELS = {
  paused_expected_but_collected: 'Pause return was not captured',
  post_lock_onboarding: 'Joined after the prediction locked',
  invoice_occurrence_timing: 'Invoice timing / occurrence count',
  no_paid_invoice: 'Predicted, but no paid invoice',
  unmatched_collection: 'Stripe money not matched to a student',
  price_difference: 'Price differs from the dashboard assumption',
  inactive_but_collected: 'Marked inactive, but Stripe collected',
  unforecast_collection: 'Collected without a forecast item',
  unpriced_forecast: 'Dashboard could not price',
  amount_mismatch: 'Other amount difference',
};

function attributionLabel(category) {
  return ATTRIBUTION_LABELS[category] || category;
}

function ForecastInputSummary({ forecast = {} }) {
  const confidence = forecast.confidence || {};
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <p className="text-sm font-semibold text-emerald-950">{confidence.datedPauseCount || 0} dated pause return(s)</p>
        <p className="mt-1 text-xs text-emerald-800">V2 removes lessons inside the pause and restores billing after the return date.</p>
      </div>
      <div className={`rounded-2xl border p-4 ${(confidence.undatedPauseCount || confidence.missingWeekdayCount || confidence.unparsedPauseCount || confidence.unpricedCount) ? 'border-amber-100 bg-amber-50/70' : 'border-emerald-100 bg-emerald-50/70'}`}>
        <p className="text-sm font-semibold text-slate-900">Inputs worth checking</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {confidence.undatedPauseCount || 0} paused without a dated return · {confidence.missingWeekdayCount || 0} missing weekday · {confidence.unparsedPauseCount || 0} unreadable pause plan(s) · {confidence.unpricedCount || 0} unpriced
        </p>
      </div>
    </div>
  );
}

function StripeProof({ reconciliation = {}, openForecast = null }) {
  const complete = reconciliation.forecastPresent && reconciliation.actualPresent;
  const largest = (reconciliation.differences || []).slice(0, 8);
  const attribution = reconciliation.attribution || [];
  const lockTime = formatForecastLockTime(openForecast?.forecastedAt);
  const usedEarlierPauseModel = /_v1$/u.test(`${openForecast?.method || ''}`);

  return (
    <section className="rounded-[1.5rem] border border-blue-200 bg-white/90 p-5 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Stripe prediction</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">Can the dashboard predict Stripe?</h2>

      {complete ? (
        <>
          <p className="mt-2 text-sm text-slate-600">Result for {formatMonth(reconciliation.month)}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Predicted</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatMoney(reconciliation.forecastTotal)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Stripe collected</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatMoney(reconciliation.collectedTotal)}</p></div>
            <div className={`rounded-2xl p-4 ${Math.abs(reconciliation.deltaPct || 0) <= 2 ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="text-xs text-slate-500">Difference</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatSignedMoney(reconciliation.netDifference)}</p><p className="mt-1 text-xs text-slate-500">{Number.isFinite(reconciliation.deltaPct) ? `${reconciliation.deltaPct > 0 ? '+' : ''}${reconciliation.deltaPct}%` : '—'}</p></div>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Reconciliation error <strong className="text-slate-900">{Number.isFinite(reconciliation.totalAbsoluteError) ? formatMoney(reconciliation.totalAbsoluteError) : '—'}</strong>
            {' · '}{reconciliation.mismatchCount} differences
            {Number.isFinite(reconciliation.matchedCollectionPct) ? ` · ${reconciliation.matchedCollectionPct}% matched` : ''}
          </p>
          {Number.isFinite(reconciliation.modelAbsoluteError) && reconciliation.modelAbsoluteError !== reconciliation.totalAbsoluteError ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatMoney(reconciliation.modelAbsoluteError)} remains after separating students who joined after the prediction locked.
            </p>
          ) : null}
          {attribution.length ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {attribution.map((item) => (
                <div key={item.category} className={`rounded-2xl border p-4 ${item.category === 'post_lock_onboarding' ? 'border-blue-100 bg-blue-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
                  <p className="text-sm font-semibold text-slate-900">{attributionLabel(item.category)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.count} {item.category === 'unmatched_collection' ? 'invoice(s)' : 'student(s)'} · {formatMoney(item.absoluteError)} absolute difference
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {largest.length ? (
            <details className="mt-5 border-t border-slate-100 pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Check the largest differences</summary>
              <div className="mt-3 divide-y divide-slate-100">
                {largest.map((item) => (
                  <div key={item.mmsId} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:gap-5">
                    <div><Link href={`/admin/students/${encodeURIComponent(item.mmsId)}`} className="font-medium text-slate-900 hover:text-blue-700">{item.studentName || item.mmsId}</Link><p className="text-xs text-slate-500">{attributionLabel(item.category || item.status)}</p></div>
                    <p className="text-slate-500">forecast {Number.isFinite(item.expectedAmount) ? formatMoney(item.expectedAmount) : 'unpriced'} · actual {formatMoney(item.actualAmount)}</p>
                    <p className={`font-semibold tabular-nums ${item.difference > 0 ? 'text-amber-700' : 'text-rose-700'}`}>{formatSignedMoney(item.difference)}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : <p className="mt-4 text-sm font-semibold text-emerald-700">Every matched student landed on the prediction.</p>}
          {openForecast && openForecast.month !== reconciliation.month ? (
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Current frozen prediction · {formatMonth(openForecast.month)}</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <p className="text-3xl font-semibold tabular-nums text-slate-950">{formatMoney(openForecast.forecastTotal)}</p>
                <p className="text-sm text-slate-600">{openForecast.billedStudentCount} expected to bill · {openForecast.zeroExpectedCount} expected at zero</p>
              </div>
              <ForecastInputSummary forecast={openForecast} />
            </div>
          ) : null}
        </>
      ) : openForecast ? (
        <>
          <p className="mt-2 text-sm text-slate-600">Original prediction for {formatMonth(openForecast.month)}</p>
          <p className="mt-4 text-4xl font-semibold tabular-nums text-slate-950">{formatMoney(openForecast.forecastTotal)}</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            {Number.isFinite(openForecast.billedStudentCount) ? <span><strong className="text-slate-900">{openForecast.billedStudentCount}</strong> predicted to bill</span> : null}
            {Number.isFinite(openForecast.zeroExpectedCount) ? <span><strong className="text-slate-900">{openForecast.zeroExpectedCount}</strong> predicted paused or not billing</span> : null}
            {Number.isFinite(openForecast.coveragePct) ? <span><strong className="text-slate-900">{openForecast.coveragePct}%</strong> priced</span> : null}
          </div>
          <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
            <p>
              This prediction was frozen{lockTime ? ` on ${lockTime}` : ''} before Stripe was read. It is not recalculated, so the comparison stays honest.
            </p>
            {usedEarlierPauseModel ? (
              <p className="mt-2 font-medium">
                This prediction used the earlier model, which treated students marked paused as paused for the whole month. The current model now uses structured pause return dates.
              </p>
            ) : null}
            <p className="mt-2">We’ll compare this frozen prediction with Stripe after {formatMonth(openForecast.month)} closes.</p>
          </div>
          <ForecastInputSummary forecast={openForecast} />
          <details className="mt-4 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Why this number stays frozen</summary>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              One prediction is locked each month before Stripe is revealed. Model improvements affect future predictions; they never rewrite this historical test.
            </p>
          </details>
        </>
      ) : (
        <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Waiting for the first prediction to lock. No result will be claimed until a prediction predates its Stripe actuals.</p>
      )}
    </section>
  );
}

function Overview({ stripeReconciliation, openStripeForecast }) {
  return (
    <div className="space-y-5">
      <StripeProof reconciliation={stripeReconciliation} openForecast={openStripeForecast} />

      <section aria-labelledby="finance-work" className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <h2 id="finance-work" className="text-sm font-semibold text-slate-900">Finance work</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ActionLink href="/admin/finance/payroll" primary>Payroll</ActionLink>
          <ActionLink href="/admin/finance/reconciliation">Absences</ActionLink>
          <ActionLink href={viewHref('spend')}>Record spend</ActionLink>
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, value, strong = false }) {
  return <div className={`flex items-center justify-between gap-4 py-2 text-sm ${strong ? 'font-semibold text-slate-950' : 'text-slate-700'}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function DetailsView({ totals, cost, coverage, attentionItems, roster, trend }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Monthly model</h2>
          <div className="mt-3 divide-y divide-slate-100">
            <DetailRow label="Gross revenue" value={formatMoney(totals.grossRevenueMonthly)} />
            <DetailRow label="VAT" value={`−${formatMoney(totals.vatLiabilityMonthly)}`} />
            <DetailRow label="Revenue after VAT" value={formatMoney(totals.netRevenueMonthly)} strong />
            <DetailRow label={`Tutor pay · ${cost.slotCount} slots`} value={formatMoney(totals.variableMonthly)} />
            <DetailRow label="Salaries" value={formatMoney(totals.salariedMonthly)} />
            <DetailRow label="Overhead" value={formatMoney(totals.fixedMonthly)} />
            <DetailRow label="Run-rate margin" value={formatMoney(totals.marginMonthly)} strong />
          </div>
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Model health</h2>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{coverage.coveragePct ?? '—'}%</p>
          <p className="text-sm text-slate-500">{coverage.pricedCount}/{coverage.activeCount} active students priced</p>
          <div className="mt-4 divide-y divide-slate-100">
            {attentionItems.length ? attentionItems.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-4 py-2.5">
                <span className="text-sm text-slate-700">{item.title}</span>
                {item.href ? <Link href={item.href} className="text-sm font-semibold text-blue-700">Fix →</Link> : null}
              </div>
            )) : <p className="py-3 text-sm font-semibold text-emerald-700">✓ No data-quality checks</p>}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Roster · six months</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-semibold text-emerald-700">+{roster.totals.onboarded}</p><p className="text-xs text-slate-500">joined</p></div>
            <div><p className="text-2xl font-semibold text-rose-700">−{roster.totals.left}</p><p className="text-xs text-slate-500">left</p></div>
            <div><p className="text-2xl font-semibold text-slate-900">{roster.totals.net >= 0 ? '+' : ''}{roster.totals.net}</p><p className="text-xs text-slate-500">net</p></div>
          </div>
          <details className="mt-5 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Monthly rows</summary>
            <div className="mt-3 divide-y divide-slate-100">{roster.months.map((month) => <DetailRow key={month.month} label={month.month} value={`${month.net >= 0 ? '+' : ''}${month.net}`} />)}</div>
          </details>
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Billing-state trend</h2>
          <p className="mt-1 text-sm text-slate-500">Seasonal movement between active and paused—not student growth.</p>
          <div className="mt-4 divide-y divide-slate-100">
            {trend.points.slice(-6).reverse().map((point) => (
              <div key={point.periodKey} className="grid grid-cols-[1fr_auto_auto] gap-4 py-2.5 text-sm">
                <span className="text-slate-600">{point.date}</span>
                <span className="tabular-nums text-slate-700">{point.activeCount ?? '—'} active · {point.pausedCount ?? '—'} paused</span>
                <span className="font-medium tabular-nums text-slate-900">{Number.isFinite(point.activeCount) && Number.isFinite(point.pausedCount) ? point.activeCount + point.pausedCount : '—'} total</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{trend.summary.count} weekly snapshots{trend.summary.gapCount ? ` · ${trend.summary.gapCount} missing week(s)` : ''}.</p>
        </div>
      </section>
    </div>
  );
}

function SpendView({ today, spend, totals, addExpenseLogAction, deleteExpenseLogAction }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <form action={addExpenseLogAction} className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Log spend</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Date<input name="date" type="date" required max={today} defaultValue={today} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base" /></label>
          <label className="text-sm font-medium text-slate-700">Amount<input name="amount" type="number" step="0.01" required placeholder="42.50" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base" /></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Description<input name="description" required placeholder="Paint for the neighbouring room" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base" /></label>
          <label className="text-sm font-medium text-slate-700">Category<select name="category" defaultValue="Other" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base">{EXPENSE_LOG_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Area<input name="linked_area" placeholder="Room / Showcase" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input name="reimbursable" type="checkbox" className="h-4 w-4" /> Needs reimbursed</label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes<textarea name="notes" rows={2} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base" /></label>
        </div>
        <SaveSpendButton />
      </form>
      <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <p className="text-sm text-slate-500">This month</p>
        <p className="mt-1 text-4xl font-semibold text-slate-950 tabular-nums">{formatMoney(spend.monthTotal)}</p>
        <p className="mt-2 text-sm text-slate-500">Cash-view margin {formatMoney(totals.cashViewMarginMonthToDate)}</p>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Last month ({spend.previousMonth}): <strong className="text-slate-900">{formatMoney(spend.previousMonthTotal)}</strong> across {spend.previousMonthEntries.length} entr{spend.previousMonthEntries.length === 1 ? 'y' : 'ies'}.
        </p>
        {spend.futureEntries.length ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {spend.futureEntries.length} existing future-dated entr{spend.futureEntries.length === 1 ? 'y needs' : 'ies need'} correcting before it distorts a later month.
          </div>
        ) : null}
        <div className="mt-5 divide-y divide-slate-100">
          {spend.latestEntries.length ? spend.latestEntries.map((entry) => (
            <div key={entry.expenseId || `${entry.date}-${entry.description}`} className="flex items-center justify-between gap-4 py-3">
              <div><p className="text-sm font-medium text-slate-900">{entry.description}</p><p className="text-xs text-slate-500">{entry.date} · {entry.category}</p></div>
              <div className="flex items-center gap-2"><span className="font-semibold tabular-nums text-slate-900">{formatMoney(entry.amount)}</span>{entry.expenseId ? <form action={deleteExpenseLogAction}><input type="hidden" name="expense_id" value={entry.expenseId} /><button type="submit" aria-label={`Delete ${entry.description}`} className="rounded-full px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</button></form> : null}</div>
            </div>
          )) : <p className="py-4 text-sm text-slate-500">No spend logged this month.</p>}
        </div>
      </section>
    </div>
  );
}

export default function AdminFinanceView({
  view = 'overview',
  totals,
  cost,
  coverage,
  trend,
  attentionItems,
  stripeReconciliation,
  openStripeForecast,
  roster,
  spend,
  today,
  addExpenseLogAction,
  deleteExpenseLogAction,
}) {
  return (
    <div className="space-y-6">
      <FinanceHeader view={view} />
      {view === 'details' ? <DetailsView totals={totals} cost={cost} coverage={coverage} attentionItems={attentionItems} roster={roster} trend={trend} /> : null}
      {view === 'spend' ? <SpendView today={today} spend={spend} totals={totals} addExpenseLogAction={addExpenseLogAction} deleteExpenseLogAction={deleteExpenseLogAction} /> : null}
      {!['details', 'spend'].includes(view) ? <Overview stripeReconciliation={stripeReconciliation} openStripeForecast={openStripeForecast} /> : null}
    </div>
  );
}
