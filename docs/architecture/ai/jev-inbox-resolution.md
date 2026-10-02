---
status: canonical
audience: [human, agent]
last_verified: 2026-10-02
---
# Jev inbox message checks

The inbox automatically proposes attention groups for messages that already
reach Open. Existing deterministic capture filtering remains unchanged: rows
already filtered into Done are not reopened or processed. The new Jev sweep
never clears a message, applies details, sends, changes attendance/payment, or
completes Planning. **Needs attention** is the default when automatic checking
is enabled; **Probably nothing** has a visible count and **All** restores the
complete open queue. This is a reviewable view, not a status change.
**Replied** means an actual reply was captured; **Looks answered** is a suggestion
with a separate opt-in filter. The reviewer uses the existing checkmark/swipe/
Select controls and Undo for any manual clearing.

## Setup and activation

Create an account/key in the [TypeSafe console](https://console.typesafe.ai/).
Keep the key in server environment configuration, never chat, source control,
client props or a `NEXT_PUBLIC_` variable. On the dashboard Railway service set:

```text
TYPESAFE_API_KEY=<secret entered privately>
TYPESAFE_MODEL=jev-1.13.0
ADMIN_AI_INBOX_RESOLUTION_ENABLED=true
ADMIN_AI_INBOX_CLASSIFICATION_ENABLED=true
ADMIN_AI_INBOX_AUTO_CHECK_ENABLED=true
```

The model setting is optional; the version above is the pinned default. Do not
use a moving alias without rerunning the evaluation. Before activating with real
inbox text, run `node scripts/eval-incoming-resolution.mjs --live` in an environment
with the key supplied securely. This sends **only synthetic fixtures** and reports
expected/actual labels, correct count and false `looks_answered` count. It exits
unsuccessfully for any false answered case or less than 80% exact matches across
ten cases. Passing this small set is an initial check, not evidence of real-world
accuracy or a reason to auto-hide requests. Offline mode checks bounds and makes
zero model calls. On 2026-10-01 the live synthetic evaluation with `jev-1.13.0` matched all
ten expected labels with zero false `looks_answered` results. This establishes
only the initial synthetic check, not real-inbox accuracy. The key was supplied
through Railway environment injection and never printed or stored locally.

The manual button appears only with both classification flag and key. **Check replies** assesses
one card when classification is disabled. With classification enabled, **Check
message** proposes topic, intent and actionability and assesses captured replies
in the same bounded Jev request. Automatic classification has its own flag and
the contract below. Removing the classification flag or key disables all new
assessments while existing fresh suggestions and feedback remain accessible.

## Automatic attention slice

Finn approved this slice on 2026-10-02 and explicitly retained the successful
existing automatic capture filters. Only open, unsnoozed, unlinked inbox bursts
are eligible. The authenticated inbox starts a separate `{mode: "auto"}` POST
on opening and every twenty seconds while visible. It pauses while the reviewer
explicitly opens a card or selects/handles messages. GET/page rendering stays
read-only. A GitHub workflow calls secret-gated `POST /api/cron/inbox-check`
every thirty minutes using the existing `SCHEDULE_REFRESH_SECRET`; that route
returns only counts. Scheduled runs may be delayed by GitHub. No ingest or
bridge code changes, reply generation, automatic reply resolution or provider
actions are introduced.

Each call checks at most three bursts, after five quiet minutes since their
latest **capture** (including replayed historical messages). A fresh existing
classification is reused. Automatic calls ask only the three classification
questions over the same bounded redacted projection. There is no per-message
click or requirement to apply classification details. Automatic details start
collapsed; the existing manual check remains available for ambiguous cases.

Only a fresh whole-burst suggestion with no guard, `no_action` and an explicit
social/acknowledgement/informational intent qualifies for Probably nothing.
Low confidence, incomplete text, provider failures, stale suggestions, Planning
links, and human-reviewed work stay in Needs attention. A later captured inbound
in the same chat invalidates an older quiet cue even if later cleared. Applying
human details remains independent. **Keep in Needs attention** rejects a
suggestion; automatic runs do not overwrite a human decision for the same
source. Select snapshots only visible explicit IDs; **Mark done** reuses the
existing batch review, stale-review checks and twenty-second Undo. Fresh
arrivals are never added silently to the selection.

Automatic starts are bounded to ten per minute per service process and one
hundred persisted attempt records in a rolling day. A metadata-only pending
proposal is saved before the provider call, suppressing ordinary repeated
requests across tabs/restarts for fifteen minutes. A failed provider call saves
an uncertain failure marker and waits an hour before retry eligibility. A crash
leaves its pending marker uncertain. Successful checks reuse fresh results for
twenty-four hours; unchanged human decisions are not automatically rerun.
The worker has an in-process overlap guard; Sheets has no atomic claim, so
multi-process simultaneous reads can still duplicate attempts. These are pilot
cost bounds, not a guaranteed distributed quota. No messages become handled
from an attempt marker or model result. A storage/source-change failure also
leaves the message in attention.

Rollback: set `ADMIN_AI_INBOX_AUTO_CHECK_ENABLED=false` and redeploy. This stops
both producers and returns the default to All without altering inbox rows or
the existing capture filters. Manual checking remains independently available.

Classification version v2 explicitly recognises standalone informal information
sharing while retaining uncertainty for ambiguous fragments. The expanded live
synthetic release check matched 17/19 classification triples and 10/10 reply
labels, with zero false no-action or answered results. The two mismatches stayed
in attention through conservative abstention. This does not measure real-inbox
accuracy. Executed tests cover automatic bounds, cooldown, overlap, human
rejection, source changes, auth and safe cron output; synthetic browser checks at 390×844, 1440×1000 and 1100×900 on
`/jev-attention-preview` covered grouping, batch review/Undo, human rejection,
keyboard navigation and a controlled failure without school-record writes.
The temporary page and API mocks were removed before delivery.

## Human-reviewed message details

Finn approved classification and reply assessment together on 2026-10-01.
`incoming_classification.propose` accepts one server-owned incoming ID, after an
admin session check, and covers the whole open five-minute burst. Its projection
contains up to four redacted original texts, each shorter than 600 characters,
plus student/tutor group type. Classification does not read school replies to
decide whether the original request needs work. It proposes exactly the existing
category, intent and actionability enums; it never proposes dates, student
matches, workflow completion, replies or provider actions. If captured reply
receipts exist and the resolution flag is on, the same request adds the independent
resolution question, using the guards below. Legacy receipts with no captured
text produce `unclear`; no receipt produces no resolution suggestion.

Each classification dimension independently requires confidence >= 0.8 and
chosen probability >= 0.85. An uncertain dimension falls back to `general`,
`unclear` or `uncertain` without discarding the other confident details. Missing,
placeholder, overlong or oversized original text makes all details conservative
without a classification call. Provider failures leave the original inbox intact.

**Apply details** saves the human-selected topic, intent and actionability for
every message in that burst. The adapter forces a fresh full-burst read and source
hash check, then patches only classification and reviewer cells with RAW values.
It preserves status, snooze, Planning links, reply receipts, message text and
student matches. Even `no_action` stays open until a separate human handling
action. **Discard** changes only the proposal. Original deterministic hypotheses,
Jev's proposed enums and the human-applied enums remain distinct. Review failures
stay beside the card. A proposal-review save failure after a successful detail
write returns the actual updated messages and an explicit warning; it does not
invite repeating a supposedly failed write. Sheets still has no compare-and-swap
transaction; the existing last-write-wins limitation remains.

Classification suggestions also use forced reads before/after evaluation,
24-hour freshness, lane isolation and client burst hashes. Applying details
invalidates an older reply assessment because its reviewed-source hash changes;
**Check message again** refreshes it explicitly. Turning either flag off prevents
new calls for that feature while existing fresh human decisions remain possible.
The classification endpoint limits POST check requests to ten per admin per
minute per process; automatic provider starts also have their own process bound.

Run `node scripts/eval-jev-inbox-check.mjs --live` with Railway environment
injection for synthetic-only classification and combined reply checks. On
2026-10-02, `jev-1.13.0` matched 14/14 classification triples and 10/10 combined
resolution labels, with zero false `no_action` or `looks_answered` results and no
unavailable responses in the final run. An earlier run's invalid response was
rejected by the existing strict adapter; no validation gate was relaxed. This is
a small synthetic release check, not measured real-family accuracy. Offline mode
validates all 24 bounded requests without contacting Jev. Unit tests execute the
service, HTTP guard, stale/concurrent source paths, partial failures and narrow
Sheets cell builder. Local laptop/phone UI QA uses only synthetic data and
intercepts every API mutation.

## Feature contract

`incoming_resolution.propose` accepts a server-owned incoming ID after an admin
session guard. The server reads current inbox rows, existing proposals and roster
names. It groups the whole open five-minute burst using the same queue logic.
The only model input is up to four original texts and four captured school replies,
each at most 600 characters, ordered by code, with reply role/quoted-or-nearby
association and a fixed evidence caveat. IDs, dates, names, full rows, private notes,
other workflows and contact details are not input fields. Known roster/sender/
tutor/replier names are replaced with placeholders; emails, phones, URLs and MMS/
payment IDs are stripped. Unknown names or sensitive content can still survive
free-text redaction; this is minimisation, not guaranteed anonymisation.

Missing/placeholder/truncated/overlong text, missing actual reply or chat, too much
context, any newer captured inbound message in the chat, or a linked Planning item
produces deterministic `unclear` without calling Jev. Archived newer inbound rows
are still a boundary. This conservative first version does not attempt to interpret
later parent thanks or a follow-up thread. It does not backfill uncaptured replies.
Nearby association can be ambiguous; the rubric tells Jev to abstain when relevance
is unclear. The four-reply capture limit can omit earlier context.

The model chooses exactly one enum: `looks_answered`, `school_action_remaining`,
`waiting_for_parent`, `unclear`. Promises/acknowledgements do not prove completion;
all requests in a burst must be answered. Provider/workflow changes cannot be
verified from wording. The provider adapter validates exact answer IDs, types,
labels, finite normalised probabilities, confidence and resolved model version.
Confidence >= 0.8 and chosen probability >= 0.85 are **provisional pilot gates**;
Jev confidence is not measured accuracy. Lower scores become `unclear`.

Fresh forced inbox/proposal reads happen before and after the call. Full source
text/reply/status/review/snooze/link/match values are hashed locally, plus newer chat
boundaries and roster names. Changes reject the result before storage. Subsequent
reads and feedback validate the source/version and a 24-hour expiry. Client burst
hash checks and refresh invalidation remove obsolete cues; a newly visible later
inbound also removes a `looks_answered` cue. Hashes detect ordinary edits; they are
not security tokens or anonymisation. Admin sessions remain the access boundary.

**Accurate** or **Save correction** records explicit human judgment separately
from message handling. Correction updates the displayed/filter label. Proposals
retain the original enum, corrected enum and actor/time for evaluation; a rejection
is feedback, not an inbox rejection. No Communication_Log entry or message send is
created by either action. Evaluate false answered suggestions in particular before
considering any future automation. Rate limiting is ten checks per admin per minute
per application process; it is a local pilot guard, not a global distributed quota.

## Shared provider and data handling

`lib/admin/jev-provider.mjs` owns the fixed HTTPS endpoint, bearer authentication,
pinned model, typed choice/score/noul validation and a five-second abort timeout.
It sends one request without retries, tools or action authority and caps serialised
state at 8,000 characters as a local safety bound. Controlled failures do not save a
suggestion. Provider error bodies are discarded; logs contain outcome, enum and
safe error/guard codes only. Proposals contain hashes/version/model metadata and
human feedback, never another copy of source text or contacts. Existing inbox
retention remains authoritative for source messages.

[Official API contract](https://docs.typesafe.ai/api),
[model versions](https://docs.typesafe.ai/models), and
[confidence interpretation](https://docs.typesafe.ai/confidence) informed this adapter.
TypeSafe says customer data is not used for training, but ordinary API use is
**not a verified zero-retention arrangement**; its
[legal overview](https://docs.typesafe.ai/legal) describes zero data retention as an
enterprise option. The [data processing terms](https://typesafe.ai/legal/data-processing)
do not provide a universal short retention period. Do not claim this integration
alone establishes compliance or extend its approval to unrelated data/features.

Tests use synthetic data and mocked responses to verify bounds, validation,
timeout, stale-source rejection, lane isolation and no inbox mutation. Desktop and
phone QA intercept every API save. Live synthetic evaluation and real human-feedback
comparison are separate from these implementation checks.
