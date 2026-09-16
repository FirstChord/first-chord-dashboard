import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Pure and Baileys-free, like the outbound guard, so it imports here without
// the socket stack.
const require = createRequire(import.meta.url);
const {
  catchUpConfig,
  messageTimestampMs,
  selectCatchUpMessages,
  DEFAULT_MAX_MESSAGES,
} = require('../../tools/whatsapp-incoming-bridge/catch-up.js');

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const CONFIRMED = new Set(['lesson-group@g.us', 'other-group@g.us']);

function message({ id = 'm1', chat = 'lesson-group@g.us', minutesAgo = 10 } = {}) {
  return {
    key: { id, remoteJid: chat },
    messageTimestamp: Math.floor((NOW - minutesAgo * 60 * 1000) / 1000),
  };
}

test('a replay inside the window is selected, oldest first', () => {
  // WhatsApp replays newest-first; parents sent them in the other order, and
  // that is the order they should reach the inbox.
  const { selected } = selectCatchUpMessages([
    message({ id: 'newest', minutesAgo: 5 }),
    message({ id: 'oldest', minutesAgo: 180 }),
    message({ id: 'middle', minutesAgo: 60 }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['oldest', 'middle', 'newest']);
});

test('messages older than the window are left alone', () => {
  // The bound is what stops a freshly linked device replaying months of group
  // chat at the dashboard.
  const { selected, eligible } = selectCatchUpMessages([
    message({ id: 'yesterday', minutesAgo: 60 * 23 }),
    message({ id: 'last_week', minutesAgo: 60 * 24 * 7 }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['yesterday']);
  assert.equal(eligible, 1);
});

test('unconfirmed groups are never replayed', () => {
  // Discovery on a replay would announce every group the account has ever been
  // in; only groups an admin already confirmed are ours to capture.
  const { selected } = selectCatchUpMessages([
    message({ id: 'ours', chat: 'lesson-group@g.us' }),
    message({ id: 'someone_elses', chat: 'random@g.us' }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['ours']);
});

test('a message with no usable timestamp is not replayed', () => {
  // Replays are exactly where timestamps go missing, and a message that cannot
  // be shown to be inside the window must not be assumed to be.
  const { selected } = selectCatchUpMessages([
    { key: { id: 'no_time', remoteJid: 'lesson-group@g.us' } },
    { key: { id: 'zero', remoteJid: 'lesson-group@g.us' }, messageTimestamp: 0 },
    message({ id: 'fine' }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['fine']);
});

test('a future-dated message is not replayed', () => {
  const { selected } = selectCatchUpMessages([
    message({ id: 'ahead', minutesAgo: -60 }),
    message({ id: 'fine' }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['fine']);
});

test('messages without a chat or message id are skipped', () => {
  const { selected } = selectCatchUpMessages([
    { key: { id: '', remoteJid: 'lesson-group@g.us' }, messageTimestamp: Math.floor(NOW / 1000) },
    { key: { id: 'x', remoteJid: '' }, messageTimestamp: Math.floor(NOW / 1000) },
    message({ id: 'fine' }),
  ], { now: NOW, confirmedChatIds: CONFIRMED });

  assert.deepEqual(selected.map((m) => m.key.id), ['fine']);
});

test('a huge replay is truncated rather than stampeding, and says how much it dropped', () => {
  const many = Array.from({ length: DEFAULT_MAX_MESSAGES + 25 }, (_, index) => (
    message({ id: `m${index}`, minutesAgo: index + 1 })
  ));
  const { selected, eligible, truncated } = selectCatchUpMessages(many, {
    now: NOW,
    confirmedChatIds: CONFIRMED,
  });

  assert.equal(selected.length, DEFAULT_MAX_MESSAGES);
  assert.equal(eligible, DEFAULT_MAX_MESSAGES + 25);
  assert.equal(truncated, 25);
});

test('messageTimestampMs copes with the long-object form Baileys sometimes uses', () => {
  assert.equal(messageTimestampMs({ messageTimestamp: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(messageTimestampMs({ messageTimestamp: { low: 1_700_000_000 } }), 1_700_000_000_000);
  assert.equal(messageTimestampMs({}), 0);
  assert.equal(messageTimestampMs({ messageTimestamp: 'nonsense' }), 0);
});

test('catch-up is on unless explicitly disabled', () => {
  // The failure it fixes is silent, so the safe default is the one that captures.
  assert.equal(catchUpConfig({}).enabled, true);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP: 'false' }).enabled, false);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP: 'FALSE' }).enabled, false);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP: 'true' }).enabled, true);
});

test('catch-up bounds are configurable, and nonsense falls back to the defaults', () => {
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP_MAX_AGE_HOURS: '6' }).maxAgeMs, 6 * 60 * 60 * 1000);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP_MAX_MESSAGES: '50' }).maxMessages, 50);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP_MAX_AGE_HOURS: '0' }).maxAgeMs, 24 * 60 * 60 * 1000);
  assert.equal(catchUpConfig({ BRIDGE_CATCH_UP_MAX_MESSAGES: 'lots' }).maxMessages, DEFAULT_MAX_MESSAGES);
});

