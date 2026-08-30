---
status: canonical
audience: [human, agent]
last_verified: 2026-08-29
---
# FirstChord Admin Ownership Matrix

Last updated: 2026-08-29

This document defines which layer currently owns each major action and field in the admin system.

Use it to reduce drift when implementing new features, resolving issues, or handing work between agents.

## Core Rule

- Many read surfaces, one admin write path.
- Google Sheets owns core operational student data.
- `students-registry.js` owns portal-specific configuration.
- MMS owns student status, billing profiles, and calendar lesson state.
- The PostgreSQL lesson mirror owns First Chord lesson identities and retained
  observations only; during mirror/parity phases MMS still owns current schedule
  and attendance facts.
- Stripe owns provider-side customer, subscription, invoice, and payment facts.
- Dashboard onboarding generates an FC ID for a new student and persists it in
  Sheets and the registry. A persisted ID must not be regenerated in the UI.
- `first-chord-brain` may still provide external batch reconciliation and
  `Review_Flags` generation, but it is not the sole owner of dashboard-created
  FC identity.
- Generated outputs should not be manually edited.

This matrix is detailed for student/onboarding actions. For the complete current
Sheets lane inventory, including finance, payroll, incoming messages, Practice
Chat, and planning, use `docs/architecture/data/state-tabs.md`.

## State Labels

- `authoritative`: the source of truth for the field or action in current operation
- `derived`: generated from another canonical source and not meant to be edited directly
- `transitional split ownership`: current V1 compromise where two systems hold related truth for different purposes and deliberate alignment is required

## Action Ownership

| Action | State | Canonical owner | Write method | Admin write surface | Downstream effect | Failure mode / conflict rule | Notes |
|---|---|---|---|---|---|---|---|
| Add student | transitional split ownership | `Students` sheet + MMS + registry | onboarding workflow + external APIs | `/admin/onboard` | Creates Sheets row, registry entry, MMS activation, billing profile, first lesson; consumes the exact suggested MMS `Free` event when one was selected | Registry credentials and strict registry readability are checked before any write. A selected `Free` event is validated before writes and again after lesson creation; it is never removed before the lesson is confirmed. A later partial failure is reported by lane and never closes Waiting or queues post-onboarding follow-ups. If Sheets exists without registry, block a full rerun and use the `SHEETS ONLY` registry repair before separately verifying MMS. | Current V1 flow has explicit preflight, partial-state reporting, and narrow registry recovery; cross-provider writes are still not transactional |
| Update student contact details | authoritative | `Students` sheet | manual dashboard edit | `/admin/students/[mmsId]` | Updates admin views and future sync consumers | If Sheets update fails, no partial registry fallback is attempted | Includes name, parent, email, phone |
| Update tutor assignment | transitional split ownership | `Students` sheet for operational truth, registry for portal truth | manual dashboard edit | `/admin/students/[mmsId]` | Resolves tutor conflicts, updates portal/admin consistency | If Sheets and registry differ, retain review flag until both are deliberately aligned | Current V1 reality is a transitional dual-write action; both lanes may need intentional updates |
| Update lesson length | authoritative | `Students` sheet | manual dashboard edit or onboarding workflow | `/admin/students/[mmsId]`, `/admin/onboard` | Affects operational lesson configuration | If MMS lesson state later differs, dashboard does not auto-reconcile | |
| Update instrument | transitional split ownership | `Students` sheet for operational display + registry for portal display | dashboard dual-write or onboarding workflow | `/admin/students/[mmsId]`, `/admin/onboard` | Affects admin context and portal behavior | Admin reads prefer the Sheet and fall back to registry; a partial dual-write must remain visible as a conflict rather than being silently merged | Both lanes are intentionally written today; field-level provenance is a future hardening target |
| Update Soundslice URL/code | authoritative | Registry | manual dashboard edit or onboarding workflow | `/admin/students/[mmsId]`, `/admin/onboard` | Affects student portal content | If registry write fails, do not silently fall back to Sheets | Not a Sheets field |
| Update Theta username | authoritative | Registry | manual dashboard edit or onboarding workflow | `/admin/students/[mmsId]`, `/admin/onboard` | Affects portal/login context | If registry write fails, do not silently fall back to Sheets | Not a Sheets field |
| Activate student in MMS | authoritative | MMS | external API via onboarding workflow | `/admin/onboard` | Moves student from waiting to active | If activation fails, keep onboarding warning visible; do not assume later MMS steps are safe | Done via API now |
| Create billing profile | authoritative | MMS | external API via onboarding workflow | `/admin/onboard` | Enables lesson creation and billing linkage | If billing profile creation fails, lesson creation may fail; surface warning and preserve prior successful writes | Done via API now |
| Create first lesson | authoritative | MMS | external API via onboarding workflow | `/admin/onboard` | Places lesson on calendar | Best-effort in V1; onboarding can still succeed without lesson creation | Done via API now |
| Consume selected `Free` event | authoritative | MMS | guarded external API delete after first-lesson confirmation | `/admin/onboard`, when reached from a Waiting capacity suggestion | Removes the exact source event so the new lesson does not leave the chosen availability marker behind | Carry the MMS event ID end-to-end; validate category, empty attendees, tutor, wall-clock date/time and duration before any writes and again immediately before delete. If removal fails, the lesson already exists: keep onboarding and Waiting closeout partial, inspect MMS, and remove the remaining `Free` event manually. Never recreate the lesson or guess by tutor/time alone. | `GET /calendar/events/{eventId}` is the verified read; `DELETE /calendar/event/{eventId}` is the verified narrow delete. Manual onboarding without a source event skips this step. |
| Resolve tutor conflict | transitional split ownership | Sheets + registry | manual dashboard edit | `/admin/students/[mmsId]` | Removes active issue from `/admin/flags` | Issue remains active until current live state matches across both sides | Dashboard now supports both tutor lanes |
| Delete orphaned portal entry | authoritative | Registry | manual dashboard edit | `/admin/flags` | Removes `REGISTRY ONLY` issue and registry entry | Only allowed for `REGISTRY ONLY`; do not delete MMS or Sheets records here | Safe delete only; does not touch MMS |
| Run external FC reconciliation / flag generation | derived | `first-chord-brain` batch tooling | terminal process outside this dashboard | No browser surface | May update FC exports and `Review_Flags` | Must not replace an existing persisted FC ID; resolve underlying mismatches rather than editing a derived flag | External compatibility path, not the dashboard onboarding owner |
| Regenerate dashboard configs | derived | Dashboard repo generation scripts | terminal/admin script | Manual terminal step | Updates derived config files and portal deployment path | Do not hand-edit derived config output to compensate for upstream errors | Not browser-triggered in V1 |

