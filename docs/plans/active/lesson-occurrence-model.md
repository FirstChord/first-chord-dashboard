---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-02
---
# First Chord Lesson Ledger and MMS Exit Path

## Outcome

First Chord will build its own durable lesson ledger: one stable record for a
recurring lesson series, one for each calendar event, and one participation for
each student expected at that event. MMS remains the scheduling and attendance
source of truth at first. Over time, First Chord systems will attach to these
provider-neutral identities, selected edits will be made safely through First
Chord, and MMS can eventually become a downstream mirror and then be removed.

This is not only a data-copy project. It is the dependency path from today’s
MMS-centred operations to a First Chord-owned school operating system, including
an independent calendar and iCalendar feeds.

## Why This Adds Meaningful Value

Today, schedule refreshes reduce many MMS events to one summary row per student
in `Schedule_Context`, then discard the occurrences. That is enough to display
“usual lesson” and “next lesson”, but it cannot reliably answer:

- what should have happened on a particular date;
- which students belonged to a group event;
- whether attendance was recorded for every expected participation;
- how a lesson changed over time;
- whether First Chord can reconstruct MMS independently; or
- which stable lesson identity payroll, cover, Practice Chat, communications,
  finance and calendars should share.

A durable ledger closes that gap. It is useful immediately for reconciliation
and attendance completeness, and it creates the stable foundation required to
replace MMS without a dangerous all-at-once migration.

## Evidence That Changed the Design

A verified whole-school MMS sample on 2026-08-10 returned 764 attendance rows
for 28 days in one paginated request. The comparable calendar search returned
769 events. That is cheaper and more complete than the existing pattern of
roughly 200 sequential per-student calendar requests with 150 ms spacing.

The sample also proved that event and attendance are different grains:

- calendar events can contain zero, one or several student attendances;
- 20 sampled calendar events represented group lessons, with up to five
  students;
- attendance rows carry both `EventID` and `StudentID`; and
- the attendance response does not carry the calendar series identifier.

Therefore the first slice uses bounded whole-school sweeps and models an event
separately from each student's participation. The earlier proposal to accept a
fortnightly observation gap as the price of being gentle on MMS is rejected.

## Ownership During the Transition

The words “First Chord-owned” have three separate meanings and must not be
conflated:

1. **Identity and retained observations:** First Chord owns its stable IDs and
   its history of what it observed.
2. **Current provider truth:** MMS owns schedule and attendance facts until the
   relevant cutover phase is explicitly completed.
3. **Scheduling authority:** First Chord owns edits only after a command path,
   provider synchronisation, read-back verification, conflict handling and
   rollback have been proved for that edit type.

During the mirror and parity phases, the SQL ledger is a rebuildable read model,
not permission to edit MMS or a new winner in a data conflict. Every record must
retain its provider, external reference, observation time and sync run.

## Long-Term Phases

### Phase 1 — Mirror MMS

Keep MMS as source of truth. Pull whole-school calendar and attendance data into
PostgreSQL and create provider-neutral First Chord identities for lesson series,
events and student participations. Record raw provider status separately from
derived state. Nothing operational reads from the mirror and no MMS write is
performed.

The first implementation slice in this document is the safe foundation of this
phase. It includes a versioned schema, verified pagination, deterministic
normalisation, idempotent transactional upserts, change revisions, sync-run
evidence, an operator-run synchronisation command and status inspection. It does
not infer missing or cancelled lessons.

### Phase 2 — Prove Parity

Regularly ask whether First Chord can reconstruct exactly what MMS says should
happen: tutor, student, date, local time, duration, room, category, recurring
series, attendance state, cancellation and exception behaviour. Measure missing
references, duplicates, conflicts, stale data and unclassified provider states.
Each mismatch becomes an explainable reconciliation item, not a silently chosen
winner.

A read-only First Chord calendar and experimental iCalendar feeds can be exposed
in this phase because they are useful parity surfaces. They must be labelled as
MMS-backed and cannot become operational truth merely because they look correct.

Phase 2's first production slice is deliberately narrower than a calendar UI. A
daily GitHub workflow calls a secret-gated route at 05:45 UTC and observes 14
London calendar days back through 42 days ahead. `/admin/lessons` shows source
freshness, exact calendar/attendance endpoint totals, changes, field coverage,
raw attendance states and recent runs. The Overview checks both the database
result and the scheduled workflow. Failed runs stay visible but cannot displace
the last verified snapshot; absence is reported as “not observed”, never
cancelled. This creates evidence for the remaining exception questions without
moving any operational consumer or write authority.

