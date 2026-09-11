---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-11
---
# FC student ID convergence

**Status:** **Finn chose B on 2026-09-11. Steps 1–3 are done and verified.**
Kept as the record of why the two IDs exist and what was measured.
**Date:** 2026-09-11

## Why this exists

Onboarding Tyler Beaton (`sdt_WFQ7Js`) surfaced two different "FC student IDs"
for one student: the dashboard registry and Students sheet hold
`fc_std_68c763fb`, while `FC_Students` holds `fc_std_fa157fc5`.
`python3 brain.py lookup fc_std_68c763fb` returns **no results**; the other ID
finds him. Tyler turned out to be the newest of 63.

## What is actually true

Everything below was measured on 2026-09-11 against the live registry, Students
sheet, FC tabs, state tabs and MMS.

**Two formulas share one name.**

| Where | Seed | Used for |
|---|---|---|
| Brain `generate_fc_ids.py` | `sha256(mms_id)` | every `FC_Students` row, rebuilt hourly |
| Dashboard `lib/admin/fc-id.mjs` | `sha256(forename:surname:email)` | onboarding route + `createRegistryEntryForStudent` |
| Brain `src/onboarding.py` | `sha256(forename:surname:email)` | CLI onboarding |

**The two repos' docs contradict each other on ownership.** Brain `CONTEXT.md`
says the `fc_std_` seed is the MMS student ID. Dashboard
`docs/architecture/data/ownership.md` says `fcStudentId` is "authoritative after
generation" in the Students row and registry, "never recompute an existing
value". The brain recomputes it every hour.

**The registry splits cleanly by date.**

| Registry `fcStudentId` | Count | When added |
|---|---:|---|
| `= sha256(mms_id)` | 147 | 2026-04-15 → 2026-05-07, the one-off `patch_registry_fc_ids.py` backfill |
| name + email seed, reproducible from today's data | 54 | every onboarding since 2026-04-16 |
| name + email seed, **no longer reproducible** | 9 | same, but the name or email has since changed |

So this is not a historic mess being cleaned up; it grows with every onboarding
(22 in August, 9 so far in September).

**The name + email seed is demonstrably unstable.** Six of the nine were
reproduced from older data — a parent email MMS still holds but the sheet no
longer does, a surname before `(Guitar)` was appended. Carol Turner (Bass)
matches her old `carole.turner17@yahoo.co.uk`, changed in MMS on 2026-09-10.
The seed's only justification was a pre-MMS student with no MMS ID yet. **There
are none:** the 18 Students rows without an `sdt_` ID are all tutor banners, and
both onboarding paths start from the MMS waiting list with an MMS ID in hand.

**`FC_Students` already agrees with itself.** 210 of 210 rows equal
`sha256(mms_id)`. The FC tabs have never carried the dashboard's IDs.

## What the divergence breaks, and what it doesn't

Checked, not assumed:

- **Broken today:** brain lookup by the ID the dashboard displays, for all 63.
  Any future join of dashboard `fcStudentId` to `FC_Students` / `FC_External_IDs`
  fails for 30% of students and for every student onboarded since mid-April.
- **Not broken:** the student portal, generated configs, Practice Chat and
  Payment Pause do not read `fcStudentId`. Teaching-relationship, cover-episode
  and lesson-occurrence keys embed it but are computed on read and never
  persisted. The lesson mirror keys participations on the MMS student ID.
  `Tutor_Absence_State` JSON, `Planning_Items`, `Issue_Queue`, `Event_Log`,
  `Practice_Notes_Log`, `Practice_Chat_Sessions`, `Communication_Log`,
  `Student_Lifecycle` and `Schedule_Context` contain no FC student IDs at all.
- **The one persisted copy outside the registry:** `WhatsApp_Group_Map.matched_fc_id`
  (239 rows, 54 holding a dashboard-style ID). It is display-only
  (`IncomingGroupMapPanel`), and 25 values already point at students no longer
  in the registry.
