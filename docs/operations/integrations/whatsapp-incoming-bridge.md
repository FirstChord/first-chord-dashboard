---
status: canonical
audience: [human, agent]
last_verified: 2026-09-12
---
# WhatsApp Incoming Bridge

## Purpose

The local Baileys bridge copies live messages from human-confirmed First
Chord student and tutor groups into the admin inbox. It is a receive-only intake aid, not a
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
chat ID is in its dashboard-supplied confirmed-group set. A live text message
from an unknown group is retained as pending in the bounded local cache while
the bridge asks WhatsApp for that exact group's metadata. A likely First Chord
title is synced to the dashboard immediately for human review. Confirmation
releases that specific pending message on the next confirmed-group refresh;
the stable message ID keeps the retry idempotent. The message is never posted
before confirmation. A bridge restart resumes targeted discovery for persisted
pending messages rather than stranding them. It skips:

- history/append batches and unconfirmed chats that have not been reviewed
- duplicate message IDs already posted by that process
- media with no extractable text or caption

`AUTO_CAPTURE_CONFIRMED_GROUPS` defaults to `true`. Setting it to `false`
disables automated capture; it does not enable a starred-message fallback.

Each post includes source `whatsapp_group_auto`, stable WhatsApp chat/message
IDs, sender metadata, text, timestamps, `from_me`, and small raw metadata. The
dashboard re-checks that the chat is still `confirmed` before storing it. Its
replay identity is `source + chat_id + external_message_id`, so a repeated post
is a no-op.

Own-account and configured admin-staff replies do not create inbox rows.
In student groups, recognised tutor replies also remain school-side evidence.
In confirmed tutor groups, the tutor's messages are inbound work and create
normal inbox rows; being listed in Tutor_Phones must not suppress them. A later school message stamps weak engagement
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

The everyday inbox is a queue/detail workspace: a compact message queue remains
visible beside one selected card on desktop, while mobile opens that card with a
sticky **Back to messages** control. The queue shows **x of y**, remembers the
selected message and scroll position on this device, and selects the adjacent
message after an outcome, so a review run does not lose its place. **Earlier in
this chat** is a collapsed, four-message context read made only when a card is
selected; it reads the cached inbox tab and does not join Planning, students,
the group map, or `Communication_Log`.
The detail card leads with student/sender, time and the original message. Tutor-group cards lead with the linked tutor and a compact **Tutor** badge.
Consecutive messages from the same sender, chat and matched student sent within
five minutes are one card: the burst is shown oldest-first under a single
header, and Handled / No action / Later / Delete apply to every message in it.
Reply and Reply + Plan work from the burst's **lead** — the non-placeholder
message with the highest actionability — while date extraction and the plan
draft read the whole burst. Clustering is display and outcome scope only; the
sheet keeps one row per WhatsApp message. One human burst decision is persisted
as one batched Sheets write and returned to the browser as changed rows only.
**Reply + Plan** opens one pre-write preview: plan type and student are
prefilled, extracted first/return dates are visible and editable, and a short
deterministic parent reply is editable beside them. **Copy reply & create plan**
copies that exact wording, stores it in the linked Planning item, closes the
inbox burst and advances to the adjacent message only after the write succeeds.
A persistent **Reply ready** handoff stays at the top of the inbox with the
reviewed text and optional **Open plan** link. It survives an accidental page
reload for this browser session. Opening WhatsApp never claims delivery: the
reviewer either confirms **Sent — finish & next** or deliberately chooses
**Leave with plan**. Clearing a false date clears it from the draft. A failed
Planning write cannot create false closure.
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
prefilled in a separate surface. The inbox remains open and shows the reviewed
reply plus the lesson-group reminder. WhatsApp does not expose a supported deep
link to a private lesson group, so the admin still chooses the chat and taps
Send. Only the explicit **Sent — finish & next** press resolves the inbox item;
**Not yet** returns the handoff to its ready state. Copied and opened remain
intent to send, not delivery evidence.

Classifier labels, evidence, correction, no-action and test-row deletion stay
behind the single More disclosure. A later school message is shown as a compact
reply receipt; its non-resolution caveat remains in Details.

**Later** stores `snoozed_until` on the open message rather than pretending it is
finished. It leaves the status and classification untouched, removes the row
from today's Inbox and Overview count, and resurfaces it after the chosen time.
The Open, Later and Done filters keep those meanings distinct. **Done** records
handled-without-a-plan; **No action needed** remains a separate outcome under
More. Neither performs a provider action or sends a reply.

**Handled** and **Later** offer a 12-second Undo. Undo carries the prior workflow
fields, reloads the current Sheet row, and applies only if its review timestamp
still matches; another person's later decision wins. Planning-linked outcomes
cannot be undone from the inbox.