## Field Ownership

| Field | State | Canonical owner | Write method | Edited where | Derived / synced to | Failure mode / conflict rule | Notes |
|---|---|---|---|---|---|---|---|
| Student first/last name | authoritative | `Students` sheet + MMS | manual dashboard edit + onboarding workflow + external API | Student detail, onboarding | Admin views, future sync logic | If systems diverge, treat it as a sync problem to fix deliberately rather than auto-overwriting | Keep aligned across systems |
| Parent/contact name | authoritative | `Students` sheet | manual dashboard edit + onboarding workflow | Student detail, onboarding | Admin use | If missing in MMS, do not infer from unrelated fields | |
| Email | authoritative | `Students` sheet + MMS | manual dashboard edit + onboarding workflow + external API | Student detail, onboarding | Admin use, future messaging | If different across systems, prefer deliberate correction over silent sync | |
| Phone number | authoritative | `Students` sheet + MMS | manual dashboard edit + onboarding workflow + external API | Student detail, onboarding | Admin use, future WhatsApp | Messaging workflows should not assume the number is valid without explicit confidence | |
| Tutor (operational) | authoritative | `Students` sheet | manual dashboard edit + onboarding workflow | Student detail, onboarding | Admin workflows | Dashboard display should continue to prefer Sheets tutor | Current display truth |
| Tutor (portal) | transitional split ownership | Registry | manual dashboard edit | Student detail | Student portal | Keep review flag active until Sheets and registry intentionally match | Can differ temporarily until resolved |
| Lesson length | authoritative | `Students` sheet | manual dashboard edit or onboarding workflow | Student detail, onboarding | Operational workflows | If later MMS billing/lesson state differs, treat as follow-up, not auto-rewrite | |
| Instrument | transitional split ownership | `Students` sheet for operational display; registry for portal display | dashboard dual-write or onboarding workflow | Student detail, onboarding | Admin context and student portal | Reads prefer the Sheet and fall back to registry; differences require deliberate reconciliation | Both lanes are written by current admin flows |
| `fcStudentId` | authoritative after generation | Persisted `Students` row + registry entry | dashboard `generateFcStudentId` during onboarding or missing-registry creation | Not manually editable in dashboard | Registry, FC exports, FC tabs | Never recompute an existing value; if persisted lanes disagree, stop and reconcile deliberately | Dashboard now owns generation for its onboarding path |
| `friendlyUrl` | authoritative | Registry | onboarding workflow, future manual dashboard edit if allowed | Onboarding, future admin editing if allowed | Student portal route | Must remain unique; collisions should be resolved intentionally | Portal-specific |
| Student dashboard heading name | derived | Registry `firstName` | server-rendered portal display helper | Student dashboard | Dashboard heading | Missing registry names fall back to the first word of the legacy display name, then `Student` | First-name-only presentation; the full operational name remains unchanged in Sheets/MMS |
| `soundsliceUrl` | authoritative | Registry | manual dashboard edit or onboarding workflow | Student detail, onboarding | Student portal | If absent, portal can still exist but follow-up may be needed | |
| `thetaUsername` | authoritative | Registry | manual dashboard edit or onboarding workflow | Student detail, onboarding | Student portal | If absent or changed, do not infer from unrelated values after first save | |
| MMS status | authoritative | MMS | external API | Onboarding, future admin action | Waiting vs active workflows | If activation fails, keep student in follow-up state rather than pretending they are live | |
| Billing profile | authoritative | MMS | external API | Onboarding, future billing actions | Lesson creation | If billing profile is missing, lesson creation may fail and should surface clearly | |
| First lesson event | authoritative | MMS | external API | Onboarding | Calendar | Best-effort in V1; absence should surface as follow-up, not silent success | |
| Selected source `Free` event ID | transient authoritative reference | MMS | carried from Waiting capacity read into onboarding; never persisted as dashboard truth | Waiting suggestion → onboarding validation/write | Identifies the only calendar event onboarding may remove | A stale, changed, occupied, or mismatched event blocks before canonical writes. The event is re-read immediately before deletion. Do not reconstruct this ID from date/time/tutor. | MMS remains the event owner; dashboard cache is cleared after successful removal. |
| First Chord lesson series/event/participation ID | authoritative identity, derived facts | First Chord PostgreSQL identity; MMS for observed schedule/attendance facts | daily or operator-triggered read-only mirror sweep | Read-only `/admin/lessons`; no browser editor | Current parity reporting; future consumer joins | A provider-reference change creates a separate FC entity until reviewed evidence supports an alias/merge; do not heuristically merge reschedules | No operational reader uses these IDs in phase 2 |
| Mirrored lesson schedule/attendance fields | derived provider observation | MMS | verified whole-school read, transactional SQL upsert | Daily secret-gated route or operator command; read-only `/admin/lessons` | Parity/freshness reporting only | Preserve provider ref, sync window and raw unknown values; an incomplete run writes no snapshot and disappearance never means cancellation | Rebuildable mirror, not an MMS replacement yet |
| Stripe customer/subscription IDs | authoritative | `Students` sheet currently | external system + trusted workflow only | Not exposed for editing in admin V1 | Payment workflows | Do not edit directly in V1 dashboard; any future repair path should be an explicit narrow admin tool | Keep tightly controlled |
| Review flags | derived | `first-chord-brain` generated into Sheets `Review_Flags` | generated by terminal/admin script | Not manually edited | `/admin/flags` | Resolve the underlying live mismatch; do not edit the generated flag row | Dashboard filters resolved issues live |

