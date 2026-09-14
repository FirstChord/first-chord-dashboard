/** @fileoverview Pure rules for telling Fenella a newsletter contribution arrived: who may receive it, and the escaped email content. */
// No I/O. The send lives in newsletter-notify.js.
//
// This is the dashboard's first automatic email other than the tutor-confirmed
// Practice Chat note, so its boundaries are deliberately narrow and written down:
//
//  - internal only: the recipient comes from NEWSLETTER_NOTIFY_EMAIL and from
//    nowhere else — never from a request, a student record or a parent contact;
//  - exactly one address, so a misconfigured list cannot fan a child's details
//    out to several inboxes;
//  - once per item, on first arrival — edits and retries never re-send;
//  - it describes what arrived and links to the dashboard. It never attaches a
//    photo, and it publishes nothing.

const MAX_TEXT_LENGTH = 600;

// One plain address. Commas, semicolons, angle brackets, quotes and whitespace are
// all refused, which rules out lists and display-name tricks alike.
const SINGLE_EMAIL_PATTERN = /^[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[^\s@,;<>"'()]+$/u;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

export function escapeHtml(value = '') {
  return `${value ?? ''}`
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function resolveNewsletterNotifyRecipient(env = process.env) {
  const raw = clean(env.NEWSLETTER_NOTIFY_EMAIL);
  if (!raw) return { recipient: '', reason: 'recipient_not_configured' };
  if (!SINGLE_EMAIL_PATTERN.test(raw)) return { recipient: '', reason: 'recipient_invalid' };
  return { recipient: raw.toLowerCase(), reason: '' };
}

export function truncateForEmail(text = '', max = MAX_TEXT_LENGTH) {
  const value = clean(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

// Only an absolute http(s) link is included, so a bad configuration value can
// never become a javascript: or relative link in someone's inbox.
function safeLink(url = '') {
  const value = clean(url);
  return /^https?:\/\/[^\s"'<>]+$/u.test(value) ? value : '';
}

export function buildNewsletterArrivalEmail({
  studentName = '',
  tutorName = '',
  tutorText = '',
  mediaLabel = '',
  hasMedia = false,
  isPriority = false,
  monthLabel = '',
  dashboardUrl = '',
} = {}) {
  const student = clean(studentName) || 'a student';
  const tutor = clean(tutorName);
  const text = truncateForEmail(tutorText);
  const media = clean(mediaLabel);
  const link = safeLink(dashboardUrl);
  const issue = clean(monthLabel) ? `the ${clean(monthLabel)} newsletter` : 'the newsletter';

  const subject = tutor
    ? `Newsletter: something new for ${student} from ${tutor}`
    : `Newsletter: something new for ${student}`;

  const opening = `${tutor || 'A tutor'} has added something for ${student} for ${issue}.`
    + (isPriority ? ' They were on your priority list.' : '');

  // Said here because it is the moment it becomes true: a picture is now in hand,
  // and it cannot be used until the family has been asked.
  const consentNote = (hasMedia || media)
    ? 'It includes a picture or recording, so the family will need asking before it can be used.'
    : '';

  const plainLines = [
    'Hi,',
    '',
    opening,
    ...(text ? ['', `"${text}"`] : []),
    ...(media ? ['', `Attached: ${media}`] : []),
    ...(consentNote ? ['', consentNote] : []),
    '',
    link ? `Nothing has been published. Review it here:\n${link}` : 'Nothing has been published.',
  ];

  const htmlParts = [
    '<p>Hi,</p>',
    `<p>${escapeHtml(opening)}</p>`,
    text
      ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #2F6B3D;color:#333;">${escapeHtml(text).replace(/\n/gu, '<br>')}</blockquote>`
      : '',
    media ? `<p><strong>Attached:</strong> ${escapeHtml(media)}</p>` : '',
    consentNote ? `<p>${escapeHtml(consentNote)}</p>` : '',
    link
      ? `<p>Nothing has been published. <a href="${escapeHtml(link)}" style="color:#2F6B3D;font-weight:bold;">Review it in the dashboard</a></p>`
      : '<p>Nothing has been published.</p>',
  ].filter(Boolean);

  return {
    subject,
    plainText: plainLines.join('\n'),
    html: htmlParts.join('\n'),
  };
}
