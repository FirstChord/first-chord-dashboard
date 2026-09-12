---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-11
---
# Practice Note Quality — Baseline and Goals

Measured 2026-09-11 against the live `Practice_Notes_Log`. The sample is the
**200 most recent notes**, which span **2026-08-28 → 2026-09-11** (one straggler
from 2026-05-28 sorts in on `email_sent_at`). Five of the 200 are absence
placeholders (`.`, `:)`) rather than notes, so **195 notes are scored**, from
**14 tutors** across **128 students**. Trend figures below use all 751 rows.

This is a **marker**, not a verdict. It says where the writing is on the day it
was measured, so the next measurement has something to move against.

---

## 1. The headline: the ritual is established, the writing is not yet a standard

Volume settled months ago and has held:

| Week beginning | Notes |
|---|---|
| 2026-06-15 | 37 |
| 2026-07-13 | 24 |
| 2026-08-10 | 84 |
| 2026-08-17 | 91 |
| 2026-08-24 | 98 |
| 2026-08-31 | 99 |
| 2026-09-07 | 101 |

Five consecutive weeks at ~100. Practice Chat is no longer being adopted; it is
simply what happens after a lesson. **The open question has moved from "will
tutors do this?" to "is what they produce worth a parent's attention?"** — and
nothing currently answers that second question (see §6).

Note length has been flat since June (median ~200 words, and ~190 words of
structured content), so growth has come entirely from more lessons covered, not
from longer notes. That is the right shape.

---

## 2. The rubric

Five things a good note does, each checkable from the stored row. Deliberately
mechanical: it is reproducible next month, and it does not pretend to judge
teaching.

| Dimension | What it asks | How it is measured |
|---|---|---|
| **Structure** | Are all three sections actually filled? | `what_we_did`, `progress_challenges`, `practice_goals` each ≥ 5 words |
| **Prose** | Does the parent read a note, or a transcript? | No line beginning `<tutor first name>:` or `<student first name>:` |
| **Measurable goal** | Could a parent tell whether it was done? | Practice goals name a tempo %, BPM, bar/line/section, octave count, or rep count |
| **Song link** | Is the repertoire a real object, not a guess? | `song_ids_json` non-empty |
| **Length** | Is there enough to act on, without burying it? | Median words of raw note |

Its limits, stated plainly: it cannot see whether the advice is *correct*,
whether it matches what actually happened in the room, or whether the family
read it. It rewards a habit, not a musician.

---

## 3. Baseline scorecard — the school, 2026-09-11

| Metric | Now | Target |
|---|---|---|
| All three sections filled | **92%** (180/195) | ≥ 98% |
| Reads as prose, not a transcript | **73%** (143/195) | ≥ 95% |
| Practice goal names something measurable | **31%** (60/195) | ≥ 60% |
| Confirmed song link attached | **29%** (56/195) | ≥ 70% |
| Names a piece or artist anywhere | **39%** (77/195) | ≥ 80% |
| Median words per note | **201** | hold 150–250 |
| Usefulness ratings ever collected | **0** | ≥ 50 within six weeks |

Two of these have moved a long way already. Song links were **1 in 14** when
measured on 2026-08-07; they are now **29%**, so the selector works and the
adoption problem named in `CURRENT_STATUS.md` is half solved. The other four
have never been measured before.

---

## 4. Ranking

Per-tutor, same 195 notes. Ordered by the four percentage columns summed.
**Small samples are marked** — three notes is an anecdote, not a score.

| Tutor | n | 3 sections | Prose | Measurable goal | Song link | Med. words |
|---|---|---|---|---|---|---|
| Dean Louden | 34 | 100% | 100% | 68% | 0% | 212 |
| Stef McGlinchey | 3 ⚠ | 100% | 100% | 33% | 33% | 79 |
| Tom Walters | 31 | 100% | 42% | 58% | 65% | 287 |
| Calum Steel | 11 | 82% | 100% | 9% | 73% | 104 |
| Fennella McCallum | 30 | 100% | 100% | 30% | 23% | 182 |
| Kenny Bates | 2 ⚠ | 100% | 100% | 0% | 50% | 141 |
| Kim Grant | 11 | 100% | 100% | 9% | 18% | 169 |
| Chloe Mak | 19 | 95% | 100% | 5% | 16% | 162 |
| Finn Le Marinel | 18 | 100% | 0% | 22% | 67% | 232 |
| Michael Gemmell | 8 | 75% | 100% | 0% | 0% | 99 |
| Matthew Leung | 2 ⚠ | 0% | 100% | 50% | 0% | 182 |
| Hamish Roberts | 10 | 30% | 100% | 0% | 0% | 47 |
| Ines Alban Zapata Peréz | 7 | 86% | 0% | 0% | 29% | 323 |
| Scott Brice | 9 | 100% | 0% | 11% | 0% | 599 |

### Tier 1 — send as-is; these are the house models

**Dean Louden** is the school standard and it is not close. Every note has three
distinct sections, names the piece, the bar range and the tempo percentage, and
ends with a goal a parent can check:

