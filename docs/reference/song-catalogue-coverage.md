---
status: supporting
audience: [human, agent]
last_verified: 2026-09-03
---
# Song Catalogue — Coverage and Gaps

Last updated: 2026-09-03 · **337 entries** · Teaching layer: 263 entries carry a `tutorNote`, 180 a `studentNote` (every *song* by a known artist is covered; Rockschool Originals and technical exercises are deliberately blank rather than invented — write those only from the actual scores)

The single home for *what repertoire exists, what is missing, and why*. Coverage numbers
here are a snapshot; the catalogue itself (`lib/config/songs-catalogue.mjs`) is the truth.
The *why* behind decisions lives in the Obsidian Learning Log; this file records **state
and gaps**, so the next session can pick up without re-deriving any of it.

---

## The one rule that is easy to get wrong

**`artist: 'RSL'` means two different things**, and you cannot tell them apart by looking:

1. **A needs-curation marker** — we could not find a trustworthy artist.
2. **The true artist** — the piece is a *Rockschool Original*, written for the syllabus.
   It has no other artist. Nothing is missing.

The official RSL Awards syllabus pages (`rslawards.com/products/<instrument>-<grade>/`) are
the settling source: **they group cover tracks separately from Rockschool Originals.** That
is the strongest evidence channel we have found — better than the slice name, the Soundslice
`artist` field, or recording provenance. Use it first.

**Every `artist: 'RSL'` song in the catalogue is now a verified Rockschool Original.** A
test (`songs-catalogue.test.mjs`) enforces it against an explicit `VERIFIED_RSL_ORIGINALS`
list, so a new unverified marker cannot be added silently:

| Instrument | Verified Originals |
|---|---|
| Piano (Rock School 2025) | Home To Philadelphia, Vanishing Footprints, Short Fuse, Midnight Song, Step By Step, Circus Waltz, Ignite, Le Noche En Havana, Cinnamon Roll, Elevator Shoes, Get Going, Contemplation, Camden Square |
| Bass | Noisy Neighbour, Do Balanco, Slam Dunk Funk |
| Electric Guitar | Route 66, Cashville, Helicopter, Headline Act, Just Don't Know, Overrated |
| Guitar (acoustic, RSL 2026) | Route 66, Runaway Road, Pocket Change, Call Across the Mountain, Ignite, Toledo Sun |

**Piano's markers were audited on 2026-07-14, and 13 of 26 were WRONG.** The assumption
that "they're all Rockschool originals" was reasonable and false: *Danny* is Daniel
Rosenfeld's (the Minecraft piece), *Arcadia* is Lana Del Rey's, *The Moth* is Maikapar's,
and the whole Classical Grade 1 set had real composers (Carolyn Miller, Anne Crosby Gaudet,
August Eberhard Müller, Ignatius Sancho). All corrected. **The lesson: `'RSL'` is not
self-describing — it must be checked piece by piece against the syllabus page, never
assumed in bulk.**

Technical exercises legitimately use `artist: 'RSL'` everywhere. That is never a gap.

### Two piano syllabuses share one shelf

RSL publishes **Rock School Piano** *and* **RSL Classical Piano**, and a student's grade can
draw on both. Piano Grade 1 holds 11 Rock School pieces and 9 Classical ones side by side.

Classical entries carry the **`classical` tag**, and the tutor Song panel shows a small
**Classical** badge on those cards, so a tutor can tell which syllabus a piece belongs to
without opening it. The badge means *"from the RSL Classical syllabus"* — **not** "sounds
classical". Mozart's *Minuet in F* and Bartók's *Quasi Adagio* sit in the **Rock School**
book and are correctly unbadged.

---

## Coverage

The RSL series runs **Debut → Grade 6**. Levels are only comparable *inside* a series.

### Guitar (acoustic) — 81 entries · 118 students
| Level | Songs | Exercises |
|---|---|---|
| Debut | 18 | 2 |
| Grade 1 | 15 | 2 |
| Grade 2 | 6 | 2 |
| Grade 3 | 13 | 2 |
| Grade 4 | 8 | — |
| Grade 5 | 6 | 2 |
| Grade 6 | 5 | — |

The available RSL Acoustic 2026 lists contributed **25 pieces**: complete Debut
and Grade 1 books (9 each), plus the 4 Grade 3, 2 Grade 4 and 1 Grade 5 slices
that currently exist. Grade 2's 2026 Soundslice list is empty. The older and
2026 pieces deliberately share their grade shelf; plain text beneath the artist
shows `RSL legacy book` / `RSL 2018 book` or `RSL 2026 syllabus` without adding
a second badge system. All six acoustic `artist: 'RSL'` rows are verified
Rockschool Originals, not unresolved attribution markers.

### Electric Guitar — 60 entries · 5 students
| Level | Songs | Exercises |
|---|---|---|
| Debut | 11 | — |
| Grade 1 | 13 | 4 |
| Grade 2 | 12 | 2 |
| Grade 3 | 6 | 2 |
| Grade 4 | 4 | — |
| Grade 5 | 4 | — |
| Grade 6 | 2 | — |

