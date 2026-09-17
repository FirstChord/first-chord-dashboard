/** @fileoverview Gmail configuration and send path for practice-note emails. */
import { google } from 'googleapis';
import {
  buildGmailRawMessage,
  buildPracticeNoteEmailContent,
  buildPracticeNoteEmailSubject,
  normaliseEmailList,
} from './practice-notes-email-helpers.mjs';

export function getPracticeNotesEmailConfig(env = process.env) {
  const config = {
    clientId: env.GMAIL_CLIENT_ID || env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GMAIL_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.GMAIL_REFRESH_TOKEN || '',
    fromEmail: env.PRACTICE_NOTES_FROM_EMAIL || 'musiclessons@firstchord.co.uk',
    fromName: env.PRACTICE_NOTES_FROM_NAME || 'First Chord Music School',
  };
  const missing = [];
  if (!config.clientId) missing.push('GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID');
  if (!config.clientSecret) missing.push('GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET');
  if (!config.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  if (!config.fromEmail) missing.push('PRACTICE_NOTES_FROM_EMAIL');
  return { ...config, missing };
}

export function assertPracticeNotesEmailConfigured(env = process.env) {
  const config = getPracticeNotesEmailConfig(env);
  if (config.missing.length) {
    throw new Error(`Practice note email is not configured: missing ${config.missing.join(', ')}`);
  }
  return config;
}

export async function sendPracticeNoteEmail({
  recipient = {},
  // Every other parent on the MMS record. One send, addresses kept private —
  // see buildGmailRawMessage for why Bcc rather than To/Cc.
  bccRecipients = [],
  studentName = '',
  tutorName = '',
  noteText = '',
  config = assertPracticeNotesEmailConfigured(),
} = {}) {
  const toEmail = recipient.email || '';
  if (!toEmail) {
    throw new Error('Practice note email recipient is missing an email address.');
  }
  const bccEmails = normaliseEmailList(bccRecipients).filter((email) => email !== `${toEmail}`.trim());

  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const content = buildPracticeNoteEmailContent({ studentName, tutorName, noteText });
  const subject = buildPracticeNoteEmailSubject({ studentName });
  const raw = buildGmailRawMessage({
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    toEmail,
    bccEmails,
    subject,
    plainText: content.plain,
    html: content.html,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    ok: true,
    channel: 'gmail',
    toEmail,
    bccEmails,
    fromEmail: config.fromEmail,
    subject,
    gmailMessageId: response.data?.id || '',
    gmailThreadId: response.data?.threadId || '',
  };
}
