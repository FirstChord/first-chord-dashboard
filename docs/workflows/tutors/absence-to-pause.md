---
status: canonical
audience: [human, agent]
last_verified: 2026-08-29
---
# Tutor Absence And Pause Contract

## Purpose

Tutor absences retain exact per-date evidence underneath while presenting the
smallest safe human action above it. Cover, cancellation notice, payment work,
and final confirmation remain distinct decisions.

This guided notice flow applies to newly captured cards marked
`Tutor absence notice planning: v1`; older records are not silently backfilled.

## State Ownership

| Lane | Meaning |
| --- | --- |
| MMS calendar | Lessons and current tutor/date truth |
| `Planning_Items` tutor-absence cards | Human capture and dated work |
| `Tutor_Absence_State` | Per-tutor/per-date cover or cancellation decision |
| `Planning_Items` pause/notice cards | Grouped human-facing communication and payment work |
| `Planning_Progress_Log` | Append-only workflow history |
| `Event_Log` | Consequential payment-expectation audit |
| Finance pause forecast | Derived view of structured, non-parked pause cards |

## Normal Flow

```text
capture tutor-away period
  -> preview MMS and retain actual teaching dates
  -> one absence record per tutor/date
  -> around 14 days before: choose cover or cancel

cover
  -> choose and confirm tutor
  -> pass on lesson notes/context
  -> confirm MMS/calendar was updated or no change was needed
  -> send the parent message
  -> no payment-pause card

cancel
  -> send early notice that says what will happen
  -> create/refresh structured student pause work
  -> group repeated weekly cancellations where safe
  -> nearer the lesson, complete payment action
  -> send final confirmation saying what happened
  -> close every linked dated absence only when its work is complete
```

The dashboard never sends the parent message or changes Stripe automatically.
Copy/send, payment execution, and final confirmation are explicit human actions.

### Temporary cover context

Open cover decisions are projected into the read-only teaching context as dated
cover episodes. A cover episode says that one tutor is temporarily teaching a
specific lesson for the usual tutor; it never changes the student's permanent
assignment or creates a second ongoing teaching relationship.

The episode derives five milestones from the existing `Tutor_Absence_State`
record: cover chosen, cover confirmed, notes/context passed on, calendar checked,
and parent informed. Only the next incomplete step is promoted as attention.
The episode becomes quiet when all five are complete and disappears when the
absence is resolved. A failed state-tab read is shown as unavailable rather than
being interpreted as no cover work.

### Group bookings and who gets a pause card

One MMS event can carry several students — a sibling pair, or a class such as
the ukulele group. Events are expanded to **one lesson per student** before any
decision is made, so every household is reached on its own record. This replaced
an earlier day-wide block that existed only because the event was collapsed to
its first student.

A structured pause card exists to drive the Stripe payment pause, so it is
raised per student by payment mode:

| Student | Reached for the parent message | Pause card |
| --- | --- | --- |
| `paymentMode = stripe` | yes | yes — one per student, keyed by student and event |
| `paymentMode = manual` | yes | no — there is no subscription to pause |
| payment mode unknown | yes | yes — missing data must not silently drop a household |

So a sibling pair on Stripe produces two individual cards from one event, while
a class of manual payers produces none — but nobody drops out of the parent
communication list either way.

## Timing

| Window | Expected work |
| --- | --- |
| 21+ days | quiet planning visibility |
| 16–14 days | cover/cancel decision and initial parent notice |
| 10 days or fewer | notice is overdue and shown as an exception |
| about 5 days before first missed lesson | payment and final-confirmation work |

One-off, repeated, and summer absences use the same rules.

## Grouping And Superseding

`Tutor_Absence_State` always stays per date. Consecutive weekly cancellations
for the same student may become one away-period pause card. Widely spaced or
fortnightly-looking dates must not be stretched into a broad period.

When a better active grouped card is created, smaller active cards are parked
and a progress-log explanation is appended. Completed, parked, or deliberately
deferred cards are never reopened or overwritten. History is not deleted.

