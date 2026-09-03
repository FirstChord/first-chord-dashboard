---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-03
---
# Song Placements

## Purpose

Let one song sit in several bodies of curriculum at once — at different levels,
with different validity — without ever changing its ID or duplicating its
history.

Written 2026-07-29 for a later session. It can be implemented cold: everything
needed to start is below.

## Decision update — first RSL 2026 intake

On 2026-09-03 Finn chose to put the available RSL Acoustic 2026 pieces on the
existing grade shelves and distinguish both books with visible plain-text
filing tags (`RSL 2026 syllabus`, `RSL legacy book`, or the existing
`RSL 2018 book`), with no new badge. This was safe for the first 25 arrangements:
none duplicates an existing acoustic catalogue work, so no song history was
split across IDs.

That decision unblocks useful repertoire; it does **not** solve the structural
problem below. Implement this plan before a later intake places the same acoustic
work in two syllabuses or at two grades, or before assignments need to answer
which exam framework a student entered under. Phase 3 is therefore editorially
started but not structurally complete.

## Why this is time-sensitive

RSL is publishing a new acoustic guitar syllabus. The old songs must stay (some
students are mid-way through the current one, and the material is still good),
the new ones must arrive, and a tutor must be able to tell which is valid for an
exam today.

Deciding the schema **before** those songs go in is a schema choice. Deciding it
after is a migration of live data. That is the whole reason this document exists
now rather than in December.

## The principle

> **A level is not a property of a song. It is a property of a
> (song, framework) pair.**

*Wonderwall* does not become a different song because RSL moved it from Grade 3
to Grade 4. It is one song, placed twice.

This is the same failure already fixed once in the Brain (see Learning Log
2026-07-28): an identifier that changes when you learn something new silently
orphans everything attached to the old one. Duplicating a song under a new ID
for the 2026 syllabus would split its outcomes, assignments and notes across two
IDs that nothing knows are the same piece.

**`fc_song_*` IDs are permanent. They are never renamed, never reused, never
retired.** Everything else about a song may change.

## What breaks today

Two concrete things in `lib/config/songs-catalogue.mjs`:

1. **A song has exactly one `level` and one `series`.** There is no way to say
   "Grade 3 in the 2019 syllabus, Grade 4 in the 2026 one".
2. **`SONG_LEVELS` flattens every series' levels and the code comments state
   "levels never repeat between series".** RSL 2019 `Grade 3` and RSL 2026
   `Grade 3` break that assumption directly. Any consumer resolving a level
   without knowing its framework becomes ambiguous the day the second syllabus
   lands.

The existing `series` concept is otherwise the right shape and this plan extends
it rather than replacing it: a series already means "a body of repertoire with
its own progression vocabulary" and already renders as a tab in the tutor Song
panel — which is exactly the "2026 tab" this needs.

## Proposed model

### Frameworks

A **framework** is any body of curriculum that places songs at levels. It
generalises today's `series` so that exam boards, method books and school
qualifications all fit one shape.

```js
export const SONG_FRAMEWORKS = {
  rsl_acoustic_2019: {
    name: 'RSL Acoustic Guitar (2019)',
    kind: 'exam_syllabus',
    instruments: ['Guitar'],
    levels: ['Debut', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'],
    status: 'superseded',
    supersededBy: 'rsl_acoustic_2026',
  },
  rsl_acoustic_2026: {
    name: 'RSL Acoustic Guitar (2026)',
    kind: 'exam_syllabus',
    instruments: ['Guitar'],
    levels: ['Debut', 'Grade 1', /* ... */],
    status: 'current',
  },
  john_thompson: {
    name: "John Thompson's Easiest Piano Course",
    kind: 'method_book',
    instruments: ['Piano'],
    levels: ['Book 1', 'Book 2'],
    status: 'current',
  },
  sqa_national_5_music: {
    name: 'SQA National 5 Music',
    kind: 'school_qualification',
    instruments: ['Guitar', 'Piano', 'Bass'],
    levels: ['National 5'],
    status: 'current',
    schoolYears: ['S4'],          // kind-specific, optional
  },
};
```

`status` lives on the **framework**, never on the song. Retiring a syllabus is
then one edit, not sixty — and it is impossible for two songs in the same
syllabus to disagree about whether it is current.

### Placements

```js
fc_song_wonderwall: {
  title: 'Wonderwall',
  artist: 'Oasis',
  instruments: ['Guitar'],
  contentType: 'song',
  tags: [...],
  tutorNote: '...',
  soundslice: { scorehash: '...' },
  placements: [
    { framework: 'rsl_acoustic_2019', level: 'Grade 3', order: 4 },
    { framework: 'rsl_acoustic_2026', level: 'Grade 4', order: 2 },
  ],
}
```

### Does it generalise?

| Case | How it fits |
|---|---|
| RSL 2019 → 2026 | Two frameworks, one `superseded`, one `current`. A song may appear in both, at different levels. |
| School exam set list (SQA etc.) | `kind: 'school_qualification'` with its own level vocabulary and optional `schoolYears`. A song can be simultaneously RSL Grade 4 and a National 5 set piece — two placements, no conflict. |
| Method books | Already works; `levels` are books. |
| Free-choice repertoire | **No placements at all.** A song with an empty `placements` array is valid and normal — most of the catalogue may end up here. |
| A song dropped from a syllabus | Its placement in the old framework stays. Nothing is deleted; the framework carries the `superseded` status. |
| Annual set lists that rotate | A new framework per year (`sqa_n5_2027`), same pattern as RSL. |

