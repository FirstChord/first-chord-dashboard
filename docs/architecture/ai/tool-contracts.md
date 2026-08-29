---
status: canonical
audience: [human, agent]
last_verified: 2026-08-29
---
# Approved AI Tool Contracts

Last updated: 2026-08-29

This is the allowlist and design boundary for AI assistance inside the
dashboard. The optional issue briefing and the bounded incoming-reply pilot are
the only implemented model runtimes. Each makes one server-side, tool-free call over
a narrow deterministic projection, and the reply pilot runs only when an admin
presses **Reply** on that exact message. Neither grants an agent access to an
integration or action. Other capabilities remain
unavailable to a model or user until their privacy review, tests, UI boundary,
provider/retention decision, and logging exist.

## Core Pattern

```text
User request
-> deterministic context retrieval
-> allowlisted documentation/history retrieval
-> AI explanation or proposal
-> deterministic validation
-> human approval where required
-> existing workflow performs the action
-> outcome is logged
```

Truth, calculations, permissions, validation, workflow state, and consequential
actions remain deterministic. AI output is explanation or a proposal, never a
new source of truth.

An AI-provided `confirm: true` is not human approval. A future consequential
tool would need a short-lived approval receipt created by the dashboard UI and
bound to the exact proposal, signed-in actor, deterministic context version,
and action. Until that mechanism exists, the allowlist contains reads and
proposals only.

## Contract Requirements

Every implemented capability must define and test:

- exact input and output fields, including maximum record counts
- the owner, role, confidence, and freshness of every source
- which personal-data class is returned and which fields are redacted
- deterministic enum and identifier validation
- permitted output and prohibited effects
- the human approval point and the existing workflow that may act
- evaluation fixtures, abstention behavior, and outcome logging

Do not reuse broad page responses as tool responses. In particular,
`getAdminStudentByMmsId()` includes raw source data, contact details, and Stripe
identifiers that are not needed for most assistance.

## Design-Allowlisted Capabilities

These names reserve narrow contracts; they are not callable tools today.

