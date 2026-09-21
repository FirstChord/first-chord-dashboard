/** @fileoverview Claims, sends, and audits one admin-approved tutor statement email without moving money. */
import { google } from 'googleapis';
import { getPracticeNotesEmailConfig } from './practice-notes-email.js';
import { buildGmailRawMessage } from './practice-notes-email-helpers.mjs';
import { getPayrollRunRows, upsertPayrollRunRow } from './sheets.js';
import { normalisePayrollRunRow } from './payroll-helpers.mjs';
import { buildStatementToken } from './tutor-statement-helpers.mjs';
import { loadTutorPayrollPreference } from './tutor-payroll-preferences.js';
import {
  buildTutorStatementEmailContent,
  decideStatementEmailDelivery,
} from './tutor-statement-email-helpers.mjs';

const SEND_TIMEOUT_MS = 10000;
const DEFAULT_BASE_URL = 'https://first-chord-dashbord-production.up.railway.app';

async function gmailSend({ config, raw }) {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: response.data?.id || '', threadId: response.data?.threadId || '' };
}

async function withStatementSendLock(operation) {
  const previous = globalThis.__firstChordStatementSendLock || Promise.resolve();
  let release;
  globalThis.__firstChordStatementSendLock = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function safeError(value = '') {
  return `${value || ''}`.replace(/[\r\n]+/gu, ' ').slice(0, 240);
}

export async function sendTutorStatementEmail({
  payrollId = '',
  actorEmail = '',
  env = process.env,
  send = gmailSend,
} = {}) {
  return withStatementSendLock(async () => {
    const id = `${payrollId || ''}`.trim();
    if (!id) return { ok: false, reason: 'missing_id' };

    const runs = await getPayrollRunRows();
    const raw = runs.find((row) => `${row.payroll_id ?? row.payrollId ?? ''}`.trim() === id);
    if (!raw) return { ok: false, reason: 'not_found' };
    const run = normalisePayrollRunRow(raw);
    const loaded = await loadTutorPayrollPreference({ tutorShortName: run.tutorShortName });
    if (!loaded.ok) return { ok: false, reason: loaded.reason };

    const decision = decideStatementEmailDelivery({
      run: raw,
      contactEmail: loaded.preference.contactEmail,
      contactEmailVerifiedAt: loaded.preference.contactEmailVerifiedAt,
    });
    if (!decision.ok) return decision;

    const secret = `${env.NEXTAUTH_SECRET || ''}`.trim();
    if (!secret) return { ok: false, reason: 'statement_secret_missing' };
    const config = getPracticeNotesEmailConfig(env);
    if (config.missing.length) return { ok: false, reason: 'gmail_not_configured' };

    const baseUrl = `${env.NEXTAUTH_URL || DEFAULT_BASE_URL}`.trim().replace(/\/+$/u, '');
    const token = buildStatementToken({ payrollId: id, tutorShortName: run.tutorShortName, secret });
    const statementUrl = `${baseUrl}/pay/statement/${token}`;
    const content = buildTutorStatementEmailContent({
      tutorName: run.tutor,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      statementUrl,
    });
    const rawMessage = buildGmailRawMessage({
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      toEmail: decision.email,
      subject: content.subject,
      plainText: content.plainText,
      html: content.html,
    });

    // Claim before provider work. A crash after this point leaves `sending`,
    // which deliberately requires checking Gmail rather than risking a duplicate.
    const attemptedAt = new Date().toISOString();
    await upsertPayrollRunRow({
      ...raw,
      statement_delivery_status: 'sending',
      statement_delivery_channel: 'gmail',
      statement_delivery_to: decision.email,
      statement_delivery_attempted_at: attemptedAt,
      statement_delivery_message_id: '',
      statement_delivery_error: '',
      updated_at: attemptedAt,
    });

    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('send_timeout')), SEND_TIMEOUT_MS);
      });
      const result = await Promise.race([send({ config, raw: rawMessage }), timeout]);
      const sentAt = new Date().toISOString();
      await upsertPayrollRunRow({
        ...raw,
        statement_sent_at: sentAt,
        statement_sent_by: `${actorEmail || ''}`.trim(),
        statement_delivery_status: 'sent',
        statement_delivery_channel: 'gmail',
        statement_delivery_to: decision.email,
        statement_delivery_attempted_at: attemptedAt,
        statement_delivery_message_id: result?.id || '',
        statement_delivery_error: '',
        updated_at: sentAt,
      });
      return { ok: true, sentAt, recipient: decision.email, messageId: result?.id || '' };
    } catch (error) {
      const failedAt = new Date().toISOString();
      await upsertPayrollRunRow({
        ...raw,
        statement_delivery_status: 'unknown',
        statement_delivery_channel: 'gmail',
        statement_delivery_to: decision.email,
        statement_delivery_attempted_at: attemptedAt,
        statement_delivery_message_id: '',
        statement_delivery_error: safeError(error?.message || 'send_failed'),
        updated_at: failedAt,
      });
      return { ok: false, reason: 'delivery_unknown' };
    } finally {
      clearTimeout(timer);
    }
  });
}