const {
  replayGuardConfig,
  shouldReplayNow,
  DEFAULT_REPLAY_MIN_INTERVAL_MS,
} = require('../../tools/whatsapp-incoming-bridge/catch-up.js');

test('a crash-loop cannot use reconnects to trigger repeated replays', () => {
  // The bridge restarted ~1,900 times between 07:52 and 10:53 on 2026-09-16.
  // Each is a fresh process with an empty in-memory dedupe, so the floor has to
  // be persisted or every restart would refire the whole eligible cache.
  const justReplayed = new Date(NOW - 5 * 1000).toISOString();
  assert.equal(shouldReplayNow({ lastReplayAt: justReplayed, now: NOW }), false);

  const tenMinutesAgo = new Date(NOW - 10 * 60 * 1000).toISOString();
  assert.equal(shouldReplayNow({ lastReplayAt: tenMinutesAgo, now: NOW }), false);
});

test('a replay is due once the interval has passed', () => {
  const overAnHourAgo = new Date(NOW - 61 * 60 * 1000).toISOString();
  assert.equal(shouldReplayNow({ lastReplayAt: overAnHourAgo, now: NOW }), true);
  // Exactly on the boundary counts.
  const exactly = new Date(NOW - DEFAULT_REPLAY_MIN_INTERVAL_MS).toISOString();
  assert.equal(shouldReplayNow({ lastReplayAt: exactly, now: NOW }), true);
});

test('a missing or unreadable marker does not disable recovery', () => {
  // Failing closed here would silently turn catch-up off on a fresh install.
  assert.equal(shouldReplayNow({ lastReplayAt: '', now: NOW }), true);
  assert.equal(shouldReplayNow({ lastReplayAt: 'not a date', now: NOW }), true);
  assert.equal(shouldReplayNow({ now: NOW }), true);
});

test('a marker in the future is a clock change, not a licence to spam', () => {
  const ahead = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
  assert.equal(shouldReplayNow({ lastReplayAt: ahead, now: NOW }), false);
});

test('the replay guard is on by default and tunable', () => {
  assert.equal(replayGuardConfig({}).enabled, true);
  assert.equal(replayGuardConfig({}).minIntervalMs, DEFAULT_REPLAY_MIN_INTERVAL_MS);
  assert.equal(replayGuardConfig({ BRIDGE_REPLAY_ON_CONNECT: 'false' }).enabled, false);
  assert.equal(replayGuardConfig({ BRIDGE_REPLAY_MIN_INTERVAL_MINUTES: '5' }).minIntervalMs, 5 * 60 * 1000);
  assert.equal(replayGuardConfig({ BRIDGE_REPLAY_MIN_INTERVAL_MINUTES: '0' }).minIntervalMs, DEFAULT_REPLAY_MIN_INTERVAL_MS);
});

const { reconnectDelayMs, RECONNECT_BASE_MS, RECONNECT_MAX_MS } = require('../../tools/whatsapp-incoming-bridge/catch-up.js');

const noJitter = { random: () => 0.5 };

test('a genuine blip still reconnects immediately', () => {
  // Backoff must not make the common case slower — the first retry is the same
  // five seconds it always was.
  assert.equal(reconnectDelayMs(0, noJitter), RECONNECT_BASE_MS);
});

test('repeated failures back off, and stop at a ceiling', () => {
  assert.equal(reconnectDelayMs(1, noJitter), 10_000);
  assert.equal(reconnectDelayMs(3, noJitter), 40_000);
  assert.equal(reconnectDelayMs(6, noJitter), RECONNECT_MAX_MS);
  // The cap is a real ceiling, not something jitter can push past meaningfully.
  assert.equal(reconnectDelayMs(50, noJitter), RECONNECT_MAX_MS);
  assert.equal(reconnectDelayMs(1000, noJitter), RECONNECT_MAX_MS);
});

test('backoff turns a three-hour sleep from ~2000 attempts into dozens', () => {
  // This Mac sleeps after a minute idle, so the common failure is hours during
  // which nothing can succeed. On 2026-09-16 a flat 5s retry made ~1,900.
  let elapsed = 0;
  let attempts = 0;
  while (elapsed < 3 * 60 * 60 * 1000) {
    elapsed += reconnectDelayMs(attempts, noJitter);
    attempts += 1;
  }
  assert.ok(attempts < 60, `expected dozens of attempts, got ${attempts}`);
  assert.ok(attempts > 10, `expected it to keep trying, got ${attempts}`);
});

test('jitter stays within ±20% and never goes silly', () => {
  const low = reconnectDelayMs(3, { random: () => 0 });
  const high = reconnectDelayMs(3, { random: () => 1 });
  assert.equal(low, 32_000);   // 40s - 20%
  assert.equal(high, 48_000);  // 40s + 20%
  // Never below a floor, whatever the inputs.
  assert.ok(reconnectDelayMs(0, { random: () => 0 }) >= RECONNECT_BASE_MS * 0.5);
});

test('a nonsense attempt count is treated as the first attempt', () => {
  assert.equal(reconnectDelayMs(-5, noJitter), RECONNECT_BASE_MS);
  assert.equal(reconnectDelayMs(Number.NaN, noJitter), RECONNECT_BASE_MS);
  assert.equal(reconnectDelayMs(undefined, noJitter), RECONNECT_BASE_MS);
});