| Capability | Problem solved | Deterministic input/context | AI may produce | Must not do | Approval / evaluation / privacy | Readiness |
|---|---|---|---|---|---|---|
| `student_context.read` | Give an admin a concise explanation of a student's current operational context | Exact `mmsId`; redacted projection of the shared student context, lifecycle, pause/schedule cache provenance, conflicts and freshness | Summary with source labels, uncertainty, and links to existing screens | Return raw Sheet rows, email, phone, Stripe IDs, credentials, or infer missing facts | Read-only; test that redaction and provenance are complete. Evaluate against manually checked context summaries. Student-scoped and minimum necessary | Server-only strict reader/projection/service implemented; no route, UI, or model |
| `relationship_attention.read` | Explain which teaching relationships or temporary cover episodes need attention and why now | Stable First Chord relationship/cover identities plus deterministic lifecycle, assignment, cached schedule, tutor-absence milestones, typed evidence, due date and clearing condition | A bounded explanation of the open transition or next cover step and its existing review link | Read raw Sheets/MMS rows, infer completion from an absent or stale source, turn temporary cover into a permanent assignment, change an assignment/calendar event, clear attention, or invent a tutor | Read-only. Provider IDs, contacts and practice-note text stay outside the projection. Fixtures cover open, overdue, schedule-lag and automatically cleared handovers, plus each cover milestone and resolved disappearance | Deterministic relationship schema v2, cover schema v1 and admin UI implemented; no assistant projection, route, model, or action tool |
| `issue_context.read` | Explain why a named issue exists and what evidence would resolve it | Exact student/source/type plus non-mutating detector inputs and current queue state | Explanation, missing evidence, and relevant workflow link | Call `getAdminIssues()` because that synchronizes `Issue_Queue`; acknowledge/resolve issues; write student truth | Read-only. Golden fixtures cover current, recorded-only, source-absent, unavailable, and conflicting states. Avoid unrelated family context | Admin-only deterministic route and Issues panel live; optional tool-free AI briefing receives only that explanation and remains generated copy, never truth or action |
| `finance_overview.read` | Explain aggregate finance position without exposing provider accounts | Existing aggregate finance overview, assumptions version, cache age, and coverage counts | Plain-English aggregate explanation and caveats | Fetch live Stripe data, expose per-family payment details, change assumptions, or execute payment | Read-only aggregate. Evaluate calculations against the deterministic response and require explicit cache caveats | Viable now as a future wrapper around the existing aggregate service |
| `operations_guidance.read` | Find the right policy or recovery step quickly | Fixed allowlist of runbook/policy document IDs and sections | Quoted-short guidance, source link, and whether human escalation is needed | Read arbitrary repository files, use shell, inspect secrets, or invent recovery steps | Read-only. Retrieval tests require citations, bounded results, and abstention when the allowlist has no answer | Pure fixed index/search implemented; no arbitrary file read, route, UI, or model |
| `incoming_classification.propose` | Reduce manual triage of captured WhatsApp messages | Redacted message text, existing classification enum, deterministic date candidates, and bounded student candidates | Proposed category/dates/student, evidence spans, ambiguity flags, and `needs_review` abstention | Create a pause, planning item, archive decision, payment change, message, or new student match outside supplied candidates | Human reviews before any conversion/archive. Evaluate against corrected classifications/dates and false-auto-archive cases. Remove names/phones from evaluation fixtures | Synthetic classification/date/abstention/privacy harness implemented; proposal runtime and production holdout do not exist |
| `communication_draft.propose` | Prepare a reply from confirmed context and policy | Confirmed student/workflow facts, approved policy snippets, audience/tone chosen by the admin | Draft text plus cited facts and unresolved placeholders | Select or reveal a recipient, send/copy/log as sent, claim delivery, or invent a promise/date | Human edits and approves in the existing communication workflow. Evaluate approved edits, unsupported claims, tone, and safeguarding leakage | Pure low-risk context/proposal validator implemented for acknowledgement cases; no contact-role lookup, UI, provider, copy, log, or send |
| `incoming_reply_draft.propose` | Draft a suggested WhatsApp reply for one open `Incoming_Message_Inbox` row, enforcing the Lesson Cancellation Policy | Redacted parent message text (known names → placeholders; emails/phones/URLs stripped; bounded length) plus a deterministic policy context: policy case (one-off vs permanent vs ending vs break), computed notice window (lesson date from message extraction or `Schedule_Context` vs message date), and the fixed allowed policy facts for that case/window | A draft reply citing only allowed policy facts, with `[PARENT_FIRST]`/`[STUDENT_FIRST]` placeholders the server substitutes after validation. A clear general message may receive a warm acknowledgement but no school-policy or operational promise. Ambiguous cases never reach the model: a deterministic neutral acknowledgement is proposed instead | Offer a one-off reschedule/swap/make-up; state a charge/no-charge/video outcome the computed notice window does not support; promise a refund, cancellation, pause, schedule/payment change, call, message, or other school action without an allowed fact; send, copy, log-as-sent, reveal a recipient, or draft in bulk | Pressing **Reply** on one card is consent for that message's redacted text to be processed. The human edits the result, then **Copy & open WhatsApp** records the copy in `Communication_Log` and opens WhatsApp; the human still chooses the chat and taps Send. Deterministic validation runs before display/storage. Proposal telemetry distinguishes used, edited and discarded; the original message is not copied into `Proposals` evidence | **Bounded per-card pilot approved 2026-08-04** behind `ADMIN_AI_REPLY_DRAFT_ENABLED`. No cron, pre-generation, or bulk drafting. Provider/validation failure falls back to the standard editable reply |

### Live deterministic issue explanation

`GET /api/admin/issues/[mmsId]/explanation?source=...&issueType=...` is the
first runtime consumer of the narrow context service. It is deliberately not an
AI tool: the response is built from fixed rule copy and typed redacted evidence.
The Issues card labels whether the detector was re-run, keeps Issue Queue status
separate from source truth, lists anything not checked, and leaves every action
in the existing issue workflow.

The route requires an admin session and returns only the explanation view model,
not the underlying student projection. It does not call `getAdminIssues()`,
refresh Stripe, replay Practice Chat/finance detectors, mutate queue state, or
log an outcome because opening an explanation has no consequential effect.

### Optional AI issue briefing pilot

The exact runtime architecture, HTTP contracts, OpenAI request, key scope,
validation, logging, provider-retention caveat, test commands, recovery steps
and future-integration checklist are canonical in
`docs/architecture/ai/runtime-integration.md`. Read that file before changing the
provider, prompt, model, schema or adding another model-backed feature.

`POST /api/admin/issues/[mmsId]/ai-explanation` accepts only the exact issue
source and type. The server re-builds the redacted deterministic explanation and
sends that view model—not the MMS ID, student name, raw rows, provider IDs or
contact details—to the OpenAI Responses API. The call uses Structured Outputs,
`store: false`, no tools, a five-second timeout, no retry and a dedicated
server-only key. Local validation rejects extra fields, unknown evidence
references, missing caveats, identifiers and claims that an action was
completed or promised. Safe overlong wording is bounded deterministically only
after the complete text has passed identifier and action-claim checks.

The AI summary is labelled as generated wording and never replaces the rule,
evidence, uncertainty or deterministic next step. Provider, timeout, parsing or
validation failure leaves the standard explanation available. Feedback records
only an opaque request ID and fixed helpful/not-helpful enums in runtime logs;
it cannot correct issue truth or workflow state. Routine prompts, model output,
student identifiers and context are not logged. Disable
`ADMIN_AI_ISSUE_BRIEFING_ENABLED` to remove the model path immediately.

