---
status: canonical
audience: [human, agent]
last_verified: 2026-09-11
---
# Admin current status

This is a snapshot of active direction, recent delivery, and open choices. It is
not a changelog or a second policy manual. Use Git history for chronology, the
Obsidian Learning Log for rationale, and the focused linked document for durable
implementation rules.

## Active direction

V3 established the operating loop:

```text
Detected -> Guided -> Actioned -> Logged -> Resolved / Kept Active
```

V4 adds small, explainable context layers that reduce the cognitive cost of
running the school. The private `/admin` dashboard is the active operating
surface. The overview is a meeting start, not a complete status board: a card
earns attention only when it represents work for today, near-term action, or a
deliberate school-improvement prompt.

## Since last session

Bounded at 8 entries and enforced by `npm run docs:check`. When it overflows,
delete the oldest — do not archive it here. The chronology is `git log` and the
rationale is already written up in the Obsidian `06 Learning Log/`.

- **A short-notice tutor cancellation can be one card per student — DEPLOYED
  2026-09-14:** cancelling a tutor absence always produced an early notice card
  (due 14 days out) and a pause card (a few days before the lesson), so a week's
  notice meant an already-overdue notice and a second message to the same parent
  days later. Cancel now offers **one card now** or **notice now, pause later** —
  a human choice, not a date threshold. The combined choice writes
  `Tutor absence notice mode: combined` on the capture card before the handoff
  runs; no early notice card is created, and each pause card is due from the day
  it was decided and carries one message covering the absence and the pause,
  unlocked only after the payment-tool step. The stored decision stays
  `cancel_day`, so absence state, reconciliation, finance and the auto-close are
  unchanged. The absence card also now names the linked cards it is still
  waiting on. Contract: `docs/workflows/tutors/absence-to-pause.md`.
- **The Message Inbox is a focused, faster processing queue and unknown live
  groups are recoverable without weakening confirmation — DEPLOYED
  2026-09-12; return-checkpoint refinement DEPLOYED 2026-09-13:** Libby Brooks's
  12:04 absence message for Adam
  reached the bridge cache but not the inbox. Adam's chat ID was absent from the
  228 confirmed groups and from a fresh 366-group WhatsApp snapshot even though
  the account received its live event. The bridge now retains only that live
  message as pending, performs a rate-limited targeted metadata lookup, and
  surfaces a likely First Chord group for human review. Confirmation releases
  the pending message on the next ten-minute refresh; the dashboard's stable
  message identity makes retries a no-op. The title never enables capture,
  history batches are never replayed, and non-First-Chord groups remain local.
  The everyday UI now keeps a compact queue beside one selected message, opens
  the same detail with a sticky return control on mobile, and keeps Reply + Plan
  in the inbox: a successful copy/create advances to the adjacent message and
  leaves Open full plan as an optional link. Burst outcomes are one batched
  write; ordinary mutations return changed rows instead of rebuilding the whole
  inbox. Done loads only when opened, returns the 100 most recent rows while
  preserving the full 906-row count, and skips the unused 840-row Planning
  join; the 485-row group map also waits for its panel. The active inbox tabs
  are prefetched together. The next narrow refinement keeps WhatsApp opening
  separate from the queue and requires a human **Sent — finish & next** on
  return; a session-only handoff preserves the reply and optional plan link.
  Selection and scroll survive refreshes on this device, the queue shows x of y,
  four earlier same-chat messages load only for the selected card, and a stale
  bridge prevents a false **All caught up**. Handled/Later gain a 12-second Undo
  guarded by the row's latest review timestamp and by any linked plan.
