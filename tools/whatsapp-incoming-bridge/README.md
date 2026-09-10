# First Chord WhatsApp Incoming Bridge

Local, receive-only Baileys helper for copying live messages from
dashboard-confirmed lesson groups into `Incoming_Message_Inbox`.

The canonical behaviour and recovery contract is
`docs/operations/integrations/whatsapp-incoming-bridge.md`. This file covers
local setup only. The bridge is not part of the Railway build.

## Setup

```bash
cd tools/whatsapp-incoming-bridge
npm install
export INCOMING_MESSAGE_WEBHOOK_URL="https://<dashboard>/api/admin/incoming-messages"
export INCOMING_MESSAGE_INGEST_SECRET="<same value as Railway>"
npm start
```

The first normal start prints a QR code. Link it from WhatsApp and keep the
generated auth/cache/log directories private and out of git.

Useful configuration:

```text
AUTO_CAPTURE_CONFIRMED_GROUPS=true
CONFIRMED_GROUPS_REFRESH_MS=600000
BRIDGE_HEARTBEAT_MS=1800000
INCOMING_STAFF_PHONES=+44...
WHATSAPP_CAPTURED_BY=Finn
WHATSAPP_CACHE_LIMIT=2000
WHATSAPP_CACHE_MAX_AGE_DAYS=14
BRIDGE_LOG_MAX_BYTES=2097152
BRIDGE_LOG_MAX_FILES=4
BRIDGE_LOG_MAX_AGE_DAYS=14
```

`AUTO_CAPTURE_CONFIRMED_GROUPS=false` turns automated capture off. There is no
starred-only mode.

## What It Does

- listens for live `messages.upsert` notifications
- posts text/captions only for dashboard-confirmed groups
- refreshes the confirmed set on connect and periodically
- sends dashboard heartbeats
- keeps a bounded local diagnostics cache
- records staff/tutor replies as evidence without creating parent rows

History/append batches are not posted, so do not rely on the cache to recover
messages missed while offline. Use dashboard Quick capture for those.

## Receive-Only Boundary

`outbound-guard.js` blocks `sock.sendMessage` and `sock.relayMessage` for every
socket. The bridge must never send a parent message. Verify with:

```bash
node --test ../../tests/admin/whatsapp-bridge-outbound-guard.test.mjs
```

## Group Sync

Discovery includes student lesson titles and tutor titles such as
`Taylor First Chord 🎹`. The dashboard proposes a roster match, and an admin
must confirm the tutor before capture begins. Confirmed-group IDs refresh every
ten minutes by default; signalling a live sync also refreshes that list.


When the main bridge is running, sync on its existing socket:

```bash
kill -USR1 <bridge-pid>
```

Only when it is stopped, use:

```bash
npm start -- --sync-groups
```

Never run both sockets against the same auth directory; WhatsApp will replace
one connection with status 440. `SYNC_GROUPS_ON_START=true` is available for a
one-time sync shortly after the normal bridge connects.

The launchd templates keep the bridge alive and signal a weekly sync. Copy and
edit the templates for the local repository path before loading them.

## Smoke And Recovery

```bash
npm start -- --send-test "Test capture only"
```

The test exercises dashboard ingestion; it is not a WhatsApp send. For a live
smoke check, verify one non-sensitive confirmed-group message appears once,
then verify the dashboard heartbeat and confirmed count.

Privacy-safe structured logs are written to `logs/bridge.log`, rotate at 2 MiB,
retain at most four rotations, and prune rotations older than 14 days. Override
the path or bounds with `BRIDGE_LOG_PATH`, `BRIDGE_LOG_MAX_BYTES`,
`BRIDGE_LOG_MAX_FILES`, and `BRIDGE_LOG_MAX_AGE_DAYS`. The launchd stdout/stderr
files contain only wrapper/uncaught output after this version; older files may
still contain legacy message previews and need a separate reviewed cleanup.

The watchdog exits after a prolonged disconnect or lack of proven health
(about 65 minutes at the default heartbeat); launchd should relaunch it. A
logged-out session requires a QR re-link. Quick capture is the downtime
fallback—offline backlog recovery is not guaranteed.

## Sensitive Local Files

- auth session directory: grants access to the linked WhatsApp account
- `cache/recent-messages.json`: message bodies and identity metadata
- legacy `logs/launchagent.*.log`: may contain message previews from older bridge versions
- `logs/starred-payloads.ndjson`: legacy filename; if enabled, may contain
  current auto/test payloads

Never commit, upload, or broadly share them. `WRITE_STARRED_LOG` should remain
off outside short-lived debugging.
