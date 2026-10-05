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
normal inbox rows; being listed in Tutor_Phones must not suppress them.
School replies remain engagement evidence and never mark work handled. A
WhatsApp quote links a reply to the matching captured request (or a stored reply
on that request) in the same chat. Unknown quotes do not fall back to a different
request. Without a quote, use the nearest preceding captured inbound message
within seven days, only if it is still open. A closed/auto-archived message is a
boundary; repeated replies must not walk backwards through older open requests.
Invalid timestamps cannot create an association.

The optional `school_reply_evidence_json` column retains at most four replies
per request, each with at most 1,200 characters, the stable message ID,
timestamp, display name, admin/tutor role and quoted/nearest association. Longer
text is explicitly marked truncated. No embedded quoted transcript, extra phone
number or raw WhatsApp object is retained. Existing timestamp-only receipts
remain readable. A duplicate reply is a no-op, including after the request is
closed; an out-of-order reply never moves the latest receipt backwards. The
capture path reloads inbox rows before attaching a reply, then patches only the
receipt columns so it cannot undo a concurrent human review or Planning link. There is no history
backfill, AI classification or external model call in this reply-evidence lane.
Deploy the bridge's `bridge.js` update on the Mac as well as the dashboard:
older bridges still supply reply text, but cannot supply quoted-message IDs.

Parent messages are deterministically classified and matched as proposals.
Topic, intent and actionability are separate: a word such as “summer”,
“holiday”, “away” or “payment” is not by itself an instruction. Action/reply
items remain open, uncertain items ask for review, and explicit no-action
messages arrive pre-archived. The stored machine proposal is preserved beside
the human-final decision so accepted/corrected outcomes can be measured without
calling untouched guesses knowledge. Neither result authorises a payment,
pause, attendance, archive, planning, or messaging action.

Classifier version 3 requires positive evidence of an acknowledgement, settled
matter, or ordinary chatter before choosing `no_action`. Substantive wording
that matches no topic stays `uncertain` / `needs_review`, including a standalone
date. Greetings and thanks cannot suppress another question, unresolved clause,
or request. Questions after a greeting do not require a question mark. Explicitly
denied cancellations/leaving are excluded from topic matching; a completed break
with an explicit restart is scheduling evidence. These are proposals for new
captures or explicitly replaced message text, not a reclassification of stored
rows. Replays preserve human decisions.

Run `npm run eval:incoming` to measure topic accuracy separately from capture
outcomes. The synthetic fixture labels expected actionability and actual inbox
status; the focused tests execute the real capturer with in-memory adapters,
including replay after review. The report counts missed work and unnecessary
reviews of recognised chatter separately. It is not a production accuracy claim.

The everyday inbox is a queue/detail workspace: a compact message queue remains
visible beside one selected card on desktop, while mobile opens that card with a
sticky **Back to messages** control. The queue shows **x of y**, remembers the
selected message and scroll position on this device, and selects the adjacent
message after an outcome, so a review run does not lose its place. **Earlier in
this chat** is a collapsed, four-message context read made only when a card is
selected; it reads the cached inbox tab and does not join Planning, students,
the group map, or `Communication_Log`.
Category pills use short words and subject colours: **Payment** is purple
(Stripe), **Absence** and **Schedule** are blue (MMS lessons/attendance),
**Leaving** and **Concern** are amber, and **General** is grey. All temporary
absence subtypes share the blue **Absence** badge; their stored types, extracted
dates and duration remain available to planning. The queue's collapsed **Category colours**
key explains this convention. Colour never means urgency, completion or no
action. The old yellow/green review dots and generic **Check details** are removed;
open messages retain **Check student** for an uncertain student match.
Parent absence bursts show **Short notice** only when an exact stated start date is
less than seven school calendar days from the earliest original message timestamp,
including same-day notice. Dates use Europe/London; capture time and today's date
are never substitutes. A clear start/return range uses its start. Missing
timestamps, vague/weekday/ordinal dates, lists of missed dates or an uncertain
date role show **Check notice**. The detail card explains
the cue, including the same-day practice-video exclusion. No notice cue authorises
a payment pause or sends a reply; apply the [school cancellation policy](../../policies/school.md)
in human review. Tutor groups do not get the parent-policy cue. Completed messages
do not retain open-review prompts. Capture filtering,
Jev checks, attention groups and workflow state are unchanged.
The detail card leads with student/sender, time and the original message. Tutor-group cards lead with the linked tutor and a compact **Tutor** badge.
Consecutive messages from the same sender, chat and matched student sent within
five minutes are one card: the burst is shown oldest-first under a single
header, and Handled / No action / Later / Delete apply to every message in it.
Reply and Reply + Plan work from the burst's **lead** — the non-placeholder
message with the highest actionability — while date extraction and the plan
draft read the whole burst. Clustering is display and outcome scope only; the
sheet keeps one row per WhatsApp message. One human burst decision is persisted
as one batched Sheets write and returned to the browser as changed rows only.
For parent absence messages, **Reply + Plan** navigates to the existing
structured pause builder on Planning (`?incomingPause=<source ID>`). This applies
to every stored temporary absence category and clear absence wording even when
the stored category is General. Routing does not change classification or the
capture/attention filters. An uncertain parent topic can be explicitly chosen as
absence in the Inbox preview; it then opens the same builder. Tutor messages keep
their separate reviewed workflow. The legacy conversion service refuses a parent
absence instead of producing an incomplete generic task.

