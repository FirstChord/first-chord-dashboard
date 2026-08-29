---
status: canonical
audience: [human, agent]
last_verified: 2026-08-29
---
# WhatsApp Incoming Bridge

## Purpose

The local Baileys bridge copies live parent messages from human-confirmed First
Chord lesson groups into the admin inbox. It is a receive-only intake aid, not a
WhatsApp sender or a source of operational truth.

Manual **Quick capture** on `/admin/incoming-messages` is the fallback for direct
messages, unconfirmed groups, bridge downtime, and anything missed while the
bridge was offline. Starring is not a capture path.

## Home-Screen App

The dashboard has one installable admin web app, **FC Messages**. Its stable
identity and launch target are `/admin/incoming-messages`, and its standalone
bottom bar links to Inbox, Planning, and Overview. Do not add another manifest
for an individual admin route: overlapping same-origin `/admin` manifests
caused iOS to install the old Planning launch target while the user was on
Inbox.

On iPhone, use Safari's **Add to Home Screen** and leave **Open as Web App** on.
iOS persists the launch metadata at installation, so an icon installed before a
launch-target correction must be removed and installed again.

## Active Capture Contract

The bridge posts only `messages.upsert` events with `type === "notify"` whose
chat ID is in its dashboard-supplied confirmed-group set. It skips:

- history/append batches, unconfirmed chats, and an empty confirmed set
- duplicate message IDs already posted by that process
- media with no extractable text or caption

`AUTO_CAPTURE_CONFIRMED_GROUPS` defaults to `true`. Setting it to `false`
disables automated capture; it does not enable a starred-message fallback.

Each post includes source `whatsapp_group_auto`, stable WhatsApp chat/message
IDs, sender metadata, text, timestamps, `from_me`, and small raw metadata. The
dashboard re-checks that the chat is still `confirmed` before storing it. Its
replay identity is `source + chat_id + external_message_id`, so a repeated post
is a no-op.

Own-account, configured staff, and the confirmed group's tutor replies do not
create parent-message rows. A later school message stamps weak engagement
evidence on the nearest preceding open row only; it does not prove that row was
answered and does not mark the work handled.

Parent messages are deterministically classified and matched as proposals.
Topic, intent and actionability are separate: a word such as “summer”,
“holiday”, “away” or “payment” is not by itself an instruction. Action/reply
items remain open, uncertain items ask for review, and explicit no-action
messages arrive pre-archived. The stored machine proposal is preserved beside
the human-final decision so accepted/corrected outcomes can be measured without
calling untouched guesses knowledge. Neither result authorises a payment,
pause, attendance, archive, planning, or messaging action.

The daily card leads with student/sender, time and the original message.
Consecutive messages from the same sender, chat and matched student sent within
five minutes are one card: the burst is shown oldest-first under a single
header, and Handled / No action / Later / Delete apply to every message in it.
Reply and Reply + Plan work from the burst's **lead** — the non-placeholder
message with the highest actionability — while date extraction and the plan
draft read the whole burst. Clustering is display and outcome scope only; the
sheet keeps one row per WhatsApp message and each row is still written
individually.
**Reply + Plan** opens one pre-write preview: plan type and student are
prefilled, extracted first/return dates are visible and editable, and a short
deterministic parent reply is editable beside them. **Copy reply & open plan**
copies that exact wording, stores it in the linked Planning item, and navigates
to the idempotent plan only after the write succeeds. Clearing a false date
clears it from the draft. A failed Planning write cannot create false closure.
For a structured pause, the saved reply is the card's final **Copy & open
WhatsApp** handoff after the payment tool. The admin must still confirm it was
sent before marking the pause complete; clipboard/log evidence alone is not
delivery evidence.

**Reply** is the deliberate per-message boundary. When the bounded pilot is
enabled, that press sends only this message's redacted, length-bounded text and
deterministic policy context for one AI draft; there is no bulk or background
generation. Ambiguous policy evidence never reaches the model. If the provider,
timeout or validator fails—or the flag is off—the same button opens the standard
editable template. **Copy & open WhatsApp** records the copy in
`Communication_Log` and opens WhatsApp's chat chooser with the final text
prefilled. WhatsApp does not expose a supported deep link to a private lesson
group, so the admin still chooses the chat and taps Send. Copied remains intent
to send, not delivery evidence.

Classifier labels, evidence, correction, no-action and test-row deletion stay
behind the single More disclosure. A later school message is shown as a compact
reply receipt; its non-resolution caveat remains in Details.

**Later** stores `snoozed_until` on the open message rather than pretending it is
finished. It leaves the status and classification untouched, removes the row
from today's Inbox and Overview count, and resurfaces it after the chosen time.
The Open, Later and Done filters keep those meanings distinct. **Done** records
handled-without-a-plan; **No action needed** remains a separate outcome under
More. Neither performs a provider action or sends a reply.

## Confirmed-Group Gate

On connection, and every six hours by default, the bridge requests
`GET /api/admin/incoming-messages?mode=confirmed_groups` using
`INCOMING_MESSAGE_INGEST_SECRET`. A refresh failure retains the previous set;
failure with no set retries after ten minutes. An empty set means no capture.

