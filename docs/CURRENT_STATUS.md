---
status: canonical
audience: [human, agent]
last_verified: 2026-09-17
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

- **Song cards show three distinctive skills, and the capo tags are gone —
  2026-09-18:** eight more RSL Acoustic 2026 slices catalogued (Grade 2 ×4,
  Grade 3 ×4; Surfer Ticket, December, Restless pinned as verified Originals).
  Looking at the shelf showed two problems. All seven `capo` tags were wrong:
  the July seeding agents described the original recordings, not the RSL
  arrangements, and no backed-up score mentions a capo. And cards listed every
  skill A–Z, so whatever sorted first led and the near-universal ones (steady
  pulse, dynamics, strumming, open chords — ~35 songs each) filled every card.
  Cards now show at most three, rarest across the catalogue first
  (`cardSkillLabelsForSong`), full list on hover; the tags themselves are
  unchanged. Policy: a tag must be true of the arrangement — what can't be
  checked is left off. Next: derive metre from the MusicXML scores, which
  already disagree with 36 time-signature tags.
- **Student records show an age — 2026-09-18:** the student list has an Age
  column and the record header leads with it. MMS stays the only home for the
  fact — no new sheet column: an exact `DateOfBirth` set in MMS wins; otherwise
  the sign-up form's "Students Age" note line is rolled forward by whole years
  since `DateStarted` and shown as `~12` (hover gives "9 at sign-up (Mar 2024)").
  A sibling form ("9 and 6") shows nothing rather than a guess. One cached
  all-students read (6h TTL, ~1s cold) feeds both pages and never fails a
  render. Students who predate the form show `—`; typing a DOB into MMS fixes
  them. `lib/admin/student-age.mjs`.
- **A household can have two parents and two payers — 2026-09-17:** Calan
  Clacherty's separated parents split his fees. Two flat assumptions surfaced.
  MMS holds `Family.Parents[]` and `buildPracticeNoteEmailRecipients` was already
  plural, but four consumers took `[0]`, so adding the second parent in MMS meant
  one of them silently received nothing. Practice notes now send once with the
  first MMS parent on `To:` and every other on `Bcc:` — chosen over two separate
  emails and over both on `To:` so neither separated parent sees the other's
  address or can reply-all to them — recorded in
  `Practice_Notes_Log.bcc_recipient_emails`, with Practice Chat naming who is
  copied before the tutor confirms. Separately, Stripe cannot split a
  subscription across two cards, so a split household is two subscriptions and
  `Students` has room for one. New read-only `Split_Billing` tab records the
  additional payers as **links, not money**; `Students` keeps the primary payer
  so Payment Pause, pause and issue detection are untouched. The amounts cache is
  now one row per subscription and `buildStripeAmountsMap` sums them; collected
  invoices match every payer. That last one is the point: without it a correct
  arrangement would report Clare's payment as unmatched money every month
  forever, and a reconciliation gap that is always there is one nobody reads.
  The household keeps its existing alternating plans — two full-price
  fortnightly subscriptions — rather than moving to half-weekly:
  `mapSubscriptionToAmounts` divides by `interval_count`, so both shapes reach
  the same weekly figure and no code prefers either. The cost is operational —
  a cancellation falls in one parent's week, and pause reaches the primary
  subscription only.
  Deferred: the FC identity layer still knows one parent — `generate_fc_ids.py`
  builds from the Sheets `Students` tab, not MMS, so it needs a source first.
  Plan: `docs/plans/active/two-payer-households.md`.
- **Payment setup completion now closes the dashboard loop — 2026-09-17:** Alma
  Freeth remained on Overview after her Stripe setup was fixed because the live
  `Students` row still explicitly said `payment_expectation = setup_pending`;
  the Brain/registry does not own that field and the dashboard was correctly
  preserving the human workflow state. A read-only live check confirmed her
  customer and active subscription, paid invoice, successful payment and no
  Stripe issues, then her expectation was changed to
  `stripe_active_expected` with an `Event_Log` audit row. The setup queue now
  offers **Verify and mark complete** only when both Stripe IDs exist. The
  reviewed click reads live Stripe, evaluates the evidence as active-expected,
  refuses missing/not-billing/problem states, then uses the existing audited
  student update with stale-state guards. It never changes Stripe and a generic
  Brain/Sheets refresh is deliberately not offered: refresh was not the missing
  operation.
- **The WhatsApp inbox now backfills after an outage and records the gap —
  DEPLOYED 2026-09-16:** cancellations were missing because the bridge is a local
  process that receives live push events and **never catches up** — its README
  says history is not posted, so a message missed is missed permanently. Five
  days of logs showed 7% of the period with nothing running, including
  **20:18–22:53 on Friday 11 Sept**. A refresh button was the wrong fix: Railway
  has no WhatsApp access, so it would always have truthfully said "nothing new".
  Instead `catchUpFromHistory` posts the recent part of a reconnect replay
  (24h/200-message bounds, `BRIDGE_CATCH_UP*`), reusing `maybeAutoCapture` so the
  confirmed-group gate and dedupe apply by construction. Safe because capture is
  already idempotent server-side — the bridge comment claiming otherwise had aged
  out. And because a live health check answers "is the bridge up?" (always yes by
  morning), a heartbeat arriving >90 min late now writes that window to
  `Bridge_Status.raw_json` and the inbox shows it **even while healthy**. Ninety
  minutes = three heartbeats, so ordinary restarts (26 in five days) stay quiet.
