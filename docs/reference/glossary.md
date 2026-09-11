---
status: supporting
audience: [human, agent]
last_verified: null
---
# Glossary

Plain-English explanations of technical terms used in the admin dashboard. This is a general reference (not a dated change log) — add to it whenever new jargon appears. A mirror lives in the Obsidian "First Chord OS" vault (`09 Glossary`).

- **Path template** — a named ordered list of catalogue song IDs (`lib/config/path-templates.mjs`, canonical hand-edited). "Assign path" instantiates it into per-student `Song_Assignments` rows; the student copy is personal from then on.

## FC student ID

`fc_std_` plus eight hex characters, identifying one student enrolment across First Chord systems. It is **minted once, from the MMS student ID, and then stored** in the registry (with a copy in the Students sheet `FC Student ID` cell). The stored value is authoritative: nothing recomputes it, so it stays stable if a name, email or provider changes, and the brain's FC tabs read it rather than deriving their own. IDs minted before September 2026 came from a name/email seed and are not `sha256(mms_id)` — expected, not an error.

## Free slot, pinned occurrence, and week bump

A **Free slot** is a weekly recurring MMS calendar event in the `Free` category
with no student attached — the school's way of marking a tutor hour as sellable.
The capacity matcher summarises a slot by its **pinned occurrence**: the soonest
dated event in that series, whose ID is what a Waiting-page slot button carries
into onboarding. A **week bump** starts the first lesson a whole number of weeks
after that occurrence (up to 12) when a student cannot start immediately. The
bumped week is confirmed still free before anything is written, and clearing the
slot afterwards always runs from the pinned occurrence, so no fragment of the
series is left to be offered to somebody else.

## Incoming topic, intent, and actionability

An incoming message's **topic** is what it mentions, such as schedule, payment,
or summer break. Its **intent** is the communication shape—request, question,
notification, acknowledgement, social message, or unclear. Its
**actionability** is the workflow decision: action needed, reply needed, check
this, or no action. Keeping these axes separate means “hope you had a lovely
summer” can mention summer without becoming a pause task. Machine proposals and
human-final values are retained separately; only explicit accepts/corrections
count as reviewed learning evidence.

## Practice Note song link

An optional stable catalogue `songId` attached to one Practice Note after a
tutor selects it and the server confirms it exists in the canonical catalogue.
Practice Chat can propose exact-title matches from the note, prioritising the
current shelf, but proposals are never selected automatically. A raw title
outside the catalogue is stored separately as an unlisted observation for
review, not promoted into a Song fact. The stored catalogue title is only a
readable snapshot; the ID is the join. Blank means no explicit link, not proof
that no song was used. The dashboard does not infer liking from note prose.

## Code map, query, impact, and grid

The **code map** is a deterministic index generated from the current repository,
not a hand-written architecture claim and not model memory. Its browseable
**grid** is `docs/reference/code-map.md`: grouped rows showing a scoped module's
path, explicit `@fileoverview` description where one exists, exports with line
numbers, and tests that directly import it. Ordinary implementation comments
are excluded rather than guessed to be module purpose. The visible grid covers
`lib/admin`, `lib/songs`, and every Next route handler.

A **find query** ranks modules using the words in their path, explicit module
overview, exports, and direct-test paths. It is the quickest route from a domain
question such as “Wise payout” to a small set of current files. Its primary scope
is `lib/admin`, `lib/songs`, and Next routes. Exact path/export matches elsewhere
in the wider source graph appear separately as outside-scope fallbacks; a zero
primary result is not evidence that code does not exist. Find is a symbol/path
metadata index, not a file-body search, so implementation text and broad concepts
belong in `rg`. An **impact query** starts from one or more changed files and walks
the reverse static-import graph through `app`, `components`, `lib`, `scripts`,
and `tests`. It reports downstream consumers, related tests, scripts, and app
entrypoints, with distance meaning the number of import steps from the target.
With no paths, it uses the current git worktree changes.

