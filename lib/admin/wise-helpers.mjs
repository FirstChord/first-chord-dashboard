/** @fileoverview Builds a Wise batch-payment CSV from reviewed payroll rows and tutor recipient records. */
import { isPayrollRunReadyForPayment } from './payroll-workflow-helpers.mjs';

// Pure + unit-tested.
//
// The dashboard only *generates* the file — a human uploads it to Wise and
// presses send. Payroll stays reconciliation, not execution. Recipient banking
// data lives in the Tutor_Wise Google Sheet, never in git.

// Exact Wise batch-payment column order (the file Wise expects on upload).
export const WISE_CSV_HEADERS = [
  'recipientId',
  'name',
  'recipientEmail',
  'recipientDetail',
  'sourceCurrency',
  'targetCurrency',
  'amountCurrency',
  'amount',
  'paymentReference',
  'receiverType',
];

function norm(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function clean(value) {
  return `${value ?? ''}`.trim();
}

// Index each Tutor_Wise row by its tutor key for joining to payroll rows.
// Accepts snake_case (sheet) or camelCase. Currency fields default to GBP.
export function parseTutorWise(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = norm(row.tutor);
    if (!key) continue;
    byKey.set(key, {
      tutor: clean(row.tutor),
      recipientId: clean(row.recipient_id ?? row.recipientId),
      name: clean(row.name),
      recipientEmail: clean(row.recipient_email ?? row.recipientEmail),
      recipientDetail: clean(row.recipient_detail ?? row.recipientDetail),
      sourceCurrency: clean(row.source_currency ?? row.sourceCurrency) || 'GBP',
      targetCurrency: clean(row.target_currency ?? row.targetCurrency) || 'GBP',
      amountCurrency: clean(row.amount_currency ?? row.amountCurrency) || 'GBP',
      receiverType: clean(row.receiver_type ?? row.receiverType),
    });
  }
  return byKey;
}

