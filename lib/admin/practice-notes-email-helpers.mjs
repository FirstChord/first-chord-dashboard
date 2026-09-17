/** @fileoverview Pure builders for the practice-note email subject, inline-styled HTML body, and raw Gmail message. */
import { noteMarkupToHtml, stripNoteMarkers } from '../notes-markup.mjs';
import { normalisePracticeNoteHeadings } from './practice-notes-helpers.mjs';

// Inline, because Gmail drops <style> blocks and <head> entirely — a stylesheet
// would silently do nothing. Margin above is larger than below so each heading
// binds visually to the text it introduces rather than floating between sections.
const EMAIL_HEADING_STYLE = 'margin:20px 0 6px;font-weight:bold;';

function renderEmailHeading(escapedHeading = '') {
  return `<p style="${EMAIL_HEADING_STYLE}">${escapedHeading}</p>`;
}

function clean(value = '') {
  return `${value || ''}`.trim();
}

function escapeHtml(value = '') {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeHeader(value = '') {
  return clean(value).replace(/[\r\n]+/gu, ' ');
}

// Deduplicated, blank-free, order-preserving. Duplicates matter: a parent listed
// twice in MMS would otherwise be Bcc'd their own copy twice.
export function normaliseEmailList(values = []) {
  const seen = new Set();
  const list = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const email = clean(typeof value === 'string' ? value : value?.email);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(email);
  }
  return list;
}

function encodeBase64Url(value = '') {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

function noteTextToHtml(noteText = '') {
  return noteMarkupToHtml(noteText, {
    escape: escapeHtml,
    join: '\n',
    renderHeading: renderEmailHeading,
  });
}

export function buildPracticeNoteEmailContent({
  studentName = '',
  tutorName = '',
  noteText = '',
} = {}) {
  const student = clean(studentName) || 'your lesson';
  const tutor = clean(tutorName);
  const intro = tutor
    ? `Here are the practice notes from ${student}'s lesson with ${tutor}.`
    : `Here are the practice notes from ${student}'s lesson.`;
  // Normalise once, for both alternatives: this turns the tutor's `[What we did]`
  // into the canonical `**What we did:**` the portal already renders, so a parent
  // reading the email and the same note in the portal sees the same structure.
  const note = normalisePracticeNoteHeadings(clean(noteText));
  const plain = [
    'Hi,',
    '',
    intro,
    '',
    // The text/plain alternative shows the note as prose: emphasis markers would
    // be visible punctuation to anyone whose client falls back to it.
    stripNoteMarkers(note),
    '',
    'Best,',
    'First Chord Music School',
  ].join('\n');

  const html = [
    '<p>Hi,</p>',
    `<p>${escapeHtml(intro)}</p>`,
    noteTextToHtml(note),
    '<p>Best,<br>First Chord Music School</p>',
  ].filter(Boolean).join('\n');

  return { plain, html };
}

export function buildPracticeNoteEmailSubject({ studentName = '' } = {}) {
  const student = clean(studentName);
  return student ? `Practice notes for ${student}` : 'Practice notes';
}

// A household with more than one parent (separated parents, two addresses) gets
// one send: the MMS parent of record on `To:` and the rest on `Bcc:`. Bcc rather
// than To/Cc so neither parent sees the other's address and a reply cannot turn
// into a reply-all between them.
export function buildGmailRawMessage({
  fromEmail = '',
  fromName = '',
  toEmail = '',
  bccEmails = [],
  subject = '',
  plainText = '',
  html = '',
} = {}) {
  const boundary = `firstchord_${Date.now().toString(36)}`;
  const from = fromName
    ? `${encodeHeader(fromName)} <${encodeHeader(fromEmail)}>`
    : encodeHeader(fromEmail);
  const bcc = normaliseEmailList(bccEmails).filter((email) => email !== clean(toEmail));
  const message = [
    `From: ${from}`,
    `To: ${encodeHeader(toEmail)}`,
    ...(bcc.length ? [`Bcc: ${bcc.map(encodeHeader).join(', ')}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    plainText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return encodeBase64Url(message);
}