### Bass — 41 entries · 5 students
| Level | Songs | Exercises |
|---|---|---|
| Debut | 1 | — |
| Grade 1 | 6 | 2 |
| Grade 2 | 6 | 1 |
| Grade 3 | 5 | 4 |
| Grade 4 | 5 | 4 |
| Grade 5 | 5 | — |
| Grade 6 | 2 | — |

### Piano — 101 RSL entries + 54 John Thompson · 58 students
| RSL Level | Songs | Exercises |
|---|---|---|
| Debut | 11 | 12 |
| Grade 1 | 20 | 17 |
| Grade 2 | 12 | 0 |
| Grade 3 | 12 | 17 |

**John Thompson** (own series, own level vocabulary): Book 1 — 23 songs · Book 2 — 30 songs + 1 exercise.

---

## Gaps

### A. Repertoire that does not exist in Soundslice (Finn must create the slice)

| Instrument | Level | Missing |
|---|---|---|
| Guitar | Grade 2 (2026) | **All the Way From America, Ascension, Beautiful Things, City of Stars, I Remember Everything, Killing Me Softly, New Rules, Surfer Ticket, Willow Tree** — list `lZZG7` exists but is empty |
| Guitar | Grade 3 (2026) | **December, Restless, Tears, Wade in the Water, Walking Home Blues** |
| Guitar | Grade 4 (2026) | **I Walk the Line, Bad Moon Rising, The Perfect Pair, Love Is a Losing Game, Parallel Lines, All In Good Time, Promise** |
| Guitar | Grade 5 (2026) | **Runaway, Deeper Well, S P E Y S I D E, Listen to the Music, Many of Horror, Rusty Swing, Low Bias, The Way Home** |
| Guitar | Grade 5 | **Songbird** |
| Guitar | Grade 6 | **More Than Words** |
| Piano | Grade 2 | **all technical exercises** — no uploads exist for this grade |

### B. Repertoire that exists but is NOT catalogued (a decision is needed first)

| What | Where | Why not ingested |
|---|---|---|
| Bass **Advanced (Grade 6–8)** | list `R1bQ7`, 9 songs (Muse, Dua Lipa, Corto Alto…) | Overlaps Grade 6 and does not split cleanly into 7 and 8 |
| Electric **Grade 7** | list `K1bQ7`, 4 songs | Above the RSL series' top level |
| Electric **Old Grade 8** | list `n1bQ7`, 1 song | Above the RSL series' top level |
| Piano **Grade 4+** | not investigated | RSL piano stops at Grade 3 in the catalogue |
| **Trinity** exam board | `NCbQ7` + sublists (electric G4, G6) | Different exam board — needs its own series, like John Thompson |
| RSL **Classical Piano Debut** | a cluster in Soundslice | Deliberately left out |

**The gate for the first three:** the RSL series stops at `Grade 6`. Adding `Grade 7` /
`Grade 8` to `SONG_SERIES` in `songs-catalogue.mjs` is a few lines and unblocks all of them.
Nobody currently on the roster obviously needs those grades, which is why it has waited.

### C. Structural gaps in Soundslice itself

- **Bass has no Debut list.** Debut currently holds exactly one song — *Green Onions*, an
  orphan slice (in no list) that names its own level. A beginner bass student has almost
  nothing to start on. **Worth building a real Bass Debut list.**
- **Electric has no Grade 4 and no Grade 6 list.** Those grades were catalogued from two
  *unlabelled* lists (`m1bQ7`, `M1bQ7`) whose contents match the official Grade 4 and
  Grade 6 syllabus track listings. That is evidence, not certainty — **worth Finn confirming.**
- **Electric Grade 2 has no 2024 sublist**, unlike Debut and Grade 1. Its four 2024 slices
  (Go Your Own Way, Do I Wanna Know?, Headline Act, Flowers) sit in **no list at all** and
  were only found by a bulk scan.
