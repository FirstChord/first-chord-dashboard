import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WhatsAppIncomingBridge } = require('../../tools/whatsapp-incoming-bridge/bridge.js');

function bridgeHarness() {
  const bridge = Object.create(WhatsAppIncomingBridge.prototype);
  bridge.autoCaptureEnabled = true;
  bridge.dryRun = false;
  bridge.confirmedChatIds = new Set();
  bridge.sentMessageIds = new Set();
  bridge.recentMessages = new Map();
  bridge.groupDiscoveryInFlight = new Map();
  bridge.groupDiscoveryLastCheckedAt = new Map();
  bridge.confirmedGroupsRefreshMs = 10 * 60 * 1000;
  bridge.pendingCaptureFlush = null;
  bridge.logInfo = () => {};
  bridge.logWarn = () => {};
  bridge.scheduleCacheSave = () => {};
  bridge.markHealthy = () => {};
  return bridge;
}

const liveMessage = {
  key: {
    id: 'message-1',
    remoteJid: '123@g.us',
    participant: '456@s.whatsapp.net',
    fromMe: false,
  },
  messageTimestamp: 1_789_000_000,
  pushName: 'Parent',
  message: { conversation: 'Student is away for two weeks' },
};

test('an unknown live group message is retained while targeted discovery runs', async () => {
  const bridge = bridgeHarness();
  let discovered = null;
  bridge.discoverGroupForCapture = async (chatId, messageAt) => {
    discovered = { chatId, messageAt };
  };

  await bridge.maybeAutoCapture(liveMessage);

  const cached = bridge.recentMessages.get('123@g.us::message-1');
  assert.equal(cached.pendingAutoCapture, true);
  assert.deepEqual(discovered, { chatId: '123@g.us', messageAt: cached.messageAt });
});

test('a pending message is delivered only after its group is confirmed', async () => {
  const bridge = bridgeHarness();
  bridge.recentMessages.set('123@g.us::message-1', {
    cacheKey: '123@g.us::message-1',
    chatId: '123@g.us',
    messageId: 'message-1',
    messageText: 'Student is away for two weeks',
    pendingAutoCapture: true,
  });
  const delivered = [];
  bridge.postCachedAutoCapture = async (cached) => {
    delivered.push(cached.cacheKey);
    return true;
  };

  await bridge.flushPendingConfirmedMessages();
  assert.deepEqual(delivered, []);

  bridge.confirmedChatIds.add('123@g.us');
  await bridge.flushPendingConfirmedMessages();
  assert.deepEqual(delivered, ['123@g.us::message-1']);
});

test('targeted discovery syncs only likely First Chord groups and refreshes the gate', async () => {
  const bridge = bridgeHarness();
  bridge.sock = {
    groupMetadata: async () => ({
      id: '123@g.us',
      subject: 'Adam Guitar Lessons 🎸',
      participants: [{ id: '447700900123@s.whatsapp.net' }],
    }),
  };
  let synced = null;
  let refreshed = 0;
  bridge.sendGroupSync = async (groups) => { synced = groups; };
  bridge.refreshConfirmedGroups = async () => { refreshed += 1; };

  await bridge.discoverGroupForCapture('123@g.us', '2026-09-12T11:04:51.000Z');

  assert.deepEqual(synced, [{
    chatId: '123@g.us',
    chatName: 'Adam Guitar Lessons 🎸',
    participantPhones: ['+447700900123'],
    lastActiveAt: '2026-09-12T11:04:51.000Z',
  }]);
  assert.equal(refreshed, 1);
});

test('restart recovery resumes discovery once per pending unknown group', async () => {
  const bridge = bridgeHarness();
  bridge.recentMessages.set('123@g.us::older', {
    cacheKey: '123@g.us::older', chatId: '123@g.us', messageAt: '2026-09-12T10:00:00Z', pendingAutoCapture: true,
  });
  bridge.recentMessages.set('123@g.us::newer', {
    cacheKey: '123@g.us::newer', chatId: '123@g.us', messageAt: '2026-09-12T11:00:00Z', pendingAutoCapture: true,
  });
  bridge.recentMessages.set('confirmed@g.us::message', {
    cacheKey: 'confirmed@g.us::message', chatId: 'confirmed@g.us', messageAt: '2026-09-12T11:30:00Z', pendingAutoCapture: true,
  });
  bridge.confirmedChatIds.add('confirmed@g.us');
  const discovered = [];
  bridge.discoverGroupForCapture = async (chatId, messageAt) => discovered.push({ chatId, messageAt });

  await bridge.resumePendingGroupDiscovery();

  assert.deepEqual(discovered, [{ chatId: '123@g.us', messageAt: '2026-09-12T11:00:00Z' }]);
});
