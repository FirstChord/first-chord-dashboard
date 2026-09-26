/** @fileoverview Pure content and safety decisions for emailing one reviewed tutor pay statement. */
import { normalisePayrollContactEmail } from './tutor-payroll-preferences-helpers.mjs';

function clean(value = '') {
  return `${value || ''}`.trim();
}

function escapeHtml(value = '') {
  return clean(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function formatDate(value = '') {
  const parsed = new Date(`${clean(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return clean(value);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function normaliseStatementDeliveryStatus(value = '') {
  const status = clean(value).toLowerCase();
  return ['sending', 'sent', 'manual', 'unknown'].includes(status) ? status : '';
}

export function decideStatementEmailDelivery({ run = {}, contactEmail = '', contactEmailVerifiedAt = '' } = {}) {
  const status = clean(run.status).toLowerCase();
  const deliveryStatus = normaliseStatementDeliveryStatus(run.statement_delivery_status ?? run.statementDeliveryStatus);
  const sentAt = clean(run.statement_sent_at ?? run.statementSentAt);
  const email = normalisePayrollContactEmail(contactEmail);
  if (status !== 'reviewed') return { ok: false, reason: 'not_reviewed' };
  if (sentAt || ['sent', 'manual'].includes(deliveryStatus)) return { ok: false, reason: 'already_sent' };
  if (['sending', 'unknown'].includes(deliveryStatus)) return { ok: false, reason: 'manual_follow_up' };
  if (!email) return { ok: false, reason: 'contact_email_missing' };
  if (!clean(contactEmailVerifiedAt)) return { ok: false, reason: 'contact_email_unverified' };
  return { ok: true, email };
}

export function buildTutorStatementEmailContent({
  tutorName = '',
  periodStart = '',
  periodEnd = '',
  statementUrl = '',
  isCutover = false,
} = {}) {
  const firstName = clean(tutorName).split(/\s+/u)[0] || 'there';
  const period = `${formatDate(periodStart)} to ${formatDate(periodEnd)}`;
  const url = clean(statementUrl);
  const subject = `Your First Chord ${isCutover ? 'cutover ' : ''}pay statement · ${period}`;
  const plainText = [
    `Hi ${firstName},`,
    '',
    `Your First Chord ${isCutover ? 'one-off cutover ' : ''}pay statement for ${period} is ready.`,
    ...(isCutover ? ['', 'This closes the previous payroll cycle through Sunday 20 September. New Monday-based periods start on Monday 21 September.'] : []),
    '',
    'Please review the lesson breakdown and either confirm it or raise a query:',
    ...(!isCutover ? ['Confirm before 9am on Wednesday (UK time) for that week’s payment run. Unconfirmed statements carry forward to the following week.'] : []),
    url,
    '',
    'The private link expires after 30 days. Confirming the statement does not itself move money.',
    '',
    'Best,',
    'First Chord Music School',
  ].join('\n');
  const html = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Your First Chord ${isCutover ? 'one-off cutover ' : ''}pay statement for <strong>${escapeHtml(period)}</strong> is ready.</p>`,
    ...(isCutover ? ['<p>This closes the previous payroll cycle through Sunday 20 September. New Monday-based periods start on Monday 21 September.</p>'] : []),
    '<p>Please review the lesson breakdown and either confirm it or raise a query:</p>',
    ...(!isCutover ? ['<p>Confirm before 9am on Wednesday (UK time) for that week’s payment run. Unconfirmed statements carry forward to the following week.</p>'] : []),
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:10px;background:#0f172a;color:#ffffff;padding:11px 16px;text-decoration:none;font-weight:700">Review pay statement</a></p>`,
    '<p style="color:#64748b;font-size:13px">The private link expires after 30 days. Confirming the statement does not itself move money.</p>',
    '<p>Best,<br>First Chord Music School</p>',
  ].join('\n');
  return { subject, plainText, html };
}
