---
status: canonical
audience: [human, agent]
last_verified: 2026-07-20
---
# Workflow design principles

Read this before adding or materially changing an admin workflow. A workflow
earns its place when it reduces repeated mental juggling and leaves the next
person able to understand what happened.

## Core pattern

```text
Context and evidence
-> recommended safe action
-> explicit human confirmation where required
-> deterministic write
-> progress/audit record
-> clear open or closed state
```

This is the operating loop in workflow form:

```text
Detected / captured -> Guided -> Actioned -> Logged -> Resolved / Kept Active
```

The goal is not more forms. It is a calm path from “I need to remember several
things” to a completed, inspectable outcome.

## Cognitive-load test

A strong workflow:

- shows only the context needed for the current decision;
- makes source, freshness, uncertainty, and the safest next action clear;
- reuses known data instead of asking for it again;
- separates review from consequential action;
- reports partial success and what remains unfinished;
- logs meaningful outcomes without creating another inbox;
- can be followed by Tom or Fenella without relying on Finn's memory.

A weak workflow exposes every field, hides which system changed, makes `Done`
ambiguous, or creates another list someone must remember to check.

## Source-of-truth boundary

Workflows must name what they read and write. MMS owns lesson/calendar facts;
Stripe owns provider payment facts; the registry owns portal configuration;
Sheets owns First Chord operating records and workflow state; Gmail and WhatsApp
are delivery channels.

Derived context, issue queues, classifications, and proposals never become
underlying truth merely because they are displayed or stored. Use
[ownership](../architecture/data/ownership.md) and
[state tabs](../architecture/data/state-tabs.md) before adding a source or lane.

Avoid live vendor reads on ordinary page load. Prefer an explicit or scheduled
refresh and show freshness where it affects a decision.

## Verified beats inferred

A guard is only as strong as its weakest unstated premise. Where a number
matters, prefer a fact the source will tell you over one deduced from the shape
of its response.

The payroll attendance walk is the worked example. It threw rather than
truncated, it had a test asserting exactly that, and it existed *because* of an
earlier truncation bug — and it was still unsafe. "A page shorter than we asked
for is the last page" quietly assumed the endpoint honours the `limit` we send.
It need not, and MMS had been returning `TotalItemCount` the whole time.

So when a check protects a count, a total, or an amount:

- **Name what the check assumes, not just what it catches.** A guard earns trust
  for the failure it was built against, not the one standing next to it.
- **Ask whether the source already reports the thing being inferred** before
  writing logic to deduce it. This is usually less code, not more.
- **Notice when a limit or threshold is quietly doing correctness work.** Once
  completeness was verified against a reported total, page size became a pure
  latency knob — and a number that only affects speed is safe to tune, where one
  holding correctness upright is not. If tuning a constant for performance feels
  risky, that is the signal to go and make the invariant checkable first.

Both halves matter: verifying the invariant is what *earns* the freedom to tune
the number. Full reasoning in the Obsidian Learning Log,
`2026-08-01 - The Safety Net's Assumption Was the Unsafe Part`.

## Approval boundary

Keep these deterministic and explicitly human-approved:

- payment-expectation or Stripe changes;
- parent-facing messages, except the narrow tutor-approved Practice Chat email;
- WhatsApp sending;
- student archive/deletion;
- MMS student, attendance, or lesson changes;
- issue resolution when the source still disagrees.

The server must revalidate consequential input rather than trust a preview or a
model-supplied confirmation. Existing workflow code performs the action and logs
the outcome. AI output may explain or propose; it never supplies human approval.

Communication-specific rules:

- `Communication_Log` records copied-to-send, not proven delivery.
- Inbound messages and classifications are evidence for review, not commands.
- Reply drafts remain proposals even when policy-validated.
- Practice Chat's lesson-note email exception does not authorise payment,
  onboarding, pause, marketing, or general-message automation.

## Page and navigation rules

The `/admin` overview is a meeting-start surface, not a complete status board.
A front-page card should answer at least one:

- What must be done today?
- What needs attention soon?
- Which actionable loop is open?
- Which prompt protects time for improving the school?

Background health and passive numbers stay lower or inside their workflow unless
something is wrong. Navigation represents modes of work, not every data object:

```text
Overview | Planning | Workflows | Issues
```

The order moves from orientation to normal planned work, then specialised
processes, then exceptions. Persistent navigation should look like navigation,
not a row of equally prominent action buttons, and it must visibly and
programmatically identify the current section.

The Workflows directory is a stable map, not another live priority board.
Overview owns what needs attention now; the directory groups destinations by the
kind of school work someone is looking for. Prefer compact semantic link lists
under clear headings to a wall of equal cards, and show a badge only when it
communicates real changing state rather than a static taxonomy label.

