/** @fileoverview Pure builders for the practice-note email subject, inline-styled HTML body, and raw Gmail message. */
import { noteMarkupToHtml, stripNoteMarkers } from '../notes-markup.mjs';
import { normalisePracticeNoteHeadings } from './practice-notes-helpers.mjs';

// Inline styles preserve appearance across mail clients with limited stylesheet
// support. Margin above is larger than below so each heading
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

function encodeSubjectHeader(value = '') {
  const text = encodeHeader(value);
  if (/^[\x20-\x7e]*$/u.test(text)) return text;
  // RFC 2047 encoded words preserve the middle dot, apostrophe and names in
  // older mail clients. 39 UTF-8 bytes leave room for the Subject prefix within
  // the 76-character line limit. Never split a multibyte character.
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 39) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`).join('\r\n ');
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
  return student ? `${student}’s practice notes · First Chord` : 'Practice notes · First Chord';
}

// Display only: keep authoritative full names/IDs in review, notes and audit.
// Structured first names preserve compound given names. For an unmapped
// student, use the first word of that student's own name, never a household
// label: the server supplies covered members separately.
export function buildPracticeNoteStudentLabel({ studentName = '', students = [] } = {}) {
  const members = students.length ? students : [{ studentName }];
  const names = members.map(member => {
    const given = clean(member.firstName).replace(/\s*\([^)]*\)/gu, '').trim();
    return given || clean(member.studentName).split(/\s+/u)[0] || '';
  }).filter(Boolean);
  if (names.length < 2) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
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
    `Subject: ${encodeSubjectHeader(subject)}`,
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
