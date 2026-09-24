/** @fileoverview Server loader for a tutor pay statement, reading the frozen reviewed payroll row and recomputing the per-lesson breakdown. */
// Server-side loader for a tutor pay statement. Shared by the admin statement
// view and the public signed-link view. Reads the frozen reviewed Payroll_Runs
// row for the total, and recomputes that window's payable lessons for the
// per-lesson breakdown. Read-only — no writes, no money movement.
import { getPayrollRunRows, getTutorPayRows, upsertPayrollRunRow } from '@/lib/admin/sheets';
import { searchAttendanceForPayroll } from '@/lib/admin/mms';
import { parseTutorPay } from '@/lib/admin/cost-helpers.mjs';
import {
  attendanceQueryCoversPeriod,
  buildPayrollAttendanceQuery,
  buildPayrollPreview,
  normalisePayrollRunRow,
} from '@/lib/admin/payroll-helpers.mjs';
import { buildTutorStatement } from '@/lib/admin/tutor-statement-helpers.mjs';
import { canRespondToPaidStatement } from '@/lib/admin/payroll-workflow-helpers.mjs';

function addOneDay(dateStr) {
  const parsed = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

// Returns { statement } for a reviewed/paid row, or { notFound } / { notReady }.
export async function loadTutorStatement({ payrollId } = {}) {
  const id = `${payrollId || ''}`.trim();
  if (!id) return { notFound: true };

  const savedRuns = await getPayrollRunRows();
  const savedRaw = savedRuns.find((row) => `${row.payroll_id ?? ''}`.trim() === id);
  if (!savedRaw) return { notFound: true };

  const savedRow = normalisePayrollRunRow(savedRaw);
  // A statement only exists once the figure is locked (reviewed) — a draft row
  // has no agreed amount to invoice.
  if (savedRow.status !== 'reviewed' && savedRow.status !== 'paid') {
    return { notReady: true, savedRow };
  }

  const tutorPay = parseTutorPay(await getTutorPayRows());

  // Reproduce the frozen window: payDate just past period end so the 35-day
  // look-back cap can't clip it; the override pins the exact dates so the
  // resolved payroll_id matches the saved row.
  const payDate = addOneDay(savedRow.periodEnd);
  const overrides = { [savedRow.tutorShortName]: { start: savedRow.periodStart, end: savedRow.periodEnd } };

  // Ask for the window the payroll page already fetched, keyed off the run's own
  // pay date, so opening a statement off the back of that page is a cache hit
  // rather than its own cold MMS call. A superset is equivalent input:
  // buildPayrollPreview filters slots by teacher and period itself. Only reuse it
  // when it demonstrably covers this run's period — a hand-set window could sit
  // outside it, and a silently short row set is the failure mode this lane has
  // been bitten by before. Otherwise fall back to the exact narrow window.
  const sharedQuery = buildPayrollAttendanceQuery(savedRow.payDate || payDate);
  const attendanceQuery = attendanceQueryCoversPeriod(sharedQuery, savedRow)
    ? sharedQuery
    : {
      startDate: savedRow.periodStart,
      endDate: savedRow.periodEnd,
      teacherIds: savedRow.teacherId ? [savedRow.teacherId] : [],
    };

  let attendanceRows = [];
  try {
    attendanceRows = await searchAttendanceForPayroll({ ...attendanceQuery, allowExpired: true });
  } catch {
    // Lines are best-effort; the frozen total still stands from the saved row.
    attendanceRows = [];
  }

  const preview = buildPayrollPreview({ attendanceRows, tutorPay, savedRuns, overrides, payDate });
  const previewRow = preview.rows.find((row) => row.payrollId === id)
    || preview.rows.find((row) => row.tutorShortName === savedRow.tutorShortName)
    || {};

  return { statement: buildTutorStatement({ savedRow, previewRow }), savedRow };
}

// Records a tutor's response to their statement (Phase 2). Called from the
// public signed-link view — no login, the token proved which row. Writes back
// to the Payroll_Runs row; never touches payment state. Returns the response
// or a reason it was declined (row missing / already paid).
export async function recordTutorStatementResponse({ payrollId, response, note = '' }) {
  const id = `${payrollId || ''}`.trim();
  const cleanResponse = `${response || ''}`.trim().toLowerCase();
  if (!id) return { ok: false, reason: 'missing_id' };
  if (cleanResponse !== 'confirmed' && cleanResponse !== 'disputed') {
    return { ok: false, reason: 'bad_response' };
  }

  const savedRuns = await getPayrollRunRows();
  const raw = savedRuns.find((row) => `${row.payroll_id ?? ''}`.trim() === id);
  if (!raw) return { ok: false, reason: 'not_found' };
  // A separately paid cutover still needs the tutor's real response. It remains
  // excluded from Wise regardless of whether they confirm or raise a query.
  if (`${raw.status ?? ''}`.trim() === 'paid' && !canRespondToPaidStatement(raw)) {
    return { ok: false, reason: 'already_paid' };
  }

  await upsertPayrollRunRow({
    ...raw,
    tutor_response: cleanResponse,
    tutor_responded_at: new Date().toISOString(),
    tutor_response_source: 'signed_link',
    tutor_note: cleanResponse === 'disputed' ? `${note || ''}`.trim() : '',
    updated_at: new Date().toISOString(),
  });

  return { ok: true, response: cleanResponse };
}

export async function recordTutorStatementSent({ payrollId, actorEmail = '' }) {
  const id = `${payrollId || ''}`.trim();
  if (!id) return { ok: false, reason: 'missing_id' };
  const savedRuns = await getPayrollRunRows();
  const raw = savedRuns.find((row) => `${row.payroll_id ?? ''}`.trim() === id);
  if (!raw) return { ok: false, reason: 'not_found' };
  if (`${raw.status ?? ''}`.trim() !== 'reviewed') return { ok: false, reason: 'not_reviewed' };
  if (`${raw.statement_sent_at ?? ''}`.trim()) {
    return { ok: true, sentAt: `${raw.statement_sent_at}`.trim(), alreadySent: true };
  }
  const now = new Date().toISOString();
  await upsertPayrollRunRow({
    ...raw,
    statement_sent_at: now,
    statement_sent_by: `${actorEmail || ''}`.trim(),
    statement_delivery_status: 'manual',
    statement_delivery_channel: 'manual_copy',
    statement_delivery_attempted_at: now,
    statement_delivery_error: '',
    updated_at: now,
  });
  return { ok: true, sentAt: now };
}
