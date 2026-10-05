/** @fileoverview Gmail configuration and send path for practice-note emails. */
import { google } from 'googleapis';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STUDENTS_REGISTRY } from '../config/students-registry.js';
import { getStudentPortalAccessRow } from './sheets/student-portal-access.mjs';
import { buildStyledPracticeNoteContent, buildGmailRawMessageWithIllustration } from './practice-notes-design-helpers.mjs';
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

export async function preparePracticeNoteEmail({
  studentMmsId = '', studentName = '', tutorName = '', noteText = '', lessonDate = '',
  // Server-derived members covered by this household's one email. Never infer
  // sibling IDs by splitting a display name or include other lesson households.
  emailStudents = [],
  designEnabled = process.env.PRACTICE_NOTES_EMAIL_DESIGN_ENABLED !== 'false',
  readProtection = getStudentPortalAccessRow,
  readIllustration = () => readFile(path.join(process.cwd(), 'public/practice-chat-readers.png')),
  warn = console.warn,
} = {}) {
  const standard = () => ({ content: buildPracticeNoteEmailContent({ studentName, tutorName, noteText }), illustration: null });
  if (!designEnabled) return standard();
  try {
    const members = emailStudents.length ? emailStudents : [{ studentMmsId, studentName }];
    const seen = new Set();
    const dashboardLinks = [];
    let protectionEnabled = false;
    for (const member of members) {
      const entry = STUDENTS_REGISTRY[member.studentMmsId];
      if (!entry?.friendlyUrl || seen.has(member.studentMmsId)) continue;
      seen.add(member.studentMmsId);
      dashboardLinks.push({ studentName: member.studentName, url: `https://firstchord.co.uk/student/${encodeURIComponent(entry.friendlyUrl)}` });
      try {
        protectionEnabled ||= Boolean((await readProtection(member.studentMmsId))?.protectionEnabled);
      } catch {
        warn('Practice-note optional code reminder unavailable.');
      }
    }
    const illustration = await readIllustration();
    if (!Buffer.isBuffer(illustration) || !illustration.length) throw new Error('Missing practice-note illustration');
    const content = buildStyledPracticeNoteContent({
      studentName, studentNames: members.map(member => member.studentName), tutorName,
      noteText, lessonDate, dashboardLinks, protectionEnabled,
    });
    return { content, illustration };
  } catch {
    warn('Practice-note design unavailable; using the standard email.');
    return standard();
  }
}

export async function sendPracticeNoteEmail({
  recipient = {},
  // Every other parent on the MMS record. One send, addresses kept private —
  // see buildGmailRawMessage for why Bcc rather than To/Cc.
  bccRecipients = [],
  studentMmsId = '',
  lessonDate = '',
  emailStudents = [],
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
  const {content,illustration}=await preparePracticeNoteEmail({studentMmsId,studentName,tutorName,noteText,lessonDate,emailStudents});
  const subject = buildPracticeNoteEmailSubject({ studentName });
  const messageOptions = {
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    toEmail,
    bccEmails,
    subject,
    plainText: content.plain,
    html: content.html,
  };
  const raw=illustration?buildGmailRawMessageWithIllustration(messageOptions,illustration):buildGmailRawMessage(messageOptions);

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
