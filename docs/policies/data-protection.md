---
status: supporting
audience: [human, agent]
last_verified: 2026-08-10
---
# Data Protection Map And Open Decisions

## Status

This is a code-checked data inventory and a proposed retention schedule. It is
not yet a signed-off retention policy and does not authorise deletion. First
Chord is the controller; many data subjects are children, so minimisation,
clear access boundaries, and plain-language transparency matter especially.

## Store Inventory

| Store | Personal data and purpose | Proposed retention |
| --- | --- | --- |
| `Students`, registry/generated portal config | child/parent identity, contact, lesson, portal and Stripe linkage needed to provide tuition | enrolled; archive/remove through the established leaving flow |
| `Students_Archive` | leaving snapshot for disputes/re-enrolment | 2 years after leaving |
| `Practice_Notes_Log` and Gmail Sent | progress notes, recipient, delivery IDs; lesson-note service | 2 years after leaving; align both stores |
| `Student_Portal_Access` | encrypted family notes code, credential verifier/version, and staff rollout confirmations | enrolled; remove through the established leaving/portal-removal flow |
| `Incoming_Message_Inbox`, `WhatsApp_Group_Map`, local bridge cache | parent messages, phones, group/student mapping for lesson administration | handled/ignored inbox rows 12 months; cache 14 days/2,000 by default; confirmed map while operationally needed |
| `Proposals` | generated reply body, source-text hash, bounded policy/model metadata, and the admin's use/edit/discard decision; no copied inbox message text | 12-month rolling prune proposed; not yet automated |
| `Newsletter_Issues`, `Newsletter_Items` | child first/last name, tutor, a tutor's or Fenella's short written observation about a child, the recorded parental answer about whether a picture of that child may be published, and Drive references to uploaded media | enrolled plus 2 years, aligned with `Practice_Notes_Log`; **never prune a `consent_answer` row while the permission it records is still being relied on** |
| Google Drive `First Chord Newsletter/<YYYY-MM>/` | **photographs, video and audio of children**, uploaded by tutors through the dashboard | proposed enrolled plus 2 years, aligned with `Practice_Notes_Log`. **Deletion is manual and deliberate** — nothing in the code deletes a file, and detaching a reference in `Newsletter_Items` leaves the file in place on purpose. `npm run newsletter:media-report` lists unreferenced files for a human to judge |
| Newsletter arrival emails (`musiclessons@` Gmail Sent, and the configured staff inbox) | student name, tutor, up to 600 characters of the contribution text, and an attachment count — never the photo itself | follows the mailbox; one email per contribution, internal only |
| `Communication_Log`, `Parent_Understanding_State` | copied parent communication and human relationship notes | communications 2 years; review subjective understanding notes yearly |
| planning, absence, pause, issue and event lanes | named operational workflow and audit evidence | workflow rows while active/useful; `Event_Log` proposed 2 years; never erase evidence to fake recovery |
| song/path/assignment/request/outcome lanes | student IDs, tutor names, learning telemetry and free-text outcomes | review periodically; do not turn tutor-linked outcomes into performance ranking |
| payroll, pay config, Wise, cover-bank lanes | tutor identity, phone, availability, earnings and recipient IDs | financial records 6 years; contact/availability while engaged |
| `Stripe_Forecast_Monthly`, `Stripe_Collected_Monthly` | student identity plus forecast/revealed collection amounts used to test finance completeness and investigate discrepancies | proposed 6 years with other financial reconciliation records; one compact row per month |
| Stripe/MMS/Google/Wise/Soundslice/GitHub | provider-held data required for payments, lessons, content, hosting and code | governed by the school purpose plus provider terms/DPA |
| Neon PostgreSQL `practice_note_delivery_claims` | pseudonymous delivery key and acting tutor used to prevent duplicate sends | retain while it is required to prove/block delivery replay; no note body |
| Neon PostgreSQL `fc_lesson_*` mirror | pseudonymous student/tutor/provider IDs, lesson date/time/location/category, raw attendance status, sync evidence and changed-state revisions; used to prove MMS parity and provide stable lesson identity | proposed: enrolled plus 2 years after leaving; no automated pruning until the school approves a lesson-history/right-to-erasure procedure |
| local Sheets backups | copies of managed operational tabs | bounded backup-set count; off-machine copies must use the same window |
| OpenAI proposal/briefing inputs | bounded redacted operational projections when an explicitly enabled pilot calls the model | ephemeral provider processing plus minimal decision/evaluation telemetry; the reply pilot is explicit-press, one message at a time |