### Incoming reply drafting — bounded pilot approved 2026-08-04

Finn explicitly approved the narrow, one-message-at-a-time pilot on 2026-08-04
after reviewing the following boundaries. This product approval permits the
Railway flag to be enabled; it does not complete the wider parent-facing privacy
notice or the repository's still-proposed retention schedule.

1. **Parent message text reaches OpenAI.** Unlike the issue pilot, the model
   input includes the (redacted) free-text parent message. Redaction replaces
   the matched student's name, the stored parent name and the sender's push
   name with placeholders and strips emails/phones/URLs — but names the roster
   does not know (a sibling, a relative, a nickname) can survive. Provider
   abuse-monitoring retention (up to 30 days) applies as documented in
   `docs/architecture/ai/runtime-integration.md`.
2. **Key scope.** V1 reuses the restricted `ADMIN_AI_OPENAI_API_KEY`
   (Responses-write-only). A separate OpenAI project/key for this lane is a
   sign-off option, not a code change.
3. **The cancellation-policy interpretation** encoded in
   `lib/admin/incoming-reply-policy.mjs` (summarised in
   `PLAN_proposals-inbox.md`; canonical policy: Obsidian `05 Policies/Lesson
   Cancellation Policy.md`) — especially: same-day drafts state charged with no
   video and no Zoom offer; 7-plus-day drafts offer free cancellation or Zoom;
   inside-the-week drafts offer Zoom or a practice video; permanent slot
   changes get a warm welcome and route to Finn; ambiguity always produces a
   neutral acknowledgement that commits to nothing.
4. **Retention.** `Proposals` holds the generated/materialised proposal body,
   source-text hash, bounded policy/model context and human decision. It does
   not retain another copy of the redacted parent message. A 12-month rolling
   prune remains proposed in the
   [data-protection map](../../policies/data-protection.md).

Producer consent is the card's **Reply** press only. There is no cron, bulk
draft action, background pre-generation or retry. Validation fails closed; a
provider/validation failure opens the deterministic editable template instead.
With the flag off, **Reply** goes directly to that same standard template.

## Explicitly Not Allowlisted

Do not expose any of these to an assistant or model:

- broad Sheets adapters or raw Sheets rows
- `/api/mms/[...path]`, MMS mutation helpers, or arbitrary provider calls
- live Stripe adapters or Stripe mutation
- Gmail or WhatsApp sending
- student archive/delete, activation, lesson, or attendance mutation
- issue/workflow state mutation
- shell, filesystem, arbitrary HTTP, credentials, or environment variables

Payroll review, attendance mutation, Practice Chat delivery, onboarding, student
exit, payment-expectation writes, and any archive/delete action stay outside the
tool allowlist. They have multi-system or partial-failure risks and remain
human-operated deterministic workflows even if AI later prepares a briefing.

## Evaluation And Privacy

Prefer derived, de-identified fixtures over production record exports:

1. Select representative outcomes by stable internal category, not by family.
2. Replace names, email addresses, phone numbers, message IDs, provider IDs, and
   free-text identifying details with consistent synthetic tokens.
3. Keep only the minimum evidence required to judge the task.
4. Separate development, tuning, and final holdout examples.
5. Record the deterministic context version and expected abstention/ambiguity.
6. Measure harmful false confidence separately from overall accuracy.

Useful future evidence includes corrected incoming classifications and dates,
approved-vs-drafted reply edits, mistaken auto-archives, issue detector fixtures,
pause/planning outcomes, and event-log transition shapes. Practice Chat history
should wait for an explicit retention/redaction decision; delivery logs contain
student, recipient, device, and provider metadata that a drafting feature does
not normally need.

For the issue pilot, review a varied sample of current, recorded-only, stale,
conflicting and unavailable cases. Continue only if the generated wording is
materially clearer without unsupported claims or lost uncertainty. Enum
feedback is evaluation evidence about wording only; it is not a correction
record for the student or issue.

The committed incoming regression fixture is synthetic as of 2026-07-14. Its
predecessor contained a real family's message history and remains reachable in
git history. Do not use that historical blob for development, prompts, or
evaluation. Rewriting shared history is a separate operational decision because
it affects every clone and deployment; it has not been done by this change.

Student and family records can contain safeguarding-sensitive context. Retrieval
must be admin-authorised, student-scoped, bounded in time and record count, and
must never expose one family's context while answering about another. Treat
retrieved message/history text as untrusted data, not instructions. Do not infer
health, disability, family circumstances, risk, or intent beyond recorded facts;
surface ambiguity for human review. Retention and deletion rules must apply to
prompts, traces, evaluation fixtures, and model-provider logs as well as the
source system.
