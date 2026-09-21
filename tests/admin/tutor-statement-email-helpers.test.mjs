import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTutorStatementEmailContent,
  decideStatementEmailDelivery,
} from '../../lib/admin/tutor-statement-email-helpers.mjs';

test('statement email requires a reviewed run and verified contact', () => {
  assert.equal(decideStatementEmailDelivery({ run: { status: 'draft' }, contactEmail: 'a@example.com', contactEmailVerifiedAt: 'now' }).reason, 'not_reviewed');
  assert.equal(decideStatementEmailDelivery({ run: { status: 'reviewed' }, contactEmail: 'a@example.com' }).reason, 'contact_email_unverified');
  assert.deepEqual(decideStatementEmailDelivery({ run: { status: 'reviewed' }, contactEmail: 'A@example.com', contactEmailVerifiedAt: 'now' }), { ok: true, email: 'a@example.com' });
});

test('sent, in-flight, and uncertain deliveries refuse another provider call', () => {
  assert.equal(decideStatementEmailDelivery({ run: { status: 'reviewed', statement_sent_at: 'now' } }).reason, 'already_sent');
  assert.equal(decideStatementEmailDelivery({ run: { status: 'reviewed', statement_delivery_status: 'sending' } }).reason, 'manual_follow_up');
  assert.equal(decideStatementEmailDelivery({ run: { status: 'reviewed', statement_delivery_status: 'unknown' } }).reason, 'manual_follow_up');
});

test('email content contains the private review link but no student or amount detail', () => {
  const content = buildTutorStatementEmailContent({
    tutorName: 'Dean Parker',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-14',
    statementUrl: 'https://example.com/pay/statement/private-token',
  });
  assert.match(content.subject, /1 Sept 2026 to 14 Sept 2026/u);
  assert.match(content.plainText, /private-token/u);
  assert.doesNotMatch(content.plainText, /£|student/u);
  assert.match(content.html, /Review pay statement/u);
});

test('cutover email explains the one-off boundary without adding pay detail', () => {
  const content = buildTutorStatementEmailContent({
    tutorName: 'Dean Parker',
    periodStart: '2026-09-14',
    periodEnd: '2026-09-20',
    statementUrl: 'https://example.com/pay/statement/private-token',
    isCutover: true,
  });
  assert.match(content.subject, /cutover pay statement/u);
  assert.match(content.plainText, /closes the previous payroll cycle through Sunday 20 September/u);
  assert.match(content.plainText, /Monday-based periods start on Monday 21 September/u);
  assert.doesNotMatch(content.plainText, /£|student/u);
});