The complete tab/key/writer inventory is [State tabs](../architecture/data/state-tabs.md).
When a store or purpose is added there, update this map in the same change.

## Current Exposure Decisions

1. `/dashboard` is a low-friction public tutor surface. It exposes student names,
   notes, and capability links without persistent tutor identity. The recommended
   fix is tutor-scoped Google login/allow-list before adding broader sensitive
   reads or writes.
2. Student portal names/paths remain guessable, but Practice Chat notes now load
   separately and can be moved one family at a time behind a memorable code. A
   missing rollout row preserves legacy public notes during transition; a failed
   access-state read fails closed. Complete the rollout campaign and explain this
   access model in the parent-facing privacy notice.
3. The incoming WhatsApp bridge retains parent group content locally and in
   Sheets for administration. A parent-facing privacy notice must explain this.
4. The Practice Chat transcription relay currently exposes its raw OpenAI key to
   browsers. Follow the active staged cutover and rotate that key; this is a
   credential exposure, not a retention-policy choice.
5. **Newsletter media consent is recorded per picture, and is newsletter-scoped.**
   There was previously no record anywhere in this repository, the brain, or MMS
   that a parent had agreed to their child's photo being published — the school
   asked informally and remembered. `Newsletter_Items` now stores the answer
   (`no` / `yes_once` / `yes_ongoing`) with the date it was given and the issue it
   was given for. Standing permission is derived from a real `yes_ongoing`
   answer; a decline is never inferred into a standing refusal. The permission
   covers **newsletters only** — reusing an asset on social media, a showcase
   reel or the website is a separate ask, and no field should be added that would
   let one answer authorise all of them. Slice 1 stores no files: the picture
   stays wherever the tutor sent it, and the upload path is refused server-side.
6. **Tutors can upload photographs, video and audio of children into First
   Chord's Google Drive from the tutor dashboard.** This is a deliberate
   improvement on the previous position, where the same files lived on tutors'
   personal phones and in WhatsApp threads with no school control and no
   retention at all. Three boundaries make it acceptable: the upload route
   refuses entirely unless `TUTOR_DASHBOARD_AUTH_MODE` is `pilot`/`required`, so
   it is inert on the legacy public service; the Drive credential is scoped to
   `drive.file`, which can only ever touch files this application itself created,
   not the rest of First Chord's Drive; and **uploading is not publishing** — the
   existing consent gate still blocks a picture from being selected for an issue
   until a parent's answer is recorded. Uploaded bytes live in `musiclessons@`'s
   Drive, shared with Fenella. Outstanding: the parent-facing privacy notice must
   say the school stores this media and for how long, and the retention window
   above needs approving.
7. Pressing **Reply** on an inbox card may send that message's redacted text to
   OpenAI. Unknown names/indirect identifiers can survive deterministic
   redaction. Finn accepted that residual risk for a bounded per-card pilot on
   2026-08-04. There is no bulk/background drafting, and `Proposals` does not
   duplicate the model-input message text.

## Leaving And Rights Requests

The existing leave action archives the `Students` row and removes the registry
entry. It does not currently prune related notes, message logs, communications,
understanding notes, SQL lesson participations/revisions, or all provider copies.

For access or erasure, use this inventory and stable student/provider IDs to
search every store. Preserve records required by legal obligation (including
the proposed six-year financial window) and the minimum audit needed to explain
consequential actions. Record what was supplied, retained, or deleted and why.
Never bulk-delete from a generated report.

## Retention Report

`npm run retention:report` is read-only. Its policy list is hard-coded in
`scripts/retention-report.mjs`; it does not parse this Markdown. It counts dated
rows against proposed windows and cannot safely determine every student's leave
date or legal exception. Review its output per tab before any manual pruning.

## Sign-Off Needed

- approve or amend every proposed retention window
- publish a parent-facing privacy notice and contact route
- choose tutor-dashboard and student-note access changes
- confirm repository access and FileVault/off-machine backup protection
- include the bounded OpenAI reply-proposal processing in the parent-facing
  privacy notice and verify the applicable provider/DPA settings
- approve the newsletter media-consent wording, and describe in the parent-facing
  privacy notice how a picture of a child is requested, recorded and retained.
  **The upload path now exists**, so this is owed rather than merely planned; it
  is gated behind tutor authentication being enforced, which is the practical
  reason it is not yet live
- approve the retention window for newsletter media held in Google Drive, and
  agree who may access that folder (currently `musiclessons@`, shared with
  Fenella)
- define and rehearse a reviewed per-student deletion/export procedure

Until then, minimisation improvements that do not destroy required history are
welcome; automated deletion is not.