Finance counts active and done structured pause cards because `done` means the
admin action occurred, not that the future pause ended. It ignores parked cards.
`Returning from date` means the first lesson/date back.

## Fail-Loud Exceptions

| Exception | Required behaviour |
| --- | --- |
| MMS cannot load | block capture/decision; never convert failure into “no lessons” |
| MMS changed after capture | block notice/payment/final confirmation until the real date is reviewed |
| multi-student MMS event | expand to one lesson per student so every household is reached; no manual block |
| payment explicitly marked not needed | create a non-pause final-confirmation card with no finance effect |
| student is only marked `stripe_paused_expected` | still create the dated structured pause card; the undated expectation is context, not proof that this absence window is covered |
| dates expand after notice | park the earlier open notice; label a replacement `Update:` if the old notice was completed |
| cover changes to cancellation | create normal notice/pause work and check whether a cover correction is owed |
| cancellation changes to cover | manually park/remove related pause work until a reconciliation tool exists |

No missing linked card is treated as completion. Cover never creates pause work.
Only an explicit per-lesson payment-not-needed decision is excluded from new
pause work. `Students.payment_expectation = stripe_paused_expected` does not
carry date coverage, so it cannot suppress the payment tool or complete a tutor
absence by itself.

## Reconciliation Boundary

Finance/reconciliation uses only dated cancellation/cover state, structured
pause cards, and the student's own pause coverage. Early notices, manual
group-event records, original tutor-absence capture/handoff cards, and
no-payment final confirmations have `isPause: false` and cannot alter payment
expectation or finance maths. Cancellation wording on the parent handoff must
never make it a structured pause; the student-linked child cards own that work.

If the student's own pause is recorded after a tutor cancellation, the earlier
tutor-absence pause card can become redundant. Reconciliation remains
order-independent and shows the student as covered. Use **Close redundant card**
on `/admin/finance/reconciliation`; it is offered only after date coverage is
established. Do not auto-retire it from incoming text or inferred overlap.

## UX And Safety Rules

1. One card asks for one thing: decide, tell early, complete payment, or confirm
   the final outcome.
2. Message-evidence cards cannot be completed by a generic status button.
3. Every block names the reason and one safe next action.
4. Early notice never claims payment happened; final copy appears only after the
   payment/no-payment outcome is known.
5. A tutor-absence pause card keeps the payment tool as step one even when the
   student is already marked `stripe_paused_expected`; the final parent message
   unlocks only after the dated tool check is confirmed.
6. Later sync may create missing work or refresh an active generated card, but
   never reopens completed, parked, or deferred work.
7. Parent-facing grouping never replaces exact dated workflow truth.
8. A student-linked notice, payment, or final-confirmation card verifies that
   student's saved lesson against live MMS. A changed lesson for another
   household on the same tutor/date blocks that household's card, not every
   student's otherwise-current pause work.
9. In the due-today view, an initial-notice card shows its message and copy
   action inline, with an explicit **Mark sent & complete** action. **Park
   notice** is a separate history-preserving choice and must not record the
   notice as sent. Do not replace the message-evidence gate with generic Done.
10. A covered absence cannot be resolved until the cover tutor, briefing,
    calendar/no-change check, and every affected parent message are recorded.
    The same deterministic guard runs in the server write path; the UI checkbox
    is not the only enforcement.

## Dated Payment Handoff Correction (2026-07-27)

The observed failure was specific and plausible-looking:

1. the first card correctly asked staff to send the early cancellation notice;
2. the generated follow-up card then claimed the pause was already handled and
   offered only a final parent message;
3. the payment pause tool was missing whenever the student carried the broad
   `stripe_paused_expected` flag.

The root cause was using an undated student-level expectation as evidence that
the tutor-absence dates had been processed. That flag has no pause-window
coverage and cannot prove a Stripe action, a dated tool check, or a completed
tutor-absence handoff.

The corrected contract is:

- notice-enabled `v1` cancellations create dated structured pause work even
  when the student is already `stripe_paused_expected`;
