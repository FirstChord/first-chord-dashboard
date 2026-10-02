import Link from 'next/link';
import FinanceDifferences from './FinanceDifferences';
import { FINANCE_DIFFERENCE_LABELS } from '@/lib/admin/finance-review-labels.mjs';
import { SubmitButton } from '@/components/admin/ui/SubmitButton';
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

function formatForecastMethod(method = '') {
  const version = method.match(/_v(\d+)$/u)?.[1];
  return version ? `Prediction V${version}` : method || 'No locked prediction';
}

function formatForecastLockTime(value = '') {
  if (!value) return '';
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

function attributionLabel(category) {
  return FINANCE_DIFFERENCE_LABELS[category] || category;
}

function ForecastInputSummary({ forecast = {} }) {
  const confidence = forecast.confidence || {};
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <p className="text-sm font-semibold text-emerald-950">{confidence.datedPauseCount || 0} student(s) with dated pause evidence</p>
        <p className="mt-1 text-xs text-emerald-800">Dated pauses remove only lessons inside the window; billing resumes on the return date.</p>
      </div>
      <div className={`rounded-2xl border p-4 ${confidence.actionableInputCount ? 'border-amber-100 bg-amber-50/70' : 'border-emerald-100 bg-emerald-50/70'}`}>
        <p className="text-sm font-semibold text-slate-900">Inputs worth checking</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {confidence.undatedPauseCount || 0} paused without a dated return · {confidence.missingWeekdayCount || 0} missing weekday · {confidence.unknownCadenceCount || 0} unknown fortnightly pattern · {confidence.unparsedPauseCount || 0} unreadable pause plan(s) · {confidence.unpricedCount || 0} unpriced
        </p>
      </div>
    </div>
  );
}