- **Practice note quality has a baseline and a rubric, measured 2026-09-11:**
  Practice Chat has held ~100 notes/week for five weeks, so adoption is finished
  and the open question is whether the writing is worth a family's attention.
  Across the 195 scored notes of the most recent 200: **92%** carry all three
  sections, **73%** read as prose rather than a verbatim transcript, **31%** of
  practice goals name something checkable, and **29%** carry a confirmed song
  link — up from 1-in-14 on 2026-08-07, so the selector's adoption problem is
  half solved. The consequential finding is that **`ratingAccuracy`,
  `ratingComment` and `priorUsefulness` are empty on all 612 session rows and
  `ratingPrompted` is never set** — the usefulness instrument was built and
  never switched on, so every quality judgement available today is structural.
  Two further defects: notes written without headings (Hamish, Matthew) store
  three blank structured columns because `parsePracticeNoteSections` needs a
  heading, which leaves those tutors invisible to the tutor card, insights and
  summaries while looking normal to parents; and a shared sibling lesson written
  as one row leaves the second sibling with no notes at all. Verbatim-dialogue
  notes are **growing** (12% June → 29% September) and capture is not the cause
  — zero ASR errors and zero re-records across 612 sessions. Baseline, ranking
  and dated goals: `docs/plans/active/practice-note-quality.md`.
- **FC student IDs have one owner and one formula — DEPLOYED 2026-09-11:** the
  dashboard and brain CLI minted `fcStudentId` from `forename:surname:email`
  while the brain's hourly job recomputed `FC_Students` from `sha256(mms_id)`,
  so 63 of 210 students carried two IDs and brain lookup could not find them by
  the one the dashboard shows. **An FC student ID is now minted once from the MMS
  student ID and then stored; the stored value is authoritative and never
  recomputed.** The brain reads it (registry → Students cell → derived), raises
  `FC ID CONFLICT` / `MALFORMED` / `DUPLICATE` instead of overwriting, and stops
  if the registry ever parses without IDs. Onboarding blocks without an MMS ID.
  Both repos pin `sdt_WFQ7Js → fc_std_fa157fc5`; the hourly workflow runs brain
  tests before writing tabs. Verified live: 210/210 match, no `created_at`
  moved. Manual `generate_fc_ids.py` runs are unnecessary — the hourly job reads
  `main`. Record: `docs/plans/active/fc-student-id-convergence.md`.
- **Rerunning a completed onboarding returns its messages — DEPLOYED
  2026-09-11:** the duplicate guard's 409 carries the welcome and Soundslice
  messages, and the form reads "Already onboarded — nothing was written" instead
  of a red wall of eight skipped steps. A partial record (Students row without a
  registry entry) is excluded and keeps the attention panel, because that one is
  genuinely unfinished.
- **Tutor WhatsApp groups are now a first-class group type — DEPLOYED
  2026-09-10 (confirm-group fix 2026-09-10):** the incoming inbox previously assumed every confirmed
  group was a parent/student lesson group. `Incoming_Message_Inbox` gains
  `group_type` / `matched_tutor_id` / `matched_tutor_name` and
  `WhatsApp_Group_Map` gains `group_type` / `matched_tutor_id`, all appended and
  optional; missing means `student`, nothing is backfilled, and no existing
  group is auto-confirmed. A tutor group is discovered by the title convention
  `<tutor> First Chord` checked against the active roster (a shared first name
  stays ambiguous and needs explicit selection), and confirming one clears the
  student/sibling/parent links so one tutor message can never remap the group.
  The consequential half is that **tutor messages are inbound work, not school
  reply evidence** — being listed in `Tutor_Phones` suppresses a tutor's message
  in a *student* group and must not suppress it in their own. Parent reply
  policy is bypassed for tutor rows (neutral acknowledgement, no model call) and
  Reply + Plan creates a general tutor Action, never a student pause inferred
  from a tutor's dates. The bridge's confirmed-group refresh drops from 6 hours
  to 10 minutes by default so a confirmation is usable in the same session.
  Rollback: mark confirmed tutor groups Review/Ignored *before* reverting, or an
  older build applies parent rules to them; leave the appended columns alone.

