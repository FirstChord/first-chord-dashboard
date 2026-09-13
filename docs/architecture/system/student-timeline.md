---
status: canonical
audience: [human, agent]
last_verified: 2026-09-13
---

# Student timeline projection

The admin student timeline answers a narrow question: **what meaningful dated
records help explain how this student reached their current state?** It is a
read-only projection. There is no `Student_Timeline` tab, table, writer, or
manual timeline-entry workflow.

## Boundary

`lib/admin/student-timeline.js` reads existing owners independently and passes
their rows through the pure adapters in
`lib/admin/student-timeline-helpers.mjs`. Those adapters emit one common UI
shape containing:

- a stable projection ID and kind;
- title and compact source-authored summary;
- date value, precision, time zone, and date certainty;
- evidence certainty;
- source system, source record type/ID, provider, and observation time; and
- an optional link back to the owning detail or workflow.

The projection is sorted and de-duplicated at read time. Its de-duplication
only collapses repeated source identities and known paired `Event_Log` rows
written for one action at the same timestamp. It does not merge merely similar
events or create a replacement historical fact.

Source failure is also part of the read model. An unavailable or unverified
source is named beneath the timeline and contributes no invented fallback row.
Missing dates remain visible as unknown and sort after dated records.

## First-slice sources

| Source owner | What enters the timeline | Important qualification |
|---|---|---|
| `Event_Log` | Selected student, issue, payment, pause, onboarding, portal, and exit actions | Append-only action history, not current truth. Routine machine noise is excluded. |
| `Pause History` | Identity-matched pause windows | Match confidence and incomplete dates are preserved. A pause row is evidence, not Stripe state. |
| `Practice_Notes_Log` | Completed/logged practice-note memory | The row is described as logged; separate delivery fields remain authoritative. |
| `Communication_Log` | Messages copied to send | Copying never proves the message was sent. |
| `Student_Lifecycle` | Earliest recorded past lesson | A derived MMS-history observation from the latest lifecycle refresh, never a fabricated lifecycle transition. |
| lesson history port | Recent, verified lesson participations | Currently supplied by the First Chord lesson mirror and labelled MMS-backed. Raw attendance is shown without interpreting it as completion or cancellation. |

The detailed Practice Chat and communication sections remain their owners' more
complete views. The compact timeline is navigation and context, not a second
record.

## Lesson-source seam

The timeline adapter accepts provider-neutral lesson observations:
`lessonId`, `participationId`, local date/time/time zone, duration, resolved
tutor name, raw attendance label, and observation time. MMS external student,
event, attendance, and tutor aliases are used only inside the server adapter and
are removed before the common timeline contract.

Today the adapter reads only rows re-seen by the latest fresh, successful,
exactly-counted lesson-mirror run. A stale, failed, missing, or out-of-window
mirror contributes no lesson rows. When the First Chord lesson ledger becomes
the current lesson-history owner, it can emit the same provider-neutral input;
the timeline event model and UI do not change.

## Deliberately excluded

- current lifecycle status presented as if it were a historical transition;
- inferred permanent tutor changes from current assignment or a single lesson;
- `Practice_Chat_Sessions` attempt telemetry, which measures the tool rather
  than the student's story;
- ordinary future lessons, every issue scan, planning checklist movement, and
  other activity noise;
- writes, corrections, event replay, projections used to authorise actions, or
  a general event-sourcing system.

Obvious later candidates are recorded permanent tutor-assignment changes,
onboarding milestones with durable student identity, selected song/path
milestones, explicit pause/resume decisions, and First Chord-owned lesson
commands after their own cutover gates exist. Each requires a trusted dated
source and adapter; none should be inferred from the current snapshot merely to
make the timeline look complete.