- generated pause cards set `is_pause = true` explicitly;
- the Planning card keeps **Payment action** as step one and unlocks the final
  parent confirmation only after the dated tool check is confirmed;
- the pause-tool prefill reason is `Teacher Holiday`;
- only an explicit per-lesson `pauseSkipped` / payment-not-needed decision
  creates a message-only `tutor-absence-final-confirmation` card;
- sync parks obsolete active message-only cards but never rewrites `done`,
  `parked`, or deferred history;
- pre-`v1` records are not silently backfilled merely because they contain old
  tutor-absence state.

The frozen historical Learning Log contains a 2026-06-25 description saying
that `stripe_paused_expected` students were skipped. That describes the old
implementation and is not current instruction. Current code, focused tests, and
this canonical document supersede it.

### Point-in-time production repair

The production Planning sync on 2026-07-27:

- created 9 missing structured pause cards;
- refreshed 5 active structured pause cards;
- parked 8 obsolete active message-only cards with progress/audit notes;
- left 0 active message-only cards produced solely from the undated
  paused-expected flag;
- left 14 active structured tutor-absence pause cards, all explicitly marked
  `is_pause = true`.

Those totals are repair evidence, not permanent expected counts. Future
absences and completed work will change them. The durable invariant is the card
shape and action boundary, not “14 cards”.

The repair changed dashboard Planning workflow state and append-only progress
evidence only. It did not execute Stripe, edit MMS, change
`Students.payment_expectation`, or send/copy a parent message.

## Future Regression Check

Run this check after changing tutor-absence sync, pause-card rendering, Planning
completion gates, structured pause note labels, or payment-expectation handling.
Also use it if a future second card looks like a message-only confirmation.

Start with deterministic tests:

```bash
node --test tests/admin/tutor-absence-helpers.test.mjs
node --test tests/admin/planning-client-helpers.test.mjs
node --test tests/admin/pause-forecast.test.mjs
npm run docs:check
```

Then, on the next real `v1` cancellation involving a student already marked
`stripe_paused_expected`, check without fabricating a live absence:

1. `/admin/planning` has an active `linkedWorkflowId = tutor-absence` card for
   the affected student/date or safely grouped date block.
2. The card is explicitly a structured pause (`is_pause = true`) and retains
   the exact date labels consumed by `pause-forecast.mjs`.
3. **Open payment pause tool** is the first action and its prefill uses
   `Teacher Holiday`.
4. The final parent message stays locked until the human confirms the dated
   payment-tool check.
5. No active `tutor-absence-final-confirmation` card exists merely because the
   student is paused-expected.
6. An explicit payment-not-needed decision still creates the non-pause,
   message-only final card and records its reason.
7. Any superseded active message-only card is parked with progress evidence;
   terminal history remains unchanged.
8. Finance sees the structured non-parked card, while early notices and genuine
   no-payment final cards remain outside pause forecasting.

Do not use a global card count as the check, and do not run Stripe or send a
parent message just to prove the regression is fixed.

## Code And Verification

- orchestration: `lib/admin/tutor-absence.js`
- rules/IDs/grouping: `lib/admin/tutor-absence-helpers.mjs`
- Planning payment-tool classification and prefill:
  `lib/admin/planning-client-helpers.mjs`
- Planning action gating/rendering:
  `components/admin/planning/PlanningCard.js`
- direct tutor-absence controls:
  `components/admin/AdminTutorAbsencePageClient.js`
- forecast parser: `lib/admin/pause-forecast.mjs`
- focused tests: `tests/admin/tutor-absence-helpers.test.mjs`,
  `tests/admin/pause-*.test.mjs`, and planning helper tests

Coverage must include two-week/overdue targeting, schedule mismatch,
multi-student expansion and the manual-payer card rule, single versus grouped
dates, parked superseded cards,
no-payment cards outside finance semantics, expanded-date update notices, and
reverse-order overlap.

Do not change the exact structured pause labels without checking
`lib/admin/pause-forecast.mjs` and every parser consumer.