The test this model has to pass: **adding a new kind of curriculum must not
require a schema change, only a new `SONG_FRAMEWORKS` entry.**

## Assignments must record the framework they were made under

`Song_Assignments` should gain `framework` and `level_at_assignment`, captured
at assignment time and never rewritten.

Without this, a student who started RSL 2019 Grade 3 in September and is still
working it in March cannot be distinguished from one on the 2026 syllabus — the
catalogue would only be able to say what the song's placements are *now*. This
is the "record the situation, not just the decision" principle: an assignment is
a decision made under conditions that later change.

It also makes an exam-readiness question answerable — *are this student's pieces
still valid for the syllabus they are entered for?* — which is otherwise
guesswork the moment a syllabus turns over.

## Migration

Deliberately phased so nothing has to change at once, and each phase is
independently shippable.

**Phase 0 — decide.** Finn confirms the naming (`framework` vs keeping `series`)
and the framework list. Nothing is built until this is settled.

**Phase 1 — add placements alongside the existing fields.** Every catalogue song
gains a `placements` array derived from its current `series` + `level`. The
old `level`/`series` fields stay exactly as they are. A contract test asserts the
two representations agree for every song. **No consumer changes, no behaviour
change** — this phase is provably inert.

**Phase 2 — move consumers onto placement-aware helpers.** Six files read level
today: `SongBrowser.js`, `catalogue-helpers.mjs`, `shelf-helpers.mjs`,
`portal-songs.mjs`, `path-templates.mjs`, and the catalogue itself. Each moves to
a helper that resolves a level *within a named framework*, defaulting to the
current framework for the instrument. Behaviour still unchanged, because there is
still only one framework per instrument at this point.

**Phase 3 — add RSL 2026.** New framework, `status: 'current'`; mark 2019
`superseded`. New songs added with placements. Songs in both get a second
placement. This is the first phase where anything visibly changes, and by now
the machinery is already proven.

**Phase 4 — remove `level`/`series` from the catalogue source.** They become
derived-only. Delete the Phase 1 agreement test, since there is no longer a
second representation to agree with.

## Invariants worth a contract test

- **Song IDs are permanent.** Assert every ID in a committed manifest still
  exists. A rename or deletion must fail loudly — this is the invariant the
  whole design rests on.
- Every placement's `level` exists in that framework's `levels` vocabulary.
- Every placement's `framework` exists in `SONG_FRAMEWORKS`.
- A song has at most one placement per framework.
- A framework's `supersededBy` names a real framework, and no cycles.
- A song with zero placements is valid (assert it does not throw anywhere).
- `instruments` on a placement's framework must intersect the song's
  `instruments` — a piano method book should not be able to place a bass song.

## What not to do

- **Do not duplicate a song under a new ID for a new syllabus.** That is the
  failure this whole plan exists to prevent.
- **Do not put syllabus status on the song.** It belongs to the framework.
- **Do not delete placements when a syllabus is superseded.** The historical
  placement is the record of what a student was working from.
- **Do not conflate frameworks with paths.** `lib/config/path-templates.mjs` is
  First Chord's *own* curated route through material — internal, opinionated,
  reorderable. A framework is an *external* authority's structure. They stay
  separate, and a path may draw from any framework.
- Do not extend this to auto-detecting song mentions in free-text notes. That is
  a separate, riskier idea; see below.

## Related, deliberately not in scope

Attaching practice notes to songs. The cheap deterministic version — stamping a
note with the songs already on that student's shelf — is worth doing before term
starts and is independent of this plan. The fuzzy version, scanning note prose
for song titles, is held: a good share of the catalogue has titles that are
ordinary English (*Perfect*, *Yesterday*, *Hello*, *Creep*, *Time*), and matching
those against ASR-derived text would attach wrong evidence invisibly. Build the
deterministic join first; it then serves as the evaluation set that would show
whether fuzzy matching is safe enough to trust.

## Open decisions for Finn

1. **Naming.** `framework`, or keep `series`? `series` is the incumbent and
   cheaper, but reads oddly for a school qualification. This plan assumes
   `framework` with `series` retired in Phase 4.
2. **How many frameworks at once?** Only RSL acoustic is changing now. Piano,
   bass and electric can stay on a single framework each until they need not to.
3. **Does a superseded framework still appear in the tutor Song panel?** Probably
   yes, visibly marked, since students mid-syllabus still need it — but it should
   not be the default tab.
4. **Do we need `schoolYears` at all yet?** Only if the school-qualification case
   is real in the next year. If not, leave the field out; the model does not
   require it.

## Blast radius

Six files read song level today (listed in Phase 2), plus `songs-catalogue.mjs`
itself and the `add-song` skill's ingestion checklist, which will need the
placement shape reflected in it. `Song_Assignments` gains two columns. No other
state tab is affected.
