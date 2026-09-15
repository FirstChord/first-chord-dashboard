---
status: canonical
audience: [human, agent]
last_verified: 2026-08-03
---
# Practice Chat Delivery Contract

## Boundary

Practice Chat may update MMS attendance and email a reviewed lesson note to a
parent only after the tutor completes the recipient-specific confirmation. This
is an accepted narrow exception on the low-friction tutor surface; it is not a
general permission for public tutor routes to perform consequential writes.

The selected tutor is self-attested, not authenticated identity. Before any
provider call the server must load the student context and require one clear
recorded tutor assignment matching that self-attestation. Missing, conflicting,
or mismatched records fail closed.

All registered tutors are enabled when `PRACTICE_NOTES_ENABLED_TUTORS` is absent.
The variable may temporarily restrict the roster; it must not be treated as the
canonical tutor registry.

## Human Confirmation

The final screen must show:

- the selected student
- lesson date/attendance target previewed from MMS
- the exact first email-capable recipient derived server-side from that
  student's MMS family/contact data

The tutor must affirm that these are the named student's notes and should be
emailed to that named recipient. A generic date-only confirmation is
insufficient. The server revalidates the selection; a model- or client-supplied
confirmation is never human approval.

Typed notes remain available if speech capture fails. `AbsentNoMakeup` records
the on-the-day cancellation without sending a parent practice-note email.

## Delivery And Idempotency

`delivery_key = student + MMS attendance + note hash` identifies one delivery.
The execute path must:

1. validate origin/shared-secret, tutor/student assignment, attendance target,
   recipient, note, and confirmation
2. atomically insert `practice_note_delivery_claims.delivery_key` in PostgreSQL
3. save the corresponding Sheets audit claim
4. only then call MMS and Gmail
5. finalize both the database claim and `Practice_Notes_Log` audit row

The database primary key is the cross-instance execution lock. The in-process
guard only complements it. Sheets is the audit/read model, not a transactional
lock.

If the database claim cannot be saved, return 503 and call neither MMS nor
Gmail. If the initial Sheets claim fails, release only that fresh pre-provider
claim and do no provider work. Terminal completed, failed, or manual-follow-up
claims are never automatically reacquired or deleted to force a retry.

A `claimed` database row older than 15 minutes is treated as an interrupted
delivery, not as permission to try again. On the next matching request,
PostgreSQL atomically moves it to `tracking_failed`; the route records
`manual_follow_up_needed = TRUE` in the Sheets audit row, returns HTTP 409 with
unknown provider status, and calls neither MMS nor Gmail. Fifteen minutes is a
conservative abandonment window, not a provider timeout. The human must inspect
MMS attendance and Gmail evidence before deciding whether either side needs a
manual repair.

A duplicate request returns the existing result instead of repeating provider
work. If MMS succeeds and Gmail errors or times out, mark manual follow-up and
do not retry the ambiguous email automatically. If provider work succeeds but
final logging fails, report explicit partial success; never imply the provider
action did not happen.

## Shared Lessons

Two students in one lesson are one MMS calendar event carrying **one attendance
record per student**. `GET /calendar/events/{eventId}` returns them, which makes
the membership of a group lesson exact — not the `Schedule_Context` shared-slot
guess, which pairs students by matching next-lesson timestamps and breaks when
one side's cache was refreshed on a different day.

`POST /api/practice-notes/group` delivers a shared lesson. It is a layer over the
single-student path, never a replacement:

- **The lesson is pinned once.** The launched student's selected event fixes the
  lesson and every other member is taken from that same event. Run the
  single-student preview twice for two sisters instead and they land on different
  dates, because each picks her own latest unrecorded record.
- **Each member keeps its own delivery key, claim, attendance write and log
  row**, so the existing idempotency and partial-failure guarantees apply
  unchanged. Members are delivered one at a time, and a member that fails never
  blocks the rest — marking one sister must not depend on the other's email.