Opening the builder performs no planning write and leaves the source open. The
original message/burst is visible, the matched student is preselected for review,
and extracted dates are suggestions only. A general away-period boundary is
shown as evidence, not silently treated as a lesson date. Review the actual MMS
lesson suggestions or enter the dates. Only **Create pause plan** saves a dated
structured pause. Missing students/dates, invalid calendar dates, reversed ranges,
and changed source text/review/student state are refused before writing. Cancel
returns to Inbox without changing the message. The intake has no generic Capture
form alongside it.

The admin-only `/api/admin/planning/incoming-pause` route re-reads fresh source
evidence, validates the exact reviewed burst and student, builds the draft with
the existing structured-pause helper, and saves the stable source-linked ID.
Only after that save succeeds are the reviewed source messages linked and moved
out of Open. It never changes Stripe, attendance or payment expectation. A save
failure retains the source and draft; a response retry reveals an already linked
card without creating or rewriting it. Existing exact-open-pause duplicate guards
remain in force. A sibling-link failure is explicit partial success with the
saved plan ID; a failed post-save dashboard refresh cannot hide the successful
save. Success and errors are brought into view on narrow screens. The receipt
provides **View pause plan** and **Return to Inbox** immediately.

The pause intake keeps an editable **Initial acknowledgement**. Its explicit
**Copy & open WhatsApp** copies the reviewed text and opens the chat chooser;
the human chooses the correct lesson group and sends. **Acknowledgement sent**
records progress on the saved pause, without finishing it or satisfying the final
confirmation gate. That field is read-only after creation so the stored context
matches what is recorded. No send is automatic.

Other topics retain their reviewed Inbox preview and persistent acknowledgement
strip. It copies the editable draft, saves only on explicit creation, and survives
reload for this browser session. An outstanding reply cannot be overwritten by
another reply or generic plan; it does not block navigating to the read-only pause
builder. Human **Acknowledgement sent** records only progress, not completion.
After recording, **View plan** locates the card without opening its editor
(`?view=`); explicit editing links (`?focus=`) elsewhere retain their behaviour.

Planning owns the later outcome confirmation. The initial acknowledgement is
collapsed context, including legacy **Suggested reply** note blocks. For a
structured pause, the final message is generated from the reviewed pause dates
and linked student, never reused from the acknowledgement, and appears after the
payment-tool step. Existing tutor-absence combined messages retain priority.
For other incoming plans, **Final confirmation** is an editable, initially empty
message: write the actual outcome after doing the work. Sending and the existing
pause-completion gates remain human actions; copied/opened evidence alone never
proves delivery. New note blocks use **Initial acknowledgement (send now in
WhatsApp):** followed by **Planning follow-up:**; legacy rows need no migration.

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
reply receipt. Open defaults to **All**; the compact **Replied** filter shows
whole bursts with a school reply after their newest inbound message. A receipt
on a non-lead child is included, while a fresh message after an older reply loses
the cue. The expanded receipt shows the bounded reply text and whether it was
linked by a quote or merely later in the chat. Replied is a review aid, not a
resolved status; **Select**, checkmarks, swipe and full **Undo** work as before.
Changing the reply filter cancels selection; filtering never drops unstamped
children from a burst or silently archives work.

