/** @fileoverview Fresh-source checks for payroll record exceptions and an admin-approved checklist email. */
import { google } from 'googleapis';
import { ADMIN_TUTORS } from './tutors-data.js';
import { parseTutorPay } from './cost-helpers.mjs';
import { buildPayrollPreview } from './payroll-helpers.mjs';
import { addRecordException, decideRecordsNudge, buildRecordsNudgeEmail } from './payroll-record-readiness.mjs';
import { getPayrollRunRows, getTutorPayRows, upsertPayrollRunRow } from './sheets.js';
import { searchAttendanceForPayroll } from './mms.js';
import { loadTutorPayrollPreference } from './tutor-payroll-preferences.js';
import { getPracticeNotesEmailConfig } from './practice-notes-email.js';
import { buildGmailRawMessage } from './practice-notes-email-helpers.mjs';

const clean = (value) => `${value ?? ''}`.trim();

export async function loadFreshPayrollRecordRow({ payrollId, tutorShortName, payDate, periodStart, periodEnd }) {
  const identity = ADMIN_TUTORS[clean(tutorShortName)];
  if (!identity?.teacherId || !/^\d{4}-\d{2}-\d{2}$/u.test(clean(periodStart)) || !/^\d{4}-\d{2}-\d{2}$/u.test(clean(periodEnd))) {
    throw new Error('This payroll period is not valid. Refresh the page.');
  }
  const [runs, tutorPayRows, attendanceRows] = await Promise.all([
    getPayrollRunRows({ force: true }), getTutorPayRows(),
    searchAttendanceForPayroll({ startDate: periodStart, endDate: periodEnd, teacherIds: [identity.teacherId], forceRefresh: true }),
  ]);
  const existing = runs.find((run) => clean(run.payroll_id) === clean(payrollId)) || null;
  if (existing && (clean(existing.tutor_short_name) !== clean(tutorShortName) || clean(existing.pay_date) !== clean(payDate) || clean(existing.period_start) !== clean(periodStart) || clean(existing.period_end) !== clean(periodEnd))) {
    throw new Error('The saved payroll period changed. Refresh the page.');
  }
  const row = buildPayrollPreview({ attendanceRows, tutorPay: parseTutorPay(tutorPayRows), savedRuns: runs, payDate,
    overrides: { [tutorShortName]: { start: periodStart, end: periodEnd } }, maxLookbackDays: 366,
  }).rows.find((entry) => entry.payrollId === payrollId);
  if (!row || row.teacherId !== identity.teacherId || row.periodStart !== periodStart || row.periodEnd !== periodEnd || row.status !== 'draft') {
    throw new Error('This payroll row is no longer a draft. Refresh the page.');
  }
  return { row, existing };
}

function draftPayload(row, existing, updatedAt) {
  return {
    ...existing,
    payroll_id: row.payrollId, pay_date: row.payDate,
    period_start: row.periodStart, period_end: row.periodEnd,
    tutor: row.tutor, tutor_short_name: row.tutorShortName, teacher_id: row.teacherId,
    invoice_cadence: row.invoiceCadence, pay_model: row.payModel,
    lesson_count: row.lessonCount, review_lesson_count: row.reviewLessonCount,
    teaching_minutes: row.teachingMinutes, expected_amount: row.expectedAmount,
    adjustment_amount: row.adjustmentAmount, final_amount: row.finalAmount,
    status: 'draft', payment_route: row.paymentRoute,
    source: 'mms_attendance_preview', created_at: existing?.created_at || updatedAt, updated_at: updatedAt,
  };
}

export async function savePayrollNoteException({ context, attendanceId, reason, actor }) {
  const { row, existing } = await loadFreshPayrollRecordRow(context);
  if (row.periodOpen || !row.cadenceDue || row.legacyNeedsReconciliation) throw new Error('Finish the payroll period checks first.');
  const now = new Date().toISOString();
  const recordExceptionsJson = addRecordException({ row, attendanceId, reason, actor, recordedAt: now });
  const latest = (await getPayrollRunRows({ force: true })).find((run) => clean(run.payroll_id) === row.payrollId);
  if (clean(latest?.updated_at) !== clean(existing?.updated_at)) throw new Error('Payroll changed. Refresh before saving this exception.');
  await upsertPayrollRunRow({ ...draftPayload(row, existing, now), record_exceptions_json: recordExceptionsJson });
  return { ok: true };
}

async function gmailSend({ config, raw }) {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: response.data?.id || '' };
}

export async function sendPayrollRecordsNudge({ context, actor, env = process.env, send = gmailSend }) {
  const previous = globalThis.__firstChordRecordsNudgeLock || Promise.resolve();
  let release;
  globalThis.__firstChordRecordsNudgeLock = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  try {
    const { row, existing } = await loadFreshPayrollRecordRow(context);
    if (row.legacyNeedsReconciliation || row.priorRunPending || row.overlapsPaid || row.overlapsOutstanding || row.cutoverNeedsStart) return { ok: false, reason: 'period_check' };
    const loaded = await loadTutorPayrollPreference({ tutorShortName: row.tutorShortName });
    if (!loaded.ok) return { ok: false, reason: 'contact_missing' };
    const decision = decideRecordsNudge({ row, contactEmail: loaded.preference.contactEmail, verifiedAt: loaded.preference.contactEmailVerifiedAt });
    if (!decision.ok) return decision;
    const email = decision.email;
    const config = getPracticeNotesEmailConfig(env);
    if (config.missing.length) return { ok: false, reason: 'gmail_not_configured' };
    const content = buildRecordsNudgeEmail({ tutorName: row.tutor, periodStart: row.periodStart, periodEnd: row.periodEnd, readiness: decision.readiness });
    const raw = buildGmailRawMessage({ fromEmail: config.fromEmail, fromName: config.fromName, toEmail: email,
      subject: content.subject, plainText: content.plainText, html: content.html });
    const latest = (await getPayrollRunRows({ force: true })).find((run) => clean(run.payroll_id) === row.payrollId);
    if (clean(latest?.updated_at) !== clean(existing?.updated_at)) return { ok: false, reason: 'changed' };
    const attemptedAt = new Date().toISOString();
    const base = draftPayload(row, existing, attemptedAt);
    await upsertPayrollRunRow({ ...base, records_nudge_status: 'sending', records_nudge_to: email,
      records_nudge_attempted_at: attemptedAt, records_nudge_fingerprint: decision.fingerprint,
      records_nudge_message_id: '', records_nudge_sent_at: '', records_nudge_sent_by: '' });
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('send_timeout')), 10000); });
      const result = await Promise.race([send({ config, raw }), timeout]);
      const sentAt = new Date().toISOString();
      await upsertPayrollRunRow({ ...base, records_nudge_status: 'sent', records_nudge_to: email,
        records_nudge_attempted_at: attemptedAt, records_nudge_fingerprint: decision.fingerprint,
        records_nudge_message_id: result?.id || '', records_nudge_sent_at: sentAt,
        records_nudge_sent_by: clean(actor), updated_at: sentAt });
      return { ok: true, recipient: email, sentAt, actor: clean(actor) };
    } catch {
      const failedAt = new Date().toISOString();
      await upsertPayrollRunRow({ ...base, records_nudge_status: 'unknown', records_nudge_to: email,
        records_nudge_attempted_at: attemptedAt, records_nudge_fingerprint: decision.fingerprint,
        records_nudge_message_id: '', records_nudge_sent_at: '', records_nudge_sent_by: '', updated_at: failedAt });
      return { ok: false, reason: 'check_gmail' };
    } finally { clearTimeout(timer); }
  } finally { release(); }
}
