/** @fileoverview Blind monthly Stripe forecasts and student-level reconciliation. */

import { resolveWeeklyWeight } from './cost-helpers.mjs';
import { PRICE_ASSUMPTIONS_VERSION } from './finance-assumptions.mjs';
import { derivePaymentValueContext } from './payment-value-helpers.mjs';
import { parsePauseWindowsFromPlanning } from './pause-forecast.mjs';

const DAY_INDEX = new Map([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
]);
const WEEKS_PER_MONTH = 52 / 12;
const FORECAST_METHOD = 'dashboard_price_x_calendar_v2';

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function toNumber(value) {
  const parsed = Number.parseFloat(`${value ?? ''}`.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMonth(month) {
  const key = clean(month);
  if (!/^\d{4}-\d{2}$/u.test(key)) throw new Error('Forecast month must use YYYY-MM');
  const start = new Date(`${key}-01T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== key) {
    throw new Error('Forecast month must be valid');
  }
  return start;
}

export function currentMonthKey(at = new Date()) {
  const parsed = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid forecast time is required');
  return parsed.toISOString().slice(0, 7);
}

function previousMonthKey(at = new Date()) {
  const parsed = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid reconciliation time is required');
  const previous = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
}

function weekdayDates(month, weekday) {
  const start = parseMonth(month);
  const target = DAY_INDEX.get(clean(weekday).toLowerCase());
  if (!Number.isInteger(target)) return [];
  const dates = [];
  const cursor = new Date(start);
  while (cursor.toISOString().slice(0, 7) === month) {
    if (cursor.getUTCDay() === target) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dateInsideWindow(date, window) {
  const at = Date.parse(`${date}T00:00:00Z`);
  return at >= window.start.getTime() && at < window.end.getTime();
}

function windowOverlapsMonth(window, month) {
  const start = parseMonth(month);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return window.start.getTime() < end.getTime() && window.end.getTime() > start.getTime();
}

function averageMonthOccurrencesOutsideWindows(month, windows, weeklyWeight) {
  const start = parseMonth(month);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  let days = 0;
  let billableDays = 0;
  for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days += 1;
    const date = cursor.toISOString().slice(0, 10);
    if (!windows.some((window) => dateInsideWindow(date, window))) billableDays += 1;
  }
  return round(WEEKS_PER_MONTH * weeklyWeight * (billableDays / days));
}

function compactForecastItem(student, { month, pauseWindows }) {
  const mmsId = clean(student.mmsId);
  const studentName = clean(student.fullName);
  const lifecycle = clean(student.lifecycleStatus).toLowerCase();
  const expectation = clean(student.paymentExpectation).toLowerCase();
  const value = derivePaymentValueContext(student);
  const lessonFrequency = clean(student.lessonFrequency || student.registry?.lessonFrequency) || 'weekly';
  const weekday = clean(student.scheduleContext?.usualWeekday);
  const studentWindows = pauseWindows
    .filter((window) => window.mmsId === mmsId)
    .filter((window) => windowOverlapsMonth(window, month));
  const pauseLike = lifecycle === 'paused' || expectation === 'stripe_paused_expected';
  const base = {
    mms_id: mmsId,
    student_name: studentName,
    expected_amount: null,
    billing_basis: '',
    confidence: value.confidence || 'low',
    weekly_amount: Number.isFinite(value.baselineWeeklyValue) ? round(value.baselineWeeklyValue) : null,
    expected_occurrences: null,
    usual_weekday: weekday,
    lesson_kind: value.lessonKind || 'unknown',
    lesson_frequency: lessonFrequency,
  };

  if (expectation === 'inactive_or_stopped' || (lifecycle !== 'active' && !pauseLike)) {
    return {
      ...base,
      expected_amount: 0,
      billing_basis: 'not_expected_to_bill',
      confidence: 'high',
      expected_occurrences: 0,
    };
  }

  // A current pause state is a fact about today, not the whole target month.
  // When its dated window ends during the month, scheduled lessons after the
  // return date become billable again. Without a relevant structured window we
  // retain the conservative whole-month pause rather than inventing a return.
  if (pauseLike && !studentWindows.length) {
    return {
      ...base,
      expected_amount: 0,
      billing_basis: 'paused_expected',
      confidence: 'high',
      expected_occurrences: 0,
    };
  }

  if (!Number.isFinite(value.baselineWeeklyValue)) {
    return { ...base, billing_basis: 'unpriced' };
  }

  if (value.lessonKind === 'orchestra' && Number.isFinite(value.baselineMonthlyValue)) {
    const fullyPaused = studentWindows.length && averageMonthOccurrencesOutsideWindows(month, studentWindows, 1) === 0;
    return {
      ...base,
      expected_amount: fullyPaused ? 0 : round(value.baselineMonthlyValue),
      billing_basis: studentWindows.length ? 'monthly_price_less_structured_pauses' : 'monthly_price',
      confidence: studentWindows.length ? 'medium' : base.confidence,
      expected_occurrences: fullyPaused ? 0 : 1,
    };
  }

  const scheduledDates = weekdayDates(month, weekday);
  if (!scheduledDates.length) {
    const weeklyWeight = resolveWeeklyWeight(student);
    const expectedOccurrences = studentWindows.length
      ? averageMonthOccurrencesOutsideWindows(month, studentWindows, weeklyWeight)
      : round(WEEKS_PER_MONTH * weeklyWeight);
    return {
      ...base,
      expected_amount: round(value.baselineWeeklyValue * expectedOccurrences),
      billing_basis: studentWindows.length
        ? 'average_month_less_structured_pauses_no_weekday'
        : 'average_month_no_weekday',
      confidence: 'low',
      expected_occurrences: studentWindows.length ? expectedOccurrences : null,
    };
  }

  const billableDates = scheduledDates.filter((date) => !studentWindows.some((window) => dateInsideWindow(date, window)));
  const expectedOccurrences = round(billableDates.length * resolveWeeklyWeight(student));
  return {
    ...base,
    expected_amount: round(value.baselineWeeklyValue * expectedOccurrences),
    billing_basis: studentWindows.length ? 'calendar_less_structured_pauses' : 'calendar_weekday',
    confidence: value.confidence === 'high' ? 'medium' : value.confidence || 'low',
    expected_occurrences: expectedOccurrences,
  };
}

export function buildStripeMonthlyForecast({ students = [], planningRows = [], month = '', forecastedAt = new Date() } = {}) {
  const at = forecastedAt instanceof Date ? forecastedAt : new Date(forecastedAt);
  if (Number.isNaN(at.getTime())) throw new Error('A valid forecast time is required');
  const targetMonth = month || currentMonthKey(at);
  parseMonth(targetMonth);
  const { windows, unparsed } = parsePauseWindowsFromPlanning(planningRows);
  const items = students
    .filter((student) => clean(student.paymentMode).toLowerCase() === 'stripe')
    .filter((student) => clean(student.mmsId))
    .map((student) => compactForecastItem(student, { month: targetMonth, pauseWindows: windows }))
    .sort((left, right) => left.student_name.localeCompare(right.student_name));
  const pricedItems = items.filter((item) => Number.isFinite(item.expected_amount));
  const nonZeroItems = pricedItems.filter((item) => item.expected_amount > 0);
  const approximateCount = pricedItems.filter((item) => item.confidence !== 'high').length;

  return {
    month: targetMonth,
    forecastedAt: at.toISOString(),
    forecastTotal: round(pricedItems.reduce((sum, item) => sum + item.expected_amount, 0)),
    candidateStudentCount: items.length,
    forecastedStudentCount: pricedItems.length,
    billedStudentCount: nonZeroItems.length,
    zeroExpectedCount: pricedItems.length - nonZeroItems.length,
    unpricedCount: items.length - pricedItems.length,
    approximateCount,
    coveragePct: items.length ? round((pricedItems.length / items.length) * 100) : null,
    unparsedPauseCount: unparsed.length,
    method: FORECAST_METHOD,
    assumptionsVersion: PRICE_ASSUMPTIONS_VERSION,
    items,
  };
}

export function buildStripeForecastRow(forecast = {}) {
  // Keep the evidence cell comfortably below Google Sheets' 50k character
  // limit as the roster grows. These seven fields are sufficient to reproduce
  // every comparison and diagnose the forecast basis; richer live student
  // context remains in its authoritative lanes.
  const compactItems = (Array.isArray(forecast.items) ? forecast.items : []).map((item) => ({
    mms_id: item.mms_id,
    name: item.student_name,
    amount: item.expected_amount,
    basis: item.billing_basis,
    confidence: item.confidence,
    weekly: item.weekly_amount,
    occurrences: item.expected_occurrences,
  }));
  const itemsJson = JSON.stringify(compactItems);
  if (itemsJson.length > 45_000) {
    throw new Error('Stripe forecast evidence is too large for one Sheets cell; move detail to a dedicated lane before revealing Stripe');
  }
  return {
    month: clean(forecast.month),
    forecasted_at: clean(forecast.forecastedAt),
    forecast_total: Number.isFinite(forecast.forecastTotal) ? forecast.forecastTotal : '',
    candidate_student_count: Number.isFinite(forecast.candidateStudentCount) ? forecast.candidateStudentCount : '',
    forecasted_student_count: Number.isFinite(forecast.forecastedStudentCount) ? forecast.forecastedStudentCount : '',
    billed_student_count: Number.isFinite(forecast.billedStudentCount) ? forecast.billedStudentCount : '',
    zero_expected_count: Number.isFinite(forecast.zeroExpectedCount) ? forecast.zeroExpectedCount : '',
    unpriced_count: Number.isFinite(forecast.unpricedCount) ? forecast.unpricedCount : '',
    approximate_count: Number.isFinite(forecast.approximateCount) ? forecast.approximateCount : '',
    coverage_pct: Number.isFinite(forecast.coveragePct) ? forecast.coveragePct : '',
    unparsed_pause_count: Number.isFinite(forecast.unparsedPauseCount) ? forecast.unparsedPauseCount : '',
    method: clean(forecast.method) || FORECAST_METHOD,
    assumptions_version: clean(forecast.assumptionsVersion) || PRICE_ASSUMPTIONS_VERSION,
    items_json: itemsJson,
  };
}

export function findMonthlyStripeForecast(forecastRows = [], { month = '' } = {}) {
  const key = clean(month);
  return forecastRows
    .filter((row) => clean(row.month) === key)
    .sort((left, right) => clean(left.forecasted_at).localeCompare(clean(right.forecasted_at)))[0] || null;
}

export async function ensureMonthlyStripeForecast({
  at = new Date(),
  getForecastRows,
  buildForecastRow,
  appendForecastRow,
} = {}) {
  if (typeof getForecastRows !== 'function') throw new Error('getForecastRows is required');
  if (typeof buildForecastRow !== 'function') throw new Error('buildForecastRow is required');
  if (typeof appendForecastRow !== 'function') throw new Error('appendForecastRow is required');
  const month = currentMonthKey(at);
  const existing = findMonthlyStripeForecast(await getForecastRows(), { month });
  if (existing) return { row: existing, skipped: true, reason: 'monthly_forecast_exists' };
  const row = await buildForecastRow({ month, forecastedAt: at });
  const result = await appendForecastRow(row);
  return {
    row,
    skipped: result?.appended === false,
    reason: result?.appended === false ? 'monthly_forecast_exists' : '',
  };
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(clean(value) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function onboardingDateByMmsId(waitingRows = []) {
  const byId = new Map();
  for (const row of waitingRows) {
    const mmsId = clean(row.mms_id ?? row.mmsId);
    const status = clean(row.status).toLowerCase();
    const updatedAt = clean(row.updated_at ?? row.updatedAt);
    if (!mmsId || status !== 'onboarded' || !updatedAt) continue;
    const parsed = new Date(updatedAt);
    if (Number.isNaN(parsed.getTime())) continue;
    byId.set(mmsId, parsed);
  }
  return byId;
}

function classifyDifference({ forecast, actual, difference, forecastedAt, onboardedAt }) {
  const expectedAmount = forecast ? toNumber(forecast.amount ?? forecast.expected_amount ?? forecast.expectedAmount) : 0;
  const actualAmount = actual ? toNumber(actual.amount) ?? 0 : 0;
  const basis = clean(forecast?.basis ?? forecast?.billing_basis ?? forecast?.billingBasis);
  const weekly = toNumber(forecast?.weekly ?? forecast?.weekly_amount ?? forecast?.weeklyAmount);

  if (!Number.isFinite(expectedAmount)) return 'unpriced_forecast';
  if (!forecast && actualAmount > 0) {
    return forecastedAt && onboardedAt && onboardedAt.getTime() > forecastedAt.getTime()
      ? 'post_lock_onboarding'
      : 'unforecast_collection';
  }
  if (!actual && expectedAmount > 0) return 'no_paid_invoice';
  if (Math.abs(difference) <= 0.009) return 'matched';
  if (basis === 'paused_expected' && actualAmount > 0) return 'paused_expected_but_collected';
  if (basis === 'not_expected_to_bill' && actualAmount > 0) return 'inactive_but_collected';
  if (basis === 'monthly_price' && Math.abs(difference) <= 2) return 'price_difference';
  if (Number.isFinite(weekly) && weekly > 0) {
    const occurrenceDelta = Math.abs(difference) / weekly;
    if (Math.abs(occurrenceDelta - Math.round(occurrenceDelta)) <= 0.01) {
      return 'invoice_occurrence_timing';
    }
  }
  return 'amount_mismatch';
}

function buildAttribution(differences = [], { unmatchedActualTotal = 0, unmatchedInvoiceCount = 0 } = {}) {
  const byCategory = new Map();
  for (const item of differences) {
    const current = byCategory.get(item.category) || {
      category: item.category,
      count: 0,
      absoluteError: 0,
      netDifference: 0,
    };
    current.count += 1;
    current.absoluteError += Math.abs(item.difference ?? item.actualAmount ?? 0);
    current.netDifference += item.difference ?? item.actualAmount ?? 0;
    byCategory.set(item.category, current);
  }
  if (unmatchedActualTotal > 0) {
    byCategory.set('unmatched_collection', {
      category: 'unmatched_collection',
      count: unmatchedInvoiceCount,
      absoluteError: unmatchedActualTotal,
      netDifference: unmatchedActualTotal,
    });
  }
  return [...byCategory.values()]
    .map((item) => ({
      ...item,
      absoluteError: round(item.absoluteError),
      netDifference: round(item.netDifference),
    }))
    .sort((left, right) => right.absoluteError - left.absoluteError);
}

export function buildStripeForecastConfidence(forecastRow = {}) {
  const items = parseItems(forecastRow.items_json ?? forecastRow.itemsJson ?? forecastRow.items);
  const countBasis = (predicate) => items.filter((item) => predicate(clean(item.basis ?? item.billing_basis))).length;
  const unpricedCount = toNumber(forecastRow.unpriced_count ?? forecastRow.unpricedCount)
    ?? items.filter((item) => !Number.isFinite(toNumber(item.amount ?? item.expected_amount))).length;
  const unparsedPauseCount = toNumber(forecastRow.unparsed_pause_count ?? forecastRow.unparsedPauseCount) ?? 0;
  const missingWeekdayCount = countBasis((basis) => basis.includes('no_weekday'));
  const undatedPauseCount = countBasis((basis) => basis === 'paused_expected');

  return {
    candidateCount: toNumber(forecastRow.candidate_student_count ?? forecastRow.candidateStudentCount) ?? items.length,
    calendarCount: countBasis((basis) => basis === 'calendar_weekday'),
    datedPauseCount: countBasis((basis) => basis.includes('structured_pauses')),
    missingWeekdayCount,
    undatedPauseCount,
    inactiveCount: countBasis((basis) => basis === 'not_expected_to_bill'),
    monthlyPriceCount: countBasis((basis) => basis === 'monthly_price'),
    unpricedCount,
    unparsedPauseCount,
    actionableInputCount: missingWeekdayCount + undatedPauseCount + unpricedCount + unparsedPauseCount,
  };
}

export function buildStripeReconciliation({ forecastRows = [], collectedRows = [], waitingRows = [], now = new Date() } = {}) {
  const month = previousMonthKey(now);
  const forecastRow = findMonthlyStripeForecast(forecastRows, { month });
  const collectedRow = collectedRows.find((row) => clean(row.month) === month) || null;
  const forecastItems = parseItems(forecastRow?.items_json ?? forecastRow?.itemsJson);
  const actualItems = parseItems(collectedRow?.student_breakdown_json ?? collectedRow?.studentBreakdownJson);
  const forecastedAt = forecastRow?.forecasted_at ? new Date(forecastRow.forecasted_at) : null;
  const validForecastedAt = forecastedAt && !Number.isNaN(forecastedAt.getTime()) ? forecastedAt : null;
  const onboardedById = onboardingDateByMmsId(waitingRows);
  const forecastById = new Map(forecastItems.map((item) => [clean(item.mms_id ?? item.mmsId), item]).filter(([id]) => id));
  const actualById = new Map(actualItems.map((item) => [clean(item.mms_id ?? item.mmsId), item]).filter(([id]) => id));
  const ids = new Set([...forecastById.keys(), ...actualById.keys()]);
  const differences = [...ids].map((mmsId) => {
    const forecast = forecastById.get(mmsId) || null;
    const actual = actualById.get(mmsId) || null;
    const expectedAmount = forecast ? toNumber(forecast.amount ?? forecast.expected_amount ?? forecast.expectedAmount) : 0;
    const actualAmount = actual ? toNumber(actual.amount) ?? 0 : 0;
    const difference = Number.isFinite(expectedAmount) ? round(actualAmount - expectedAmount) : null;
    const category = classifyDifference({
      forecast,
      actual,
      difference,
      forecastedAt: validForecastedAt,
      onboardedAt: onboardedById.get(mmsId),
    });
    return {
      mmsId,
      studentName: clean(forecast?.name ?? forecast?.student_name ?? forecast?.studentName ?? actual?.student_name ?? actual?.studentName),
      expectedAmount,
      actualAmount,
      difference,
      invoiceCount: toNumber(actual?.invoice_count ?? actual?.invoiceCount) ?? 0,
      paidDays: Array.isArray(actual?.paid_days ?? actual?.paidDays) ? (actual.paid_days ?? actual.paidDays) : [],
      basis: clean(forecast?.basis ?? forecast?.billing_basis ?? forecast?.billingBasis),
      weeklyAmount: toNumber(forecast?.weekly ?? forecast?.weekly_amount ?? forecast?.weeklyAmount),
      category,
      status: category,
    };
  });
  const actionable = differences
    .filter((item) => item.category !== 'matched')
    .sort((left, right) => Math.abs(right.difference ?? right.actualAmount) - Math.abs(left.difference ?? left.actualAmount));
  const collectedTotal = toNumber(collectedRow?.collected_total ?? collectedRow?.collectedTotal);
  const forecastTotal = toNumber(forecastRow?.forecast_total ?? forecastRow?.forecastTotal);
  const unmatchedActualTotal = toNumber(collectedRow?.unmatched_total ?? collectedRow?.unmatchedTotal) ?? 0;
  const netDifference = Number.isFinite(collectedTotal) && Number.isFinite(forecastTotal)
    ? round(collectedTotal - forecastTotal)
    : null;
  const deltaPct = Number.isFinite(netDifference) && forecastTotal > 0
    ? round((netDifference / forecastTotal) * 100)
    : null;
  const breakdownAvailable = Boolean(forecastRow && collectedRow && clean(collectedRow?.student_breakdown_json ?? collectedRow?.studentBreakdownJson));
  const itemAbsoluteError = breakdownAvailable
    ? differences.reduce((sum, item) => sum + (Number.isFinite(item.difference) ? Math.abs(item.difference) : Math.abs(item.actualAmount)), 0)
    : null;
  const totalAbsoluteError = Number.isFinite(itemAbsoluteError) ? round(itemAbsoluteError + unmatchedActualTotal) : null;
  const offsettingError = Number.isFinite(totalAbsoluteError) && Number.isFinite(netDifference)
    ? round(Math.max(0, totalAbsoluteError - Math.abs(netDifference)) / 2)
    : null;
  const attribution = buildAttribution(actionable, { unmatchedActualTotal, unmatchedInvoiceCount: toNumber(collectedRow?.unmatched_invoice_count ?? collectedRow?.unmatchedInvoiceCount) ?? 0 });
  const rosterChangeError = attribution.find((item) => item.category === 'post_lock_onboarding')?.absoluteError ?? 0;

  return {
    month,
    forecastPresent: Boolean(forecastRow),
    actualPresent: Boolean(collectedRow),
    breakdownAvailable,
    forecastedAt: forecastRow?.forecasted_at || null,
    refreshedAt: collectedRow?.refreshed_at || null,
    forecastTotal,
    collectedTotal,
    invoiceCount: toNumber(collectedRow?.invoice_count ?? collectedRow?.invoiceCount),
    netDifference,
    deltaPct,
    totalAbsoluteError,
    offsettingError,
    unmatchedActualTotal,
    unmatchedInvoiceCount: toNumber(collectedRow?.unmatched_invoice_count ?? collectedRow?.unmatchedInvoiceCount) ?? 0,
    matchedCollectionPct: Number.isFinite(collectedTotal) && collectedTotal > 0
      ? round(((collectedTotal - unmatchedActualTotal) / collectedTotal) * 100)
      : null,
    forecastCoveragePct: toNumber(forecastRow?.coverage_pct ?? forecastRow?.coveragePct),
    unpricedCount: toNumber(forecastRow?.unpriced_count ?? forecastRow?.unpricedCount) ?? 0,
    approximateCount: toNumber(forecastRow?.approximate_count ?? forecastRow?.approximateCount) ?? 0,
    confidence: buildStripeForecastConfidence(forecastRow || {}),
    mismatchCount: actionable.length,
    modelAbsoluteError: Number.isFinite(totalAbsoluteError) ? round(totalAbsoluteError - rosterChangeError) : null,
    attribution,
    differences: actionable,
  };
}