- **One email per household.** Recipients are deduplicated by address: the first
  member holding it carries the send and names everyone it covers ("Athena and
  Sophia"); the rest record `covered_by_group_email`. Both real sibling pairs
  share a single parent, so sending per student would put two near-identical
  emails in one inbox about one lesson. **The server owns this decision** — the
  PWA sends no recipient or household field, because a client that got it wrong
  would duplicate a parent email.
- **Attendance-only lessons send nothing.** A lesson whose kind is `orchestra`
  (`derivePaymentValueContext`) marks every member and emails nobody: the ukulele
  orchestra is adults with their own contacts, where a parent practice-note email
  is the wrong shape. Recorded as `attendance_only_lesson`, a reason rather than
  silence, so "no email was needed" never reads like "the email failed".
- **Partial is its own state.** A group where one sister was marked and the other
  was not reports `partial` and names who still needs sorting; it is never
  reported as done.

A lesson with one student returns `isGroup: false` and the caller falls back to
the ordinary single-student endpoint with its own recipient confirmation.

## Sources And Visibility

- MMS remains attendance/payroll continuity truth.
- Gmail owns whether it accepted the outbound email and its message/thread IDs.
- PostgreSQL owns the unique delivery execution claim.
- `Practice_Notes_Log` owns dashboard delivery audit and parent-visible note
  memory.

Only sent/completed note rows may be parent-visible. Draft, snapshot,
in-progress, failed, and absence-only rows are not proof of parent delivery.
Rows with `manual_follow_up_needed = TRUE` surface as Practice Delivery issues;
clearing that flag is a narrow cell update, not a full-row rewrite.

Practice Chat may attach optional stable catalogue song IDs after tutor review.
The dashboard context endpoint returns the student's exact current-shelf
`{songId, title, status}` objects for transcription/prioritisation plus bounded
public catalogue metadata for deliberate search. The PWA proposes only
deterministic exact-title matches from the note: proposals are not preselected,
duplicate catalogue titles are suppressed unless the shelf resolves them, and
one-word titles require a nearby song-work cue. Both note POST routes validate
submitted IDs against the canonical repository catalogue; `song_titles_json`
is a readable capture-time snapshot and the ID is the join. A tutor may instead
record up to six raw titles in `unlisted_song_titles_json`; those are observations
for catalogue review, never Song objects. Blank remains unknown. Do not infer
whether a student liked a song from ordinary English in prose; optional
`Song_Outcomes` remains separate supplementary evidence.

`Practice_Notes_Log.acting_tutor` must remain labelled
`Self-attested: <name>` until tutor authentication exists.

## Required Configuration And Bootstrap

On the canonical Railway admin service:

```text
DATABASE_URL=<Neon PostgreSQL URL supplied to Railway>
PRACTICE_CHAT_API_SECRET=<shared PWA handoff secret>
# Optional emergency/temporary restriction only:
PRACTICE_NOTES_ENABLED_TUTORS=<comma-separated canonical names>
# Optional transcription trial only. Unset = the PWA's own default (whisper-1).
NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL=<supported model id>
# Six-week evaluation only. Unset = no tutor is ever prompted.
NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS=<comma-separated short names>
NEXT_PUBLIC_PRACTICE_CHAT_EVAL_SAMPLE=<prompt on 1 in N sessions>
```

The two evaluation variables gate the rating card only; session telemetry runs
regardless and changes nothing a tutor sees. See
[the evaluation workflow](./evaluation.md).

## Transcription Model

The model is school-wide configuration, not a per-lesson choice: the useful
comparison is a week on one model against a week on another, and a tutor should
never have to remember a setting mid-lesson. Unset is the normal state.

Supported values are allow-listed in `lib/config/practice-chat-asr.mjs` and
again in the PWA's `asr-client.js`; anything else falls back to the default and
warns rather than reaching the provider. `gpt-4o-transcribe-diarize` is
deliberately excluded — it requires `diarized_json` plus a `chunking_strategy`
and accepts no `prompt`, so it is a different feature, not a swap.

**`NEXT_PUBLIC_` variables are inlined into the client bundle at build time.**
Changing this value therefore requires a **rebuild**, not just a restart — on
Railway, editing the variable triggers a new deployment, which is what bakes it
in. A variable changed without a rebuild has no effect at all.

Record the start and end of any trial: without per-transcript model capture
(held with the raw-transcript slice), the dates the variable was set are the
only record of which model produced which notes.

Before first use against a database, run:

```bash
npm run ensure:practice-delivery-claims
```

The shared PWA secret is a coarse caller guard, not tutor identity. Keep allowed
browser origins narrow and never expose database or provider credentials to the
PWA.

## Recovery

- Failure before provider work: inspect the selected lesson/recipient and retry
  only if no terminal claim exists.
- Gmail ambiguity after MMS success: verify Gmail/provider evidence and follow
  up manually; retain the claim and audit trail.
- Gmail success with MMS failure: preserve delivery evidence and repair
  attendance/payroll from MMS truth rather than resending the email.
- Final log failure: treat as partial success and reconcile from PostgreSQL,
  Gmail, MMS, and existing Sheets evidence. Never guess or erase history.
- Claim still `claimed` after 15 minutes: submit the same delivery once to park
  it as manual follow-up, then inspect MMS and Gmail. Do not delete or reset the
  claim, and do not submit a different note merely to bypass its delivery key.

## Verification

Focused tests are `tests/admin/practice-*.test.mjs`. Any delivery change must
cover validation, recipient/student scoping, tutor mismatch/conflict, claim
failure before providers, duplicate/concurrent execution, absence-without-email,
ambiguous Gmail failure, and final-log partial success.

After a deployment, use one explicitly approved real end-to-end note and verify
the confirmation copy, parent receipt, MMS attendance, audit row, database claim,
and duplicate response. Do not create a real delivery merely for an automated
smoke test.

### Look at the email

```bash
npm run preview:email            # both MIME alternatives, plus layout checks
npm run preview:email -- --open  # writes an HTML file to open in a browser
npm run preview:email -- --note path/to/note.txt
```

Sends nothing and calls no provider, so it is safe to run at any time.

**Run it whenever the email body, the note markup, or their shared renderers
change.** Assertions on this path check that content is present and correctly
escaped; they cannot see how it is arranged. Section headings once rendered
inside the body paragraph — leaving Gmail no block boundary to space around, so
parents received a wall of text — while every test passed, because presence and
arrangement are different properties and only one of them was ever asserted.

Styling must be inline. Gmail discards `<style>` blocks and `<head>` entirely,
so a stylesheet silently does nothing; the preview reports whether any crept in,
and whether raw `[section]` brackets are still reaching parents.
