/** @fileoverview Sheets adapter for the Stripe actuals cache, the immutable monthly forecast series, and the refreshable collected series. */
import { buildSheetRange, ensureManagedSheet, getSheetValues, getSheetsClient, getSheetsEnv, invalidateSheetReadCache, mapRowsToObjects, SPLIT_BILLING_HEADERS, SPLIT_BILLING_SHEET, STRIPE_AMOUNTS_CACHE_HEADERS, STRIPE_AMOUNTS_CACHE_SHEET, STRIPE_COLLECTED_MONTHLY_HEADERS, STRIPE_COLLECTED_MONTHLY_SHEET, STRIPE_FORECAST_MONTHLY_HEADERS, STRIPE_FORECAST_MONTHLY_SHEET, upsertManagedSheetRow, withSheetsRetry } from './core.mjs';
import { columnNumberToLetter } from '../sheets-helpers.mjs';

// --- Stripe actuals cache (read-only revenue calibration) -----------------------
// Stripe_Amounts_Cache is a full-replace cache: every refresh rewrites the whole
// tab (clear + one update, two API calls) because the row set follows the roster,
// and per-row upserts for ~170 students would crawl. Stripe_Forecast_Monthly is
// immutable after its first row for a month; Stripe_Collected_Monthly is the
// separately revealed, refreshable provider-actual series.

// Read-only here on purpose: Finn records a split by hand after creating the
// second subscription in Stripe, and nothing in the dashboard invents one.
export async function getSplitBillingRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  await ensureManagedSheet({ sheets, spreadsheetId, sheetName: SPLIT_BILLING_SHEET, requiredHeaders: SPLIT_BILLING_HEADERS });
  const values = await getSheetValues(SPLIT_BILLING_SHEET);
  return mapRowsToObjects(values);
}

export async function getStripeAmountsCacheRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  await ensureManagedSheet({ sheets, spreadsheetId, sheetName: STRIPE_AMOUNTS_CACHE_SHEET, requiredHeaders: STRIPE_AMOUNTS_CACHE_HEADERS });
  const values = await getSheetValues(STRIPE_AMOUNTS_CACHE_SHEET);
  return mapRowsToObjects(values);
}

export async function replaceStripeAmountsCacheRows(rows = []) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: STRIPE_AMOUNTS_CACHE_SHEET,
    requiredHeaders: STRIPE_AMOUNTS_CACHE_HEADERS,
  });
  const endColumn = columnNumberToLetter(headers.length);

  await withSheetsRetry(() => sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: buildSheetRange(STRIPE_AMOUNTS_CACHE_SHEET, `A2:${endColumn}`),
  }));

  if (rows.length) {
    const values = rows.map((row) => headers.map((header) => row[header] ?? ''));
    await withSheetsRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: buildSheetRange(STRIPE_AMOUNTS_CACHE_SHEET, `A2:${endColumn}${rows.length + 1}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    }));
  }

  invalidateSheetReadCache(STRIPE_AMOUNTS_CACHE_SHEET);
  return { written: rows.length };
}

export async function getStripeCollectedMonthlyRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  await ensureManagedSheet({ sheets, spreadsheetId, sheetName: STRIPE_COLLECTED_MONTHLY_SHEET, requiredHeaders: STRIPE_COLLECTED_MONTHLY_HEADERS });
  const values = await getSheetValues(STRIPE_COLLECTED_MONTHLY_SHEET);
  return mapRowsToObjects(values);
}

export async function getStripeForecastMonthlyRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: STRIPE_FORECAST_MONTHLY_SHEET,
    requiredHeaders: STRIPE_FORECAST_MONTHLY_HEADERS,
  });
  const values = await getSheetValues(STRIPE_FORECAST_MONTHLY_SHEET);
  return mapRowsToObjects(values);
}

export async function appendStripeForecastMonthlyRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const month = `${row.month || ''}`.trim();
  if (!month) throw new Error('month is required');
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: STRIPE_FORECAST_MONTHLY_SHEET,
    requiredHeaders: STRIPE_FORECAST_MONTHLY_HEADERS,
  });
  // Re-read at the write boundary as a second guard against a cron retry. Sheets
  // has no conditional append, so workflow concurrency remains the outer guard.
  const existing = await getSheetValues(STRIPE_FORECAST_MONTHLY_SHEET, { force: true });
  const monthIndex = headers.indexOf('month');
  if (existing.slice(1).some((entry) => `${entry[monthIndex] || ''}`.trim() === month)) {
    return { appended: false, month };
  }
  await withSheetsRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: buildSheetRange(STRIPE_FORECAST_MONTHLY_SHEET, 'A:A'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [headers.map((header) => row[header] ?? '')] },
  }));
  invalidateSheetReadCache(STRIPE_FORECAST_MONTHLY_SHEET);
  return { appended: true, month };
}

export async function upsertStripeCollectedMonthlyRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const monthKey = `${row.month || ''}`.trim();
  if (!monthKey) {
    throw new Error('month is required');
  }
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: STRIPE_COLLECTED_MONTHLY_SHEET,
    requiredHeaders: STRIPE_COLLECTED_MONTHLY_HEADERS,
    valuesByHeader: {
      month: monthKey,
      collected_total: row.collected_total ?? row.collectedTotal ?? '',
      invoice_count: row.invoice_count ?? row.invoiceCount ?? '',
      matched_total: row.matched_total ?? row.matchedTotal ?? '',
      matched_invoice_count: row.matched_invoice_count ?? row.matchedInvoiceCount ?? '',
      unmatched_total: row.unmatched_total ?? row.unmatchedTotal ?? '',
      unmatched_invoice_count: row.unmatched_invoice_count ?? row.unmatchedInvoiceCount ?? '',
      student_breakdown_json: row.student_breakdown_json ?? row.studentBreakdownJson ?? '',
      currency: row.currency ?? 'gbp',
      refreshed_at: row.refreshed_at ?? row.refreshedAt ?? new Date().toISOString(),
    },
    matchesRow: (entry, headers) => `${entry[headers.indexOf('month')] || ''}`.trim() === monthKey,
  });
}