- **First-seen dates are safe either way.** `fc_first_seen.py` keys
  `FC_Students` on `mms_student_id`, `FC_External_IDs` on the external value, and
  links on their email:mms seeded `id` — never on the FC student ID. Its own
  docstring anticipated IDs changing.
- **No suffix coupling.** `lookup.py` resolves student → person through the
  `fc_person_id` column, not by swapping `fc_std_` for `fc_per_`.

## The decision: which value wins

**A. Converge the stored values onto the brain's formula.** Rewrite 63 registry
entries, 52 Students sheet cells and 54 `matched_fc_id` cells to
`sha256(mms_id)`. Brain unchanged.

**B. The stored value wins; the formula only mints.** The brain reads the ID the
registry already holds (then the Students sheet cell, then `sha256(mms_id)` for a
student with neither) instead of recomputing it. No registry, Students or group
map cell changes. Only derived FC tab rows change, once.

| | A | B |
|---|---|---|
| Registry entries rewritten | 63 | 0 |
| Students sheet cells rewritten | 52 | 0 |
| `WhatsApp_Group_Map` cells rewritten | 54 | 0 |
| `FC_Students` rows changed | 0 | 63 of 211 |
| `FC_External_IDs` rows changed | 0 | 208 of 1003 (`fc_entity_id` only) |
| `FC_Parent_Student_Links` rows changed | 0 | 39 of 166 (`fc_student_id` only) |
| `FC_People` rows changed | 0 | 0 |
| Stored-ID collisions / duplicates | — | 0 / 0 |
| Rollback | reverse a registry commit **and** two sheet rewrites | revert one brain commit; next hourly run restores |

**Recommendation: B.** It touches only tabs `CLAUDE.md` already classes as
derived, which the hourly job rewrites anyway; A rewrites canonical,
human-facing data to fix a derived layer. B also honours the stronger of the two
existing contracts — "never recompute an existing value" — which is what a
provider-neutral identity needs: an ID recomputed hourly from an MMS key is an
MMS alias, not an identity that could survive leaving MMS. The nine
irreproducible IDs stop mattering once the stored value is authoritative; the
registry's git history is its backup.

## Plan (assuming B)

Steps 1 and 2 are independent. Step 1 alone closes the divergence; step 2 stops
minting unstable IDs. Do 1 first — it is the one users feel and the cheapest to
reverse.

### 1. Brain: read the stored ID (first-chord-brain)

- `parse_registry`: add `fcStudentId` to the extracted fields. It is not read
  today.
- `generate_fc_ids.py` main loop: resolve `fc_std_id` as registry `fcStudentId`
  → Students `fc_student_id` → `make_fc_id("std", mms_id)`. Accept a stored value
  only if it matches `^fc_std_[0-9a-f]{8}$`.
- New review flags, surfacing through the existing `Review_Flags` tab:
  `FC ID CONFLICT` when registry and sheet both hold different IDs (0 today),
  `FC ID MALFORMED`, `FC ID DUPLICATE` when one stored ID belongs to two MMS IDs
  (0 today). Flag, don't fail — an hourly job should not stop on a data
  condition.
- Leave `fc_person_id` as `sha256(mms_id)`. Nothing couples the two.
- Tests (`test_fc_ids.py`): stored registry ID wins over derived; sheet cell used
  when registry lacks one; derived used when neither exists; conflict and
  malformed flags raised.
- Workflow: add `python -m unittest` before `python generate_fc_ids.py` in
  `regenerate-fc-ids.yml`. The brain has no test CI today, so a broken resolver
  would otherwise write tabs before anyone ran a test.

**Rehearsal before the live run:** `python3 generate_fc_ids.py --no-sheets`, then
diff the exports against the current ones. Expect **exactly** the counts in the
table above — 63 / 208 / 39 / 0 — and no `created_at` change. Anything else
stops the rollout.

**Verify after:** `python3 brain.py lookup fc_std_68c763fb` finds Tyler; the
table's counts hold on the live tabs.