- **The note format is now a contract both renderers are held to — DEPLOYED
  2026-09-15:** a tutor's note is turned into HTML twice, by two separate
  implementations — Practice Chat for the tutor's check, the dashboard for the
  parent's email and the portal. Nobody sees both, so drift would mean the tutor
  approves one thing and the parent receives another. They agreed on all 17
  sampled notes, so this guards an unbroken contract rather than fixing a bug.
  `tests/fixtures/note-markup-contract.mjs` is mirrored byte-for-byte in both
  repositories and **each side tests only its own renderer**, so it runs on both
  CIs with neither needing the other checked out. `docs:check` compares the two
  copies locally and warns (never fails — Practice Chat is absent on CI).
  Generated from the behaviour the two already agreed on, so it records what is
  true. Verified by breaking each renderer on purpose and watching it fail.
  **Also found:** `test:admin` globbed only `tests/admin/`, so 16 root-level
  tests had never run on CI; the glob now covers both (1,668 → 1,684).
- **Practice Chat lost its pilot-era scaffolding — DEPLOYED 2026-09-15:** three
  live error messages in `previewPracticeNoteMmsTestWrite` still named the pilot
  account, so a tutor whose real student had no attendance record was told the
  lesson could not be found for "Test Studenty" — a real student's failure
  reported under a test account's name. They now name the student in front of
  the tutor, and `tests/admin/pilot-artefact-census.test.mjs` refuses the
  placeholder anywhere in `lib/admin` or `app` (a scan, because the strings live
  in functions that need MMS, Gmail and Sheets to call). The attendance panel
  also lost its "Lesson admin pilot" heading and its three-item "next steps"
  list, which narrated the controls directly beneath it. **Correction to an
  earlier review:** the "Take Attendance → MyMusicStaff" fallback is **not**
  dead — it is the whole flow for a bookmark launch with no dashboard context,
  and its reminder stays. Its comment, which called it the "Test Studenty pilot"
  fallback, was the thing that was wrong.
- **A shared lesson can be finished in one action — BUILT, NOT DEPLOYED
  2026-09-15:** taking attendance for a group through Practice Chat meant doing
  it twice, and the tool offered each sister a *different* lesson — it picks each
  student's latest unrecorded record, so Athena resolved to 8 Aug and Sophia to
  12 Sept. `POST /api/practice-notes/group` pins the lesson from the launched
  student's event and reads every other member from that same event, which is
  exact: one MMS event carries one attendance record per student. It is a layer
  over the single-student path — each member keeps its own delivery key, claim,
  attendance write and log row, delivered one at a time, and a member that fails
  never blocks the rest. **One email per household:** both sibling pairs share
  one parent, so recipients dedupe by address and the carrier names everyone it
  covers; the rest record `covered_by_group_email`. The server owns that
  grouping and the PWA sends no recipient field, because a client bug there means
  a duplicate email to a parent. An `orchestra` lesson marks everyone and emails
  nobody. Partial is its own reported state. The live single-student route was
  deliberately **not** refactored to share code: it has no route-level tests and
  it emails real parents. Contract:
  `docs/workflows/practice-chat/delivery.md` → Shared Lessons.

## Current operating contracts

| Area | Current boundary |
|---|---|
| Context | Student lifecycle, schedule, payment value, and capacity summaries are derived/read-only. They do not become provider truth or authorise actions. |
| Issues detective | The generated opinion is optional wording over the deterministic case file. A one-button resolution is selected by code from an allowlist of existing issue actions, never by the model; the human press is approval, stale-state checks fail with 409, and normal action logging remains authoritative. |
| Navigation | Overview orients; Planning holds due work, reflection, notes, and initiatives; Workflows holds specialised and recurring processes; Issues handles detected exceptions. Persistent navigation visibly identifies the current section. Student records are reached through search and workflow links. |
| Capacity | MMS `Free` events remain source truth. Waiting-list matches are hints filtered by instrument, never reservations or automatic assignment. |
| Planning | `Planning_Items` is human work state, not a project-management or workflow engine. Friday reflection, Monday scheduling, month-end expense reconciliation, and the pre-newsletter Mailchimp audience check are seeded planning prompts. |
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
- **Tutor payroll Phase 3:** the source now has verified payroll contacts,
  one-at-a-time admin-previewed Gmail delivery, admin-recorded existing
  weekly/biweekly choices, Monday–Sunday periods, a confirmation-gated one-off
  cutover through 20 September 2026, and a complete-cadence due guard. Live rollout
  remains gated by populating verified contact/cadence data and proving the manual pilot;
  scheduled delivery and WhatsApp reminders remain unbuilt.
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
