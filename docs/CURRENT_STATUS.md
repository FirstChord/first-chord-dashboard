---
status: canonical
audience: [human, agent]
last_verified: 2026-09-02
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

- **The lesson mirror now has a real read-only calendar and an exception lens —
  DEPLOYED 2026-09-02:** `/admin/lessons/calendar` renders one authenticated week
  from events re-seen in the latest fresh, exactly-counted MMS sweep. It defaults
  to student-bearing lessons, filters by tutor/type, resolves names on the server
  and removes MMS student/tutor aliases before rendering; stale, failed or
  out-of-window evidence produces no fallback calendar. The parity page now
  separates lessons from Free/Potential/Break rows, splits real lesson tutor gaps
  from placeholder gaps, compares non-observations with same-student replacements,
  and measures retained historical links and late attendance changes. The first
  live classification found 1,557 current lesson events, 198 Free rows, 72
  Potential holds, eight breaks, zero current lesson tutor gaps and 74
  lesson-shaped rows not re-observed; 30 current Free rows retain only older
  student links, so they stay free in the calendar. None of those counts means
  cancelled and the surface performs no MMS or workflow write.
- **Issues now open as detective case files with a bounded one-button resolution
  — DEPLOYED 2026-09-01:** **Ask the detective** always loads the checked,
  redacted rule and evidence; when the existing AI flag/key are configured, that
  same explicit click also adds one validated generated opinion. The model never
  chooses the action. `getDetectiveResolution` offers **Yes, solve it** only for
  the existing deterministic primary correction on `PAUSE EXPECTATION MISMATCH`
  and `PAUSE EXPECTATION STALE`, while a source-cleared case can be closed with
  the same reviewed gesture. Every other case says it still needs judgement and
  leaves the established action in place. Payment fixes now carry the payment
  mode/expectation the card was prepared from, and source-cleared closure carries
  expected `source_present = false`; either endpoint returns 409 rather than
  applying a stale decision. **No, reconsider** freezes the proposal and records
  only a fixed correction enum against the opaque AI request ID. Those pilot
  runtime logs can guide reviewed rule/test changes; they are not durable
  training data and the detective does not retrain itself. Vince character and
  visual identity are deliberately a later pass over this working contract.
- **Tutor banners in the Students sheet are merged cells, and the growth figure
  runs off `updated_at` — DEPLOYED 2026-08-31:** Michael Gemmell joined the
  roster (canonical `first-chord-brain/tutors.py`, regenerated into
  `lib/admin/tutors-data.js`), and adding his first students exposed two
  contracts now written down in [state tabs](./architecture/data/state-tabs.md).
  Each orange tutor bar is a merged range two rows deep across columns A–I, so
  the row beneath a banner is not a blank student row: the Sheets API accepts
  writes to A–G there, reports the cells updated, and keeps nothing. Add rows
  through `addStudentSheetRow`, which inserts a real row instead. Separately,
  `findTutorInsertRow` appends at the bottom of the sheet for a tutor with no
  existing rows, which is why a new tutor's first student lands outside their
  block until one row is moved under the banner by hand. The monthly joiner
  count buckets `Waiting_List_State.updated_at`, not the first lesson date, so
  the onboarding flow is the measurement: a student set up outside it is
  uncounted until a row is written deliberately.
- **A burst of messages from one parent is now one card — DEPLOYED 2026-08-29
  (`b76ab93`):** The bridge posts one inbox row per WhatsApp message and that
  stays canonical, but three messages sent in one breath were three cards to
  tick. The view now clusters consecutive messages from the same sender, chat
  and matched student within five minutes into one stack shown oldest-first.
  The **lead** — the non-placeholder message with the highest actionability —
  is what Reply and Reply + Plan work from, while date extraction and the plan
  draft read the whole burst, because "Amy can't come" and "on Thursday" are
  often two messages. Handled / No action / Later / Delete apply to every row in
  the stack, so nothing is left open behind the message that was dealt with. A
  differing matched student splits the burst rather than merging two children's
  business; clustering runs after view filtering, so a stack never spans views.
- **The fortnightly Sheets backup now actually runs itself — LIVE LOCALLY
  2026-08-28 (`e93a49b`):** `com.firstchord.sheets-backup` had been installed,
  loaded and enabled since 11 June and had never executed once (`runs = 0`, no
  launchd logs ever written); every backup in `backups/sheets/` was manual. Two defects: a
  `StartInterval` restarts its countdown on every load, so a 14-day timer on a
  machine that reboots never fires; and the job ran `npm`, whose
  `#!/usr/bin/env node` shebang cannot resolve on launchd's default `PATH`. It
  now runs `node scripts/backup-sheets-tabs.mjs` on a `StartCalendarInterval` of
  the 1st and 15th, verified by a forced `launchctl kickstart` (`runs = 1`,
  exit 0, 36 tabs, 0 failed). The planning reminder moved from 14 to 17 days —
  the widest gap that schedule can leave — so the card is an alarm that the
  automation stopped, not a chore that cries wolf monthly. **Check `runs`, not
  `state`, when asking whether a launchd job works.**