> "The goal this week should be to play the whole song. Start playing the full
> song at 80% and the more confidence you get, increase the tempo. It would be
> good to hear it at 100% next week."

He also has the **lowest edit rate in the school (14%, median 0 characters
changed)** — he speaks the finished note first time. That is the real lesson:
his quality is not editing discipline, it is having a sentence shape in his head
before he presses record. His one gap is song links at 0%.

**Fennella McCallum** is the other model, in a different shape: labelled
sub-headings per piece rather than continuous prose, and the only tutor who
routinely writes *forward* — "you'll ultimately need five songs for this grade,
so there's a strong chance you can eventually do both". Her edit rate is 65%
with a median 69-character delta; she reworks, and it shows.

**Stef McGlinchey** (3 notes) is the short form done right — 79 median words that
still carry a number ("improved to 76%", "at 80% for next week").

### Tier 2 — good prose, goals that cannot be checked

**Calum Steel, Kim Grant, Chloe Mak, Michael Gemmell.** All write clean,
warm, parent-readable English. All stop one sentence short. Chloe is the clearest
case: the prose is excellent and the repertoire tracking is meticulous, but
practice goals read "and don't stop the music, energy, just energy" — a feeling,
not a task, and **5% measurable**. Calum's are diagnostically precise but
unquantified: "to work on the clarity of the notes in the D chord". Michael's
notes are thin rather than vague — "All perfect! no trouble" is an entire
Progress section — which is a new-tutor calibration issue, not a writing one.

The fix for this whole tier is one sentence per note, not a new habit.

### Tier 3 — excellent capture, but the parent receives a transcript

**Tom Walters, Scott Brice, Ines Alban Zapata Peréz, Finn Le Marinel.**

This is the largest quality gap in the school and it is entirely stylistic.
Tom's *content* is arguably the best anywhere — he dictates exact fret and
string positions into the goal so the parent has a reference card — but 58% of
his notes carry `Tom:` / `Charlie:` dialogue. Scott's median note is **599
words**, three times the school median, and every one is a two-person
conversation; his fret-by-fret scale listings are genuinely valuable and
genuinely unreadable in that wrapper. Ines runs the best student
self-assessment practice in the school ("What was easy? What was harder?") and
ships it verbatim, with markdown bold scattered through it.

Two consequences worth being explicit about:

1. **The student's voice appears unlabelled.** Kenny Bates' Progress section
   reads "I think, and doing the course went quite well because I practiced them
   a lot" — that is the student, but a parent reads it as the tutor.
2. **It is growing, not shrinking.** Dialogue-style notes were 12% in June, 22%
   in July, 26% in August, **29% in September**.

Note that this is not simply a defect. `docs/plans/active/practice-chat-diarisation-audit.md`
Phase 3 deliberately moves toward named dialogue as a *stored* structure. The
problem is not that the dialogue is captured — it is that the captured dialogue
is shipped to the parent unconverted, and the tutor-facing notes card already
drowns in it (`CURRENT_STATUS.md`, "the tutor notes card, measured 2026-08-06":
Guy Pilsworth's card carries 290 characters of guidance against 1,835 of
dialogue). **Capture the dialogue; send the prose.**

Editing does not fix this on its own, but the reason differs by tutor and it
matters. **Ines is not failing to convert the transcript — she is deliberately
authoring it.** Traced 2026-09-11: the app applies no LLM and no diarisation
(`generateStructuredOutput` concatenates the three question labels with
regex-cleaned `whisper-1` text; `gpt-4o-transcribe-diarize` is explicitly
excluded in `asr-client.js`), so every `**Ines:**` label and every bold span in
her notes was typed by hand in the rich editor. She averages **15 speaker labels
and 35 bold spans per note**, edits 100% of them, and her median edit *removes*
106 characters — she is trimming waffle and adding structure at the same time.
That is craft aimed at a real goal: hers are the only notes in the school that
carry the student's own words about what was easy and hard. The format is the
problem, not the effort, and the fix is to keep the quote and drop the script
(§7, goal 3a). Scott's 62% is the other case — repair, not authoring.

### Tier 4 — a structural break, not a writing problem

**Hamish Roberts (10 notes) and Matthew Leung (2)** write with no section
headings at all — blank-line-separated paragraphs. `parsePracticeNoteSections`
needs a `[What we did]` bracket or a recognised bare heading line, finds
neither, and returns three empty strings. So **70% of Hamish's notes and 100% of
Matthew's store blank structured columns**.

The content itself is fine — terse and useful:

> "Starting to get a 'snare sound' that's essential for acoustic rhythm.
> Avoiding bass strings in some chords (like D) that make things muddy."

The parent is unaffected: both the email and the portal render `raw_note_text`.
What is lost is everything downstream of the columns — the per-section tutor
card, insights, and `buildPracticeSummary`. These tutors are invisible to the
analytics layer while appearing completely normal to families.

One further structural case: Matthew's 2026-09-05 note to Athena Papadakis
contains feedback for **both** Papadakis sisters in one row. They are siblings,
so this is not a confidentiality breach — but **Sophia Papadakis has zero notes
in the log, ever**, because hers ride inside her sister's. One lesson, one note,
one row.

