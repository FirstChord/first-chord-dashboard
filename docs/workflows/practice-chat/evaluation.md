---
status: canonical
audience: [human, agent]
last_verified: 2026-10-08
---
# Practice Chat six-week evaluation

Live from 2026-08-11. The original 2026-09-22 decision date passed without a
recorded decision.

**Decision, 2026-10-08 (Finn): keep.** The evaluation continues, and its purpose
widens: as well as "is the ritual worth keeping?", it is the evidence for
offering Practice Chat to other schools. Re-judge by **2027-03-31** (end of the
spring term).

### Evidence so far (2026-10-08)

- **1,187 sessions** since 2026-08-12 across **17 tutors**; median tutor active
  time per note **about 2.5 minutes**.
- **73% finished** in-session. Of the 317 that were not: 147 were reopened and
  finished within three hours (107 of those had barely started), 81 had the
  note saved another way the same day, 67 were opened and closed within five
  seconds. **22 (under 2%)** genuinely stopped, all at the review screen, none
  with a transcription error. The unfinished rate fell month on month: 30%,
  26%, 23%.
- **No accuracy ratings yet.** The rating card is gated to
  `NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS` and no tutor has been enabled, so
  there is no quality evidence beside the time evidence. Enabling it is
  Finn's call (it interrupts tutors, at most once a day).
- **Gaps an outside school would ask about:** a "before" figure for how long
  notes took without Practice Chat, and how children's voice data is handled
  (OpenAI processing, retention, the parent privacy notice).
- **The ritual changed on 2026-10-06 to 10-08** (server-side transcription, new
  questions, refreshed screens). Every row records `build_version`, so compare
  by build, never by week across that boundary.

Answers one question: **is the end-of-lesson ritual worth keeping?** It measures
the ritual; it never changes it. No screen a tutor uses behaves differently
because of this, apart from one rating card shown to an explicitly enabled
roster.

## The two tiers

**Silent** — timings, abandonment, transcription failures, retries, whether the
note was edited before saving. Runs school-wide from day one. Nothing appears,
nothing is asked, and every write is best-effort and wrapped: a failure here
must cost a tutor nothing, so a dead network is silent by design.

**Visible** — the rating card, and only that. Gated to
`NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS`, at most one prompt per tutor per day,
with a permanent opt-out. Unset means **nobody** is prompted — the opposite
default to `PRACTICE_NOTES_ENABLED_TUTORS`, because an evaluation prompt is an
interruption a tutor agreed to and a forgotten config must fail closed.

Recording how long a colleague took, and where they gave up, without asking them
is defensible as tool telemetry — but "we don't ask them anything" and "they
don't know it's happening" are different claims. Whether to tell the team is a
judgement for Finn, not a technical question.

## Configuration

On the canonical Railway admin service:

```text
NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS=Finn      # comma-separated short names; unset = nobody
NEXT_PUBLIC_PRACTICE_CHAT_EVAL_SAMPLE=1         # prompt on 1 in N eligible sessions
```

`NEXT_PUBLIC_` values are inlined at **build** time, so a change needs a rebuild,
not a restart — editing the variable on Railway triggers one. Same trap as
`NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL` in [delivery](./delivery.md).

The roster is resolved server-side (`lib/config/practice-chat-eval.mjs`) into an
opaque `evalPrompt=1` plus a sampling number on the launch URL. The PWA never
learns who else is enabled. **Note the roster does reach the dashboard's own
client bundle**, so a tutor with devtools open could read it; irrelevant while
the value is one name, worth resolving server-side before it is several.

## Schedule

| When | Action |
|---|---|
| Week 1 | Silent tier live school-wide. Prompts to Finn only, `SAMPLE=1`. **Check your own rows look sane before trusting any of the data.** |
| Week 2 | Unchanged. |
| Week 3 | Add opt-in tutors to the roster, drop to `SAMPLE=4`. Run `npm run eval:practice-summaries -- --week 3`. |
| Weeks 4–6 | Unchanged. |
| Week 6 | `npm run eval:practice-summaries -- --week 6`, `npm run eval:practice-chat`, then decide. |

