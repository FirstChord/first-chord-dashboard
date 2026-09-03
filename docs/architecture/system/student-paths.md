---
status: canonical
audience: [human, agent]
last_verified: 2026-07-20
---
# Student paths and song assignments

This is the current architecture contract for catalogue songs, reusable paths,
tutor assignments, and the student-portal song view. Current repertoire counts,
known gaps, and ingestion work live in
[Song catalogue coverage](../../reference/song-catalogue-coverage.md).

## Live model

| Concept | Meaning | Owner |
|---|---|---|
| Song | Reusable, curated teaching item with an FC ID and one Soundslice slice reference | `lib/config/songs-catalogue.mjs` |
| Path template | Hand-curated ordered list of catalogue song IDs for an instrument/level | `lib/config/path-templates.mjs` |
| Assignment | One student's current relationship to one song | `Song_Assignments` |
| Status history | Best-effort evidence of assignment status changes | `Song_Status_Log` |
| Request | Tutor request for repertoire missing from the catalogue | `Song_Requests` |
| Outcome | Optional tutor reflection when a song is done or parked | `Song_Outcomes` |

A student's path is not a separate stored entity. It is the ordered set of that
student's assignment rows. Assigning a template copies its steps into assignments;
the tutor can then reorder, park, or add songs independently. Later edits to the
template never rewrite existing student assignments.

## Ownership and boundaries

| Data | Authority | Lane |
|---|---|---|
| Notation, recordings, slice availability | Soundslice | External truth |
| Catalogue metadata, teaching notes, tags, series, levels | Repository catalogue | Canonical, hand-curated |
| Reusable path order | Repository path templates | Canonical, hand-curated |
| Assignment status and order | Google Sheets | Workflow state, keyed upsert |
| Status/outcome history | Google Sheets | Append-only evidence |
| Student identity and live tutor assignment | MMS | External truth |
| Portal configuration and per-student Soundslice course URL | Student registry | Canonical portal config |

The catalogue is in Git because it changes at editorial pace and benefits from
reviewable diffs. Assignments are in Sheets because tutors change them live and
the volume is human-paced. Exact headers, writers, keys, and retention are in
[the state-tab contract](../data/state-tabs.md).

```text
Soundslice list export
  -> human curation
  -> repository catalogue and path templates
       -> tutor browses and assigns
       -> keyed Song_Assignments write
       -> student portal reads its own active assignments
       -> status/outcome evidence informs later curation
```

## Catalogue contract

`lib/config/songs-catalogue.mjs` is canonical and is not generated. Each entry:

- has a stable `fc_song_*` ID;
- uses declared instrument, series, level, and content-type vocabularies;
- stores only `soundslice.scorehash`, never a raw slice URL;
- derives the playable URL through `lib/songs/catalogue-helpers.mjs`;
- contains no student names or private notes because it ships in the client bundle;
- points to a slice whose secret link is enabled and verified;
- has a MusicXML backup made through the external Soundslice toolshed before merge.

`artist: 'RSL'` is an explicit needs-curation marker for syllabus originals or
unverified attribution. Never replace it by guessing.

**The `fc_song_*` ID is permanent** — never renamed, never reused, never retired.
Every accumulated fact about a song (assignments, status transitions, outcomes)
hangs off it, so a new ID for what is musically the same piece silently splits
its history in two.

That invariant is what makes the current one-`level`-one-`series` shape a
problem: a song placed at Grade 3 in one syllabus and Grade 4 in its replacement
cannot be expressed without duplicating the ID. **A level is a property of a
(song, framework) pair, not of a song.** The first RSL Acoustic 2026 intake was
safe to add without that migration because none of its available arrangements
duplicated an existing acoustic catalogue work. Finn chose to keep both books on
the same grade shelves, identified by visible plain-text filing tags. That is an
interim display decision, not a replacement for the placement model: implement
the phased migration in [song placements](../../plans/active/song-placements.md)
before ingesting an acoustic work that moves between syllabuses or recording a
student's exam framework at assignment time.

Per-student Soundslice courses and the shared slice catalogue are separate
surfaces. Soundslice exposes no usable course API, so this system does not create
or populate student courses. Existing course links remain available alongside
assigned songs.

## Assignment and path behaviour

`assignment_id` is deterministic: `<mms_id>_<song_id>`. Reassigning a song
upserts the same row and preserves its original assignment time, status, and
order. Status is one of:

