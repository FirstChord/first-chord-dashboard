---
status: canonical
audience: [human, agent]
last_verified: 2026-10-06
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

- **Practice Chat deploys go through GitHub again — 2026-10-07:** the repo's
  push-to-`main` workflow (tests, then Firebase deploy) had been bypassed since
  August: live code sat on an unpushed branch and was deployed by hand. `main`
  is now what is live; `firebase.json` also runs the tests before any manual
  deploy. The repo is **public**, so a real student id was removed from tests.
  Deploy = commit + push from `practice-chat`.
- **Practice-note wording check widened — 2026-10-07:** after a review of 271
  recent notes found one with sexual wording sent home, the PWA's send-time
  check now also covers sexual terms, milder swearing, drugs, insults and
  possible safeguarding disclosures. Disclosures get their own prompt ("tell the
  safeguarding lead", not "may have been misheard"). Measured on all 1,179
  logged notes: 0.7% flagged. Still flag-and-confirm, never a rewrite or block.
  Contract: `docs/workflows/practice-chat/delivery.md`.
- **Practice Chat transcription moves server-side — 2026-10-06:** the PWA
  no longer fetches the relay's raw OpenAI key. It posts the recorded audio to
  the dashboard's `POST /api/practice-notes/transcribe` (existing Practice Chat
  secret + origin gate, 10MB cap, model allow-list) and gets only text back.
  The dashboard, not the relay, was chosen because it already owns that gate,
  tests and CI, which lets the relay be retired. A bookmarked PWA (no dashboard
  context) now says so before recording; typed notes still work. The exposure
  only ends when the old relay key is **revoked** in OpenAI after rollout.
  Contract: `docs/plans/active/practice-chat-whisper-hardening.md`.
- **Warm practice-note emails — 2026-10-06:** Finn approved the tested design
  and requested a barely off-white card plus supported light-mode override.
  The opening is now 30px shorter after reviewing email width/type guidance;
  the fluid 560px card and note spacing are retained. Practice Goals now use
  the same unboxed layout as other sections, and the optional code reminder
  explains that First Chord set it up. Subjects put the student first and
  retain the school name with a middle-dot separator. Email headings, subjects
  and dashboard labels now use each covered student's first name, retaining
  compound given names and dropping instrument suffixes. Presentation changes at
  the email boundary; reviewed notes, recipients, tutor
  workflow and delivery identity stay unchanged. Household links are restricted
  to the server-derived students covered by that email. Previous-format rollback:
  `PRACTICE_NOTES_EMAIL_DESIGN_ENABLED=false`. Contract:
  `docs/workflows/practice-chat/delivery.md`.
- **Automatic attention checks for the existing open inbox — 2026-10-02:**
  approved by Finn with the current capture filters explicitly preserved.
  Jev checks quiet open bursts without per-card clicks; confident no-action
  suggestions appear in a visible Probably nothing group. Uncertainty remains
  in Needs attention, All stays available, and clearing is human Select/Mark done
  with Undo. Separate kill switch; bounded background/open-inbox producers never
  apply details or change status. Expanded synthetic checks: 17/19 triples,
  10/10 replies, zero false no-action/answered. Contract:
  `docs/architecture/ai/jev-inbox-resolution.md`.
- **Jev checks message details and captured replies — 2026-10-02:** manual
  **Check message** suggests topic, intent and actionability, and adds reply
  resolution in the same call when captured evidence supports it. Humans edit
  before **Apply details**; the narrow cell writer preserves open status, reply
  receipts and Planning links. Both features have separate kill switches;
  stale/uncertain evidence abstains. Synthetic live checks matched 14/14
  classification triples and 10/10 reply labels, with no false no-action or
  answered results. Contract: `docs/architecture/ai/jev-inbox-resolution.md`.
- **Buttons: only the pressed one speaks — 2026-09-26:** from an admin report.
  The button blueprint (`a499fda`) existed, but many buttons shared one busy
  flag, so a whole card or page said "Saving…" at once, and card errors showed
  in a banner off-screen. `usePressedAction` scopes the spinner to the pressed
  button; outcomes now show beside it (Issues, Planning, student record,
  WhatsApp inbox). All buttons get a CSS pressed state; server-action forms use
  `SubmitButton`; `ui-conventions.md` gained **A Way Back**. Payroll untouched
  (mid-redesign).
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

## Current operating contracts

