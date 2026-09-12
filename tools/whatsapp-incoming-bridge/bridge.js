#!/usr/bin/env node

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const { titleLooksLikeFcGroup, confirmedGroupsRefreshMs } = require('./group-discovery');
const { guardOutbound } = require('./outbound-guard');
const {
  buildSafeDashboardResponseLog,
  buildSafePayloadLog,
  createBridgeLogStream,
} = require('./logging');

const DEFAULT_DASHBOARD_URL = 'https://first-chord-dashbord-production.up.railway.app';

function loadLocalEnv(filePath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && typeof process.env[key] === 'undefined') {
      process.env[key] = value;
    }
  }
}

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function expandHome(input = '') {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function resolveLocalPath(input = '', basePath = process.cwd()) {
  const expanded = expandHome(clean(input));
  return path.isAbsolute(expanded) ? expanded : path.resolve(basePath, expanded);
}

function parseBoolean(value = '') {
  return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
}

function nowIso() {
  return new Date().toISOString();
}

function phoneFromJid(jid = '') {
  const value = clean(jid);
  // Only phone-format JIDs (@s.whatsapp.net) carry a real number. WhatsApp's
  // LID migration means group senders often arrive as <id>@lid — an anonymised
  // id that looks numeric but is not a phone. Turning one into "+<id>" poisons
  // every downstream phone match (Tutor_Phones, staff numbers, group map), so
  // any other server yields blank: an honest "no phone known".
  if (value.includes('@') && !value.endsWith('@s.whatsapp.net')) return '';
  const id = value.split('@')[0].split(':')[0];
  return id && /^\d+$/u.test(id) ? `+${id}` : '';
}

function messageCacheKey(key = {}) {
  return `${key.remoteJid || ''}::${key.id || ''}`;
}

function extractMessageContent(message = {}) {
  const content = message.message || message;
  const text = content?.conversation
    || content?.extendedTextMessage?.text
    || content?.imageMessage?.caption
    || content?.videoMessage?.caption
    || content?.documentMessage?.caption
    || content?.buttonsResponseMessage?.selectedDisplayText
    || content?.listResponseMessage?.title
    || '';

  return {
    text: clean(text),
    type: content?.conversation ? 'text'
      : content?.extendedTextMessage ? 'extended_text'
        : content?.imageMessage ? 'image'
          : content?.videoMessage ? 'video'
            : content?.audioMessage ? 'audio'
              : content?.documentMessage ? 'document'
                : content?.stickerMessage ? 'sticker'
                  : 'unknown',
  };
}


class WhatsAppIncomingBridge {
  constructor(options = {}) {
    loadLocalEnv();
    this.dashboardUrl = clean(options.dashboardUrl || process.env.DASHBOARD_BASE_URL || DEFAULT_DASHBOARD_URL).replace(/\/$/u, '');
    this.webhookUrl = clean(options.webhookUrl || process.env.INCOMING_MESSAGE_WEBHOOK_URL)
      || `${this.dashboardUrl}/api/admin/incoming-messages`;
    this.webhookSecret = clean(options.webhookSecret || process.env.INCOMING_MESSAGE_INGEST_SECRET);
    this.authDir = expandHome(clean(options.authDir || process.env.BAILEYS_AUTH_DIR || './auth_info_baileys'));
    this.captureName = clean(options.captureName || process.env.WHATSAPP_CAPTURED_BY || 'Finn');
    this.maxCachedMessages = Math.max(100, Number(process.env.WHATSAPP_CACHE_LIMIT || 2000) || 2000);
    const maxCacheAgeDays = Math.max(1, Number(process.env.WHATSAPP_CACHE_MAX_AGE_DAYS || 14) || 14);
    this.maxCacheAgeMs = maxCacheAgeDays * 24 * 60 * 60 * 1000;
    this.cachePath = resolveLocalPath(process.env.WHATSAPP_CACHE_PATH || './cache/recent-messages.json');
    this.cacheSaveTimer = null;
    this.writeStarredLog = parseBoolean(process.env.WRITE_STARRED_LOG);
    this.dryRun = parseBoolean(process.env.DRY_RUN);
    this.syncGroupsOnStart = parseBoolean(process.env.SYNC_GROUPS_ON_START);
    // Auto-capture every live text message from dashboard-confirmed FC lesson
    // groups (no starring needed). On by default; the dashboard still filters
    // to confirmed groups server-side, so this is belt-and-braces scoping.
    this.autoCaptureEnabled = typeof process.env.AUTO_CAPTURE_CONFIRMED_GROUPS === 'undefined'
      ? true
      : parseBoolean(process.env.AUTO_CAPTURE_CONFIRMED_GROUPS);
    this.confirmedChatIds = new Set();
    this.confirmedGroupsRefreshMs = confirmedGroupsRefreshMs(process.env.CONFIRMED_GROUPS_REFRESH_MS);
    this.confirmedGroupsTimer = null;
    this.heartbeatMs = Math.max(5 * 60 * 1000, Number(process.env.BRIDGE_HEARTBEAT_MS || 30 * 60 * 1000) || 30 * 60 * 1000);
    this.heartbeatTimer = null;
    // Watchdog: launchd's KeepAlive only relaunches on process *exit*, so a
    // hung-but-alive process (e.g. the Mac slept and the socket died without a
    // clean close) never self-heals. We track a "last healthy" moment (a
    // connect, a heartbeat-while-connected, or a live capture) and force-exit
    // if it goes stale — turning a hang into an exit so launchd restarts fresh.
    // Disable with BRIDGE_WATCHDOG=false.
    this.watchdogEnabled = typeof process.env.BRIDGE_WATCHDOG === 'undefined'
      ? true
      : parseBoolean(process.env.BRIDGE_WATCHDOG);
    this.watchdogCheckMs = Math.max(30 * 1000, Number(process.env.BRIDGE_WATCHDOG_CHECK_MS || 2 * 60 * 1000) || 2 * 60 * 1000);
    // The stale window MUST sit above the heartbeat interval. A healthy-but-quiet
    // bridge (no incoming messages) only refreshes lastHealthyAt via the
    // connected heartbeat, so a window shorter than the heartbeat would recycle a
    // perfectly live bridge. Default to two heartbeats + slack; floor above one.
    const staleDefault = 2 * this.heartbeatMs + 5 * 60 * 1000;
    const staleFloor = this.heartbeatMs + 5 * 60 * 1000;
    this.watchdogStaleMs = Math.max(staleFloor, Number(process.env.BRIDGE_WATCHDOG_STALE_MS) || staleDefault);
    // A bridge that dropped and can't get back on is dead even though the process
    // and its timers are fine — catch that specific case faster than the stale
    // window (which is tuned for the total-freeze/sleep case).
    this.watchdogDisconnectGraceMs = Math.max(2 * 60 * 1000, Number(process.env.BRIDGE_WATCHDOG_DISCONNECT_GRACE_MS) || 10 * 60 * 1000);
    this.disconnectedSince = null;
    this.watchdogTimer = null;
    this.lastHealthyAt = Date.now();
    this.startedAt = nowIso();
    this.connectedAt = '';
    try {
      this.bridgeVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '';
    } catch {
      this.bridgeVersion = '';
    }
    this.groupSyncWaitMs = Number(process.env.GROUP_SYNC_WAIT_MS || 25000) || 25000;
    try {
      this.logDestination = createBridgeLogStream({ env: process.env, baseDir: __dirname });
      this.logger = P({ level: process.env.LOG_LEVEL || 'info' }, this.logDestination);
    } catch (error) {
      // Logging must never stop intake. The fallback remains privacy-safe
      // because message bodies and response previews are excluded below.
      console.error(`Could not initialise bounded bridge logging: ${error.message}`);
      this.logDestination = null;
      this.logger = P({ level: process.env.LOG_LEVEL || 'info' });
    }
    this.sock = null;
    this.connected = false;
    this.recentMessages = new Map();
    this.recentChatTimestamps = new Map();
    this.sentMessageIds = new Set();
    this.groupDiscoveryInFlight = new Map();
    this.groupDiscoveryLastCheckedAt = new Map();
    this.pendingCaptureFlush = null;
    this.groupSyncInFlight = false;
    this.signalHandlersBound = false;
    this.startupSyncDone = false;
    this.loadMessageCache();
  }

  validateConfig() {
    if (!this.webhookUrl) {
      throw new Error('INCOMING_MESSAGE_WEBHOOK_URL or DASHBOARD_BASE_URL is required');
    }
    if (!this.webhookSecret && !this.dryRun) {
      throw new Error('INCOMING_MESSAGE_INGEST_SECRET is required unless DRY_RUN=true');
    }
  }

  logInfo(message, data = {}) {
    this.logger.info(data, message);
  }

  logWarn(message, data = {}) {
    this.logger.warn(data, message);
  }

  logError(message, data = {}) {
    this.logger.error(data, message);
  }

  loadMessageCache() {
    if (!fs.existsSync(this.cachePath)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : parsed?.messages;
      if (!Array.isArray(rows)) return;

      for (const row of rows) {
        const cacheKey = clean(row?.cacheKey) || messageCacheKey({ remoteJid: row?.chatId, id: row?.messageId });
        if (!cacheKey || !row?.messageId || !row?.chatId) continue;
        this.recentMessages.set(cacheKey, { ...row, cacheKey });
      }
      this.trimCache({ persist: false });
      this.logInfo('Loaded WhatsApp message cache', {
        cachePath: this.cachePath,
        cachedMessages: this.recentMessages.size,
      });
    } catch (error) {
      this.logWarn('Could not load WhatsApp message cache', { cachePath: this.cachePath, error: error.message });
    }
  }

  trimCache({ persist = true } = {}) {
    const now = Date.now();
    let changed = false;
    for (const [key, value] of this.recentMessages.entries()) {
      const cachedAt = Date.parse(value.cachedAt || value.messageAt || '');
      if (Number.isFinite(cachedAt) && now - cachedAt > this.maxCacheAgeMs) {
        this.recentMessages.delete(key);
        changed = true;
      }
    }

    while (this.recentMessages.size > this.maxCachedMessages) {
      const firstKey = this.recentMessages.keys().next().value;
      this.recentMessages.delete(firstKey);
      changed = true;
    }

    if (changed && persist) {
      this.scheduleCacheSave();
    }
  }

  scheduleCacheSave() {
    if (this.cacheSaveTimer) return;
    this.cacheSaveTimer = setTimeout(() => {
      this.cacheSaveTimer = null;
      this.saveMessageCache();
    }, 750);
    this.cacheSaveTimer.unref?.();
  }

  saveMessageCache() {
    if (this.cacheSaveTimer) {
      clearTimeout(this.cacheSaveTimer);
      this.cacheSaveTimer = null;
    }

    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const payload = {
        savedAt: nowIso(),
        messages: Array.from(this.recentMessages.values()),
      };
      const tempPath = `${this.cachePath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
      fs.renameSync(tempPath, this.cachePath);
    } catch (error) {
      this.logWarn('Could not save WhatsApp message cache', { cachePath: this.cachePath, error: error.message });
    }
  }

  async getChatName(chatId = '') {
    if (!chatId) return '';
    if (chatId.includes('@g.us') && this.sock) {
      try {
        const metadata = await this.sock.groupMetadata(chatId);
        return metadata?.subject || chatId;
      } catch {
        return 'WhatsApp group';
      }
    }
    if (chatId.includes('@s.whatsapp.net')) return 'Direct WhatsApp chat';
    return chatId;
  }

  cacheMessage(message, { pendingAutoCapture = false } = {}) {
    if (!message?.key?.id || !message?.key?.remoteJid) return null;

    const { text, type } = extractMessageContent(message);
    const senderJid = message.key.fromMe ? 'me' : message.key.participant || message.key.remoteJid;
    // In LID-addressed groups the participant JID is anonymised; Baileys carries
    // the real number alongside it in participantPn (groups) / senderPn (DMs).
    const senderPhoneJid = message.key.fromMe
      ? ''
      : message.key.participantPn || message.key.senderPn || senderJid;
    const timestamp = Number(message.messageTimestamp || Date.now() / 1000);
    const cacheKey = messageCacheKey(message.key);
    const existing = this.recentMessages.get(cacheKey) || {};
    const cached = {
      cacheKey,
      messageId: message.key.id,
      chatId: message.key.remoteJid,
      senderName: message.pushName || '',
      senderJid,
      senderPhone: phoneFromJid(senderPhoneJid),
      messageText: text || '[Media or unsupported message]',
      messageType: type,
      messageAt: new Date(timestamp * 1000).toISOString(),
      fromMe: Boolean(message.key.fromMe),
      pendingAutoCapture: Boolean(pendingAutoCapture || existing.pendingAutoCapture),
      autoCapturedAt: existing.autoCapturedAt || '',
      cachedAt: nowIso(),
    };

    this.recentMessages.set(cacheKey, cached);
    this.trimCache();
    this.scheduleCacheSave();
    return cached;
  }

  markCacheCaptureComplete(cached = {}) {
    if (!cached.cacheKey) return;
    this.recentMessages.set(cached.cacheKey, {
      ...cached,
      pendingAutoCapture: false,
      autoCapturedAt: nowIso(),
      cachedAt: nowIso(),
    });
    this.scheduleCacheSave();
  }

  async buildPayload(data = {}) {
    const chatName = data.chatName || await this.getChatName(data.chatId);
    return {
      source: 'whatsapp_starred',
      external_message_id: data.messageId || '',
      chat_id: data.chatId || '',
      chat_name: chatName || '',
      sender_name: data.senderName || data.senderJid || '',
      sender_phone: data.senderPhone || phoneFromJid(data.senderJid || ''),
      message_text: data.messageText || '',
      message_at: data.messageAt || '',
      captured_at: nowIso(),
      captured_by: this.captureName,
      raw_json: JSON.stringify({
        messageId: data.messageId || '',
        messageType: data.messageType || '',
        fromMe: Boolean(data.fromMe),
        cacheHit: Boolean(data.cacheHit),
      }),
    };
  }

  async sendPayload(payload) {
    if (this.writeStarredLog) {
      const logDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'starred-payloads.ndjson'), `${JSON.stringify(payload)}\n`);
    }

    if (this.dryRun) {
      this.logInfo('Dry run payload', buildSafePayloadLog(payload));
      return { dryRun: true };
    }

    const response = await axios.post(this.webhookUrl, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'x-firstchord-incoming-secret': this.webhookSecret,
      },
    });
    this.logInfo(
      'Posted incoming message to dashboard',
      buildSafeDashboardResponseLog(response),
    );
    return response.data;
  }

  // Which chats may be auto-captured — asked of the dashboard so the
  // human-confirmed group map stays the single source of that decision.
  async refreshConfirmedGroups() {
    if (!this.autoCaptureEnabled || this.dryRun) return;
    try {
      const response = await axios.get(this.webhookUrl, {
        params: { mode: 'confirmed_groups' },
        timeout: 15000,
        headers: { 'x-firstchord-incoming-secret': this.webhookSecret },
      });
      const chatIds = Array.isArray(response.data?.chatIds) ? response.data.chatIds : [];
      this.confirmedChatIds = new Set(chatIds);
      this.logInfo('Refreshed confirmed group list for auto-capture', { confirmedGroups: chatIds.length });
      await this.flushPendingConfirmedMessages();
    } catch (error) {
      this.logWarn('Could not refresh confirmed group list — auto-capture keeps the previous list', { error: error.message });
      // A failed fetch with no previous list means auto-capture is dead until
      // the next scheduled refresh (6h) — e.g. restarting mid-deploy gets a
      // 401 from the old server code. Retry soon instead.
      if (!this.confirmedChatIds.size && !this.confirmedGroupsRetryTimer) {
        this.confirmedGroupsRetryTimer = setTimeout(() => {
          this.confirmedGroupsRetryTimer = null;
          this.refreshConfirmedGroups().catch(() => {});
        }, 10 * 60 * 1000);
        this.confirmedGroupsRetryTimer.unref?.();
        this.logInfo('Auto-capture list is empty — retrying in 10 minutes');
      }
    }
  }

  async postCachedAutoCapture(cached = {}) {
    if (!cached.cacheKey || !cached.messageId || !cached.chatId) return false;
    if (this.sentMessageIds.has(cached.cacheKey)) return false;
    if (!cached.messageText || cached.messageText === '[Media or unsupported message]') return false;

    const payload = await this.buildPayload({ ...cached, cacheHit: true });
    payload.source = 'whatsapp_group_auto';
    payload.from_me = Boolean(cached.fromMe);
    await this.sendPayload(payload);
    this.sentMessageIds.add(cached.cacheKey);
    this.markCacheCaptureComplete(cached);
    this.markHealthy();
    return true;
  }

  async flushPendingConfirmedMessages() {
    if (!this.autoCaptureEnabled || this.dryRun || !this.confirmedChatIds.size) return;
    if (this.pendingCaptureFlush) return this.pendingCaptureFlush;

    this.pendingCaptureFlush = (async () => {
      const pending = Array.from(this.recentMessages.values()).filter((cached) => (
        cached.pendingAutoCapture && this.confirmedChatIds.has(cached.chatId)
      ));
      let delivered = 0;
      for (const cached of pending) {
        try {
          if (await this.postCachedAutoCapture(cached)) delivered += 1;
        } catch (error) {
          // Keep the pending marker. The next confirmed-group refresh retries
          // with the same stable message id, and the dashboard is idempotent.
          this.logWarn('Pending auto-capture delivery failed', { error: error.message });
        }
      }
      if (pending.length) {
        this.logInfo('Flushed pending messages for confirmed groups', {
          pendingMessages: pending.length,
          deliveredMessages: delivered,
        });
      }
    })();

    try {
      await this.pendingCaptureFlush;
    } finally {
      this.pendingCaptureFlush = null;
    }
  }

  async discoverGroupForCapture(chatId = '', messageAt = '') {
    if (!chatId.endsWith('@g.us') || !this.sock) return;
    const lastCheckedAt = this.groupDiscoveryLastCheckedAt.get(chatId) || 0;
    if (Date.now() - lastCheckedAt < this.confirmedGroupsRefreshMs) return;
    if (this.groupDiscoveryInFlight.has(chatId)) {
      return this.groupDiscoveryInFlight.get(chatId);
    }

    const discovery = (async () => {
      const metadata = await this.sock.groupMetadata(chatId);
      const chatName = clean(metadata?.subject);
      if (!titleLooksLikeFcGroup(chatName)) {
        this.groupDiscoveryLastCheckedAt.set(chatId, Date.now());
        this.logInfo('Targeted group discovery ignored a non-First-Chord title');
        return;
      }
      const participantPhones = (metadata?.participants || [])
        .map((participant) => phoneFromJid(participant.jid || participant.id))
        .filter(Boolean)
        .slice(0, 50);
      await this.sendGroupSync([{
        chatId: metadata?.id || chatId,
        chatName,
        participantPhones,
        lastActiveAt: messageAt || nowIso(),
      }]);
      this.groupDiscoveryLastCheckedAt.set(chatId, Date.now());
      this.logInfo('Targeted group discovery synced one candidate group');
      // If this was an already-confirmed group missing only from the bridge's
      // stale local set, the refresh immediately releases the pending message.
      // A genuinely new group stays pending until a human confirms it.
      await this.refreshConfirmedGroups();
    })().catch((error) => {
      this.logWarn('Targeted group discovery failed', { error: error.message });
    }).finally(() => {
      this.groupDiscoveryInFlight.delete(chatId);
    });

    this.groupDiscoveryInFlight.set(chatId, discovery);
    return discovery;
  }

  async resumePendingGroupDiscovery() {
    const pendingByChat = new Map();
    for (const cached of this.recentMessages.values()) {
      if (!cached.pendingAutoCapture || this.confirmedChatIds.has(cached.chatId)) continue;
      const current = pendingByChat.get(cached.chatId);
      if (!current || `${cached.messageAt || ''}` > `${current.messageAt || ''}`) {
        pendingByChat.set(cached.chatId, cached);
      }
    }
    for (const cached of pendingByChat.values()) {
      await this.discoverGroupForCapture(cached.chatId, cached.messageAt);
    }
  }

  scheduleConfirmedGroupsRefresh() {
    if (!this.autoCaptureEnabled || this.confirmedGroupsTimer) return;
    this.confirmedGroupsTimer = setInterval(() => {
      this.refreshConfirmedGroups().catch(() => {});
    }, this.confirmedGroupsRefreshMs);
    this.confirmedGroupsTimer.unref?.();
  }

  // Heartbeat so the dashboard can tell a down/unlinked bridge (stale
  // heartbeat) and an "alive but capturing nothing" bridge (empty group list)
  // apart from an ordinary quiet day. Fail-silent: a Sheets/network hiccup
  // must never affect capture.
  async sendBridgeStatus() {
    if (this.dryRun) return;
    try {
      await axios.post(this.webhookUrl, {
        mode: 'bridge_status',
        bridge_id: 'primary',
        connected_at: this.connectedAt,
        started_at: this.startedAt,
        confirmed_groups: this.confirmedChatIds.size,
        cached_messages: this.recentMessages.size,
        bridge_version: this.bridgeVersion,
      }, {
        timeout: 15000,
        headers: { 'x-firstchord-incoming-secret': this.webhookSecret },
      });
      // A heartbeat that posts while the socket is live is proof of health.
      // Posting while disconnected doesn't count — that must stay stale so the
      // watchdog can act if reconnects aren't succeeding.
      if (this.connected) this.markHealthy();
    } catch (error) {
      this.logWarn('Could not post bridge heartbeat', { error: error.message });
    }
  }

  scheduleHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendBridgeStatus().catch(() => {});
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  // A moment of proven life: a live socket or successful work happened.
  markHealthy() {
    this.lastHealthyAt = Date.now();
  }

  // Force-exit when nothing healthy has happened for watchdogStaleMs so
  // launchd (KeepAlive) restarts a fresh process. Deliberately NOT unref'd:
  // this timer must keep firing even if every other handle has gone quiet,
  // and it's what fires on wake after the Mac has slept through everything.
  startWatchdog() {
    if (!this.watchdogEnabled || this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      // Dropped and not reconnecting — reconnect normally succeeds in seconds.
      if (this.disconnectedSince && now - this.disconnectedSince > this.watchdogDisconnectGraceMs) {
        this.exitForRelaunch('disconnected too long', {
          disconnectedSeconds: Math.round((now - this.disconnectedSince) / 1000),
          thresholdSeconds: Math.round(this.watchdogDisconnectGraceMs / 1000),
        });
        return;
      }
      // Total stall: no proof of life at all (process/timers frozen, e.g. the
      // Mac slept and the socket died without a clean close). On wake the
      // accumulated staleness is huge, so this fires within one check.
      const staleMs = now - this.lastHealthyAt;
      if (staleMs > this.watchdogStaleMs) {
        this.exitForRelaunch('no healthy activity', {
          staleSeconds: Math.round(staleMs / 1000),
          thresholdSeconds: Math.round(this.watchdogStaleMs / 1000),
          connected: this.connected,
        });
      }
    }, this.watchdogCheckMs);
  }

  exitForRelaunch(reason, details = {}) {
    this.logError(`Watchdog: ${reason} — exiting for a clean relaunch`, details);
    this.saveMessageCache();
    process.exit(1);
  }

  // Live messages (upsert type "notify") in confirmed FC groups post to the
  // dashboard automatically — including our own replies (from_me), which the
  // dashboard uses as "school replied" evidence rather than inbox rows.
  // sentMessageIds dedupes within a session so a re-delivered message id is
  // only posted once.
  async maybeAutoCapture(message) {
    if (!this.autoCaptureEnabled || this.dryRun) return;
    const chatId = message.key?.remoteJid || '';
    const messageId = message.key?.id || '';
    const cacheKey = messageCacheKey(message.key || {});
    if (!chatId || !messageId || this.sentMessageIds.has(cacheKey)) return;

    const { text } = extractMessageContent(message);
    if (!text) return; // media without a caption carries nothing to classify

    if (!this.confirmedChatIds.has(chatId)) {
      const pending = this.cacheMessage(message, { pendingAutoCapture: true }) || {};
      await this.discoverGroupForCapture(chatId, pending.messageAt);
      return;
    }

    const cached = this.cacheMessage(message) || {};
    await this.postCachedAutoCapture(cached);
  }

  // `kill -USR1 <pid>` on the running bridge triggers a group sync on the live
  // socket. Bound once, even across reconnects.
  bindGroupSyncSignal() {
    if (this.signalHandlersBound) return;
    this.signalHandlersBound = true;
    process.on('SIGUSR1', () => {
      this.logInfo('SIGUSR1 received — running group sync on live connection');
      this.triggerLiveGroupSync().catch((error) => this.logError('SIGUSR1 group sync failed', { error: error.message }));
    });
  }

  async connect() {
    this.validateConfig();
    this.bindGroupSyncSignal();
    this.startWatchdog(); // also covers a never-opens startup, not just a mid-life hang
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.logInfo('Starting WhatsApp incoming bridge', {
      webhookUrl: this.webhookUrl,
      authDir: this.authDir,
      version: version.join('.'),
      isLatest,
      dryRun: this.dryRun,
      syncGroupsOnStart: this.syncGroupsOnStart,
    });

    this.sock = makeWASocket({
      version,
      auth: state,
      logger: P({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
      browser: ['First Chord Incoming Bridge', 'Chrome', '121.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
    });
    guardOutbound(this.sock); // receive-only: block any WhatsApp send

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('messaging-history.set', ({ chats = [] }) => this.recordChatTimestamps(chats));
    this.sock.ev.on('chats.set', ({ chats = [] }) => this.recordChatTimestamps(chats));
    this.sock.ev.on('chats.upsert', (chats = []) => this.recordChatTimestamps(chats));

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('\nScan this QR code from WhatsApp Linked Devices:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.connected = true;
        this.connectedAt = nowIso();
        this.disconnectedSince = null;
        this.markHealthy();
        this.startWatchdog();
        this.logInfo('WhatsApp bridge connected');
        // Heartbeat straight after the group refresh so the first status row
        // carries the real list size, not zero.
        this.refreshConfirmedGroups()
          .then(() => this.resumePendingGroupDiscovery())
          .then(() => this.sendBridgeStatus())
          .catch(() => {});
        this.scheduleConfirmedGroupsRefresh();
        this.scheduleHeartbeat();
        if (this.syncGroupsOnStart && !this.startupSyncDone) {
          this.startupSyncDone = true;
          this.logInfo('Scheduling startup group sync', { waitMs: this.groupSyncWaitMs });
          setTimeout(() => {
            this.triggerLiveGroupSync().catch((error) => this.logError('Startup group sync failed', { error: error.message }));
          }, this.groupSyncWaitMs);
        }
      }

      if (connection === 'close') {
        this.connected = false;
        if (!this.disconnectedSince) this.disconnectedSince = Date.now();
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.logWarn('WhatsApp bridge connection closed', { statusCode, shouldReconnect });
        if (shouldReconnect) {
          setTimeout(() => this.connect().catch((error) => this.logError('Reconnect failed', { error: error.message })), 5000);
        }
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages = [], type }) => {
      // Only live deliveries ('notify') are captured. History/append batches on
      // reconnect replay old traffic — cache them so context is warm, but never
      // post them (the auto-capture dedupe is in-memory and resets on restart,
      // so a reconnect would otherwise re-post already-handled messages).
      if (type !== 'notify') {
        for (const message of messages) this.cacheMessage(message);
        return;
      }
      for (const message of messages) {
        this.cacheMessage(message);
        await this.maybeAutoCapture(message).catch((error) => this.logWarn('Auto-capture failed', { error: error.message }));
      }
    });
  }

  async sendTestPayload(text) {
    this.validateConfig();
    const payload = await this.buildPayload({
      messageId: `manual-test-${Date.now()}`,
      chatId: 'manual-test',
      chatName: 'Manual bridge test',
      senderName: 'Manual test',
      senderPhone: '',
      messageText: text,
      messageType: 'manual_test',
      messageAt: nowIso(),
      cacheHit: true,
    });
    return this.sendPayload(payload);
  }

  async sendGroupSync(groups = []) {
    if (this.dryRun) {
      this.logInfo('Dry run group sync', { groupCount: groups.length });
      return { dryRun: true, groups };
    }

    const response = await axios.post(this.webhookUrl, { mode: 'sync_groups', groups }, {
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'x-firstchord-incoming-secret': this.webhookSecret,
      },
    });
    this.logInfo('Posted group sync to dashboard', {
      status: response.status,
      groupsSent: groups.length,
      summary: response.data?.groupSyncSummary || null,
    });
    return response.data;
  }

  // Metadata-only snapshot of every group the account is in, tagged with the
  // last-active time we know from chat history. Shared by the one-shot command
  // and the live (already-connected) trigger.
  async collectParticipatingGroups(sock = this.sock, chatTimestamps = this.recentChatTimestamps) {
    const participating = await sock.groupFetchAllParticipating();
    const all = Object.values(participating || {});
    const groups = all
      .filter((meta) => titleLooksLikeFcGroup(meta.subject || ''))
      .map((meta) => {
        const ts = chatTimestamps.get(meta.id);
        // LID-addressed groups list participants under an anonymised id with the
        // phone-format JID (when known) in participant.jid; phoneFromJid rejects lids.
        const participantPhones = (meta.participants || [])
          .map((participant) => phoneFromJid(participant.jid || participant.id))
          .filter(Boolean)
          .slice(0, 50);
        return {
          chatId: meta.id,
          chatName: meta.subject || '',
          participantPhones,
          lastActiveAt: ts ? new Date(ts * 1000).toISOString() : '',
        };
      });
    this.logInfo('Filtered groups to likely First Chord student or tutor groups', { total: all.length, kept: groups.length });
    return groups;
  }

  recordChatTimestamps(chats = []) {
    for (const chat of chats) {
      const ts = Number(chat.conversationTimestamp || 0);
      if (chat.id && ts) this.recentChatTimestamps.set(chat.id, ts);
    }
  }

  // Runs a group sync on the bridge's existing live connection — no second
  // socket, so it never trips WhatsApp's "connection replaced" (440). Triggered
  // by SIGUSR1 or, once, on startup when SYNC_GROUPS_ON_START is set.
  async triggerLiveGroupSync() {
    if (this.groupSyncInFlight) {
      this.logWarn('Group sync already running — ignoring trigger');
      return;
    }
    if (!this.sock || !this.connected) {
      this.logWarn('Cannot sync groups yet — bridge is not connected');
      return;
    }
    this.groupSyncInFlight = true;
    try {
      this.logInfo('Live group sync triggered');
      const groups = await this.collectParticipatingGroups();
      this.logInfo('Fetched participating groups', { groupCount: groups.length });
      const result = await this.sendGroupSync(groups);
      this.logInfo('Live group sync complete', { summary: result?.groupSyncSummary || null });
      await this.refreshConfirmedGroups();
    } catch (error) {
      this.logError('Live group sync failed', { error: error.message });
    } finally {
      this.groupSyncInFlight = false;
    }
  }

  // One-shot: connect, let chat history settle so we know last-active times,
  // enumerate every group the account is in (metadata only), and post them.
  // WhatsApp frequently closes the first connection ("restart required", 515)
  // or drops briefly, so this reconnects on any non-logout close and only
  // settles the promise once — on a successful sync or after max attempts.
  async runGroupSync({
    waitMs = Number(process.env.GROUP_SYNC_WAIT_MS || 25000) || 25000,
    maxAttempts = Number(process.env.GROUP_SYNC_MAX_ATTEMPTS || 6) || 6,
  } = {}) {
    this.validateConfig();
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    let attempts = 0;
    let settled = false;

    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      const recordChats = (chats = []) => this.recordChatTimestamps(chats);

      const start = () => {
        attempts += 1;
        const sock = makeWASocket({
          version,
          auth: state,
          logger: P({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
          browser: ['First Chord Incoming Bridge', 'Chrome', '121.0'],
          markOnlineOnConnect: false,
          keepAliveIntervalMs: 25000,
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 60000,
        });
        guardOutbound(sock); // receive-only: block any WhatsApp send
        this.sock = sock;
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('messaging-history.set', ({ chats = [] }) => recordChats(chats));
        sock.ev.on('chats.set', ({ chats = [] }) => recordChats(chats));
        sock.ev.on('chats.upsert', (chats = []) => recordChats(chats));

        sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;
          if (qr) {
            console.log('\nScan this QR code from WhatsApp Linked Devices:\n');
            qrcode.generate(qr, { small: true });
          }

          if (connection === 'close') {
            if (settled) return;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
              finish(reject, new Error('WhatsApp session logged out — re-link the device and try again'));
              return;
            }
            if (attempts >= maxAttempts) {
              finish(reject, new Error(`WhatsApp connection kept closing (last status ${statusCode ?? 'unknown'}) after ${attempts} attempts`));
              return;
            }
            this.logWarn('Connection closed, reconnecting', { statusCode, attempt: attempts });
            setTimeout(() => {
              try { start(); } catch (error) { finish(reject, error); }
            }, 2000);
            return;
          }

          if (connection !== 'open') return;

          try {
            this.logInfo('Connected — letting chat history settle before syncing groups', { waitMs, attempt: attempts });
            await new Promise((done) => setTimeout(done, waitMs));

            const groups = await this.collectParticipatingGroups(sock);
            this.logInfo('Fetched participating groups', { groupCount: groups.length });
            const result = await this.sendGroupSync(groups);
            finish(resolve, result);
            try { sock.end(); } catch { /* ignore */ }
          } catch (error) {
            // A dropped connection surfaces here as a query error — let the
            // close handler reconnect and retry rather than failing outright.
            this.logWarn('Group fetch failed; will retry on reconnect', { error: error.message, attempt: attempts });
            try { sock.end(new Error('retry group sync')); } catch { /* ignore */ }
          }
        });
      };

      start();
    });
  }
}

async function main() {
  const bridge = new WhatsAppIncomingBridge();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      bridge.saveMessageCache();
      process.exit(0);
    });
  }
  const testIndex = process.argv.indexOf('--send-test');
  if (testIndex !== -1) {
    const text = process.argv.slice(testIndex + 1).join(' ').trim() || 'Alex is away next Friday';
    const result = await bridge.sendTestPayload(text);
    console.log(`Bridge intake test complete: ${result?.success === true || result?.dryRun === true ? 'success' : 'unexpected response'}`);
    return;
  }
  if (process.argv.includes('--sync-groups')) {
    const result = await bridge.runGroupSync();
    console.log('Group sync complete:', JSON.stringify(result?.groupSyncSummary || result || {}, null, 2));
    process.exit(0);
  }
  await bridge.connect();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  WhatsAppIncomingBridge,
  extractMessageContent,
  phoneFromJid,
};
