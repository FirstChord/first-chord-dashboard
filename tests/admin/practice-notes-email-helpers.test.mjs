import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGmailRawMessage,
  buildPracticeNoteEmailContent,
  buildPracticeNoteEmailSubject,
  buildPracticeNoteStudentLabel,
  normaliseEmailList,
} from '../../lib/admin/practice-notes-email-helpers.mjs';
import {
  getPracticeNotesEmailConfig,
} from '../../lib/admin/practice-notes-email.js';

test('buildPracticeNoteEmailSubject includes the student name', () => {
  assert.equal(buildPracticeNoteEmailSubject({ studentName: 'Test Studenty' }), 'Test Studenty’s practice notes · First Chord');
  assert.equal(buildPracticeNoteEmailSubject(), 'Practice notes · First Chord');
});

test('first-name email labels use each covered student and preserve given-name punctuation', () => {
  assert.equal(buildPracticeNoteStudentLabel({studentName:'Tabitha Example (voice)'}),'Tabitha');
  assert.equal(buildPracticeNoteStudentLabel({students:[{firstName:'Mary Jane (piano)'},{firstName:'Anne-Marie'},{firstName:'Élodie'}]}),'Mary Jane, Anne-Marie and Élodie');
  assert.equal(buildPracticeNoteStudentLabel({students:[{studentName:'Simon Example'},{studentName:'Simon Other'}]}),'Simon and Simon');
  assert.equal(buildPracticeNoteStudentLabel({studentName:'Unrelated Person',students:[{studentName:'Simon Example'},{studentName:'Nina Sample'}]}),'Simon and Nina');
  assert.equal(buildPracticeNoteStudentLabel(), '');
  assert.equal(buildPracticeNoteEmailSubject({studentName:buildPracticeNoteStudentLabel({studentName:'Tabitha Example (voice)'})}),'Tabitha’s practice notes · First Chord');
});