**Later** stores `snoozed_until` on the open message rather than pretending it is
finished. It leaves the status and classification untouched, removes the row
from today's Inbox and Overview count, and resurfaces it after the chosen time.
The Open, Later and Done filters keep those meanings distinct. **Done** records
handled-without-a-plan; **No action needed** remains a separate outcome under
More. Neither performs a provider action or sends a reply.

The queue offers a 44px **Handled** checkmark without opening the detail card.
On touchscreens, a deliberate left swipe performs the same action; vertical
scrolling, short swipes and cancelled gestures do nothing. **Select** reveals
checkboxes and a compact batch toolbar. A row selects its currently visible
burst; selection keeps exact message IDs, so a later arrival is not swept into
an earlier selection. Changing views cancels selection. **E** handles the
focused row or selected messages and **Z** undoes while the queue has keyboard
focus; shortcuts never apply while typing.

**Up/Down** moves through the visible message bursts, updates the detail card,
and keeps the focused row in view; it stops at the first/last row. In Select
mode it moves checkbox focus without selecting or handling anything. **Left/Right**
switches the focused filter strip (Open/Later/Done or All/Replied/Looks answered)
and wraps at its ends. Elsewhere in the inbox it uses the reply filters in Open,
or the view strip in Later/Done. Arrow navigation leaves text fields, native
selects, forms, menus/dialogs, modified keys, and saving states alone. It does
not run Jev or persist a message outcome.

Review, Later and Undo share a 100-message batch limit. Review guards compare
status, review timestamp, snooze and Planning link before any batch write; a
changed item rejects the whole selection for refresh/review. Failed actions
leave the queue and selection visible with an error beside the controls. A
refresh begun before an inbox mutation cannot overwrite its compact response.

**Handled** and **Later** offer a 20-second Undo, including the whole selected
batch rather than truncating it to twelve messages. Undo pauses while saving.
Unlinked Done items also offer **Bring back to Open** after the toast expires.
Undo carries the prior workflow fields, bypasses the read cache for the current
Sheet rows, and applies only if each review timestamp
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
`recordBridgeStatus` writes that window into `Bridge_Status.raw_json`. Ninety
minutes is three heartbeat intervals, chosen so ordinary restarts (26 in five
days) stay quiet.

**Recording a gap and showing one are different decisions.** Every gap is
recorded; the inbox banner shows only those the automatic replay could not have
filled — `selectUnrecoveredBridgeCoverageGaps`, meaning longer than the 24-hour
catch-up window. A reconnect is what ends a gap and also what triggers the
replay, so a shorter gap is already backfilled by the time anyone reads the
page. The bridge crash-loops most days, so showing those would put a permanent
amber banner above the queue, and a warning that is always on is not a warning.
The line itself is one sentence with no heading and no advice: what to do about
a missed message is what the screen is already for.

`selectRecentBridgeCoverageGaps` returns everything for diagnosis. The filter is
on the display, never on the evidence.

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

### Optional manual Jev assessment

The dashboard's opt-in **Check message** proposes topic/intent/actionability and
assesses captured school replies in one bounded call through
[Jev inbox message checks](../../architecture/ai/jev-inbox-resolution.md).
**Apply details** changes only classification/reviewer cells and leaves the
message open. The separate reply feedback and handling boundaries are preserved.
The bridge does not call Jev, backfill transcripts or change reply association.
**Replied** remains a factual capture cue; **Looks answered** is a separate,
reviewable suggestion. Even confirmed feedback never archives a message or
completes linked Planning work. New requests/replies invalidate old suggestions.

### Automatic attention checks after capture

Finn approved an automatic Jev attention slice on 2026-10-02 for messages that
already reach Open. Existing confirmed-group gates, deterministic filtering and
pre-archive behaviour remain unchanged. The bridge still never calls Jev.
A bounded dashboard producer checks quiet open bursts and proposes Needs attention
or Probably nothing views; it never handles, applies details or sends.
Human batch clearing reuses Select, stale-review checks and Undo. Contract and
kill switch: [Jev inbox message checks](../../architecture/ai/jev-inbox-resolution.md).