- *"Funny Faces"* (John Thompson Book 1, #10) is in no list; included on numbering evidence.

### D. Source-data errors to fix in Soundslice

Corrected in the catalogue, still wrong at source:

| Slice | Soundslice says | Should be |
|---|---|---|
| `tlSlc` | "Fell on Black **Times**" | **Fell On Black Days** (Soundgarden) |
| `dGyMc` | artist "**Alleman** Brothers" | **The Allman Brothers Band** |
| `pvWMc` | artist "**Jimmy** Hendrix" | **Jimi Hendrix** |
| Piano G1 | title "Le Douz De Decembre" | **Le Douze de Decembre** (Ignatius Sancho) — corrected in the catalogue |

**One open question, deliberately NOT changed:** piano Grade 2 has an entry titled
**"Le Noche En Havana"**, but the RSL Grade 2 syllabus lists an Original called
**"La Noche En Rio"**. Same piece under a garbled title, or a different piece? The evidence
does not say, so nothing was renamed. **Checking the physical Grade 2 book settles it.**

### E. Instruments with no repertoire at all

| Instrument | Students | Note |
|---|---|---|
| Singing | 13 | No repertoire. Listed in `INSTRUMENTS_WITHOUT_REPERTOIRE`. |
| Ukulele Orchestra | 6 | Ditto. |
| Ukulele | 1 | Ditto. |
| Voice | 1 | A single holdout — `Voice` and `Singing` are the same thing under two labels. Worth collapsing. |

These are **acknowledged**, not accidental: a test (`songs-catalogue.test.mjs`) fails if a
student holds an instrument that is neither seeded nor on that list. That guard exists
because the empty-shelf bug shipped three times in one day (bass, the 38 blank instruments,
then electric).

Also: **Claire McGinniss** has no instrument in the registry *or* the Sheet.

---

## Paths

`lib/config/path-templates.mjs` — **5 templates, every instrument covered** (bass, electric
and piano added 2026-07-19; orderings are FC pilot orderings, revisit with Tom after
~2026-08-03 only if they feel wrong in use):

| Path | Instrument | Level | Steps |
|---|---|---|---|
| `fc_path_guitar_debut` | Guitar | Debut | 6 |
| `fc_path_guitar_grade_1` | Guitar | Grade 1 | 6 |
| `fc_path_bass_grade_1` | Bass | Grade 1 | 6 |
| `fc_path_electric_debut` | Electric Guitar | Debut | 6 |
| `fc_path_piano_debut` | Piano | Debut | 6 |

Bass enters at Grade 1 because Debut still holds a single orphan song (see gap A). RSL
originals are kept off templates (covers keep beginners motivated) but stay on the shelf.
Two standing decisions to respect:

- **No path templates for John Thompson's books.** A 23-step path would dump 23 songs onto a
  child's practice page at once. The numbered shelf carries the sequence instead.
- Editing a template **never** rewrites already-instantiated assignments.

Fretboard / chord paths were discussed and deliberately deferred ("hold off at the moment").

---

## How to ingest more (the pipeline, and its traps)

Toolshed: `~/Desktop/Tools:Games/FC Admin Tools/Soundslice/`

1. **Discover lists.** There is no list-all endpoint (`GET /lists/` = 405) and no folders
   endpoint (404). Bulk `GET /slices/` returns everything but leaves `lists` **empty**; only
   a *single*-slice GET populates it. That is the only way to find a list ID.
2. **Draft** with `build_catalogue_draft.py LIST_ID --instrument --level`. Drafts are
   **reviewed by a human and never auto-merged.**
3. **Enable secret links** — `enable_secret_links.py -- <hashes>`. Slices default to
   `status=1` (private); students cannot open them until `status=3`.
4. **Verify** — `verify_catalogue_links.py` (slice exists, secret link on, anonymous GET 200).

**The rules live in `slice_cleaning.py` — ONE home, with the reason attached to each, and
`python3 slice_cleaning.py --selftest` (43 real slice names that each once produced wrong
data). Change them there, never in a copy.** `build_catalogue_draft.py` uses them, and
derives its instrument/level vocabulary from `songs-catalogue.mjs` so it cannot drift stale.

Sheet→registry instrument drift has its own tool:
`first-chord-brain/sync_instruments_to_registry.py` (dry-run by default).

**Traps, all of which have drawn blood:**

- **macOS is case-insensitive.** `G1bQ7` and `g1bQ7` are *different lists* but the *same
  filename*. A subagent ignored this warning and reported the bass Grade 4 list as electric.
  Encode case in any filename you save.
- **`Title - Artist` is a trap.** "The Bottle - Grade 5 bass" yields `artist: 'Grade 5 bass'`
  — not unknown, *wrong*.
- **The `artist` field lies too**: real artists, grade markers posing as artists
  ("Rockschool Grade 4 bass"), contaminated values ("Daft Punk (Grade 5 Bass)"), and blanks.
  Read *both* name and field; strip syllabus noise from each; if nothing trustworthy
  survives, emit `RSL` and say so.
- **Grades are sometimes spelled as WORDS** ("Grade One Electric Guitar"). A digit-based
  stripper misses them, and the garbage then *beats* the real artist sitting in the name.
- **Only the TITLE can carry a student's name.** The half after "by" is an artist —
  "Stay With Me by Sam Smith" is not a copy made for a student called Sam.
- **Split on the LAST " by "**, not the first: "Stand By Me by Ben E. King".
- **Student practice copies live INSIDE the grade lists**, not only in "Student Versions"
  sublists — and some belong to *former* students the registry cannot see. Names also get
  jammed onto titles ("MAthildeRunning away"), defeating word-boundary matching.
- **Dedupe must prefer the copy that NAMES its artist**, or bare "Green Onions" beats
  "Green Onions by Booker T and the MG's".
- **Arrangement notes are not names.** Treating any unrecognised parenthetical as a student
  name deleted **7 of 9 real songs** from the bass Advanced list (`Gosh (Pick Bass Groove)`,
  `Hysteria (Bass)`). Recognise musical vocabulary; don't enumerate phrases.
- **Titles need gentler cleaning than artists.** Word-level stripping mangles a real title
  (`Piano Joint` → `Joint`). Artists never legitimately contain "Grade 5 bass", so there the
  aggressive strip is safe; titles are cleaned by segment.
- **Never guess an artist.** "Unknown" is a correct answer; a plausible wrong artist ships to
  children and is worse than a blank.