This is a brain push, which needs an explicit instruction under `CLAUDE.md`. The
hourly job checks out `main`, so nothing changes live until then.

### 2. Mint from the MMS ID (dashboard + brain onboarding)

- `lib/admin/fc-id.mjs`: `generateFcStudentId(mmsId)` returns
  `fc_std_${sha256(mmsId).slice(0, 8)}` and **throws** without an `sdt_` ID. No
  name + email fallback: there is no pre-MMS case left to serve, and a silent
  fallback is how the second formula survived.
- Call sites: `app/api/admin/onboard/route.js` (`appendCanonicalStudent`) and
  `lib/admin/students.js` (`createRegistryEntryForStudent`, which keeps
  `student.fcStudentId ||` so an existing sheet value still wins).
- Brain `src/onboarding.py` `_generate_fc_student_id`: same change.
- **Shared golden fixture:** `sdt_WFQ7Js → fc_std_fa157fc5` asserted in
  `tests/admin/fc-helpers.test.mjs` and in the brain's `test_fc_ids.py`. This is
  the guard against the actual failure — two repos drifting to two formulas —
  since neither repo can import the other.
- Replace the existing name/email determinism test rather than keep both.

Rollback: revert. Any ID minted in between is `sha256(mms_id)`, which is valid
under B.

### 3. Docs, same session as each step

- Brain `CONTEXT.md`: seed is "MMS student ID at mint; the stored value is
  authoritative thereafter"; delete the "future work to preserve the old ID as a
  legacy link" line — under B the ID never changes, so no legacy link is needed.
- `docs/architecture/data/ownership.md`: `fcStudentId` write method.
- `docs/reference/glossary.md` + Obsidian `09 Glossary`: **FC student ID** — one
  line, including that it is minted once and never recomputed.
- `CURRENT_STATUS.md`, Learning Log entry.

## Operational note, effective now

Manual `generate_fc_ids.py` runs are unnecessary for onboarding: the hourly job
(`:12` past) reads the dashboard's `main` branch. A local run reads the *local*
registry, so a stale checkout writes stale tabs — which happened on 2026-09-11
and briefly flagged Tyler as `SHEETS ONLY`.

## Out of scope, noted

- **Person identity across enrolments.** Carol Turner is two MMS students, so two
  `fc_std_` and two `fc_per_` IDs. That is correct for student records and wrong
  for people; a separate problem.
- **Two stored copies.** The Students sheet `FC Student ID` column duplicates the
  registry (52 filled, all agreeing; 158 blank). One home per fact argues for
  retiring it; don't backfill the blanks in the meantime.
- **25 stale `matched_fc_id` values** for students no longer in the registry.
  Display-only; leave.

## Outcome

**B, decided 2026-09-11, implemented the same day.**

- **Brain** (`31b3225`, `762ec53`, plus a registry-parse guard): stored ID wins;
  `fc_ids.py` is the single formula home; CLI onboarding mints from the MMS ID;
  the hourly workflow runs the unit tests before writing tabs. The generation
  stops outright if the registry parses with no `fcStudentId` values, because a
  format change would otherwise rekey every stored ID with no flag.
- **Dashboard:** `generateFcStudentId(mmsId)` with no name/email fallback;
  onboarding blocks without an MMS ID; the three FC ID flags are classified
  issues instead of "Unclassified"; the "run `generate_fc_ids.py`" guidance now
  says the hourly job does it.
- **Rehearsal matched exactly** once compared row by row: 63 / 208 / 39 / 0. A
  first keyed diff reported 205 external-ID changes because 47 external values
  are shared between rows (siblings, shared Soundslice courses) and collapsed;
  it was a measuring error, not a behaviour difference.
- **Live, after the manual workflow run:** 210 of 210 `FC_Students` rows equal
  the registry, `created_at` unchanged on all 211, `Review_Flags` unchanged,
  and `brain.py lookup fc_std_68c763fb` finds Tyler.
