/** @fileoverview Pure builders, renderers, and signed tokens for the read-only tutor pay statement; no money moves here. */
// Tutor pay statement — the "here's what you're owed this period" document a
// tutor can review before they're paid (Phase 1 of tutor-facing payroll). Pure
// + unit-tested. The frozen total comes from a reviewed Payroll_Runs row (the
// same source the Wise CSV reads); the per-lesson lines are a best-effort
// breakdown recomputed for that window. No money moves here — this only renders
// and signs a read-only link.
import { requiresPayrollConfirmation } from './payroll-cycle-helpers.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatPayrollDate, isPayrollCutoverPeriod, PAYROLL_NEW_SYSTEM_START } from './payroll-helpers.mjs';

function money(value) {
  const n = Number(value);
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function hoursLabel(minutes) {
  const m = Number(minutes) || 0;
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h${rem ? ` ${rem}m` : ''}`;
}

export function buildStatementReference({
  payrollId = '',
  tutorShortName = '',
  periodStart = '',
  periodEnd = '',
} = {}) {
  const tutor = `${tutorShortName || 'TUTOR'}`
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'TUTOR';
  const start = `${periodStart || ''}`.replace(/[^0-9]/g, '') || 'START';
  const end = `${periodEnd || ''}`.replace(/[^0-9]/g, '') || 'END';
  // The readable dates make the reference useful in WhatsApp/files. The
  // payroll id remains the underlying unique key and is retained separately.
  return `FC-${tutor}-${start}-${end}${payrollId ? '' : '-DRAFT'}`;
}

// savedRow = normalisePayrollRunRow output (frozen total/period/status).
// previewRow = the payroll preview row resolved for that SAME window (for lines).
export function buildTutorStatement({ savedRow = {}, previewRow = {} } = {}) {
  const lines = (previewRow.payableSlots || []).map((slot) => ({
    date: slot.startAt || slot.lessonDate || '',
    student: (slot.students || []).map((student) => student.studentName).filter(Boolean).join(', ') || 'Lesson',
    minutes: Number(slot.durationMinutes) || 0,
    amount: slot.amount ?? null,
    isGroup: (slot.studentCount || 1) > 1,
    isCover: Boolean(slot.isCover),
  }));
  const payrollId = savedRow.payrollId || previewRow.payrollId || '';
  const tutorShortName = savedRow.tutorShortName || previewRow.tutorShortName || '';
  const periodStart = savedRow.periodStart || previewRow.periodStart || '';
  const periodEnd = savedRow.periodEnd || previewRow.periodEnd || '';
  const status = savedRow.status || 'reviewed';
  const isCutover = isPayrollCutoverPeriod({ periodEnd });
  return {
    payrollId,
    reference: buildStatementReference({ payrollId, tutorShortName, periodStart, periodEnd }),
    tutor: savedRow.tutor || previewRow.tutor || '',
    tutorShortName,
    periodStart,
    periodEnd,
    cadence: savedRow.invoiceCadence || previewRow.invoiceCadence || 'weekly',
    isCutover,
    lines,
    lessonCount: previewRow.lessonCount ?? lines.length,
    teachingMinutes: previewRow.teachingMinutes ?? lines.reduce((sum, line) => sum + line.minutes, 0),
    total: Number(savedRow.finalAmount ?? previewRow.finalAmount ?? 0),
    status,
    paidVia: savedRow.paidVia || '',
    documentType: status === 'paid' ? 'receipt' : 'statement',
    paymentRoute: requiresPayrollConfirmation({ periodStart, periodEnd }) ? 'confirmation' : (savedRow.paymentRoute || previewRow.paymentRoute || 'normal'),
    issuedAt: savedRow.reviewedAt || savedRow.statementSentAt || savedRow.createdAt || periodEnd,
    paidAt: savedRow.paidAt || '',
    // Current tutor response (Phase 2): '' | 'confirmed' | 'disputed'.
    tutorResponse: savedRow.tutorResponse || '',
    tutorRespondedAt: savedRow.tutorRespondedAt || '',
    tutorNote: savedRow.tutorNote || '',
    // A past taught-but-unrecorded lesson means the total may still move — worth a caveat.
    hasUnrecorded: (previewRow.reviewPastCount || 0) > 0,
    attendanceChanged: Boolean(previewRow.attendanceChanged),
    generatedAt: new Date().toISOString(),
  };
}

function periodLabel(statement) {
  return `${formatPayrollDate(statement.periodStart)} – ${formatPayrollDate(statement.periodEnd)} (${statement.isCutover ? 'one-off cutover' : statement.cadence})`;
}

export function renderTutorStatementText(statement = {}) {
  const lines = (statement.lines || []).map((line) => {
    const tags = [line.isGroup ? 'group' : '', line.isCover ? 'cover' : ''].filter(Boolean).join(', ');
    return `  ${formatPayrollDate(line.date, { withTime: true })} · ${line.student}${tags ? ` (${tags})` : ''} · ${line.minutes} min · ${money(line.amount)}`;
  });
  const parts = [
    `First Chord Music School — ${statement.isCutover ? 'cutover ' : ''}${statement.documentType === 'receipt' ? 'payment receipt' : 'payment statement'}`,
    `Reference: ${statement.reference || '—'}`,
    `For: ${statement.tutor}`,
    `Period: ${periodLabel(statement)}`,
    '',
    'Lessons:',
    lines.length ? lines.join('\n') : '  (no payable lessons found for this period)',
    '',
    `Total lessons: ${statement.lessonCount} · ${hoursLabel(statement.teachingMinutes)}`,
    `Amount: ${money(statement.total)}`,
  ];
  if (statement.isCutover) {
    parts.push('', `This one-off statement closes legacy pay through ${formatPayrollDate(statement.periodEnd)}. New Monday-based periods begin ${formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}.`);
  }
  if (statement.tutorResponse === 'confirmed') {
    parts.push(`Confirmed: ${formatPayrollDate(statement.tutorRespondedAt)}`);
  }
  if (statement.status === 'paid') {
    parts.push(`Paid: ${formatPayrollDate(statement.paidAt)}`);
  }
  if (statement.hasUnrecorded) {
    parts.push('', 'Note: some lessons in this period aren’t yet marked in the register, so this figure may still change.');
  }
  parts.push('', statement.status === 'paid'
    ? 'If anything looks off in this record, please reply and we’ll review it. Thank you!'
    : 'If anything looks off, just reply and we’ll sort it before payment. Thank you!');
  return parts.join('\n');
}

export function renderTutorStatementHtml(statement = {}) {
  const rows = (statement.lines || []).map((line) => {
    const tags = [line.isGroup ? 'group' : '', line.isCover ? 'cover' : ''].filter(Boolean).join(', ');
    return `<tr>
      <td style="padding:6px 12px 6px 0;color:#334155;white-space:nowrap">${formatPayrollDate(line.date, { withTime: true })}</td>
      <td style="padding:6px 12px 6px 0;color:#0f172a">${line.student}${tags ? ` <span style="color:#94a3b8">(${tags})</span>` : ''}</td>
      <td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${line.minutes} min</td>
      <td style="padding:6px 0;color:#0f172a;text-align:right;white-space:nowrap">${money(line.amount)}</td>
    </tr>`;
  }).join('');
  const caveat = statement.hasUnrecorded
    ? '<p style="color:#b45309;font-size:13px">Note: some lessons in this period aren’t yet marked in the register, so this figure may still change.</p>'
    : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#0f172a">
  <p style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin:0">First Chord Music School</p>
  <h2 style="margin:4px 0 2px;font-size:20px">${statement.isCutover ? 'Cutover ' : ''}${statement.documentType === 'receipt' ? 'payment receipt' : 'payment statement'}</h2>
  <p style="margin:0 0 8px;color:#64748b;font-size:12px">Reference ${statement.reference || '—'}</p>
  <p style="margin:0 0 2px;font-weight:600">${statement.tutor}</p>
  <p style="margin:0 0 16px;color:#64748b;font-size:14px">${periodLabel(statement)}</p>
  ${statement.isCutover ? `<p style="margin:0 0 16px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;padding:10px;color:#1e3a8a;font-size:13px">This one-off statement closes legacy pay through ${formatPayrollDate(statement.periodEnd)}. New Monday-based periods begin ${formatPayrollDate(PAYROLL_NEW_SYSTEM_START)}.</p>` : ''}
  <table style="border-collapse:collapse;width:100%;font-size:14px">${rows || '<tr><td style="color:#94a3b8;padding:6px 0">No payable lessons found for this period.</td></tr>'}</table>
  <p style="margin:16px 0 0;border-top:1px solid #e2e8f0;padding-top:12px;font-size:15px">
    <strong>${statement.lessonCount} lessons · ${hoursLabel(statement.teachingMinutes)}</strong>
    <span style="float:right;font-size:18px;font-weight:700">${money(statement.total)}</span>
  </p>
  ${caveat}
  <p style="margin:20px 0 0;color:#475569;font-size:13px">${statement.status === 'paid' ? 'If anything looks off in this record, please reply and we’ll review it.' : 'If anything looks off, just reply and we’ll sort it before payment.'} Thank you!</p>
</div>`;
}

// ---- Signed read-only link (no login) ---------------------------------------
// Token = base64url(payload).base64url(HMAC-SHA256). Carries the payroll_id (the
// frozen row) so the view re-derives from the sheet, and an expiry. Phase 2 adds
// a Confirm button on the same link — the token proves "this tutor, this row".

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signStatementToken(payload = {}, secret = '') {
  if (!secret) throw new Error('signStatementToken requires a secret');
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyStatementToken(token = '', secret = '', { now = Date.now() } = {}) {
  if (!secret || !token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Number(payload.exp) < now) return null;
  return payload;
}

// 30 days is plenty for a pay-period statement; keeps stale links from lingering.
const STATEMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function buildStatementToken({ payrollId = '', tutorShortName = '', secret = '', now = Date.now() } = {}) {
  return signStatementToken(
    { pid: payrollId, t: tutorShortName, iat: now, exp: now + STATEMENT_LINK_TTL_MS },
    secret,
  );
}