Tutors joining at week 3 means **only Finn's students can reach the 6+ ritual
bucket**, and consecutive-week usage tops out at four for everyone else. That is
a fact about the rollout, not about the tool, and belongs in the write-up.

## The manual baseline — collect this or lose it

`lib/config/practice-chat-baseline.mjs` is empty until roughly ten lesson notes
are hand-timed the old way and pasted in. Until then every time-saved figure
reads "—" and the report says why.

**This cannot be collected retrospectively.** Once the ritual is habitual there
is no clean way back to how long writing a note in MMS took, and without it "the
ritual takes 92 seconds" is a fact about the tool rather than a saving. The
collection method, and the three things that would quietly ruin the number, are
documented in that file.

## Reading the report

`/admin/insights/practice-chat` — read-only, rolling window. Three bands, and
they must never be added together:

- **Observed** — the system watched it happen.
- **Rated by tutors** — self-reported, always shown with its n.
- **Derived** — a rule inferred it. "A next practice action was captured" means
  the Practice Goals section is non-empty; it cannot tell a clear action from a
  sentence occupying the space.

`npm run eval:practice-chat` writes the underlying rows plus a summary to
`backups/practice-chat-eval/` (gitignored). **Per-tutor adoption lives there and
deliberately not on the page**: `state-tabs.md` forbids that surface becoming a
tutor leaderboard, so on screen a name appears only against something broken and
fixable. A spreadsheet Finn opens to make a judgement is a different artefact
from a screen the school walks past.

Three fields are kept apart on purpose. An ASR error is the tool breaking, a
re-record is a tutor choosing to say it better, and an edit is a tutor improving
the output. One "problem rate" would report the most careful tutor in the school
as the one having the most trouble.

## What this cannot measure

State these as limits in the write-up. They are not zeroes.

- **Speaker-attribution corrections.** No diarisation exists; transcription
  sends one blob per question and reads back one string. See
  [the diarisation audit](../../plans/active/practice-chat-diarisation-audit.md).
- **Whether the student's voice appears in the reflection.** One microphone, one
  undifferentiated transcript.
- **Whether a tutor read the previous note.** `NotesPanel` renders it and the
  Lesson Focus summary automatically on student select, so it is always on
  screen and a passive view proves nothing. Only the deliberate "Show earlier
  lessons" click is counted.
- **Transcription accuracy.** The raw transcript is discarded, so there is no
  artefact to score against. Capture was built and held on a preservation branch
  pending a retention and parent-notice decision; the PWA half of that slice is
  not present in any known clone.
- **Parent engagement.** Delivery is recorded; opening is not, and tracking a
  message about a child is a consent decision rather than a config change.
- **Adoption for a tutor nobody trained.** The denominator is every taught
  lesson, which is the honest internal number and understates the tool
  externally. Both are computable from the export.

Cost is priced per model from audio minutes actually sent. A model with no
published per-minute rate is counted as unpriced rather than costed at a guess.

## At week six, decide the lane's fate

`Practice_Chat_Sessions` is time-boxed, not permanent. Either keep it — and
re-judge it against the storage rubric on its measured growth — or purge it. A
telemetry lane nobody decided to keep is the kind of thing that quietly outlives
its question. The census already watches its growth.

## Verification

```bash
node --test tests/admin/practice-chat-session-helpers.test.mjs
node --test tests/admin/practice-chat-eval-helpers.test.mjs
node --test tests/admin/practice-chat-eval-rollout.test.mjs
node --test tests/admin/notes-summary-route-boundary.test.mjs
```

The last one pins the narrow exception this work introduced:
`POST /api/notes/[studentId]/prior-rating` is the single write on the
per-student tutor-token boundary, which is otherwise read-only until tutor auth
exists. A second write there should have to be argued for.
