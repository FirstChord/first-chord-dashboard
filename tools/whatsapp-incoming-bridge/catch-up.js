'use strict';

// Which replayed messages are worth posting after the bridge has been offline.
//
// WhatsApp replays a backlog on reconnect (`messages.upsert` with a type other
// than 'notify'). The bridge used to drop all of it, on the grounds that its
// own dedupe was in-memory and a replay would re-post already-handled messages.
// The dashboard has since made capture idempotent — `buildIncomingMessageId`
// hashes source::chatId::externalMessageId so a replay upserts the same row,
// and `mergeIncomingCapture` skips outright when a real row already exists,
// preserving review status, notes and any linked plan when it heals a
// placeholder. So a replay costs redundant requests, not duplicate rows.
//
// That makes catch-up worth doing, because the alternative is silent permanent
// loss: on 2026-09-11 the bridge was down 20:18–22:53, a Friday evening, and
// nothing sent in that window was ever captured.
//
// Pure and dependency-free so it can be unit tested from the dashboard suite
// without pulling in the socket stack.

// A day. Long enough to cover an overnight or an evening outage, short enough
// that a freshly linked device does not fire thousands of requests at the
// dashboard replaying months of group chat.
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// A ceiling on one replay batch, so a pathological history dump degrades into
// "some of it" rather than a stampede against a 60-per-minute Sheets quota.
// Exceeding it is logged by the caller: a truncated catch-up the human is told
// about beats a silent one.
const DEFAULT_MAX_MESSAGES = 200;

function messageTimestampMs(message) {
  const raw = message?.messageTimestamp;
  const seconds = typeof raw === 'object' && raw !== null
    ? Number(raw.low ?? raw.toNumber?.() ?? 0)
    : Number(raw || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

// Oldest first: a catch-up should land in the inbox in the order the parents
// actually sent them, not newest-first because that is how WhatsApp replayed.
function selectCatchUpMessages(messages = [], {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxMessages = DEFAULT_MAX_MESSAGES,
  confirmedChatIds = null,
} = {}) {
  const cutoff = now - maxAgeMs;
  const eligible = (messages || [])
    .filter((message) => {
      const chatId = message?.key?.remoteJid || '';
      const messageId = message?.key?.id || '';
      if (!chatId || !messageId) return false;
      // Unconfirmed groups are not ours to capture, and discovery on a replay
      // would announce every group the account has ever been in.
      if (confirmedChatIds && !confirmedChatIds.has(chatId)) return false;
      const at = messageTimestampMs(message);
      // A message with no usable timestamp cannot be shown to be inside the
      // window, and replays are exactly where timestamps go missing.
      return at > 0 && at >= cutoff && at <= now;
    })
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));

  return {
    selected: eligible.slice(0, maxMessages),
    considered: (messages || []).length,
    eligible: eligible.length,
    truncated: Math.max(eligible.length - maxMessages, 0),
  };
}

// Whether an automatic cache replay is due.
//
// This guard is the whole design. The bridge crash-loops — roughly 1,900
// restarts between 07:52 and 10:53 on 2026-09-16 — and each restart is a fresh
// process with an empty in-memory dedupe. Replaying on connect without a
// persisted floor would fire the entire eligible cache at the dashboard every
// five seconds, against a Sheets quota that cannot be raised. The marker is
// therefore written to disk, and written *before* the replay runs, so a crash
// part-way through costs one skipped window rather than starting a stampede.
function shouldReplayNow({ lastReplayAt = '', now = Date.now(), minIntervalMs = DEFAULT_REPLAY_MIN_INTERVAL_MS } = {}) {
  const last = Date.parse(`${lastReplayAt || ''}`);
  // Never replayed, or an unreadable marker: treat as due. A missing marker
  // should not disable recovery.
  if (!Number.isFinite(last)) return true;
  // A marker in the future is a clock change, not a licence to spam.
  if (last > now) return false;
  return now - last >= minIntervalMs;
}

// Half an hour: long enough that a crash-loop cannot use it as a trigger,
// short enough that a genuine outage is picked up within one heartbeat cycle.
const DEFAULT_REPLAY_MIN_INTERVAL_MS = 30 * 60 * 1000;

function replayGuardConfig(env = process.env) {
  const minutes = Number.parseInt(env.BRIDGE_REPLAY_MIN_INTERVAL_MINUTES || '', 10);
  return {
    enabled: `${env.BRIDGE_REPLAY_ON_CONNECT ?? 'true'}`.toLowerCase() !== 'false',
    minIntervalMs: Number.isFinite(minutes) && minutes > 0
      ? minutes * 60 * 1000
      : DEFAULT_REPLAY_MIN_INTERVAL_MS,
  };
}

function catchUpConfig(env = process.env) {
  const maxAgeHours = Number.parseInt(env.BRIDGE_CATCH_UP_MAX_AGE_HOURS || '', 10);
  const maxMessages = Number.parseInt(env.BRIDGE_CATCH_UP_MAX_MESSAGES || '', 10);
  return {
    // Opt-out rather than opt-in: the failure this fixes is silent, so the safe
    // default is the one that captures.
    enabled: `${env.BRIDGE_CATCH_UP ?? 'true'}`.toLowerCase() !== 'false',
    maxAgeMs: Number.isFinite(maxAgeHours) && maxAgeHours > 0
      ? maxAgeHours * 60 * 60 * 1000
      : DEFAULT_MAX_AGE_MS,
    maxMessages: Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : DEFAULT_MAX_MESSAGES,
  };
}

module.exports = {
  catchUpConfig,
  replayGuardConfig,
  shouldReplayNow,
  DEFAULT_REPLAY_MIN_INTERVAL_MS,
  messageTimestampMs,
  selectCatchUpMessages,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_MESSAGES,
};
