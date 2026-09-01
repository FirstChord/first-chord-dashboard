/** @fileoverview Executable HTTP boundary for the scheduled Stripe cache job. */

import { authenticateFinanceCronRequest } from './finance-cron-auth.mjs';
import { ensureMonthlyStripeForecast } from './stripe-forecast-helpers.mjs';

function requireFunction(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

export function createStripeAmountsPostHandler({
  getSecret,
  now = () => new Date(),
  getForecastRows,
  buildForecastRow,
  appendForecastRow,
  ensureForecast = ensureMonthlyStripeForecast,
  getStudents,
  getArchivedStudents,
  fetchSubscriptions,
  buildCacheRows,
  replaceCacheRows,
  previousMonth,
  fetchPaidInvoices,
  summariseInvoices,
  upsertCollectedMonth,
} = {}) {
  requireFunction('now', now);
  requireFunction('getForecastRows', getForecastRows);
  requireFunction('buildForecastRow', buildForecastRow);
  requireFunction('appendForecastRow', appendForecastRow);
  requireFunction('ensureForecast', ensureForecast);
  requireFunction('getStudents', getStudents);
  requireFunction('fetchSubscriptions', fetchSubscriptions);
  requireFunction('buildCacheRows', buildCacheRows);
  requireFunction('replaceCacheRows', replaceCacheRows);
  requireFunction('previousMonth', previousMonth);
  requireFunction('fetchPaidInvoices', fetchPaidInvoices);
  requireFunction('summariseInvoices', summariseInvoices);
  requireFunction('upsertCollectedMonth', upsertCollectedMonth);

  return async function stripeAmountsPost(request) {
    const authError = authenticateFinanceCronRequest(request, { getSecret });
    if (authError) return authError;

    try {
      const at = now();
      // This ordering is the integrity boundary for the blind test. The monthly
      // dashboard-only forecast must be durably locked before any Stripe read is
      // allowed to reveal subscription or invoice facts.
      const forecast = await ensureForecast({
        at,
        getForecastRows,
        buildForecastRow,
        appendForecastRow,
      });
      const month = previousMonth(at);
      const [students, archivedStudents, subscriptions, invoices] = await Promise.all([
        getStudents(),
        typeof getArchivedStudents === 'function' ? getArchivedStudents() : Promise.resolve([]),
        fetchSubscriptions(),
        fetchPaidInvoices(month),
      ]);

      const {
        rows,
        unmatchedStudents,
        unmatchedSubscriptions,
      } = buildCacheRows(subscriptions, students, { now: at });
      const collected = summariseInvoices(invoices, { month, students, archivedStudents });

      // Complete every provider read before mutating either cache. A Stripe read
      // failure therefore leaves both Sheets lanes at their previous refresh.
      await replaceCacheRows(rows);
      await upsertCollectedMonth({
        month: collected.month,
        collected_total: collected.collectedTotal,
        invoice_count: collected.invoiceCount,
        matched_total: collected.matchedTotal,
        matched_invoice_count: collected.matchedInvoiceCount,
        unmatched_total: collected.unmatchedTotal,
        unmatched_invoice_count: collected.unmatchedInvoiceCount,
        student_breakdown_json: JSON.stringify(collected.studentBreakdown || []),
        currency: 'gbp',
        refreshed_at: at.toISOString(),
      });

      return Response.json({
        success: true,
        forecastMonth: forecast.row?.month || '',
        forecastLocked: true,
        forecastSkipped: forecast.skipped,
        cachedStudents: rows.length,
        unmatchedStudents,
        unmatchedSubscriptions,
        collectedMonth: collected.month,
        collectedTotal: collected.collectedTotal,
        invoiceCount: collected.invoiceCount,
        unmatchedTotal: collected.unmatchedTotal,
        unmatchedInvoiceCount: collected.unmatchedInvoiceCount,
      });
    } catch (error) {
      return Response.json(
        { error: error?.message || 'Stripe amounts refresh failed' },
        { status: 500 },
      );
    }
  };
}