```text
assigned | working | ready | done | parked
```

Parked rows remain as workflow history but sit outside active ordering. Reordering
normalises a student's sequence and skips parked neighbours.

Finishing and shelving are separate acts and each gets its own one-tap control.
The status chip walks `assigned → working → ready` only; `done` and `parked` are
the two exits. This is a correction, not a preference: while `done` was the
fourth step of the chip's cycle the school recorded **zero** of them in a month,
and park — one tap, always visible — collected songs tutors had actually
finished. Read pre-August 2026 `parked` rows accordingly; some of them mean done.

## The note is the second door onto the shelf

A song a tutor confirms in a Practice Note is added to that student's shelf
(`syncNoteSongsToShelf`). The shelf already fed the note — a student's assigned
songs are the note's song picker and its transcription prompt — but nothing fed
back, so a tutor saying "we worked on this" produced a link no shelf reflected.
Both of the first two linked notes named songs the student had never been
assigned. Note-taking is the lower-friction capture path, so it has to be able
to create the fact rather than only reference one.

Three rules keep the weaker door from degrading the stronger one:

- **Create only.** An existing assignment keeps its status, order and
  provenance. Evidence gathered next to prose may add a row; it may never
  restate a tutor's own status. A `done` song mentioned in a recap stays done.
- **Confirmed catalogue ids only.** `unlisted_song_titles_json` must never reach
  this path — those are explicitly observations, not Song facts.
- **`assigned_via` records the door.** The Practice Chat routes authenticate
  with a shared app secret rather than per-tutor identity, so `assigned_by` on a
  `note` row is self-attested. The label keeps that visible in the data instead
  of blurring it into rows written from a verified token.

New rows are born `working` rather than `assigned` — the note is evidence the
song was in front of the student that lesson — which also carries them into the
next lesson's transcription prompt. The write is best-effort after the note is
stored and can never fail it: the note is what the tutor spent a lesson making.

Path instantiation is idempotent. Existing songs are adopted without resetting
their status or order; new steps append in template order and receive `path_id`
and `step_label`. A template is a starting sequence, not a synchronised syllabus.

Status-log writes happen after assignment writes and are best-effort. A missing
log row must never invalidate a real assignment or be treated as proof that a
transition did not happen. Outcomes are curation evidence, not a tutor scorecard
or complete ledger.

## Tutor and portal trust boundary

The public tutor dashboard still trades stronger identity for low friction. Song
reads and writes use the per-student signed tutor-surface token. The server takes
`assigned_by` or `recorded_by` from the verified token payload, never the request
body, and validates student/song/path references before writing.

That token proves access to the selected tutor/student surface; it is not durable
per-tutor authentication. Do not extend this route into consequential school,
payment, attendance, or communication actions without tutor auth.

Student portal song reads are enrichment and fail safely. A Sheets failure or a
catalogue row removed after assignment returns no affected songs rather than
breaking the portal. Parked assignments are hidden; the student's existing
Soundslice course link remains.

## Requests and learning loop

A search miss can append a `Song_Requests` row. The dashboard does not resolve
requests: the catalogue-curation workflow adds or declines them and records the
result. Duplicate human requests are acceptable evidence of demand.

Optional outcomes (`cruised`, `about_right`, `battle`, and/or a short note) and
status durations can inform termly catalogue-note and path-order changes. Use the
[parked distillation plan](../../plans/parked/song-loop-distillation.md); do not
turn raw telemetry directly into canonical teaching guidance.

## Skills: what a song teaches

A song is a vehicle; the thing that transfers between songs is the skill. Skills
live in `lib/config/song-skills.mjs` as a vocabulary (`SONG_SKILLS`, grouped by
`SKILL_AREAS`) plus a mapping from the tags catalogue entries already carry.

This was **derived, not migrated**. The catalogue already held sixty-eight
distinct tags across two hundred and thirty songs, roughly two thirds of them
describing a skill rather than a category; nobody had separated the teaching
vocabulary from the filing vocabulary, so none of it was usable. No catalogue
entry had to change. A song may still declare `skills` explicitly and that
always wins.

`NON_SKILL_TAGS` names the filing tags on purpose, so "deliberately not a skill"
stays distinguishable from "nobody has classified this yet". A test fails when a
new tag is neither, which is how the next batch of songs gets noticed.

