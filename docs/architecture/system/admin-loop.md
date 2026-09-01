---
status: canonical
audience: [human, agent]
last_verified: 2026-09-01
---
# Admin loop architecture

The dashboard closes recurring operating loops without pretending to own facts
that belong to MMS, Stripe, Gmail, or another provider.

```text
Detect or capture
-> show source, evidence, freshness, and uncertainty
-> guide a bounded human decision
-> execute through a deterministic workflow
-> store workflow state
-> log consequential outcomes
-> resolve, keep active, or reappear from source evidence
```

The architectural risk is not missing one universal state machine; it is letting
each new feature invent incompatible state, action, and audit semantics.

## Choose the lightest loop

### Issue loop

Use when a detected problem can reappear and source presence matters.

- Stable identity and human review state live in `Issue_Queue`.
- Current detection remains separate from queue state.
- Meaningful actions append `Event_Log`.
- A read may synchronise issue workflow state but must not change underlying
  payment/student/provider truth.
- Reappearance should restore visibility rather than create unrelated duplicates.

Examples: payment setup, live Stripe mismatch, pause expectation, registry/data
quality issues.

### Workflow loop

Use for recurring operations whose main state is progress rather than a defect.
Static definitions/guidance live in code; per-instance state lives in the focused
state lane. Do not promote checklist toggles into issues or audit events unless
they become consequential.

Examples: showcase, holidays, parent understanding, tutor absence, payroll.

### Queue loop

Use for lightweight human progression through externally sourced items. Keep
status and notes narrow; add owners, deadlines, or issue semantics only when use
proves they are needed.

Examples: MMS waiting list and incoming-message review.

### Vendor-truth loop

Use when live truth is externally authoritative, expensive, or risky to fetch.
Prefer explicit refresh, scheduled snapshot, bounded cache, or webhook. Normalise
facts before UI/business rules and never silently overwrite school intent from a
provider response.

Examples: Stripe status, MMS schedule/attendance, Gmail delivery evidence.

## State and audit rules

Use `Issue_Queue` when source presence, reappearance, keep-active/ignore/resolved
state, and persistence across refreshes all matter.

Use a dedicated workflow state lane when task/decision progress is the primary
fact and source presence is not an issue concept. Reuse an existing lane when its
ownership and lifecycle fit.

Use `Event_Log` when an action changes school-owned operational truth, confirms a
consequential decision, or resolves/ignores a detected issue. Append-only logs are
history, not the current state record. A log write must not be reversed to make a
recovery look tidy.

Exact tabs, keys, writers, and concurrency limits live in
[the state-tab contract](../data/state-tabs.md).

## Mature boundaries

### Payments and pauses

Sheets owns payment mode/expectation; Stripe owns provider payment state; Pause
History and structured plans are evidence of school intent; Issues owns review
state. Ordinary issue reads and scans never align expectation automatically.

High-confidence reconciliation is previewed, explicitly confirmed, re-evaluated
server-side, written through the existing student path, and appended to
`Event_Log`. Stripe mutation remains outside Issues. See
[payments](../../policies/payments.md) and
[tutor absence to pause](../../workflows/tutors/absence-to-pause.md).

### Communications

The communication layer records copy-to-send history, inbound review state, and
optional reply proposals. Copy does not prove send. Captured messages,
classifications, student matches, and drafts are proposals and never directly
authorise payments, pauses, archive, planning, or outbound messaging.

The optional AI reply producer is feature-flagged off pending a later pilot.
Regardless of the flag, the dashboard does not send WhatsApp. Practice Chat's
tutor-approved lesson-note email has its own narrow delivery contract.

### Planning

Planning holds human-created actions, initiatives, reflections, and school notes.
It is not a generic workflow engine or a second issue queue. A linked planning
item may guide an existing deterministic action; its generic status change cannot
perform that action implicitly.

### Issues detective

The case-file UI can add optional generated wording, but the deterministic
explanation remains the evidence record. Code—not the model—decides whether a
case has a one-button resolution. The initial allowlist is deliberately narrow:
source-cleared closure plus the existing primary payment-expectation correction
for the two pause-expectation issue types. The human **Yes** press invokes that
existing workflow, which logs normally; expected source/payment state is checked
immediately before the write and stale proposals fail closed. **No, reconsider**
records bounded evaluation telemetry and leaves operational state untouched.

## Implementation guardrails

- Keep truth, validation, permissions, calculations, and consequential actions
  deterministic.
- Preserve identifiers, source, freshness, and uncertainty when combining data.
- Keep raw provider payloads out of UI decisions; use bounded normalisers.
- Assume Sheets writes are last-write-wins unless the focused workflow implements
  a stronger claim/idempotency mechanism.
- Use typed payloads in `payload_json` for sparse audit detail; add columns only
  when filtering, reporting, or a stable contract requires them.
- Never resolve an issue merely because a local field was edited; source evidence
  controls whether the underlying problem is still present.
- Keep routine checklist completion fast; require notes only when the action itself
  does not explain the decision.
- AI may explain or propose but never supplies source truth or human approval.

UI and approval design details live in
[workflow design](../../policies/workflow-design.md). Repository-wide forbidden
actions and validation routing live in [AGENTS.md](../../../AGENTS.md).