- **Tutors can put photos, voice notes and video straight into First Chord's
  Drive — BUILT AND DEPLOYED 2026-09-12, INERT UNTIL SWITCHED ON:** the tutor
  dashboard gains a quiet newsletter strip (month, question, priority names as
  links — no tick boxes) and a per-student capture panel with text plus camera and
  voice-note buttons. **Correction to the earlier plan: uploading is not
  publishing.** Those photos already sat on tutors' personal phones and in
  WhatsApp with no school control and no retention, so moving them into a
  controlled Drive folder is a privacy improvement; consent gates *use*, and that
  gate already exists. The path is bounded: its own `DRIVE_*` credential scoped to
  **`drive.file` only** (no `GOOGLE_*` fallback, unlike Gmail — a fallback would
  silently widen the grant), a MIME allowlist, per-kind size caps enforced again
  against arriving bytes because `Content-Length` is a claim, the body **streamed**
  to Drive rather than buffered, Drive written before Sheets so a failure leaves
  recoverable garbage rather than a broken row, and **no deletion anywhere in the
  code**. `npm run newsletter:media-report` reconciles references against files.
  Three tutor routes refuse outright unless `TUTOR_DASHBOARD_AUTH_MODE` is
  enforced — the first routes in the repo to fail closed on a missing auth mode,
  because the legacy public service still serves `/dashboard` with no login while
  holding Sheets credentials. **Boundary verified live 2026-09-12:** the legacy
  service answers `503 tutor_auth_not_enforced` and the canonical one `401
  token_required` — the first time this has been confirmed in production rather
  than only by test, and only possible because enforcement is now checked before
  any token work. That 401 also means **tutor auth is already enforced on
  canonical (pilot mode), so the strip and text capture are live today for the
  shared `musiclessons@` account**; `TUTOR_DASHBOARD_EMAIL_MAP` is needed for
  individual tutors to reach their own students, not for Finn to try it. Media
  upload remains genuinely inert, returning `drive_not_configured` until the three
  `DRIVE_*` vars are set. Full suite (1,609), lint, code-map, docs and build pass.
  **Follow-up 2026-09-14:** priority students carry a small newsletter mark on
  the tutor's student list (amber until something arrives, green after), and a
  tutor's first contribution for a student emails Fenella once — internal only,
  one configured address, never on edits. A photo-only item no longer loses its
  arrival time when its row is rewritten, which would also have re-sent that email.
  Record: `docs/plans/active/newsletter-loop.md`.
- **Fenella's half of the newsletter loop is a real workflow — 2026-09-12:** the
  monthly newsletter existed only in Fenella's memory and a WhatsApp message she
  retyped. `/admin/newsletter` now holds the issue (month, question of the month,
  deadline), the priority students she asked about, what has arrived, what is
  outstanding, what turned up unprompted, and what she has chosen to use — plus
  one derived sentence answering *what is still preventing this issue from being
  ready*. **Neither new tab has a status column:** `requested`, `captured`,
  `declined`, `selected`/`not_selected` and `needs_review` are computed on read
  from `requested_at`, `captured_at`, `tutor_response` and `editorial`, so a
  stale write cannot leave a row claiming something untrue, and the four
  different facts a checkbox would have conflated stay separate. Items key on the
  **stored** `fcStudentId`; the workflow resolves it and refuses
  (`fc_identity_unresolved` / `fc_identity_conflict`) rather than filing a child's
  story under a name — `tests/admin/newsletter-identity-boundary.test.mjs` pins
  that no newsletter module can import the minting helper. **Media consent now
  has a home for the first time:** nothing in this repo, the brain or MMS recorded
  that a parent had agreed to their child's photo being published. It is asked per
  picture, answered `no` / `yes` / `yes + future`, and standing permission is
  derived from a real `yes_ongoing` answer — deliberately newsletter-scoped, not a
  general media release. A picture cannot be selected until consent is cleared,
  re-checked server-side. Nothing is sent: tutor requests and consent asks are
  copy-to-send via `Communication_Log`, and the upload path is refused
  (`media_not_supported`) until the Slice 3 gates close. Design and slice gates:
  `docs/plans/active/newsletter-loop.md`.
