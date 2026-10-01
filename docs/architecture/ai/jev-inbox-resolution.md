---
status: canonical
audience: [human, agent]
last_verified: 2026-10-01
---
# Jev inbox resolution pilot

The pilot helps a reviewer assess whether WhatsApp replies appear to answer an
open inbox request. It never clears, hides by default, sends a message, changes
attendance/payment, or completes Planning. **All** remains the default view.
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

The pilot button appears only with both flag and key. **Check replies** assesses
one card; **Check again** reassesses it. No page load, focus refresh, ingest,
cron or batch selection triggers a model call. Removing the flag or key disables
new assessments while existing fresh suggestions and feedback remain accessible.

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