The active inbox is the initial read path. **Done** loads only when opened,
returns the 100 most recent completed rows with the full history count, and
does not read Planning because the inbox card already stores the plan link it
needs. The large WhatsApp group map plus tutor list load only when **WhatsApp
group connections** is opened. The initial tabs are prefetched in one Sheets
batch. Ordinary corrections, outcomes and plan conversions return compact row
patches instead of reloading the inbox, Planning and group map after every
press. When bridge health is stale, an empty Open queue is explicitly
untrusted—never presented as an ordinary **All caught up**—and the recovery
steps remain available behind a small disclosure.

## Confirmed-Group Gate

On connection, and every ten minutes by default, the bridge requests
`GET /api/admin/incoming-messages?mode=confirmed_groups` using
`INCOMING_MESSAGE_INGEST_SECRET`. A refresh failure retains the previous set;
failure with no set retries after ten minutes. An empty set means no capture.

Group discovery sends metadata only: group ID/title, up to 50 participant phone
JIDs, and last-known activity. The dashboard proposes matches using participant
phones and the group-title convention:

```text
{Student first name} {Instrument} Lessons {emoji}
```

The dashboard requires a group JID, a recognised student/tutor title, and activity within six
months; unknown activity is retained for review. Sync may rebucket only automatic
`review`/`unmatched` states. Human `confirmed` and `ignored` decisions persist.
Confirmation requires either a real student or a tutor selected from the active
roster. The group review offers **Student group** / **Tutor group** and the
corresponding person selector. Known tutor names followed by **First Chord**
(with optional emoji) are also discovered without an instrument word. A shared
first name stays ambiguous and needs an explicit selection. The title is only a
proposal; neither it nor participant membership enables capture by itself.

The periodic full-group snapshot is not assumed complete. When WhatsApp emits a
live message for a chat absent from the confirmed set, the bridge performs a
rate-limited targeted `groupMetadata` lookup. This closes the gap where a group
can deliver messages to the linked account yet be absent from
`groupFetchAllParticipating()`. Non-First-Chord titles remain local cache only;
likely lesson/tutor titles appear in group review, and only a human confirmation
allows their pending live messages through.

The map stores explicit `group_type` (`student` / `tutor`) and
`matched_tutor_id` (the roster short name). Missing legacy types mean student.
A tutor-group confirmation clears student, sibling and parent links; selecting a
student on one tutor message cannot remap the whole group. Re-review and Ignore
remove the group from the server capture gate. Sync preserves confirmed/ignored
decisions. A confirmed tutor group without a tutor ID fails closed.

Each new tutor inbox row snapshots `group_type`, `matched_tutor_id` and
`matched_tutor_name`, so later review, snoozing and group changes do not relabel
its history. Tutor messages do not auto-match a student from an incidental name
or phone; an admin can explicitly link a student when relevant. Reply uses a
neutral editable acknowledgement. Parent-policy AI falls back without a model
call, and Reply + Plan creates a general tutor Action (`is_pause = false`),
never a student pause inferred from the tutor's dates. The normal reviewed tutor
absence workflow remains the route for organising cover or cancellation.

The two schemas gain appended, optional columns through the existing managed
header adapter; no existing row is backfilled or automatically confirmed.
Before rolling back the code, mark any confirmed tutor groups Review or
Ignored, so an older bridge/dashboard does not apply parent rules to them.
Leave the appended columns and historical inbox rows intact.

Use `SIGUSR1` to sync on the existing live socket and refresh its confirmed-group list. Use the one-shot
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

## Catch-Up After An Outage

The bridge receives live WhatsApp events; it does not poll, so there is nothing
to "refresh". It is also a local process, so it is offline whenever this Mac is.
Measured over the five days to 2026-09-16 there were 8 hours of complete log
silence, including **20:18–22:53 on Friday 11 September** — a Friday evening,
when cancellations arrive.

**That undercounts it, and the cause is the Mac sleeping.** `pmset -g custom`
shows `sleep 1` on **both** battery and AC: the machine sleeps after a minute
idle. The network goes with it, the WhatsApp socket times out (`408 timedOut`),
and the bridge retries into a machine that cannot answer. On 16 September it
restarted roughly 1,900 times between 07:52 and its first successful connect at
10:53 — the power log shows only hourly darkwakes (07:59, 08:59, 09:59) in that
window, so the Mac was asleep throughout and the loop ended when the laptop was
opened. The same pattern produced ~770 restarts in one hour on 11 September.

A flapping bridge writes constantly to its log while capturing nothing, so
measuring downtime by log silence misses this mode entirely — which is how the
original figure came to be an undercount.