Use [copy and tone](./copy-and-tone.md) and [UI conventions](./ui-conventions.md)
for action wording, async feedback, density, and error states.

### Lightweight projects inside Planning

Planning has three ordinary human-facing kinds:

- **Action** — one concrete task, scheduled on the day it should appear;
- **Project** — a finishable outcome that needs several actions or work sessions;
- **Note / idea** — useful context that is not yet committed work.

Structured pauses remain their own guarded action shape. Learning and Strategic
notes remain valid stored types, but new school thinking uses Note / idea and all
three note shapes share the single **Let's work on the school** home. A Note /
idea can be converted in place into a dated Action or a Project.

`initiative` is the backward-compatible stored value for Project. Project mode
is derived as `ongoing`; Action and Note / idea derive `task`, so the UI must not
ask for a second overlapping Mode choice. `target_date` reads **Do on** for an
Action and **Review next** for a Project. In the manual UI an active Action needs
a date; an unscheduled Action stays in Inbox. A Project review date is optional
and means “reconsider this outcome”, not “do the whole Project today”.

A Project owns only the durable outcome, context, optional review reminder, and
its linked Actions. It may have several child Actions through
`parent_planning_id`; each child has its own **Do on** date and completion state.
Those child cards are the progress record. Do not require a manual Project status
report or duplicate an Action completion into `Planning_Progress_Log`. A Project
cannot be completed while linked Actions remain open. This linkage changes
Planning state only and must never imply provider, payment, message, attendance,
or student state changes.

Area is optional secondary context, not another work type. New manual choices
use stable school responsibilities: Teaching & curriculum, Students & families,
Tutors & team, School operations, Finance & administration, and Growth & events.
Legacy area values remain readable and editable so existing rows round-trip.

## Existing workflow boundaries

| Surface | Distinctive boundary | Focused document |
|---|---|---|
| Issues | Detected problems have workflow state; reads do not change payment truth | [Admin loop](../architecture/system/admin-loop.md) |
| Waiting/onboarding | Placement hints do not reserve; multi-system onboarding preserves partial results | [School policy](./school.md) |
| Parent understanding | Manual campaign state; copies follow-up text but does not send or edit MMS | AGENTS workflow map |
| Tutor absence | Per-date decisions remain auditable; repeated cancellations may group parent/pause work without deleting source rows | [Absence bridge](../workflows/tutors/absence-to-pause.md) |
| Planning | Human work, reflection, ideas, and lightweight multi-action Projects; not a second issue queue or full project-management suite | [State tabs](../architecture/data/state-tabs.md) |
| First-lesson follow-up | One Planning card composes bounded evidence, persists explicit human confirmations, and server-gates closure; it never interprets attendance or changes Stripe/WhatsApp | [State tabs](../architecture/data/state-tabs.md) |
| Pause completion | Requires confirmation, logs progress and `Event_Log`, then aligns expectation through the existing route | [Payments](./payments.md) |
| Payroll | Review and export prepare provider work; a human pays in Wise | [Paying tutors](../workflows/finance/paying-tutors.md) |
| Incoming messages | Capture, match, classify, and draft are proposals; no automatic school action or send | [WhatsApp bridge](../operations/integrations/whatsapp-incoming-bridge.md) |
| Practice Chat | Recipient-specific confirmation, narrow tutor/student check, and delivery-key claim precede MMS/Gmail work | [Delivery contract](../workflows/practice-chat/delivery.md) |

`/admin/insights` is a read-only learning surface, not another queue. Individual
family concerns close in their existing workflow; recurring patterns may become
one bounded Planning experiment with an owner and review date.

## What not to build yet

- a generic workflow engine or full CRM;
- heavy owner/permission/project-management layers;
- automatic WhatsApp or Stripe actions;
- AI as the reason an operational action occurs;
- a new state tab where an existing lane safely fits;
- passive dashboards without a decision or action they improve.

## Shipping test

Before shipping, ask:

1. Does this remove a real repeated burden?
2. Is every source and owner clear?
3. Are missing, stale, and conflicting facts fail-safe?
4. Is the risky step explicit and human-approved?
5. Can the final state be inspected and recovered later?
6. Does the UI handle loading, success, failure, empty state, narrow screens, and
   keyboard/focus use without relying on a reload?
7. Are the focused tests, state contract, current status, and recovery notes
   updated where the behaviour actually changed?
8. Where a guard protects a count or an amount, is it checking a fact the source
   reports rather than one inferred from shape? See
   [verified beats inferred](#verified-beats-inferred).