// Short on purpose — Wise payment references are length-limited per currency.
export function buildPaymentReference({ periodEnd = '' } = {}) {
  const end = clean(periodEnd);
  return end ? `FC pay ${end}` : 'FC pay';
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

// Select the reviewed-but-unpaid Payroll_Runs rows to pay out, ONE payment per
// tutor. Built straight from saved runs (not a re-resolved preview) so it never
// depends on the current window: a tutor stays payable even if their reviewed
// row used a manually-adjusted window whose payroll_id no longer matches the
// default resolver. (That mismatch was silently dropping adjusted tutors — e.g.
// David Husz — from the CSV, and made re-downloads look "stuck".)
//
// Duplicate reviewed rows for the same tutor (a window tweaked and re-reviewed)
// collapse to a single payment: the latest reviewed row is the representative,
// and EVERY duplicate's payroll_id is returned so marking the batch paid clears
// them all. If the duplicates disagree on amount we surface a conflict rather
// than guessing — one row, warn if amounts differ.
export function selectPayableReviewedRuns(savedRuns = []) {
  const byTutor = new Map();
  const disputed = [];
  for (const raw of savedRuns) {
    if (!isPayrollRunReadyForPayment(raw)) {
      if (norm(raw.status ?? raw.Status) === 'reviewed' && norm(raw.tutor_response ?? raw.tutorResponse) === 'disputed') {
        disputed.push({
          tutor: clean(raw.tutor ?? raw.Tutor) || clean(raw.tutor_short_name ?? raw.tutorShortName),
          note: clean(raw.tutor_note ?? raw.tutorNote),
        });
      }
      continue;
    }
    // A tutor who flagged their statement is held out of the batch until it's
    // resolved — never silently pay a contested amount.
    const tutor = clean(raw.tutor ?? raw.Tutor);
    const tutorShortName = clean(raw.tutor_short_name ?? raw.tutorShortName);
    const key = norm(tutorShortName || tutor);
    if (!key) continue;
    const finalAmount = Number(raw.final_amount ?? raw.finalAmount);
    const entry = byTutor.get(key) || [];
    entry.push({
      payrollId: clean(raw.payroll_id ?? raw.payrollId),
      tutor,
      tutorShortName,
      owedAmount: Number.isFinite(finalAmount) ? finalAmount : 0,
      periodEnd: clean(raw.period_end ?? raw.periodEnd),
      reviewedAt: clean(raw.reviewed_at ?? raw.reviewedAt),
      updatedAt: clean(raw.updated_at ?? raw.updatedAt),
    });
    byTutor.set(key, entry);
  }

  const rows = [];
  const amountConflicts = [];
  for (const entry of byTutor.values()) {
    const positive = entry.filter((row) => row.owedAmount > 0);
    if (!positive.length) continue;
    // Latest reviewed row represents the payment; ties fall back to updated_at.
    const chosen = [...positive].sort((a, b) => (
      `${b.reviewedAt || b.updatedAt}`.localeCompare(`${a.reviewedAt || a.updatedAt}`)
    ))[0];
    const distinctAmounts = [...new Set(positive.map((row) => Math.round(row.owedAmount * 100)))];
    if (distinctAmounts.length > 1) {
      amountConflicts.push({
        tutor: chosen.tutor || chosen.tutorShortName,
        amounts: distinctAmounts.map((cents) => cents / 100).sort((a, b) => a - b),
      });
    }
    rows.push({
      status: 'reviewed',
      payrollId: chosen.payrollId,
      // All duplicate ids so a batch-paid flip clears the collapsed rows too.
      allPayrollIds: positive.map((row) => row.payrollId).filter(Boolean),
      tutor: chosen.tutor,
      tutorShortName: chosen.tutorShortName,
      owedAmount: chosen.owedAmount,
      periodEnd: chosen.periodEnd,
    });
  }
  return { rows, amountConflicts, disputed };
}

// rows = payroll preview rows; wiseByKey from parseTutorWise.
// Includes ONLY reviewed rows with a positive owed amount — an unchecked
// figure can never become a payment. Reviewed rows missing a Wise recipient
// are surfaced (not silently dropped) so they can be chased.
export function buildWiseBatch({ rows = [], wiseByKey = new Map() } = {}) {
  const csvRows = [];
  const includedTutors = [];
  const missing = [];
  const includedPayrollIds = [];
  let totalAmount = 0;
  for (const row of rows) {
    if (norm(row.status) !== 'reviewed') continue;
    const owed = Number(row.owedAmount);
    if (!Number.isFinite(owed) || owed <= 0) continue;

    const recipient =
      wiseByKey.get(norm(row.tutorShortName)) ||
      wiseByKey.get(norm(row.tutor)) ||
      null;

    if (!recipient || !recipient.recipientId) {
      missing.push({ tutor: row.tutor || row.tutorShortName, owedAmount: owed });
      continue;
    }

    totalAmount += owed;
    // A collapsed tutor carries every duplicate id so the batch-paid flip clears
    // them all; otherwise fall back to the single row id.
    if (Array.isArray(row.allPayrollIds) && row.allPayrollIds.length) {
      includedPayrollIds.push(...row.allPayrollIds);
    } else if (row.payrollId) {
      includedPayrollIds.push(row.payrollId);
    }
    includedTutors.push({
      tutor: row.tutor || row.tutorShortName || recipient.name,
      owedAmount: owed,
    });
    csvRows.push({
      recipientId: recipient.recipientId,
      name: recipient.name || row.tutor,
      recipientEmail: recipient.recipientEmail,
      recipientDetail: recipient.recipientDetail,
      sourceCurrency: recipient.sourceCurrency,
      targetCurrency: recipient.targetCurrency,
      amountCurrency: recipient.amountCurrency,
      amount: formatAmount(owed),
      paymentReference: buildPaymentReference({ periodEnd: row.periodEnd }),
      receiverType: recipient.receiverType,
    });
  }
  return {
    csvRows,
    includedTutors,
    missing,
    includedPayrollIds,
    includedCount: csvRows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}

function csvField(value) {
  const s = `${value ?? ''}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toWiseCsv(csvRows = []) {
  const lines = [WISE_CSV_HEADERS.join(',')];
  for (const row of csvRows) {
    lines.push(WISE_CSV_HEADERS.map((header) => csvField(row[header])).join(','));
  }
  return lines.join('\r\n');
}