These are navigation signals, not proofs. A direct test import does not prove
that the relevant behaviour is asserted; a blank test cell does not prove that
no indirect test exists; and a static graph can miss runtime-selected or
constructed relationships. The map narrows what an agent must inspect before it
reads the current code, focused docs, and tests. `npm run code-map:check`
regenerates the artifact in memory, checks the hand-authored Workflow Map, and
fails CI on drift or export syntax the parser cannot account for.

## Student lifecycle

Careful: **"lifecycle" means two unrelated things in this system.** The older one
is a student's *operational status* — active, waiting, paused, left — derived
from Sheets/registry/payment fields and shown on the student record. The newer
one is *time with the school*, from `Student_Lifecycle`. The tabs, the docs and
the UI keep them apart deliberately: the tenure line on a student record is never
labelled "Lifecycle".



**Tenure** is how long a student who is still here has been coming; **lifetime**
is how long a student who left actually stayed. Exactly one applies to any given
student, so the other stays blank — blank is meaningful, not missing.
**Departed** means inactive *and* nothing booked, because inactive with future
lessons is a pause. **Cohort survival** is the share of students who started in a
given year that were still attending N months after their first lesson, counting
only students whose cohort has had N months available — the naive alternative
(average lifetime by cohort) falls every year no matter what, because recent
starters cannot yet have lasted long.

## Song frameworks and placements

**Proposed, not yet built** — see
[song placements](../plans/active/song-placements.md).

A **framework** is any body of curriculum that places songs at levels: an exam
syllabus (RSL Acoustic 2026), a method book (John Thompson), or a school
qualification (SQA National 5). It generalises the current `series`. A
**placement** is one song's position within one framework — its level, and
optionally its order. One song may hold several placements, which is how a piece
sits at Grade 3 in a superseded syllabus and Grade 4 in its replacement without
its `fc_song_*` ID ever changing. `status` (current / superseded) belongs to the
framework, never to the song.

## Proposals inbox

The "machine prepares, human commits" pattern made concrete: a machine-produced suggestion (a **proposal**) sits in the generic `Proposals` tab until a human uses, edits or discards it — the machine never acts. A **lane** is one kind of proposal; V1's only lane is `incoming_reply` (suggested WhatsApp replies on open incoming messages). Proposals expire after 7 days and are **superseded** if the message under them changes or a fresh draft is made. Telemetry is derived, not stored: an approved proposal whose applied text matches the proposed text was *used unmodified* — the gate metric for adding a second lane.

## Notice window