---

## 5. What the telemetry adds

From `Practice_Chat_Sessions` (612 rows):

- Median session length **151 seconds**. The ritual costs two and a half minutes.
- **291 of 612 notes (48%) are edited** after generation, but the edit is
  bimodal: Dean, Chloe and Kim edit ~10–14% with a median delta of 0 characters;
  Calum, Stef and Matthew edit with median deltas of 284–417 characters because
  they **type rather than speak** (70% typed for Calum and Stef against a school
  average of 14%).
- **Zero ASR errors and zero re-records across all 612 sessions.** Whatever is
  wrong with the notes, capture is not it.
- Outcomes: 427 sent, 10 absence, 8 failed, 166 blank.

The quality problem is a writing-craft problem, not a tooling problem. That is
good news — it is cheaper to fix.

---

## 6. The measurement gap, which is the most important finding

`ratingAccuracy`, `ratingComment` and `priorUsefulness` exist as columns on every
one of the 612 session rows. **All three are empty. Not one rating has ever been
collected.** `ratingPrompted` is also 0, so the prompt is not firing — this is
not tutor reluctance, it is an instrument that was built and never switched on.

Every judgement in this document is therefore structural. Nobody knows whether
the notes families actually receive are useful to them, and no amount of
rubric-scoring will answer that. **A note that scores 5/5 on structure and is
never read is a worse outcome than a scruffy one that changes what happens at
home on Wednesday.**

Fixing this outranks every writing goal below.

---

## 7. Goals

Ordered. Each has a number, because a goal without one is exactly the failure
this document is about.

1. **Turn the rating prompt on.** Find why `ratingPrompted` is never set, fix it,
   and collect **≥ 50 usefulness ratings within six weeks**. Everything else is
   guessing until this exists.
   *Target: first ratings recorded by 2026-09-25.*

2. **Every practice goal names something checkable.** Tempo %, bar range, line
   number, or number of repetitions. One sentence per note.
   *31% → 60% by 2026-10-31.* This is the single biggest quality lever and the
   cheapest: Tier 2 already writes well, they just stop early.

3. **Prose out, dialogue kept.** Convert the note the parent receives to
   continuous prose while keeping the dialogue as stored structure
   (diarisation audit Phase 3). Whether that happens in the transcription prompt
   or as a post-step is an implementation choice; the outcome is the same.
   *73% → 95% prose by 2026-11-30.* Tom, Scott, Ines and Finn are the whole gap.

   **3a. Ines specifically — one quoted line, not a script.** The nearest fix
   costs no code: keep the student's answer as a single quoted sentence inside
   prose, rather than a full two-person transcript. It preserves the thing that
   makes her notes distinctive, cuts roughly 60% of the words, and removes ~15
   labels and ~35 hand-typed bold spans of work per note. Do this as a
   conversation before building anything.

   **3b. A privacy decision has already been overtaken.** The diarisation audit
   holds raw transcript capture pending "a retention number and a parent
   privacy-notice decision — it is the only piece that stores verbatim child
   speech." That is no longer true. Ines's notes already put verbatim child
   speech into `Practice_Notes_Log` and into a parent's inbox, by a different
   route. The policy question should be settled on what is happening now, not
   on what the held branch would start.

4. **Fix the heading-less parse.** Either make `parsePracticeNoteSections`
   fall back to paragraph-order splitting for notes with no recognised heading,
   or make the Practice Chat form make headings unavoidable. Prefer the second —
   a parser that guesses will guess wrong quietly.
   *92% → 98% three-section coverage by 2026-10-31.*

5. **Song links to 70%.** 29% now, up from 7% in August, and Dean — the best
   writer in the school — is at 0%. The habit is independent of writing quality,
   which means it can be raised without touching anyone's style.
   *29% → 70% by 2026-11-30.*

6. **One lesson, one note.** A shared sibling lesson should write one row per
   student so nobody is invisible in the log. *Sophia Papadakis is the current
   test case: she should have notes by 2026-10-31.*

7. **Publish the two house models.** Dean's shape and Fennella's shape, side by
   side, as the answer to "what does a good one look like?". Not a policy
   document — two real notes, with the numbers from §4 next to them.
   *Do this before goal 2's deadline; it is what makes goal 2 achievable.*

Explicitly **not** a goal: longer notes. Median 201 words is right, and Scott's
599 is the problem case, not the model.

---

## 8. Reproducing this measurement

The figures came from `getPracticeNoteLogRows()` and `getPracticeChatSessionRows()`
via a local script, read-only, with `loadLocalEnv(repoRoot)`. There is no
committed command for the rubric yet — **adding one is the natural next slice**,
so the 2026-10 remeasurement is a single run rather than a rebuild. The closest
existing tools are `scripts/eval-practice-chat.mjs` (adoption) and
`scripts/eval-practice-summaries.mjs` (summary fidelity); this rubric belongs
beside them as `scripts/eval-note-quality.mjs`.
