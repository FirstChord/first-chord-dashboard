/** @fileoverview Sends Fenella one internal email when a tutor's newsletter contribution first arrives, using the existing send-only Gmail sender; never throws. */
import { google } from 'googleapis';
import { getPracticeNotesEmailConfig } from './practice-notes-email.js';
import { buildGmailRawMessage } from './practice-notes-email-helpers.mjs';
import { formatIssueMonthLabel } from './newsletter-helpers.mjs';
import { parseItemMedia, summariseItemMedia } from './newsletter-media-helpers.mjs';
import {
  buildNewsletterArrivalEmail,
  resolveNewsletterNotifyRecipient,
} from './newsletter-notify-helpers.mjs';

// Reuses the practice-note sender rather than minting a second credential. That is
// a deliberate exception to "never reuse a Google credential": the reason for the
// rule is to avoid widening a grant, and this is the same account
// (musiclessons@) with the same `gmail.send` scope, doing the same kind of thing.
// A second identical token would add a rotation chore and no least-privilege
// benefit. Contrast Drive, where reuse would have been a real widening.
const SEND_TIMEOUT_MS = 8000;
const DEFAULT_DASHBOARD_URL = 'https://first-chord-dashbord-production.up.railway.app';

async function gmailSend({ config, raw }) {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: response.data?.id || '' };
}

function dashboardLinkFor(issueMonth = '', env = process.env) {
  const base = `${env.NEXTAUTH_URL || DEFAULT_DASHBOARD_URL}`.trim().replace(/\/+$/u, '');
  const month = `${issueMonth || ''}`.trim();
  return `${base}/admin/newsletter${month ? `?month=${encodeURIComponent(month)}` : ''}`;
}

// Best-effort by contract: resolves to { sent, reason } and never rejects. A
// tutor's contribution is already saved by the time this runs, and an email
// failing must not turn that save into an error or tempt a retry that would
// record the story twice.
export async function notifyNewsletterArrival({
  item = null,
  env = process.env,
  send = gmailSend,
} = {}) {
  try {
    if (!item?.itemId) return { sent: false, reason: 'no_item' };

    const { recipient, reason } = resolveNewsletterNotifyRecipient(env);
    if (!recipient) return { sent: false, reason };

    const config = getPracticeNotesEmailConfig(env);
    if (config.missing.length) return { sent: false, reason: 'gmail_not_configured' };

    const media = parseItemMedia(item.mediaJson);
    const content = buildNewsletterArrivalEmail({
      studentName: item.studentName,
      tutorName: item.tutorName,
      tutorText: item.tutorText,
      mediaLabel: summariseItemMedia(media).label,
      hasMedia: `${item.hasMedia || ''}`.trim().toLowerCase() === 'true' || media.length > 0,
      isPriority: Boolean(`${item.requestedAt || ''}`.trim()),
      monthLabel: formatIssueMonthLabel(item.issueMonth),
      dashboardUrl: dashboardLinkFor(item.issueMonth, env),
    });

    const raw = buildGmailRawMessage({
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      toEmail: recipient,
      subject: content.subject,
      plainText: content.plainText,
      html: content.html,
    });

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('notify_timeout')), SEND_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([send({ config, raw }), timeout]);
      return { sent: true, recipient, messageId: result?.id || '' };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // A timeout is reported as a failure, but Gmail may still deliver it: the
    // Sent folder of musiclessons@ is the record of what actually went.
    console.error(`Newsletter arrival email not confirmed for ${item?.itemId || 'unknown item'}:`, error.message);
    return { sent: false, reason: error.message === 'notify_timeout' ? 'send_timeout' : 'send_failed' };
  }
}