function StripeProof({ reconciliation = {}, openForecast = null }) {
  const complete = reconciliation.forecastPresent && reconciliation.actualPresent;
  const differences = reconciliation.differences || [];
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
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Paid invoices</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatMoney(reconciliation.collectedTotal)}</p></div>
            <div className={`rounded-2xl p-4 ${Math.abs(reconciliation.deltaPct || 0) <= 2 ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="text-xs text-slate-500">Difference</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatSignedMoney(reconciliation.netDifference)}</p><p className="mt-1 text-xs text-slate-500">{Number.isFinite(reconciliation.deltaPct) ? `${reconciliation.deltaPct > 0 ? '+' : ''}${reconciliation.deltaPct}%` : '—'}</p></div>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Student-level absolute difference <strong className="text-slate-900">{Number.isFinite(reconciliation.totalAbsoluteError) ? formatMoney(reconciliation.totalAbsoluteError) : '—'}</strong>
            {Number.isFinite(reconciliation.mismatchCount) ? ` · ${reconciliation.mismatchCount} differences` : ' · individual comparison unavailable'}
            {Number.isFinite(reconciliation.matchedCollectionPct) ? ` · ${reconciliation.matchedCollectionPct}% of invoice money linked to student IDs` : ''}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">The total difference can hide overestimates and underestimates that cancel. Student-level error adds them instead; it is not money lost. Linking money to a student is not prediction accuracy.</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">Locked {formatForecastLockTime(reconciliation.forecastedAt)} · invoices refreshed {formatForecastLockTime(reconciliation.refreshedAt)} · {formatForecastMethod(reconciliation.method)}. Paid invoices are grouped by creation month, not payment date.</p>
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
                    {item.count} {item.category === 'unmatched_collection' ? 'invoice(s)' : 'student(s)'} · {formatMoney(item.absoluteError)} absolute difference · net {formatSignedMoney(item.netDifference)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {differences.length ? <FinanceDifferences differences={differences} month={reconciliation.month} /> : reconciliation.breakdownAvailable ? <p className="mt-4 text-sm font-semibold text-emerald-700">Every linked student landed on the prediction.</p> : <p className="mt-4 text-sm text-amber-800">Student breakdown unavailable; no individual accuracy result can be claimed.</p>}
          {reconciliation.unmatchedActualTotal > 0 ? <p className="mt-3 text-xs text-amber-800">{formatMoney(reconciliation.unmatchedActualTotal)} across {reconciliation.unmatchedInvoiceCount} invoices is separate from the student list. Check identifiers in Stripe; invoice references appear below when the cache retains them.</p> : null}
          {reconciliation.unmatchedInvoices?.length ? <details className="mt-3"><summary className="text-sm font-semibold text-slate-700">Review unlinked invoices</summary><div className="mt-2 space-y-2">{reconciliation.unmatchedInvoices.map((invoice) => <p className="text-sm" key={invoice.id}><a href={`https://dashboard.stripe.com/invoices/${encodeURIComponent(invoice.id)}`} className="text-blue-800 underline">{invoice.id}</a> · {formatMoney(invoice.amount)} · created day {invoice.created_day}</p>)}</div></details> : null}
          <p className="mt-3 text-sm"><Link href="/admin/finance?view=details#review-differences" className="text-blue-800 underline">Compare these differences with current records</Link></p>
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

function DetailsView({ totals, cost, coverage, attentionItems, roster, trend, completedMonth, scorecard = [], reviewReconciliation }) {
  return (
    <div className="space-y-5">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Completed month · {formatMonth(completedMonth?.month)}</h2>
        <p className="mt-2 text-sm text-slate-600">Month-end evidence is read from the logs, including spending entered after the last snapshot.</p>
        <div className="mt-3 divide-y divide-slate-100">
          <DetailRow label="Paid invoices created in this month" value={formatMoney(completedMonth?.invoiceTotal)} />
          <DetailRow label={`Logged extra spend · ${completedMonth?.spendCount || 0} entries`} value={formatMoney(completedMonth?.spendTotal)} strong />
          <DetailRow label="Spend entered after the last snapshot" value={formatMoney(completedMonth?.lateSpendTotal)} />
          <DetailRow label="Estimated monthly costs at the baseline" value={formatMoney(completedMonth?.estimatedCosts)} />
          <DetailRow label="Baseline margin less completed-month extra spend" value={formatMoney(completedMonth?.marginAfterLoggedSpend)} />
          <DetailRow label={`Payroll marked paid in this month · ${completedMonth?.payrollMarkedPaidCount || 0} runs`} value={formatMoney(completedMonth?.payrollMarkedPaidTotal)} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Baseline captured {formatForecastLockTime(completedMonth?.baselineAt)}. Costs and margin remain estimates. Payroll markers record human confirmation, not bank receipts; {completedMonth?.payrollCrossMonthCount || 0} reviewed/paid periods cross a month boundary. Actual monthly profit and available cash are not yet reconciled.</p>
      </section>
      <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Monthly prediction scorecard</h2>
        <p className="mt-2 text-sm text-slate-600">Compare completed months on their original methods. An absent prediction is a gap, not a backtest.</p>
        <div className="mt-4 space-y-4">{scorecard.map((score) => <div key={score.month} className="rounded-xl bg-slate-50 p-4">
          <p className="font-semibold text-slate-900"><Link className="underline underline-offset-4" href={viewHref('details', { month: score.month })}>{formatMonth(score.month)}</Link> · {formatForecastMethod(score.method)}</p>
          <p className="mt-1 text-sm text-slate-600">Predicted {formatMoney(score.forecastTotal)} · paid invoices {formatMoney(score.collectedTotal)} · net {formatSignedMoney(score.netDifference)} · student error {formatMoney(score.totalAbsoluteError)}</p>
          <p className="mt-1 text-xs text-slate-500">{score.breakdownAvailable ? `${score.mismatchCount} student differences` : 'Individual comparison unavailable'} · {Number.isFinite(score.unmatchedActualTotal) ? `${formatMoney(score.unmatchedActualTotal)} unlinked` : 'Unlinked amount unavailable'} · locked {formatForecastLockTime(score.forecastedAt) || 'not recorded'} · refreshed {formatForecastLockTime(score.refreshedAt) || 'not recorded'}</p>
        </div>)}</div>
      </section>
      {reviewReconciliation ? <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-900">Compare with current records</h2>{reviewReconciliation.breakdownAvailable ? <FinanceDifferences differences={reviewReconciliation.differences} month={reviewReconciliation.month} /> : <p className="mt-3 text-sm text-slate-500">The frozen prediction and invoice breakdown needed for this comparison are unavailable.</p>}</section> : null}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Current monthly model</h2>
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
          <h2 className="text-lg font-semibold text-slate-900">Roster movement · six calendar months</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-semibold text-emerald-700">+{roster.totals.onboarded}</p><p className="text-xs text-slate-500">joined</p></div>
            <div><p className="text-2xl font-semibold text-rose-700">−{roster.totals.left}</p><p className="text-xs text-slate-500">left</p></div>
            <div><p className="text-2xl font-semibold text-slate-900">{roster.totals.net >= 0 ? '+' : ''}{roster.totals.net}</p><p className="text-xs text-slate-500">net</p></div>
          </div>
          <details className="mt-5 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Monthly rows</summary>
            <div className="mt-3 divide-y divide-slate-100">{roster.months.map((month) => <DetailRow key={month.month} label={month.month} value={`${month.onboarded} joined · ${month.left} left · net ${month.net >= 0 ? '+' : ''}${month.net}`} />)}</div>
          </details>
          <p className="mt-3 text-xs leading-5 text-slate-500">Departure month uses the recorded month, then an explicit month in older archive notes. The archive date is used only when neither exists.</p>
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
        <SubmitButton className="mt-4">Save spend</SubmitButton>
      </form>
      <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <p className="text-sm text-slate-500">This month</p>
        <p className="mt-1 text-4xl font-semibold text-slate-950 tabular-nums">{formatMoney(spend.monthTotal)}</p>
        <p className="mt-2 text-sm text-slate-500">Run-rate margin less this month’s logged extra spend {formatMoney(totals.cashViewMarginMonthToDate)}</p>
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
              <div className="flex items-center gap-2"><span className="font-semibold tabular-nums text-slate-900">{formatMoney(entry.amount)}</span>{entry.expenseId ? <form action={deleteExpenseLogAction}><input type="hidden" name="expense_id" value={entry.expenseId} /><SubmitButton variant="quiet" size="compact" pendingLabel="" aria-label={`Delete ${entry.description}`} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</SubmitButton></form> : null}</div>
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
  completedMonth,
  scorecard,
  reviewReconciliation,
}) {
  return (
    <div className="space-y-6">
      <FinanceHeader view={view} />
      {view === 'details' ? <DetailsView totals={totals} cost={cost} coverage={coverage} attentionItems={attentionItems} roster={roster} trend={trend} completedMonth={completedMonth} scorecard={scorecard} reviewReconciliation={reviewReconciliation} /> : null}
      {view === 'spend' ? <SpendView today={today} spend={spend} totals={totals} addExpenseLogAction={addExpenseLogAction} deleteExpenseLogAction={deleteExpenseLogAction} /> : null}
      {!['details', 'spend'].includes(view) ? <Overview stripeReconciliation={stripeReconciliation} openStripeForecast={openStripeForecast} /> : null}
    </div>
  );
}