The first production Phase 2 dispatch on 2026-08-10 covered `2026-07-27` through
the end-exclusive `2026-09-22` and completed in about four seconds. It matched
MMS totals exactly: 1,597/1,597 calendar events and 1,579/1,579 attendance
participations across 221 series. It found no attendance-only events, missing
tutor/duration/series references, or event/participation non-observations; 748
events had no location and remain coverage evidence rather than assumed errors.
The overlapping observation added 825 events, 812 participations and two changed
participation revisions. The separate Practice Chat claim table remained at 111
completed claims with none active.

#### Read-only calendar and exception investigation (2026-09-02)

`/admin/lessons/calendar` is the first calendar-shaped First Chord surface. It is
an authenticated weekly view, not a new schedule owner: it renders only calendar
events re-seen by the latest fresh, successful and exactly-counted mirror run.
A newer failed run, stale mirror or week outside the verified window produces no
calendar fallback. Student and tutor provider aliases are used only inside the
server composition layer to join the current Students row and canonical tutor
roster; the rendered view model contains names plus stable First Chord IDs and
never exposes those aliases. An unmatched participation stays visibly unmatched.

The calendar defaults to student-bearing lessons and can filter by tutor or show
Free capacity, Potential holds, breaks and other rows. A `Free` or `Potential`
event counts as a lesson only when its participation was re-observed in the same
verified run. Older retained participation history never puts a student onto a
currently free calendar card.

`/admin/lessons` now turns its broad parity warnings into a bounded aggregate
investigation. It separates lesson-shaped rows from availability/hold/break
rows, splits genuine lesson tutor gaps from expected placeholder gaps, compares
not-re-observed lessons with same-student replacements, measures late attendance
changes within the existing overlap, and reports availability labels that retain
only older student links. The SQL uses provider references only for aggregate
matching and returns no student names or provider IDs. Disappearance is still
not cancellation; these counts identify the next evidence to inspect rather
than resolving it.

The follow-on `/admin/lessons/exceptions` drill-down keeps that boundary while
making the 74 lesson-shaped non-observations inspectable. It resolves current
Students/tutor names on the server, shows up to eight current same-student events
within seven days, and counts current events sharing the stable First Chord
series. It is capped at 250 rows and returns nothing after a newer failed or
stale sweep. Provider aliases never enter the view model, and the screen has no
classification or mutation control.

The first live detail read split the 74 rows into zero same-slot candidates,
five same-day candidates, 14 with only nearby context and 55 with no same-student
event within seven days. Twelve have current events in the same First Chord
series; 33 historical participations no longer map to a current Students row.
All 74 lack an MMS event status. These findings narrow the evidence questions,
but none proves cancellation or authorises an identity merge.

### Phase 3 — Attach Existing Systems to First Chord IDs

Gradually make payroll, tutor cover, WhatsApp context, Practice Chat, student
dashboards and finance refer to First Chord series, event or participation IDs
at the correct grain. Each reader migrates behind parity checks and a rollback
switch. MMS still feeds the schedule, but provider IDs stop being the conceptual
join key for the school.

#### First Phase 3 consumer — teaching relationship lesson timeline (2026-08-30)

The Tutor Changes page now has a bounded read-only lesson-occurrence timeline
inside each current teaching relationship. The server queries only event and
participation rows re-observed by the latest successful, exactly-counted mirror
run; adapter-only MMS student, tutor, event and attendance references are used
to join existing context and removed before the view model is returned.

This consumer is deliberately shadow/dual-read:

- the existing assignment plus `Schedule_Context` still derive relationship
  phase and handover truth;
- one recent and up to two upcoming verified occurrences are shown, with exact
  First Chord event/participation identities, raw attendance status, matched
  tutor-absence cover/cancel context and bounded practice-note delivery status;
- exact attendance/event references link practice notes first, with a unique
  date+tutor fallback labelled medium confidence and ambiguity left unattached;
- raw attendance values are not interpreted as lesson completion, cancellation,
  payroll truth or automatic work;
- only an existing explicit practice-delivery follow-up, or a fresh mismatch
  after the cover-calendar step was marked complete, creates occurrence
  attention; both clear from their source evidence rather than a new status;
- a failed, stale, missing or partially covering mirror never displaces the
  existing relationship view and never proves that no lesson exists; and