## Current V1 Boundaries

- Do not edit generated dashboard config files manually.
- Do not generate or recompute FC IDs in the UI except through the existing onboarding flow where already implemented.
- Do not delete MMS records from the flags page.
- `REGISTRY ONLY` deletes are currently the only destructive issue action exposed in the dashboard.
- Production onboarding writes the registry through the repository GitHub path;
  the registry workflow and deploy prebuild validate/regenerate derived config.
  Local registry changes still require `npm run generate-configs` before local
  portal verification.

## Shared Student Context Read Model

`lib/admin/student-context-helpers.mjs` is the shared deterministic composition
boundary used by Students, Issues, live Stripe issue scans, and explicit pause
reconciliation. It preserves the existing Sheet-first registry fallbacks and
adds runtime-only provenance for source role, cache freshness, inferred payment
fields, and Sheet/registry conflicts.

- Provenance describes how the current value was selected; it owns no truth and
  is never written back to Sheets or the registry.
- `Students` remains operational truth. Registry fallback does not silently
  repair a missing Sheet field.
- `Schedule_Context` remains a cached MMS projection. `checkedAt`, confidence,
  and freshness travel with the context; a `found` row is not live MMS truth.
- The SQL lesson mirror is a separate event-grain parity foundation. Its daily
  reader and `/admin/lessons` report do not feed operational student context or
  change current ownership during phase 2.
- Lifecycle, payment value, pause coverage, and pause-expectation decisions are
  derived values.
- Raw student context includes sensitive contact and provider identifiers. Any
  future assistant read must use a separate redacted projection defined in
  `docs/architecture/ai/tool-contracts.md`.

## Teaching Relationship Context Read Model

`lib/admin/teaching-relationship-helpers.mjs` is the provider-neutral,
deterministic boundary for the current student–tutor relationship. It joins the
existing student context, canonical tutor identity, cached schedule evidence and
practice-note delivery metadata without becoming a new owner or writer.