| Area | Current boundary |
|---|---|
| Context | Student lifecycle, schedule, payment value, and capacity summaries are derived/read-only. They do not become provider truth or authorise actions. |
| Issues detective | The generated opinion is optional wording over the deterministic case file. A one-button resolution is selected by code from an allowlist of existing issue actions, never by the model; the human press is approval, stale-state checks fail with 409, and normal action logging remains authoritative. |
| Navigation | Overview orients; Planning holds due work, reflection, notes, and initiatives; Workflows holds specialised and recurring processes; Issues handles detected exceptions. Persistent navigation visibly identifies the current section. Student records are reached through search and workflow links. |
| Capacity | MMS `Free` events remain source truth. Waiting-list matches are hints filtered by instrument, never reservations or automatic assignment. |
| Planning | `Planning_Items` is human work state, not a project-management or workflow engine. Friday reflection, Monday scheduling, month-end expense reconciliation, and the pre-newsletter Mailchimp audience check are seeded planning prompts. The global dashboard-report control captures glitches and improvement notes as unassigned Inbox Ideas; its dedicated filter is the human triage queue. |
| Pauses | Generic completion never changes payment state. The guarded pause-completion action requires human confirmation, writes through the existing student route, and logs to `Event_Log`. For new guided tutor-absence cancellations, an undated paused-expected flag cannot suppress the dated structured pause card or unlock its final message; only an explicit per-lesson payment-not-needed decision takes the message-only path. |
| Messaging | Parent communication remains approval-first. `Communication_Log` means copied to send, not proven sent; inbound classifications and reply drafts remain proposals. The one automatic staff email is the newsletter arrival notice: one configured internal recipient (`NEWSLETTER_NOTIFY_EMAIL`), once per item, never a family. |
| Practice Chat | All registered tutors are enabled unless temporarily constrained. The tutor self-attests, the student must have one clear tutor assignment, the final screen names the server-derived recipient, and PostgreSQL claims the delivery key before MMS/Gmail work. Ambiguous Gmail outcomes require manual follow-up. |
| Lesson mirror | Neon PostgreSQL holds rebuildable MMS observations and stable First Chord series/event/participation IDs. A daily bounded read populates the mirror; `/admin/lessons` exposes aggregate parity/exception evidence, `/admin/lessons/exceptions` gives a bounded human-readable drill-down, and `/admin/lessons/calendar` renders the latest verified week. Tutor Changes and first-lesson Planning consume the mirror as fail-open shadow context, but no operational workflow depends or acts on it. MMS remains schedule and attendance truth, and absence from a sweep never proves cancellation. |
| Student portal notes | Profile URLs and non-note resources stay public. Practice Chat notes load through a separate no-store API; families are moved individually to memorable-code protection through the claimed admin rollout queue. A missing rollout row remains legacy-public, while an access-state failure fails closed. The memorable code is a light privacy guard proportionate to what it protects — a child's practice notes — not a defence against a determined attacker, and it is not sized to become one. |
| Finance | Sheets holds operating estimates/review state; Stripe and Wise remain provider truth. Exact-period payroll sending can be approved in advance when records are missing; fresh deterministic checks govern execution. Confirmation and payment remain separate human boundaries. PostgreSQL is delivery coordination only, not payroll truth. |
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
- **Practice Chat transcription security:** server-side transcription is live
  in both dashboard and PWA (2026-10-06). Remaining: **revoke the old relay key**
  in OpenAI once tutors have reloaded (from 2026-10-07), then retire the relay.
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
  cutover through 20 September 2026, an operator progress queue, future-period
  and unresolved-statement guards, and a complete-cadence due guard. Live rollout
  requires verified contact/cadence data. Scoped send-after-records delivery is
  built and its activation was approved on 5 October; blanket scheduled
  due-statement sending remains out of scope. A calmer payroll queue, mandatory
  confirmation, a direct prefilled WhatsApp reminder handoff, a link-free reply
  to open tutor queries and a checked Wise batch are built; sending requires
  either the immediate human press or one exact-period deferred approval.
  Production rollout and the Wednesday 09:00 UK cutoff were approved by Finn
  on 26 September 2026. Shared cadence starts 21 September: first weekly
  statement 28 September, first fortnightly 5 October; legacy coverage gaps
  remain explicit review blockers. See `docs/plans/active/tutor-payroll.md`.
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