One structural inference only: `contentType: 'scale'` teaches `scales`. Not
`exercise` (which covers riffs, chords and technique alike), and never anything
read out of a title or a tutor note — guessing skills from prose manufactures
confident wrong data at catalogue scale. Coverage is therefore partial by
design: `node scripts/song-skills-report.mjs` shows the gaps, with each song's
tutor note alongside so a human can pick the right tag quickly.

**Judge coverage per instrument, never as a catalogue average.** A tutor looks
at one instrument's shelf, so an instrument at zero is a blank feature for them
however healthy the total. This shipped at 41% overall with **Bass and Electric
Guitar at zero** — tagging had been done instrument by instrument and those two
were never started, so the bass tutor saw an empty card every time. The
catalogue-wide number hid it and the first test measured exactly that number.
`INSTRUMENTS_WITHOUT_SKILLS` in `tests/admin/song-skills.test.mjs` now names the
untagged instruments explicitly and fails in both directions: if a listed
instrument is fixed without the list being updated, and if any unlisted
instrument goes blank.

Skills are the layer every later difficulty-rating or sequencing idea needs.
"This student has met syncopation four times and struggled each time" is
unanswerable while the unit of knowledge is the song.

## Teaching history: the read side of the loop

`buildSongTeachingHistory` (`lib/songs/teaching-history.mjs`) reduces
`Song_Assignments`, `Song_Outcomes` and `Practice_Notes_Log` song links to one
answer per song — who has taught it, to how many students, and what they said —
served by `GET /api/song-history` and shown on the Song Browser card.

It exists because until August 2026 all four song lanes were **written and never
read**. A tutor who parked eight songs and wrote three careful outcome notes got
nothing back, which is the whole reason capture stayed at three rows. Any new
song telemetry should reach this function or justify why it is worth collecting.

Two boundaries are structural:

- **No student leaves the builder.** Outcome notes are written about a real child
  in a real lesson, so the output has counts and tutor words and nowhere to put a
  student. Callers cannot opt back in. Test students are excluded by the route.
- **Per song only.** `docs/policies/data-protection.md` forbids turning
  tutor-linked outcomes into performance ranking, so tutors are ordered by
  experience *of that song* (who to ask) and never totalled across songs.

A song with no history renders nothing rather than an empty state, so a quiet
card means "nobody has taught this yet", not "history is unavailable here".

## Code map

| Responsibility | Files |
|---|---|
| Catalogue and path truth | `lib/config/songs-catalogue.mjs`, `lib/config/path-templates.mjs` |
| Catalogue validation/filtering/URL derivation | `lib/songs/catalogue-helpers.mjs` |
| Assignment and path rules | `lib/songs/assignment-helpers.mjs` |
| Portal join and fail-safe read | `lib/songs/portal-songs.mjs` |
| Requests and outcomes | `lib/songs/request-helpers.mjs`, `lib/songs/outcome-helpers.mjs` |
| Cross-song teaching history | `lib/songs/teaching-history.mjs` |
| Song skills vocabulary and mapping | `lib/config/song-skills.mjs`, `lib/songs/skills-helpers.mjs` |
| Note-to-shelf sync (best-effort) | `lib/admin/practice-note-shelf-sync.mjs` |
| Sheets adapter | `lib/admin/sheets/song-assignments.mjs` |
| APIs | `app/api/song-assignments/`, `app/api/song-requests/`, `app/api/song-outcomes/`, `app/api/song-history/` |
| Tutor and student UI | `components/tutor-dashboard/SongBrowser.js`, `components/student-portal/StudentSongs.js` |
| Focused tests | `tests/admin/songs-catalogue.test.mjs`, `song-assignment-helpers`, `portal-songs`, `song-request-helpers`, `song-outcome-helpers`, `song-teaching-history`, `note-song-assignments`, `song-skills`, `paths-signal` |

## Change checklist

Before changing this system:

1. Confirm whether the change belongs to Soundslice truth, repository curation,
   assignment workflow state, or evidence logs.
2. Preserve the catalogue privacy test and the single URL-derivation helper.
3. Keep assignment writes token-guarded, validated, and idempotent.
4. Update `docs/architecture/data/state-tabs.md` for any header, writer, key, or
   retention change.
5. Run the matching focused song/path tests, the full admin suite, and the build.

Recommendations, a per-lesson progress log, or automated path changes remain
future work only if real use justifies them. Deterministic suggestions should
precede AI, and event-heavy history should not be added to Sheets by default.