- A relationship is identified by `fc_student_id + fc_tutor_id`. Within this
  read model, MMS student and teacher IDs remain provider aliases used only by
  adapters and existing routes.
- The phase is recalculated on read. There is deliberately no
  `Teaching_Relationships` Sheet and no manually advanced lifecycle status.
- `Students` / registry assignment, `Tutor_Lifecycle`, `Schedule_Context`, and
  `Practice_Notes_Log` retain their existing ownership and freshness rules.
- Pauses, tutor departures, stale schedules and note follow-up are conditions on
  the relationship; they do not overwrite the underlying student or tutor state.
- Missing, stale or conflicting evidence produces `uncertain` / **Needs review**.
  The resolver never treats an absent practice note or cache row as proof that a
  relationship ended.
- Tutor handover attention is also recalculated on read. It is not a Planning
  item or a manually cleared task: it remains open while a leaving tutor still
  owns the student assignment, and follows the relationship to the replacement
  tutor when the cached next lesson still names the departing tutor. It clears
  only when assignment and fresh schedule evidence agree.
- Each handover item is typed and bounded: severity, due date, explanatory
  evidence with source/freshness, an observable `clearsWhen` condition, and the
  existing student-assignment review workflow. It cannot perform the reassignment
  or change MMS. A missing or stale schedule remains uncertainty, not proof of a
  completed handover.
- Temporary cover is a separate dated episode derived from
  `Tutor_Absence_State`; it never rewrites the permanent student assignment.
  The episode connects the student, usual tutor, cover tutor, lesson date and
  five existing preparation checks, promoting only the next incomplete check.
  It disappears when the source absence is resolved and creates no new state
  tab or manual lifecycle.
- Practice-note text and recipient data do not enter this context. Only bounded
  delivery metadata is projected.
- The first lesson-ledger adapter now emits bounded event and participation
  observations into each relationship card. It reads only rows re-observed by
  the latest successful mirror run, projects First Chord identities, and keeps
  MMS event/student/tutor aliases inside the server join. The relationship phase
  still comes from the existing assignment and `Schedule_Context`; lesson-ledger
  evidence cannot silently become the winner in a disagreement.
- Open first-lesson Planning cards are a second bounded lesson-ledger consumer.
  They exact-match the linked student plus planned date/time, show the raw
  attendance label only as context, and attach nothing when the match is
  ambiguous, stale or unavailable. Sheets student linkage, Stripe linkage
  fields, `Student_Portal_Access`, and append-only Planning confirmations retain
  their existing ownership; the combined card is a read model, not new truth.

## Lesson Occurrence Context Read Model

`lib/admin/lesson-occurrence-helpers.mjs` is the deterministic boundary for one
student participation in one dated lesson. It joins a stable First Chord event
and participation to the current teaching relationship, tutor-absence workflow,
raw attendance observation, and bounded practice-note delivery metadata.

- PostgreSQL remains a rebuildable MMS-backed observation layer during this
  slice. MMS still owns current calendar and attendance facts, and
  `Schedule_Context` continues to drive the existing relationship phase.
- The read is bounded to the same 14-days-back / 42-days-ahead London window as
  the daily mirror. It excludes events and participations not re-seen by the
  latest successful run, but never interprets their absence as cancellation.
- `Unrecorded`, `Present`, `AbsentNotice`, `AbsentNoMakeup`, blank and unknown
  attendance values remain raw provider labels. V1 does not map them to
  completed, missed, payable, or needs-action states.
- Practice notes attach by exact attendance reference, then exact event
  reference. A unique student/date/tutor match is allowed only as explicitly
  medium-confidence context; ambiguity attaches no note. Note text, recipient
  data and provider references never enter the occurrence projection.
- A tutor-absence cover or cancellation is a separate workflow fact. It does
  not rewrite provider status. If a human has marked the cover calendar step
  complete but a fresh verified occurrence still names another tutor, a bounded
  review item remains until the evidence agrees or the workflow is corrected.
- The UI receives at most one recent and two upcoming observations plus any
  bounded attention for a relationship. If PostgreSQL is unavailable, stale,
  incomplete or outside the requested window, the occurrence layer fails open
  and the existing schedule/relationship view continues unchanged.
- This is a dual-read consumer, not a scheduling cutover. A future preferred
  source change still requires measured parity, a rollback switch and explicit
  authority review for that consumer.

## Future Direction

- Keep the admin dashboard as the main human write surface.
- Keep reusable business rules in tested deterministic modules with narrow
  integration boundaries; do not move ownership merely to create an AI layer.
- Keep specialist tools like Payment Pause and future messaging flows on top of the same shared ownership model.
- Expand this matrix when adding:
  - payments issue detection
  - WhatsApp-triggered workflows
  - agent-assisted triage or recommendations