## Current operating contracts

| Area | Current boundary |
|---|---|
| Context | Student lifecycle, schedule, payment value, and capacity summaries are derived/read-only. They do not become provider truth or authorise actions. |
| Issues detective | The generated opinion is optional wording over the deterministic case file. A one-button resolution is selected by code from an allowlist of existing issue actions, never by the model; the human press is approval, stale-state checks fail with 409, and normal action logging remains authoritative. |
| Navigation | Overview orients; Planning holds due work, reflection, notes, and initiatives; Workflows holds specialised and recurring processes; Issues handles detected exceptions. Persistent navigation visibly identifies the current section. Student records are reached through search and workflow links. |
| Capacity | MMS `Free` events remain source truth. Waiting-list matches are hints filtered by instrument, never reservations or automatic assignment. |
| Planning | `Planning_Items` is human work state, not a project-management or workflow engine. Friday reflection and Monday scheduling are seeded planning prompts. |
| Pauses | Generic completion never changes payment state. The guarded pause-completion action requires human confirmation, writes through the existing student route, and logs to `Event_Log`. For new guided tutor-absence cancellations, an undated paused-expected flag cannot suppress the dated structured pause card or unlock its final message; only an explicit per-lesson payment-not-needed decision takes the message-only path. |
| Messaging | Parent communication remains approval-first. `Communication_Log` means copied to send, not proven sent; inbound classifications and reply drafts remain proposals. The one automatic staff email is the newsletter arrival notice: one configured internal recipient (`NEWSLETTER_NOTIFY_EMAIL`), once per item, never a family. |
| Practice Chat | All registered tutors are enabled unless temporarily constrained. The tutor self-attests, the student must have one clear tutor assignment, the final screen names the server-derived recipient, and PostgreSQL claims the delivery key before MMS/Gmail work. Ambiguous Gmail outcomes require manual follow-up. |
| Lesson mirror | Neon PostgreSQL holds rebuildable MMS observations and stable First Chord series/event/participation IDs. A daily bounded read populates the mirror; `/admin/lessons` exposes aggregate parity/exception evidence, `/admin/lessons/exceptions` gives a bounded human-readable drill-down, and `/admin/lessons/calendar` renders the latest verified week. Tutor Changes and first-lesson Planning consume the mirror as fail-open shadow context, but no operational workflow depends or acts on it. MMS remains schedule and attendance truth, and absence from a sweep never proves cancellation. |
| Student portal notes | Profile URLs and non-note resources stay public. Practice Chat notes load through a separate no-store API; families are moved individually to memorable-code protection through the claimed admin rollout queue. A missing rollout row remains legacy-public, while an access-state failure fails closed. The memorable code is a light privacy guard proportionate to what it protects — a child's practice notes — not a defence against a determined attacker, and it is not sized to become one. |
| Finance | Sheets holds operating estimates/review state; Stripe and Wise remain provider truth. Payroll preparation does not execute Wise payment. |
| Public tutor surfaces | Low-friction tutor identity is not durable authentication. Do not add broader sensitive reads or consequential writes before tutor auth. |
| Testing | A test that reads source text and asserts a name appears is a lint rule, not coverage — it cannot show the code ran, ran in the right order, or was correct. Guards, verifiers, and write paths get executed instead: inject the impure dependency and run the real function. Source-text checks are legitimate only for architectural absence (module X must not import writer Y) and for server components with no callable handler, and must discover their targets from disk rather than a hardcoded list. Before trusting a new security or money-path test, break the thing it guards and confirm it fails. |

Canonical details live in [state ownership](./architecture/data/ownership.md),
[state tabs](./architecture/data/state-tabs.md),
[workflow design](./policies/workflow-design.md), and the focused workflow docs.