Reconnects now back off (5s, 10s, 20s … capped at 5 minutes, ±20% jitter,
reset on a successful connect). A three-hour sleep costs about 40 attempts
instead of 2,160, and a genuine blip still recovers on the first five-second
retry. Backoff does not make the bridge available again any sooner — nothing
can, while the machine is asleep — it stops the futile hammering, the 16MB log
files and the CPU wake on every darkwake.

**The real fix is a machine that does not sleep.** See
`10 Idea Incubator/Ideas` in the vault for the always-on host option.

On reconnect WhatsApp replays a backlog (`messages.upsert` with a type other
than `notify`). The bridge used to drop all of it, because its own dedupe is
in-memory and resets on restart. **That is no longer the binding constraint:**
capture is idempotent server-side — `buildIncomingMessageId` hashes
`source::chatId::externalMessageId` so a replay upserts the same row, and
`mergeIncomingCapture` skips outright when a real row exists, preserving review
status, notes and any linked plan when it heals a placeholder.

`catchUpFromHistory` therefore posts the recent part of a replay, bounded:

| Bound | Default | Env |
|---|---|---|
| How far back | 24 hours | `BRIDGE_CATCH_UP_MAX_AGE_HOURS` |
| Messages per batch | 200 | `BRIDGE_CATCH_UP_MAX_MESSAGES` |
| On/off | on | `BRIDGE_CATCH_UP=false` |

It reuses `maybeAutoCapture` rather than adding a second capture path, so the
confirmed-group gate, text-only rule, session dedupe and staff/tutor reply
handling all apply to a replayed message by construction. Messages without a
usable timestamp are never replayed — a replay is exactly where timestamps go
missing, and a message that cannot be shown to be inside the window must not be
assumed to be. Truncation is logged rather than swallowed.

**How far back WhatsApp replays is WhatsApp's decision, not ours.** This closes
short and medium gaps reliably; it is not a guarantee that a long outage is
fully recovered. The coverage-gap record below exists for exactly that reason.

## Recovering Messages Already Missed

**This runs automatically on connect** (`maybeAutoReplayCache`), so recovery
needs no human. The guard is the design: the bridge crash-loops, and each
restart is a fresh process with an empty in-memory dedupe, so the floor is a
marker written to `cache/last-replay.json` — **before** the replay, so a crash
part-way through costs one skipped window instead of letting the loop restart
the replay every five seconds. Default floor 30 minutes
(`BRIDGE_REPLAY_MIN_INTERVAL_MINUTES`, `BRIDGE_REPLAY_ON_CONNECT=false` to turn
it off). It runs after the heartbeat, so a replay failure can never delay the
status the dashboard uses to decide the bridge is alive.

The manual command remains for a wider window than the automatic one, or to
check before posting. The local cache keeps roughly a fortnight of traffic
(`WHATSAPP_CACHE_MAX_AGE_DAYS`) and always did — history batches were cached
even while they were never posted, so messages missed before catch-up existed
are usually still on disk:

```bash
cd tools/whatsapp-incoming-bridge
node bridge.js --replay-cache --since-days 7 --dry-run   # count first
node bridge.js --replay-cache --since-days 7             # then post
```

It needs no WhatsApp connection — it reads the cache and posts over HTTP, so it
is safe to run while the main bridge is up. It reuses `postCachedAutoCapture`,
so each replayed message is built and posted exactly as a live one and **the
dashboard applies its own rules**: staff and tutor messages become reply
evidence, no-signal parent messages land pre-archived, and anything already
captured is skipped server-side. Nothing in the replay decides what a message
is; there must not be a second opinion on that.

First run, 2026-09-16: 220 eligible, 219 posted (one HTTP timeout), and the
inbox went from 967 rows to 977 — **two genuinely missed messages surfaced**, a
tutor chasing payment from 10 Sept and a lesson cancellation from that morning.
The rest were already captured or became reply evidence. That ratio is the point:
replaying is cheap and mostly redundant, which is exactly why it is safe.

## Coverage Gaps

A live health check answers "is the bridge up?", which by the next morning is
always yes. When a heartbeat arrives more than 90 minutes after the previous one,
`recordBridgeStatus` writes that window into `Bridge_Status.raw_json` and the
inbox page shows it **even when the bridge is currently healthy** — the only
evidence that Friday evening had a hole in it. Ninety minutes is three heartbeat
intervals, chosen so ordinary restarts (26 in five days) stay quiet.

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
and identity metadata, is gitignored, and supports diagnostics, heartbeat
counts, and the narrow retry of a live message held while its group awaits
confirmation. History/append batches are never marked pending and are not
replayed. Treat the cache as sensitive and consider its removal if those uses no
longer justify retaining message bodies.

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