- **A waiting-list suggestion now keeps its instrument through onboarding —
  DEPLOYED 2026-08-26 (`d9536cc`):** a sign-up note naming two instruments was parsed
  as a list by Waiting but collapsed to a single first-match label by
  onboarding, which then filtered the tutor list server-side and hid the very
  tutor whose slot was clicked. Both surfaces now share `parseInstrumentList`,
  the slot link carries the instrument its tutor was matched on, and onboarding
  trusts that over its own reading of the note. The instrument field is a
  dropdown over the canonical `STUDENT_INSTRUMENT_OPTIONS` list; the tutor list
  is filtered in the browser from the full active roster and a tutor who does
  not teach the newly chosen instrument is cleared rather than silently
  submitted. `generateFcStudentId` moved to `lib/admin/fc-id.mjs` so the
  normalisation helpers stay importable by client components.
- **Onboarding lost its dry run and its last manual-era label — DEPLOYED
  2026-08-18 (`825ea63`):** the read-only
  `POST /api/admin/onboard/preflight` endpoint and its "Run preflight" panel are
  deleted. Every state it reported is now enforced
  at submit and enforced harder: duplicates and partial canonical records block
  with a 409 before the first write, the selected Free slot is validated before
  any write, and MMS activation, billing profile and first lesson are all
  idempotent (`alreadyActive`, `alreadyExists`, `duplicateSkipped`). The one gap
  preflight genuinely covered is closed rather than kept — a sibling group's
  **second** student is now duplicate-checked before the primary is written, so
  it can no longer fail halfway and leave one sibling created. **A reintroduced
  dry run should be read as a sign the write path stopped being safe to press;**
  `tests/admin/onboarding-route-boundary.test.mjs` pins that. The
  `Name - WGCS` WhatsApp group label is also gone, along with the `wgcs` key in
  the onboarding response (now `messages`) — the welcome message and Soundslice
  follow-up are unchanged.
- **A preselected Free slot can now start a student weeks later — DEPLOYED
  2026-08-18 (`44ac3bf`):** the Waiting slot buttons pin one *occurrence* of a weekly
  Free event, and the capacity summary always collapses a slot to its soonest
  one, so choosing any start date past the next free week failed the exact
  date-equality guard and blocked the entire onboarding before its first write.
  A first lesson may now sit any whole number of weeks after the pinned
  occurrence, capped at 12. Two decisions keep that safe. The bumped week is
  confirmed against a live per-day MMS calendar search before anything is
  written, so a bump can never book over a slot taken since the suggestions were
  refreshed. And removal still deletes from the **pinned** occurrence forward,
  deliberately taking the free weeks before the start date with it: a weekly Free
  slot with a couple of occurrences left still advertises itself to the capacity
  matcher as a full weekly slot, and would be offered to a second student who
  collides with this one within a month. A different weekday or an earlier date
  is still refused, and the form now bumps in whole weeks and offers onboarding
  without the slot, rather than leaving a free-text date to drift out of
  alignment and dead-end the run.
## Current operating contracts

| Area | Current boundary |
|---|---|
| Context | Student lifecycle, schedule, payment value, and capacity summaries are derived/read-only. They do not become provider truth or authorise actions. |
| Issues detective | The generated opinion is optional wording over the deterministic case file. A one-button resolution is selected by code from an allowlist of existing issue actions, never by the model; the human press is approval, stale-state checks fail with 409, and normal action logging remains authoritative. |
| Navigation | Overview orients; Planning holds due work, reflection, notes, and initiatives; Workflows holds specialised and recurring processes; Issues handles detected exceptions. Persistent navigation visibly identifies the current section. Student records are reached through search and workflow links. |
| Capacity | MMS `Free` events remain source truth. Waiting-list matches are hints filtered by instrument, never reservations or automatic assignment. |
| Planning | `Planning_Items` is human work state, not a project-management or workflow engine. Friday reflection and Monday scheduling are seeded planning prompts. |
| Pauses | Generic completion never changes payment state. The guarded pause-completion action requires human confirmation, writes through the existing student route, and logs to `Event_Log`. For new guided tutor-absence cancellations, an undated paused-expected flag cannot suppress the dated structured pause card or unlock its final message; only an explicit per-lesson payment-not-needed decision takes the message-only path. |
| Messaging | Parent communication remains approval-first. `Communication_Log` means copied to send, not proven sent; inbound classifications and reply drafts remain proposals. |
| Practice Chat | All registered tutors are enabled unless temporarily constrained. The tutor self-attests, the student must have one clear tutor assignment, the final screen names the server-derived recipient, and PostgreSQL claims the delivery key before MMS/Gmail work. Ambiguous Gmail outcomes require manual follow-up. |
| Lesson mirror | Neon PostgreSQL holds rebuildable MMS observations and stable First Chord series/event/participation IDs. A daily bounded read populates the mirror; `/admin/lessons` exposes aggregate parity/exception evidence and `/admin/lessons/calendar` renders the latest verified week. Tutor Changes and first-lesson Planning consume the mirror as fail-open shadow context, but no operational workflow depends or acts on it. MMS remains schedule and attendance truth, and absence from a sweep never proves cancellation. |
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
- **Song placements, before the RSL 2026 songs are added.** A level is a property
  of a (song, framework) pair, not of a song: today a song has one `level` and
  one `series`, so a piece that sits at Grade 3 in the 2019 syllabus and Grade 4
  in the 2026 one cannot be expressed without duplicating its ID and splitting
  its accumulated history. Deciding the schema before the new songs go in is a
  schema choice; after, it is a migration of live data. Phased plan, invariants
  and open decisions in [song placements](./plans/active/song-placements.md).
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