- no new Sheet, migration, provider write, attendance mutation or scheduling
  authority is introduced.

Rollback is the code deploy only: remove the occurrence reader/composition and
the Tutor Changes page returns to its existing schedule-cache presentation. No
provider, Sheets or lesson-ledger data needs reversing.

#### Second Phase 3 consumer — first-lesson loop context (2026-08-30)

Open first-lesson Planning cards now use an exact linked-student/date/time match
to show whether the planned lesson appears in the fresh verified mirror. The
projection returns timing and the raw attendance label but removes every MMS
alias. A missing, ambiguous, stale or unavailable match remains explicit
uncertainty and never blocks the human follow-up or means the lesson was
cancelled.

This evidence sits beside recorded Stripe-link booleans, the existing
`Student_Portal_Access` workflow, and append-only human confirmations. It cannot
change payment, WhatsApp, attendance or access state. Planning closure is
server-gated by the due date and deterministic confirmation rules; it does not
depend on the lesson mirror being available. Rollback removes the composition
and focused UI only—no provider or workflow state needs reversing.

### Phase 4 — Own Selected Edits

Make a deliberately narrow class of schedule change in First Chord first, then
synchronise it to MMS through a durable command/outbox. Require idempotency,
human approval, provider read-back, reconciliation, an audit log and a defined
rollback. Tutor cover or a policy-approved permanent change is a better first
candidate than one-off rescheduling, which current school policy does not offer.

### Phase 5 — First Chord Becomes Canonical

Create new students, recurring lessons, cancellations and timetable changes in
First Chord. MMS receives a downstream projection for a defined transition
period. This phase requires explicit cutover criteria and must not be inferred
from elapsed time or high parity alone.

### Phase 6 — Replace the Calendar Surface

Provide a First Chord calendar UI, likely backed by a JSON calendar API, and
publish scoped iCalendar feeds for Google and Apple calendars. iCalendar is a
distribution format, not the mutable schedule database:

`First Chord lesson ledger -> scoped iCalendar feed -> tutor/student calendar`

Feed URLs require opaque revocable tokens, stable First Chord UIDs, least-data
event content and no payment, contact, private-note or operational detail.

### Phase 7 — Remove MMS

Remove MMS only after the particular functions the school still relies on have
been replaced and recovered in drills: attendance capture, notification
behaviour, make-up logic, reports, schedule editing and any remaining exports.
Archive evidence and provider identifiers according to the retention policy;
do not keep a zombie integration indefinitely.

## First Slice: Exact Scope

### Implementation and rollout status — 2026-08-10

The repository implementation is deployed. The initial checksummed migration
was explicitly applied to the production Neon PostgreSQL database after its
six-hour restore window was confirmed. The existing Practice Chat delivery
claim table remained at 111 terminal claims with no active claim before and
after the rollout.

The first bounded production reconciliation covered `2026-08-01` through the
end-exclusive `2026-08-29`. It succeeded with matching provider totals: 772/772
calendar events and 767/767 attendance rows. The mirror contains 219 series,
772 events, 767 participations, 1,758 external references and 1,758 initial
revisions. Integrity checks found no orphaned events or participations and no
event lacking a calendar observation. Names and free text were not emitted by
the operator commands.

Phase 2 schedules the bounded read and exposes aggregate evidence at
`/admin/lessons` plus an authenticated weekly parity calendar at
`/admin/lessons/calendar`. Two Phase 3 shadow consumers read the verified mirror:
the Tutor Changes lesson timeline and first-lesson Planning context. MMS remains
schedule and attendance truth, and no MMS write is performed. This is a
provider-neutral read-model adoption, not a scheduling-authority cutover.

### Included

- paginated whole-school calendar and attendance reads that verify provider
  totals before reporting success;
- bounded date windows and explicit maximum-page protection;
- separate series, event and student-participation records;
- First Chord IDs that are stable and provider-neutral at consumers;
- a generic external-reference layer retaining MMS IDs;
- local date, local time and `Europe/London` stored explicitly rather than
  relying on JavaScript `Date` coercion of MMS wall-clock values;
- raw MMS attendance status retained without guessing its business meaning;
- current-state hashes and append-only revisions only when state changes;
- sync-run records containing requested windows, expected/received counts,
  status and failure detail;
- idempotent, transactional database writes; and
- manual operator commands for migration, sync and status before scheduling is
  enabled.