Which band of the Lesson Cancellation Policy a one-off absence falls in, computed from the lesson date (from the message's own dates, else `Schedule_Context`) minus the message date: `seven_plus` (cancelled, not charged), `inside_week` (charged; Zoom-at-slot or practice video), `same_day` (charged; no video). If the window can't be computed, the ambiguity rule applies: a neutral acknowledgement that commits to nothing.

## Cover bank

The pool of tutors who have said (in a phone survey run by Fenella) whether they're happy to cover other tutors' shifts (yes/no — every cover is arranged by asking, so "maybe" carries nothing), on which days, and whether a same-day ask is OK or they need notice. Answers live in the `Cover_Bank_State` tab; the `/admin/workflows/cover-bank` page cross-references them live against teaching days from `Schedule_Context`, flagging (not hiding) tutors who already teach that day. External tutors — people not currently teaching at the school — can be added to the bank and exist only as `ext:<slug>` rows in that tab.

## Loading skeleton

A placeholder layout shown instantly while a page's real data is still loading — grey pulsing shapes where the real content will appear, instead of a blank or frozen screen.

- Admin pages fetch data (Sheets/MMS) on the server before they can render. Without a skeleton, navigation left the previous page frozen until data arrived. The skeleton gives immediate feedback so the app feels responsive.
- It is a **perceived-performance** technique — it does not make data load faster (caching does that).
- Implemented as `app/admin/loading.js`, a single Suspense fallback Next.js shows across the whole `/admin` subtree during navigation. The layout (nav/header) stays; only `<main>` swaps to the skeleton. A specific route can override with its own `loading.js`.

## Perceived performance

How fast something *feels* vs how fast it technically is. Skeletons improve perceived performance; caches improve actual performance.

## Cache / TTL

A cache keeps a temporary copy of data to avoid re-fetching. TTL ("time to live") is how long the copy is trusted before refetching.

- The Sheets read cache (`SHEETS_READ_TTL_MS` in `lib/admin/sheets/core.mjs`) is fresh for 60s, then uses bounded stale-while-revalidate for a short window. Recent stale rows can render instantly while the server refreshes the cache in the background; very old rows block for a fresh Google Sheets read. Dashboard writes call `invalidateSheetReadCache` for the affected tab, so the admin's own edits appear immediately. External writers are bounded by the hard max age.

## Sheets read budget

Google allows **60 Sheets read requests per minute per user**, and the whole app authenticates as one service account — so that single number is the ceiling for every page, route and cron together, not a per-module allowance.

- Exceeding it returns HTTP 429. Because `/admin` is `force-dynamic`, the failure lands on whichever page renders next rather than on whoever caused it, which is why the symptom is "random pages occasionally break".
- `lib/admin/sheets/core.mjs` counts real API reads (cache misses and retries — both spend quota) in a rolling minute and warns at 75%. That warning is the signal to cache or batch a caller; raising the threshold to silence it is the wrong move.
- The rule and its per-module tiers are in [Sheets read discipline](../architecture/data/sheets-reads.md).

## Stale-While-Revalidate

A cache pattern where the app serves a recently-stale value immediately, then refreshes it in the background for the next request.

- Normally First Chord uses this with a hard cap: past it, the caller waits for a fresh read rather than seeing something very old.
- **The payroll page is the deliberate exception** (`allowExpired`, 2026-07-29). A save re-renders that whole page inside its own POST, so blocking there meant the button's spinner waited on a ~950-row MMS fetch. It now renders whatever is cached *at any age* and refreshes behind the request — and says so in the header when what it served is past the usual cap, because cached context must show its freshness. "↻ Refresh MMS & recalculate" is the deliberate wait.
- **`staleOnError`** is the opposite bargain to `allowExpired`: it never serves stale while the source is healthy, but if the fetch fails it serves the expired copy rather than throwing. Ordinary Sheets reads use it, so a 429 degrades to slightly-old data instead of an error page. Forced (pre-write) reads deliberately do not — a write must fail rather than act on a copy it has already superseded.
- A write that knows exactly what it changed can **patch** the cache instead of dropping it (`patchScopeStale`) — recording attendance does this. Patched entries are marked stale, never fresh: the patch buys speed, not authority, and the source still gets the last word on the next read.
- It is meant for admin speed, not for replacing source-of-truth checks. If a workflow must know live MMS, Stripe, or a just-edited Sheet value, use an explicit refresh or direct source read.

## Timeout

A ceiling on how long one outbound request may take before it is abandoned with an error.

- Neither `fetch` nor the Google Sheets client has one by default, so before 2026-07-29 a stalled connection could hang an admin page **forever** — no error, nothing in the logs, just a spinner. That, rather than slowness, was the real "stuck until I refresh".
- Both now stop at 30s (`MMS_REQUEST_TIMEOUT_MS` overrides the MMS one without a deploy). Deliberately slack against a ~5s realistic worst case: a timeout tighter than a legitimately slow response turns a rare hang into a payroll that will not load at all.

## TotalItemCount

The count of matching records MMS returns alongside the rows on every `/search` response.

- Used to decide when a paged fetch is **complete**. The alternative — "a page smaller than we asked for must be the last one" — quietly assumes the endpoint honours the limit we send; if it caps below that, every page looks final and the result truncates in silence. On payroll that means a short total that looks entirely plausible.
- Because completeness is now checked against this number, page size is a speed decision rather than a correctness one. See `lib/admin/mms-pagination.mjs`.

## Lesson series, event, participation, and sync run

A **lesson series** is the stable First Chord identity for a recurring run of
lessons. A **lesson event** is one dated calendar slot. A **lesson participation**
is one student expected at that event, which is why a five-student group is one
event and five participations rather than five unrelated events. A one-off event
does not need a fabricated series.

A **lesson sync run** is the evidence envelope around one bounded MMS mirror
attempt: requested dates, MMS-reported and received totals, outcome and observed
entity counts. During the mirror/parity phases these SQL facts are retained MMS
observations, not authority to edit the calendar or reinterpret missing rows as
cancellations.

## Server component

A page rendered on the server (fetching its data there) before sending HTML to the browser. Most admin pages are server components — hence the data wait on navigation and the value of the loading skeleton.

## Prefetch

The browser loading a linked route before the user clicks (on hover/in-viewport), making the click feel instant. Next.js `<Link>` prefetches in production builds (not local dev), which is one reason the live dashboard feels snappier than `npm run dev`.

## Actuals (finance)

Real billing amounts read from Stripe subscriptions, as opposed to the price-table estimate. Cached weekly in `Stripe_Amounts_Cache`; a student priced from actuals shows `source: stripe_actual` in the finance figures.

## Calibration (finance)

The old aggregate comparison between a finance run-rate snapshot and monthly
Stripe collections. It remains as historical context, but it was not a strict
blind test and equal student errors could cancel.

## Blind Stripe test

One current-month forecast is locked in `Stripe_Forecast_Monthly` before the
Stripe refresh is allowed to read subscriptions or invoices. After month close,
`Stripe_Collected_Monthly` reveals the actual. **Net gap** compares the two
headline totals. **Student-level error** adds every per-student miss plus
unmatched Stripe money, so opposite mistakes cannot cancel. A forecast is
derived evidence, and the reveal is a provider cache; Stripe remains truth.

## Capture replay identity (incoming inbox)

An inbound row is identified by `source + chat_id + external_message_id`. A
repeated bridge post is therefore a no-op. Placeholder healing remains only as
legacy compatibility; the active confirmed-group bridge does not create or
recover starred-message placeholders.

## Eval fixture (incoming classifier)

The privacy-reviewed set of independent synthetic message cases (`tests/admin/fixtures/incoming-eval-set.json`) that `classifyIncomingMessage` is measured against. `npm run eval:incoming` prints classification, date and harmful-auto-archive results; the test suite pins minimum floors so rule changes cannot silently regress. It is a development regression set, not a production holdout. Any later holdout built from reviewed outcomes must be de-identified, access-controlled and kept out of git.

## Auto-capture (incoming inbox)

The bridge posts live text/caption notifications from dashboard-confirmed FC
lesson groups (`source: whatsapp_group_auto`). Starring is not a capture path.
School-side messages stamp open items as reply evidence instead of creating
rows; no-signal parent messages land pre-archived.

## Route guard census (testing)

The sweep in `tests/admin/api-route-guard-census.test.mjs` that discovers every
`app/api/**/route.js` on disk and records which guard it applies — tutor
session, admin, signed token, shared secret, or declared public with a written
reason. It replaced a hardcoded seven-route list, so a newly added unguarded
route fails the suite until someone classifies it. It is a lint rule: it also
checks the tutor guard is reached before any data module call, but it cannot
show any guard works. Behaviour lives in
`tests/admin/tutor-auth-guard.test.mjs`.

## Sheet census (data governance)

A per-tab row-count reading taken during `npm run backup:sheets`
(`lib/admin/sheet-census.mjs` → `census.json` beside the manifest). It reports
row totals/deltas and ranks watched event-heavy tabs. Its purpose is to make any
future store migration evidence-led. See
[storage boundaries](../architecture/data/storage-boundary.md).

## Group-only student (tutor dashboard)

A student whose registry `instrument` is a group ensemble (currently `Ukulele Orchestra`). `excludeGroupOnlyStudents()` (`lib/tutor-dashboard-helpers.mjs`) keeps them out of the tutor dashboard's individual student list — they're taught as a group, so their group lesson still appears on the schedule timeline (display-only) but they have no individual card.

## Song object / song catalogue (student paths)

A song as a reusable structured object in `lib/config/songs-catalogue.mjs` — title, artist, instruments, level, contentType, tags, tutor/student notes, and a nested `soundslice.scorehash` as the only Soundslice reference. The catalogue is **canonical and hand-curated** (not generated; edit it directly, unlike the five registry-derived config files). It ships in the client bundle, so it must never contain student names — a test enforces this. Soundslice URLs are derived exclusively in `lib/songs/catalogue-helpers.mjs`. See [student paths](../architecture/system/student-paths.md).

## Scorehash (Soundslice)

Soundslice's stable ID for one slice (one piece of playable notation), e.g. `Yvmfc` → `soundslice.com/slices/Yvmfc/`. The catalogue references slices only by scorehash; a slice is student-viewable only when its secret URL is enabled (`status=3`), which `enable_secret_links.py` (Soundslice toolshed) sets, verifies, and logs at curation time.

## Rockschool Original (and the two meanings of `artist: 'RSL'`)

A piece **written for** the RSL/Rockschool syllabus rather than covered from a commercial recording (e.g. bass *Noisy Neighbour*, electric *Cashville*). It has no other artist, so `artist: 'RSL'` is its **true artist**.

This collides with the catalogue's other use of the same string: `artist: 'RSL'` is *also* the **needs-curation marker**, meaning "we could not find a trustworthy artist and refused to guess". **One string, two meanings** — you cannot tell them apart by looking, so `songs-catalogue.mjs` names the verified originals in comments. The settling source is the official RSL Awards syllabus page for the grade (`rslawards.com/products/…`), which **groups cover tracks separately from Rockschool Originals**. Piano's markers predate this distinction and are unverified — see `docs/reference/song-catalogue-coverage.md`.

## Song series

A body of repertoire with its own progression vocabulary (`SONG_SERIES` in `songs-catalogue.mjs`). RSL runs in **grades** (Debut→Grade 6); John Thompson's piano course runs in **books** (Book 1→Book 2). Each becomes a tab in the tutor Song panel. **Levels are only comparable inside a series** — Book 2 is not "above" Grade 6 — which validation and level-inference both enforce. `series` defaults to `rsl`, so adding one costs nothing to existing entries. A new exam board (Trinity) or method book would be a new series.

## INSTRUMENTS_WITHOUT_REPERTOIRE

The explicit, reviewed list (in `tests/admin/songs-catalogue.test.mjs`) of instruments a student may hold that deliberately have **no songs** — currently Voice, Singing, Ukulele Orchestra. Every entry is a person opening the Song panel to an empty shelf, so the list must be a conscious decision. A test fails if a student holds an instrument that is neither seeded in `SONG_INSTRUMENTS` nor named here. It exists because the empty-shelf bug shipped three times in one day (bass, the 38 blank-instrument students, then electric guitar) with nothing anywhere saying so.

## Song outcome

The tutor's optional one-tap answer ("How was it for them?" — *cruised it / about right / a battle*, plus an optional note) when a song assignment reaches `done` or gets parked, appended to the `Song_Outcomes` tab. Opinions with a timestamp, never workflow state — `Song_Assignments.status` stays the only current truth. Sibling tab `Song_Status_Log` records every status transition automatically ("free data before asked data"). Distilled slowly into catalogue `tutorNote`s and path ordering; read live by [song teaching history](#song-teaching-history).

## Song skill

What a song *teaches*, as opposed to what it is. A vocabulary of about thirty skills across five areas (technique, rhythm, harmony, reading, expression), defined in `lib/config/song-skills.mjs` and **derived from the tags catalogue entries already carry** — no entry had to change. `NON_SKILL_TAGS` names the filing tags (`exam piece`, `2025 syllabus`, genre) deliberately, so "not a skill" stays distinguishable from "not yet classified"; a test fails when a new tag is neither.

Only one structural inference: `contentType: 'scale'` teaches scales. Nothing is ever read out of a title or tutor note, because guessing skills from prose manufactures confident wrong data at catalogue scale — so coverage is partial by design and `scripts/song-skills-report.mjs` shows the gaps. Skills are the layer any later difficulty-rating or sequencing work depends on: while the unit of knowledge is the song, "this student keeps struggling with syncopation" cannot be asked.

## Song teaching history

What the school knows about teaching one song, gathered from every lane that records it — who has taught it, to how many students, what they said in an outcome note, and how often it appears in practice notes. Built by `buildSongTeachingHistory` and shown on the Song Browser card, so a tutor choosing a song sees colleagues' experience of it first.

Its point is reciprocity: the four song lanes were written and never read for their first month, so capturing well returned nothing. Two rules hold it honest — **no student identity leaves the builder** (counts and tutor words only), and it is **per song, never per tutor**, because ranking tutors on outcomes would poison the notes it depends on.

## `assigned_via` (the two doors onto a shelf)

Which route created a `Song_Assignments` row. `shelf` — a tutor assigned it in the Song Browser, where `assigned_by` comes from a verified per-student token. `note` — a tutor confirmed the song in a Practice Note, where the tutor name is self-attested because that route authenticates with a shared app secret. Blank means `shelf` (written before the column existed).

It exists so the weaker guarantee stays legible rather than being blurred into the stronger one — the same instinct as [`songIdSource`](#on-the-go) labelling a confirmed join apart from an inferred one. The note door is create-only: it can add a song to a shelf but never restates a status a tutor set.

## Song request

A tutor's one-tap "Request "X"" on a Song Browser search miss, appended as a `status='new'` row to the `Song_Requests` tab. The catalogue's intake queue — resolved during curation by the `add-song` skill (or a sheet edit), deliberately not via any admin page.

## Note markup

The three formatting markers a Practice Chat note may carry: `**bold**`, `_italic_`, and `- ` starting a line for a bullet.

- **The note is always plain text.** Tutors format in the PWA's rich editor, but the editor is *serialised* to these markers before anything is saved, hashed, emailed or shown. Nothing downstream ever receives HTML a tutor produced.
- Renderers **escape first, convert second**. Markers are ASCII, so escaping cannot touch them — which is how emphasis reaches a parent's inbox while a pasted `<script>` still arrives as visible text.
- Code that *analyses* the note rather than displaying it reads `stripNoteMarkers` output. Song matching compares titles exactly and the safety check works on word boundaries, so `**Clocks**` would silently stop matching `Clocks`.
- Contract and cross-repo warning: [State tabs → Format Contracts](../architecture/data/state-tabs.md).

## On the go

The line on the tutor notes card listing the pieces a student currently has in flight, with a distinct-lesson count and a start date.

- It is **mined from the student's own notes**, not from an assignment: a multi-word phrase recurring across two or more of their lessons, Title-Cased in the raw text.
- Mined phrases are matched against the song catalogue. **A match supplies both identity and name**, so spellings the transcriber got wrong collapse into one correctly-titled entry. A phrase matching nothing is shown exactly as the tutor said it, never corrected.
- Three guards stop it inventing things: a mishearing must share the word's first three letters, a phrase matching several *different* catalogue titles names none of them, and an ambiguous fragment may only resolve to a song the same student's other notes already name outright.
- So a wrong or duplicated entry is usually a **catalogue** problem — a missing song, or one title stored several ways — rather than an algorithm one. Rules live in `lib/admin/practice-summary-helpers.mjs`.

**`songIdSource` says how much the id is worth**, and consumers must check it:

| Value | Meaning |
|---|---|
| `confirmed` | A tutor selected this song in Practice Chat. A real join. |
| `inferred` | Matched from note text against the catalogue. A proposal, not a join. |
| `''` | No catalogue match; `label` is the tutor's own wording. |

Confirmed links are preferred wherever they exist and a confirmed song appears even when no phrase named it — mining needs a phrase to recur across **two** lessons, so it structurally cannot see a song taught once. Where both describe the same song the count is the union of both, with `confirmedLessonCount` recording how much of it is confirmed evidence; counting only confirmed lessons would drop a long-running piece to "1 lesson" the first time a tutor used the selector.

**Do not aggregate an `inferred` id as if it were a join** (cross-student counts, time-on-piece). Errors that are tolerable on one card compound across students. Mining is a bridge until confirmed links cover most recent notes, and it scales the wrong way: 18 of 299 catalogue titles are already fully contained inside another title, so a growing catalogue means more ambiguous refusals, not fewer.