test('buildPracticeNoteEmailContent creates plain text and escaped HTML', () => {
  const content = buildPracticeNoteEmailContent({
    studentName: 'Test Studenty',
    tutorName: 'Finn',
    noteText: '[What we did]\nA <scale> & rhythm.',
  });

  assert.match(content.plain, /Test Studenty's lesson with Finn/u);
  assert.match(content.plain, /A <scale> & rhythm/u);
  assert.match(content.html, /Test Studenty&#39;s lesson with Finn/u);
  assert.match(content.html, /A &lt;scale&gt; &amp; rhythm/u);
});

test('buildPracticeNoteEmailContent gives each section heading its own block', () => {
  const content = buildPracticeNoteEmailContent({
    studentName: 'Test Studenty',
    tutorName: 'Finn',
    noteText: [
      '[What we did]',
      'Scales and Twinkle.',
      '',
      '[Progress & Challenges]',
      'F chord still tricky.',
      '',
      '[Practice Goals]',
      '- Scales daily',
    ].join('\n'),
  });

  // Gmail needs a real block boundary: the heading used to share a <p> with the
  // body, separated only by <br>, which left nothing to put space around.
  assert.match(content.html, /<p style="[^"]*font-weight:bold;">What we did<\/p><p>Scales and Twinkle\.<\/p>/u);
  assert.match(content.html, /<p style="[^"]*font-weight:bold;">Progress &amp; Challenges<\/p>/u);
  assert.match(content.html, /<p style="[^"]*font-weight:bold;">Practice Goals<\/p><ul><li>Scales daily<\/li><\/ul>/u);

  // Styling has to be inline; Gmail discards <style> blocks and <head>.
  assert.equal(/<style|<head/u.test(content.html), false);

  // The brackets are an internal marker, not something a parent should read.
  assert.equal(content.html.includes('[What we did]'), false);
  assert.match(content.plain, /^What we did:$/mu);
  assert.equal(content.plain.includes('[What we did]'), false);
});

test('buildGmailRawMessage returns base64url MIME without leaking newlines in headers', () => {
  const raw = buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    fromName: 'First Chord\nMusic School',
    toEmail: 'parent@example.com',
    subject: 'Practice notes\r\nInjected',
    plainText: 'Plain',
    html: '<p>HTML</p>',
  });
  const decoded = Buffer.from(raw.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');

  assert.match(decoded, /From: First Chord Music School <musiclessons@firstchord.co.uk>/u);
  assert.match(decoded, /To: parent@example.com/u);
  assert.match(decoded, /Subject: Practice notes Injected/u);
  assert.match(decoded, /Content-Type: multipart\/alternative/u);
});

test('getPracticeNotesEmailConfig reports missing Gmail configuration', () => {
  const config = getPracticeNotesEmailConfig({});
  assert.deepEqual(config.missing, [
    'GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID',
    'GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ]);
});

test('getPracticeNotesEmailConfig can reuse the dashboard Google OAuth client', () => {
  const config = getPracticeNotesEmailConfig({
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-refresh',
  });

  assert.equal(config.clientId, 'google-client');
  assert.equal(config.clientSecret, 'google-secret');
  assert.equal(config.refreshToken, 'gmail-refresh');
  assert.deepEqual(config.missing, []);
});

function decodeRaw(raw = '') {
  return Buffer.from(raw.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
}

test('Unicode subjects survive MIME encoding, folding and header sanitisation', () => {
  for (const subject of [
    buildPracticeNoteEmailSubject({ studentName: 'Alex' }),
    buildPracticeNoteEmailSubject({ studentName: 'Athena and Sophia' }),
    buildPracticeNoteEmailSubject({ studentName: 'Élodie 王 🎵 '.repeat(15).trim() }),
    'Élodie’s notes\r\nBcc: hidden@example.com',
  ]) {
    const message = decodeRaw(buildGmailRawMessage({ subject, toEmail: 'parent@example.com' }));
    const header = message.match(/^Subject: (.*(?:\r\n .*)*)\r\nMIME-Version:/mu)?.[1];
    assert.ok(header);
    const words = [...header.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gu)];
    assert.ok(words.length);
    for (const word of words) assert.ok(word[0].length <= 75);
    for (const line of `Subject: ${header}`.split('\r\n')) assert.ok(line.length <= 76);
    assert.equal(words.map(word => Buffer.from(word[1], 'base64').toString('utf8')).join(''), subject.replace(/[\r\n]+/gu, ' '));
    assert.doesNotMatch(message, /\r\nBcc: hidden/u);
    assert.doesNotMatch(header, /[^\x20-\x7e\r\n]/u);
  }
});

test('a second parent is Bcc\'d, not added to the To line', () => {
  // Calan's parents are separated. Neither address may appear in the other's
  // copy, and a reply must not become a reply-all between them.
  const decoded = decodeRaw(buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    toEmail: 'ross@example.com',
    bccEmails: ['clare@example.com'],
    subject: 'Practice notes for Calan',
  }));

  assert.match(decoded, /To: ross@example\.com/u);
  assert.match(decoded, /Bcc: clare@example\.com/u);
  assert.doesNotMatch(decoded, /To:.*clare@example\.com/u);
  assert.doesNotMatch(decoded, /Cc: /u);
});

test('buildGmailRawMessage omits the Bcc header for a single-parent household', () => {
  const decoded = decodeRaw(buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    toEmail: 'parent@example.com',
    subject: 'Practice notes',
  }));

  assert.doesNotMatch(decoded, /Bcc:/u);
});

test('the primary address is never also Bcc\'d itself', () => {
  // MMS can list the same carer twice across parent records; a duplicate would
  // otherwise deliver two copies to the same inbox.
  const decoded = decodeRaw(buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    toEmail: 'ross@example.com',
    bccEmails: ['ross@example.com', 'clare@example.com', 'clare@example.com'],
    subject: 'Practice notes',
  }));

  assert.match(decoded, /Bcc: clare@example\.com\r\n/u);
});

test('Bcc addresses cannot smuggle a header break', () => {
  const decoded = decodeRaw(buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    toEmail: 'ross@example.com',
    bccEmails: ['clare@example.com\r\nSubject: Injected'],
    subject: 'Practice notes',
  }));

  // encodeHeader collapses the CRLF, so the text survives as part of the Bcc
  // value. What must never happen is it starting a header line of its own.
  assert.doesNotMatch(decoded, /\r\nSubject: Injected/u);
  assert.match(decoded, /\r\nSubject: Practice notes\r\n/u);
});

test('normaliseEmailList accepts recipient objects and bare strings', () => {
  assert.deepEqual(
    normaliseEmailList([{ email: 'clare@example.com' }, 'ross@example.com', { email: '' }, 'CLARE@example.com']),
    ['clare@example.com', 'ross@example.com'],
  );
});