## Next choices

- **The tutor notes card, measured 2026-08-06 and only half addressed.** The
  card is read at the start of a lesson as a 5–10 second reminder. Its
  typography is genuinely good and should be left alone: body text is 14.18:1 on
  the yellow (AAA), the measure is 57 characters (Bringhurst's 45–75, near Dyson
  & Haselgrove's ~55 optimum), line height is 1.62, and the section labels are
  what make layer-cake scanning possible. The **yellow is right on evidence** — a
  pastel tint avoids the veil-of-light that pure white creates behind black text.
  What does not work, across a 7-student sample: two of seven cards are **taller
  than the viewport** (1041px and 1303px against 900px), and the transcript
  dominates them — Guy Pilsworth has 290 characters of guidance against 1835 of
  dialogue. Ranked: (1) **collapse the Progress & Challenges transcript behind a
  disclosure** — it is a record, not guidance, and this alone makes every card
  fit the screen; (2) **make Lesson Focus glanceable** — it is unedited
  transcribed speech, up to 430 characters, so the bottom line is buried
  mid-paragraph; bullets in Practice Chat now flow through, so the structural fix
  is upstream; (3) minor: the lesson-date heading is 16px against 17px body, two
  heading vocabularies are live (older notes say `WHAT WOULD BE GOOD PRACTICE
  OVER THE WEEK? (AND HOW!)`), and `max-w-[68ch]` is **inert** — it computes to
  728px while the column is pinned at 488px at every width from 1280 to 2560.
- **Song-link adoption is the lever, not the matcher.** Since the Practice Chat
  song selector shipped (2026-08-04), **1 of 14 notes** carries a confirmed link,
  at a run rate of ~130 notes/month. The flow exists; adoption does not. Every
  confirmed link is exact, is a real object reference, and unlocks what inference
  never can — cross-student repertoire counts, time-on-piece per grade, direct
  Soundslice/level links. Improving capture in Practice Chat is worth more than
  any further work on the matcher, which should be retired once confirmed links
  cover most recent notes. **The next concrete move (2026-08-07): let a note's
  song link create or update the assignment.** Today it is a one-way street —
  the shelf feeds the note's picker and transcription prompt, but the note never
  writes back, and both linked notes so far name songs the student was never
  assigned. **Shipped 2026-08-07** — see "A practice note now puts songs on the
  shelf" above. The remaining half of the lever is unchanged: the flow exists,
  adoption does not.
- **Catalogue titles need normalising, and the catalogue has no concept of a
  "work" (corrected 2026-08-07).** Dock of the Bay appears three times —
  `(Sittin' On) The Dock of the Bay` (Guitar, Grade 2), `(Sittin' On) The Dock Of
  The Bay` (Bass, Grade 1), `Sitting on the Dock of The Bay` (Electric Guitar,
  Grade 3). These are **not duplicates to delete**: they are three real
  arrangements of one song, and an earlier note here calling for deduplication
  was wrong. What breaks the matcher is that one work is spelled three ways, so
  it sees three names and correctly refuses to pick. The fix is title
  normalisation, not deletion. Across the catalogue, 13 titles repeat and almost
  all are this same legitimate pattern (Stand By Me guitar + electric, Come as
  You Are, Thinking Out Loud); the genuinely ambiguous ones are generic exercise
  labels — `Sight Reading` ×3, `Scales` ×2, `Chords` ×2, `Improvisation` ×2,
  `Riff Exercise` ×2 — which are not songs and should probably never have been
  matchable by title at all. The structural gap underneath: a song is currently
  an instrument-specific arrangement with no parent work, so teaching history
  for Dock of the Bay is split three ways and a First Chord path cannot say "this
  song, on whichever instrument". Worth settling before the FC curriculum paths
  are built on top of it.
- **Piano is the last untagged shelf, and the riskiest one to tag.** 77 of 155
  songs carry no skill (50% covered, the other three shelves are 90–100%). The
  gap splits cleanly: **42 have a `tutorNote` to tag from — a short curation pass
  — and 35 do not**, and those 35 need somebody at the score, not another pass
  over prose. `node scripts/song-skills-report.mjs --gaps` lists both.
  Two cautions specific to piano, both learned the hard way on the other shelves.
  First, it has the **largest tag vocabulary**, so expect the mapping-context
  error class described in "Acoustic guitar re-tagged" above — `left hand` →
  `hand_position` was exactly this and came from piano. Check what each existing
  mapping asserts before reusing it. Second, the coverage doc the `add-song`
  skill tells you to read "first, every time" moved to
  [song catalogue coverage](./reference/song-catalogue-coverage.md); the skill
  still pointed at the old `docs/admin/` path, so every run of it began by
  failing to find its own stated authority — plausibly how *I Don't Want to Miss
  a Thing* was given `strumming`. The skill was corrected 2026-08-11. **A
  user-level skill can rot silently against a repo that moved**: `docs:check`
  guards paths inside this repo and cannot see `~/.claude/skills/`.
- **The FC levelled path (guitar, bass, piano) targeted for 2027 — what the
  skills layer can and cannot contribute.** The skill × level matrix per
  instrument is buildable now and is **one input, not the syllabus**. Trust its
  structural findings (bass Debut is one song; Grade 6 is thin on every shelf; no
  reading strand exists for guitar or electric) and distrust its blank cells, for
  the reason recorded above. The intended sequence is **December distillation
  first, commissioning briefs second** — briefs written before then rest on tags
  no tutor has confirmed. Booked as `planning_song_loop_distillation` in
  `Planning_Items`, target **2026-12-07**, owner Finn, with a stop condition in
  its notes: under ~40 `Song_Outcomes` rows across more than one tutor, re-book
  rather than run. Recipe: `docs/plans/parked/song-loop-distillation.md`.
  **The test that decides whether the skills layer earned its place:** can you
  ask a question about a student that names a skill and get a true answer —
  *"has this student met syncopation before, and how did it go?"* If December's
  data supports that, the aggregate views (skill history per student, "what
  next" by skill overlap) become worth building. Until then they would be built
  on an unconfirmed draft, and a confidently wrong suggestion costs more trust
  than no suggestion.
- **Notes access lifecycle, not notes brute force.** The realistic way practice
  notes reach the wrong person is that the code lives in the WhatsApp group
  description, so anyone ever in that group keeps access until it is reset — a
  tutor who moves on, a family who leaves. Worth deciding whether code rotation
  should be part of tutor changeover and student exit. This is a rollout and
  lifecycle question, not a cryptographic one.
- **Parent message angle for the notes rollout:** the current WhatsApp template
  is safe placeholder copy, not the final campaign wording. Agree the parent
  framing with Finn before starting real-family rollout, then update the one
  template helper and its focused assertion listed in the
  [rollout handoff](./workflows/practice-chat/student-notes-access.md).
- **Practice Chat transcription security:** the current PWA can receive the raw
  OpenAI key from the relay. Complete the staged server-side transcription
  cutover, remove `/api-key`, and rotate the exposed key in a no-lessons window.
  See [the active hardening checklist](./plans/active/practice-chat-whisper-hardening.md).
- **Cover test cleanup:** before 22 July, check MMS event `evt_zsGLw6J0` at
  14:00 and restore Tom unless Dean is genuinely covering. This is a manual MMS
  check; automation remains parked in [the cover note](./plans/parked/cover-loop.md).
- **Song placements, before an overlapping RSL 2026 work is added.** The first
  2026 intake had no same-instrument work collision, so visible year tags were a
  safe interim choice. A level is still a property of a (song, framework) pair,
  not of a song: the current shape cannot represent one acoustic work at two
  grades without duplicating its ID and splitting history. Implement the phased
  [song placements](./plans/active/song-placements.md) migration before that
  overlap arrives or assignments need to record a student's exam framework.
- **Student paths:** decide whether current use justifies RSL Grade 7–8 ingestion,
  recommendation/progress work, or fretboard/chord paths. Finn must still create
  the missing Soundslice slices listed in
  [song coverage](./reference/song-catalogue-coverage.md).
- **Tutor payroll Phase 3:** scheduled statement delivery and tutor-selected
  cadence remain gated by persistent tutor auth/contact email.
- **Pause clarity:** distinguish Pause History, sheet expectation, and live Stripe
  evidence more clearly without adding Stripe mutation to Issues.
- **Tutor dashboard auth pilot:** the canonical service now has a reversible
  Google-login pilot for the shared Finn/Tom `musiclessons` account, with full
  tutor selection. The legacy `efficient-sparkle` dashboard stays public during
  the pilot, so the security transition is not complete. After usability checks,
  pilot one exact-email scoped tutor and then close/redirect the legacy route.
  See the [active pilot plan](./plans/active/tutor-dashboard-auth-pilot.md).
- **Incoming-message follow-ups:** settle retention/lawful-basis wording, capture
  the lesson group during onboarding, add removal for sibling mappings if needed,
  prune the ineffective inactivity-timestamp path, and separately review/remove
  the pre-hardening `launchagent.out.log`/`launchagent.err.log` files that may
  contain message previews. Do not assume the new bounded logger removes those
  legacy files.
- **Practice Chat operational check:** use one approved real note to verify the
  recipient, MMS attendance, Gmail ID, Sheets audit, PostgreSQL claim, and
  duplicate response after relevant delivery changes.
- **Activate Practice Note song capture in the Firebase PWA:** the desktop
  side-panel review, exact-title suggestions, catalogue search, unlisted-title
  escape hatch and handoff are built/tested in its separate repository; review,
  commit and deploy that project independently. Keep suggestions unselected and
  deterministic: titles such as *Perfect*, *Yesterday* and *Creep* make fuzzy or
  context-free matching look precise while producing false history.
- **Monolith splits:** remaining candidates and extraction discipline live in
  [the active split map](./plans/active/monolith-split.md).

## Deliberately not next

- heavy assignment, ownership, CRM, or generic workflow systems;
- WhatsApp auto-send or general automated parent messaging;
- Stripe mutations from Issues or model output;
- a database rewrite before measured Sheets limits justify one;
- direct edits to generated portal configuration files;
- hardening student-notes unlock beyond the current per-IP limit. The unlock
  rate limit buckets on the caller-supplied leftmost `x-forwarded-for`, so a
  rotating header would defeat it. Reviewed 2026-07-27 and accepted: the
  existing limit already stops the realistic case (someone typing a few
  guesses), while the bypass needs a scripted attacker deliberately targeting a
  child's practice notes. A per-student cap would close it but lets one attacker
  lock a real family out of their own notes, and correcting the header hop
  depends on Railway's proxy topology — a wrong guess buckets every visitor
  together. Both costs exceed the risk. Behaviour is pinned in
  `tests/admin/student-notes-rate-limit.test.mjs`; revisit only if the data
  behind the code stops being practice notes.

## Fragile contracts

Do not change these without updating their parser/consumer and focused tests:

- MMS sign-up labels `Preferred days` and `Preferred times`;
- the Google Sheets `Students` header row;
- MMS attendance status strings used by payroll;
- Wise CSV column order and money rounding;
- exact pause-note date labels used by pause forecasting;
- scheduled GitHub workflows, which can stop after prolonged inactivity.

Before deployment, follow [AGENTS.md](../AGENTS.md) and the
[operations runbook](./operations/runbook.md). Keep this file short: when detail
becomes durable, move it to the focused canonical document and leave only the
current decision or status here.
