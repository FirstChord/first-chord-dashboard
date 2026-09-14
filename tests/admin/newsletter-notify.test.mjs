// The arrival email is the dashboard's first automatic email other than the
// tutor-confirmed Practice Chat note, so these pin its boundaries: who it can go
// to, that it cannot be turned into an injection vector by a student name or a
// tutor's text, and that a failure can never become a failed save.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNewsletterArrivalEmail,
  escapeHtml,
  resolveNewsletterNotifyRecipient,
  truncateForEmail,
} from '../../lib/admin/newsletter-notify-helpers.mjs';
import { notifyNewsletterArrival } from '../../lib/admin/newsletter-notify.js';
import { buildGmailRawMessage } from '../../lib/admin/practice-notes-email-helpers.mjs';

const decode = (raw) => Buffer.from(raw.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');

const GMAIL_ENV = {
  GMAIL_CLIENT_ID: 'id',
  GMAIL_CLIENT_SECRET: 'secret',
  GMAIL_REFRESH_TOKEN: 'refresh',
  PRACTICE_NOTES_FROM_EMAIL: 'musiclessons@firstchord.co.uk',
  NEXTAUTH_URL: 'https://first-chord-dashbord-production.up.railway.app',
};

function item(overrides = {}) {
  return {
    itemId: 'nli_2026-09_fc_std_fa157fc5',
    issueMonth: '2026-09',
    studentName: 'Hayley Adams',
    tutorName: 'Dean',
    tutorText: 'Hayley passed Grade 3 with distinction.',
    requestedAt: '2026-09-12T10:00:00.000Z',
    capturedAt: '2026-09-14T10:00:00.000Z',
    hasMedia: '',
    mediaJson: '',
    ...overrides,
  };
}

// --- recipient --------------------------------------------------------------

test('the recipient comes only from configuration, and must be one plain address', () => {
  assert.equal(resolveNewsletterNotifyRecipient({}).reason, 'recipient_not_configured');
  assert.equal(resolveNewsletterNotifyRecipient({ NEWSLETTER_NOTIFY_EMAIL: '  ' }).reason, 'recipient_not_configured');

  assert.deepEqual(
    resolveNewsletterNotifyRecipient({ NEWSLETTER_NOTIFY_EMAIL: ' Fenella@FirstChord.co.uk ' }),
    { recipient: 'fenella@firstchord.co.uk', reason: '' },
  );

  // A list would fan a child's details out to several inboxes; a display name or a
  // newline is how a header gets smuggled in. All refused.
  for (const bad of [
    'fenella@firstchord.co.uk,finn@firstchord.co.uk',
    'fenella@firstchord.co.uk; finn@firstchord.co.uk',
    'Fenella <fenella@firstchord.co.uk>',
    'fenella@firstchord.co.uk\r\nBcc: someone@example.com',
    'not-an-email',
    '@firstchord.co.uk',
  ]) {
    assert.equal(
      resolveNewsletterNotifyRecipient({ NEWSLETTER_NOTIFY_EMAIL: bad }).recipient,
      '',
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

// --- content ----------------------------------------------------------------

test('a tutor’s text and names are escaped in the HTML body', () => {
  const email = buildNewsletterArrivalEmail({
    studentName: '<img src=x onerror=alert(1)>',
    tutorName: 'Dean"><script>',
    tutorText: '<script>alert("hi")</script> & great',
    monthLabel: 'September 2026',
    dashboardUrl: 'https://first-chord-dashbord-production.up.railway.app/admin/newsletter',
  });
  assert.ok(!email.html.includes('<script>'), email.html);
  assert.ok(!email.html.includes('<img'), email.html);
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.ok(email.html.includes('&amp; great'));
  assert.equal(escapeHtml(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;');
});

test('a newline in a student name cannot inject an email header', () => {
  const email = buildNewsletterArrivalEmail({ studentName: 'Hayley\r\nBcc: someone@example.com', tutorName: 'Dean' });
  const raw = decode(buildGmailRawMessage({
    fromEmail: 'musiclessons@firstchord.co.uk',
    toEmail: 'fenella@firstchord.co.uk',
    subject: email.subject,
    plainText: email.plainText,
    html: email.html,
  }));
  const headers = raw.split('\r\n\r\n')[0].split('\r\n');
  assert.ok(!headers.some((line) => /^bcc:/iu.test(line)), headers.join(' | '));
});

test('only an absolute http(s) link is ever included', () => {
  for (const url of ['javascript:alert(1)', '/admin/newsletter', 'data:text/html,hi', '']) {
    const email = buildNewsletterArrivalEmail({ studentName: 'Hayley', dashboardUrl: url });
    assert.ok(!email.html.includes('href='), `${JSON.stringify(url)} must not become a link`);
  }
  const good = buildNewsletterArrivalEmail({ studentName: 'Hayley', dashboardUrl: 'https://example.com/admin/newsletter' });
  assert.ok(good.html.includes('href="https://example.com/admin/newsletter"'));
});

test('the email says what arrived, flags priorities, and reminds about permission for pictures', () => {
  const plain = buildNewsletterArrivalEmail({
    studentName: 'Hayley Adams',
    tutorName: 'Dean',
    tutorText: 'Passed Grade 3',
    isPriority: true,
    monthLabel: 'September 2026',
  });
  assert.equal(plain.subject, 'Newsletter: something new for Hayley Adams from Dean');
  assert.ok(plain.plainText.startsWith('Hi,'), 'house tone: opens with Hi');
  assert.ok(plain.plainText.includes('for the September 2026 newsletter'));
  assert.ok(plain.plainText.includes('They were on your priority list.'));
  assert.ok(plain.plainText.includes('"Passed Grade 3"'));
  assert.ok(plain.plainText.includes('Nothing has been published.'));
  assert.ok(!plain.plainText.includes('family will need asking'), 'no consent line without a picture');

  const withPhoto = buildNewsletterArrivalEmail({ studentName: 'Hayley', mediaLabel: '1 photo' });
  assert.ok(withPhoto.plainText.includes('Attached: 1 photo'));
  assert.ok(withPhoto.plainText.includes('family will need asking'));

  const extra = buildNewsletterArrivalEmail({ studentName: 'Jo', isPriority: false });
  assert.ok(!extra.plainText.includes('priority list'));
});

test('long text is capped rather than pasted whole into an inbox', () => {
  assert.equal(truncateForEmail('short'), 'short');
  const long = truncateForEmail('x'.repeat(2000));
  assert.equal(long.length, 600);
  assert.ok(long.endsWith('…'));
});

// --- the send ---------------------------------------------------------------

test('nothing is sent when no recipient is configured', async () => {
  let called = false;
  const result = await notifyNewsletterArrival({
    item: item(),
    env: GMAIL_ENV,
    send: async () => { called = true; return { id: 'x' }; },
  });
  assert.deepEqual(result, { sent: false, reason: 'recipient_not_configured' });
  assert.equal(called, false);
});

test('nothing is sent when the Gmail sender is not configured', async () => {
  let called = false;
  const result = await notifyNewsletterArrival({
    item: item(),
    env: { NEWSLETTER_NOTIFY_EMAIL: 'fenella@firstchord.co.uk' },
    send: async () => { called = true; return { id: 'x' }; },
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'gmail_not_configured');
  assert.equal(called, false);
});

test('the email goes to the configured address and never to anything on the item', async () => {
  const sent = [];
  const result = await notifyNewsletterArrival({
    // Contact-looking data on the row must never be able to become a recipient.
    item: item({ parentEmail: 'parent@example.com', email: 'parent@example.com' }),
    env: { ...GMAIL_ENV, NEWSLETTER_NOTIFY_EMAIL: 'fenella@firstchord.co.uk' },
    send: async ({ raw }) => { sent.push(decode(raw)); return { id: 'gmail-1' }; },
  });

  assert.deepEqual(result, { sent: true, recipient: 'fenella@firstchord.co.uk', messageId: 'gmail-1' });
  assert.equal(sent.length, 1, 'exactly one email');
  const headers = sent[0].split('\r\n\r\n')[0];
  assert.ok(/^To: fenella@firstchord\.co\.uk$/mu.test(headers), headers);
  assert.ok(!sent[0].includes('parent@example.com'));
  assert.ok(sent[0].includes('/admin/newsletter?month=2026-09'));
});

test('a failed send resolves quietly instead of throwing into the save', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await notifyNewsletterArrival({
      item: item(),
      env: { ...GMAIL_ENV, NEWSLETTER_NOTIFY_EMAIL: 'fenella@firstchord.co.uk' },
      send: async () => { throw new Error('invalid_grant'); },
    });
    assert.deepEqual(result, { sent: false, reason: 'send_failed' });
  } finally {
    console.error = originalError;
  }
});

test('an item without an id sends nothing', async () => {
  const result = await notifyNewsletterArrival({
    item: null,
    env: { ...GMAIL_ENV, NEWSLETTER_NOTIFY_EMAIL: 'fenella@firstchord.co.uk' },
    send: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(result, { sent: false, reason: 'no_item' });
});