Group discovery sends metadata only: group ID/title, up to 50 participant phone
JIDs, and last-known activity. The dashboard proposes matches using participant
phones and the group-title convention:

```text
{Student first name} {Instrument} Lessons {emoji}
```

The dashboard requires a group JID, an instrument token, and activity within six
months; unknown activity is retained for review. Sync may rebucket only automatic
`review`/`unmatched` states. Human `confirmed` and `ignored` decisions persist.
Confirmation requires a real student and stores the group/student/parent/tutor
context that becomes the capture allow-list.

Use `SIGUSR1` to sync on the existing live socket. Use the one-shot
`npm start -- --sync-groups` only while the normal bridge is stopped: two Baileys
sockets sharing one auth directory replace each other (status 440). The launchd
template signals the live bridge on Monday at 06:30.

## Endpoint And Storage

External capture and bridge-control requests use:

```text
POST /api/admin/incoming-messages
x-firstchord-incoming-secret: <INCOMING_MESSAGE_INGEST_SECRET>
```

Secret-only bridge capture responses contain acknowledgement metadata only.
They never return the admin inbox, group map, parent text, or student context.
Group sync additionally returns its aggregate match summary so the local
operator can diagnose mapping coverage. Authenticated admin requests retain the
full interactive response their UI needs.

The dashboard writes:

- `Incoming_Message_Inbox`: captured evidence and human workflow state
- `WhatsApp_Group_Map`: proposed and confirmed group mappings
- `Bridge_Status`: one heartbeat row for the primary bridge

See [State tabs](../../architecture/data/state-tabs.md) for field ownership and
retention. The route must remain secret-authenticated and must re-check the
confirmed group server-side.

## From Evidence To Action

Admins can correct the proposed topic, actionability, or student; move an open
message to Later; record handled or no-action; or convert a message into an
idempotently linked `Planning_Items` action. Conversion archives the message
only after the plan save succeeds, and
the inbox then shows the linked plan's current status. The returned reply is
editable clipboard text only. Copying logs `Communication_Log`; it does not
prove the reply was sent.

The outbound guard replaces both `sock.sendMessage` and `sock.relayMessage` with
throwing functions. Keep
`tests/admin/whatsapp-bridge-outbound-guard.test.mjs` green. Any future sending
must be a separate, approved official-API workflow.

## Health And Recovery

After connecting, the bridge refreshes confirmed groups and posts a heartbeat,
then repeats the heartbeat about every 30 minutes. Dashboard health warns when:

- heartbeat age is at least two hours
- the confirmed-group count is zero
- no auto-capture has been recorded for at least three days

The watchdog normally exits after more than ten minutes disconnected, or after
roughly 65 minutes without proven health at the default heartbeat. launchd
`KeepAlive` then relaunches it. A logged-out session needs a QR re-link.

Recovery order:

1. Use Quick capture for any urgent missed message.
2. Check `tools/whatsapp-incoming-bridge/logs/bridge.log`, the dashboard
   heartbeat, and confirmed-group count.
3. Restart/re-link the single bridge process if needed.
4. Signal a live group sync if mappings are stale.
5. Do not promise backlog recovery: history/append batches are cached locally
   but deliberately are not posted after reconnect.

## Local Cache And Privacy

The JSON cache defaults to 2,000 messages and 14 days. It contains message text
and identity metadata, is gitignored, and currently supports diagnostics and
heartbeat counts—not replay or recovery. Treat it as sensitive and consider its
removal if those diagnostics no longer justify retaining message bodies.

Structured operational logs default to `logs/bridge.log`. They exclude message
text, message/chat IDs, sender details, group samples, and dashboard response
content. The logger rotates at 2 MiB, keeps at most four rotated files, and
removes rotations older than 14 days. `BRIDGE_LOG_PATH`,
`BRIDGE_LOG_MAX_BYTES`, `BRIDGE_LOG_MAX_FILES`, and
`BRIDGE_LOG_MAX_AGE_DAYS` may override those bounds. Existing
`launchagent.out.log`/`launchagent.err.log` files predate this boundary; review
and remove them separately rather than assuming the new logger prunes them.

`WRITE_STARRED_LOG` and `starred-payloads.ndjson` are legacy names; when enabled,
the log can contain current test/auto payloads and personal data. Never commit it.

Baileys is unofficial and can break or lead to account restriction. Risk is
bounded by receive-only operation, low-frequency metadata reads, a separate
manual-capture path, and keeping MMS/Sheets—not WhatsApp automation—as truth.

## Code And Checks

- local bridge: `tools/whatsapp-incoming-bridge/`
- dashboard orchestration: `lib/admin/incoming-messages.js`
- deterministic rules: `lib/admin/incoming-message-helpers.mjs`
- Sheets adapter: `lib/admin/sheets/incoming-messages.mjs`
- focused tests: `tests/admin/incoming-*.test.mjs` and
  `tests/admin/whatsapp-bridge-outbound-guard.test.mjs`

There is no end-to-end socket/watchdog contract test. Changes to live event,
heartbeat, refresh, or reconnect handling need a manual bridge smoke check.