### Excluded

- switching any existing reader or writer to SQL;
- changing `Schedule_Context`, payroll, Practice Chat, tutor cover, finance,
  messaging or attendance behaviour;
- writing to MMS;
- heuristically merging a deleted MMS event with a replacement event;
- interpreting disappearance as cancellation;
- deriving “completed” from an attendance label;
- a calendar UI or iCalendar feed; and
- an automatic production schedule before the migration, backup position and
  first reconciliation run have been reviewed.

## Data Model

| Table | Grain and purpose |
|---|---|
| `fc_lesson_series` | One First Chord series identity. A series is not fabricated for one-off events; recurrence observations remain on events until parity proves the provider contract. |
| `fc_lesson_events` | One scheduled calendar event. Holds event-level tutor, time, duration, location/category and raw provider facts. |
| `fc_lesson_participations` | One student at one event. Holds the raw attendance status and attendance reference independently of the event. |
| `fc_lesson_external_refs` | Provider/type/reference to one FC entity. This keeps MMS IDs out of consumer identity contracts. |
| `fc_lesson_revisions` | Append-only snapshots written only when a current record’s state hash changes. |
| `fc_lesson_sync_runs` | The windows, totals, outcome and error evidence for one mirror attempt. |
| `fc_schema_migrations` | Explicit applied migration versions. Schema creation never happens lazily in an application request. |

The initial FC IDs are deterministic opaque hashes of the entity kind and MMS
reference. That makes concurrent or repeated imports converge without a lookup
race. The external-reference layer allows a later, reviewed alias or merge when
evidence proves that two provider records represent one First Chord entity.
Until then, an MMS delete-and-recreate remains two FC events. False separation
is visible and repairable; a false automatic merge can corrupt history.

## Completeness and Safety Invariants

1. A provider response is complete only when pagination reaches the reported
   total. A mismatch fails the run.
2. A failed or incomplete run never marks unseen records missing, cancelled or
   stale.
3. Fetches complete before current rows and revisions are committed. A database
   transaction makes the mirror change all-or-nothing for a successful run.
4. Re-running the same window does not duplicate entities or revisions.
5. Unknown provider values are retained as raw data and surfaced in parity
   reporting; they are not coerced to a reassuring default.
6. Group events have one event and several participations. Event count is never
   used as a student lesson count.
7. All application readers continue to use existing sources during the first
   slice, so disabling the sync command is an immediate behavioural rollback.
8. Credentials never enter rows, logs, command output or documentation.

## Cadence After the First Reconciliation

The production cadence is one bounded whole-school sweep daily at 05:45 UTC: 14
London calendar days back, today, and 42 days ahead. The overlap observes late
attendance edits; the future horizon catches schedule changes without hiding a
historical backfill inside the daily job. Both MMS endpoints are paginated and
their reported totals must match before SQL accepts the snapshot.

Daily cadence improves observation; it still does not turn polling into a true
provider change log. A lesson created and removed entirely between successful
sweeps may remain invisible unless MMS exposes another audit source.

## Rollout Gates

The first slice is ready to run in production only when:

- migrations have been reviewed and applied explicitly;
- PostgreSQL backup/PITR availability is known, while recognising that mirror
  rows themselves are rebuildable from MMS;
- the existing Practice Chat delivery-claim table is unaffected;
- a bounded dry reconciliation reports provider totals and database counts;
- logs and health output contain IDs/counts but no sensitive names or secrets;
- the manual status command can distinguish fresh, failed and never-run states;
  and
- rollback is documented as disabling the mirror trigger and reverting code,
  without deleting append-only revisions or guessing at provider repair.

Automatic daily scheduling is separately observable through the GitHub workflow
and Overview health card. No existing operational surface waits on the mirror,
so a sync failure is visible but does not interrupt school work or replace the
last verified parity view.

## Phase 2 Questions to Answer with Evidence

- Does MMS preserve `SeriesID` across term changes and permanent slot moves?
- How are cancelled events represented: status, disappearance, category or a
  separate source?
- Can attendance records outlive or refer to calendar events outside the
  selected calendar window?
- Which provider fields change when tutor cover is used?
- What overlap window captures late attendance edits without needless load?
- Which privacy and retention period is proportionate for detailed lesson and
  attendance history?
- Which first consumer gains enough value to justify its own cutover risk?

These are parity measurements, not reasons to put event and participation data
into the wrong schema now.
