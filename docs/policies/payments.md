---
status: canonical
audience: [human, agent]
last_verified: 2026-08-04
---
# Payments Rules

## Purpose

This is the policy boundary between dashboard-owned payment intent and Stripe
provider facts. It governs issue detection and reconciliation; it does not
authorise Stripe mutation.

## Ownership

- `Students.payment_mode` and `Students.payment_expectation` express First
  Chord's operational intent.
- Stripe owns customers, subscriptions, invoices, payment intents, and whether
  provider-side money movement occurred.
- Stripe snapshot tabs are timestamped caches, not provider truth.
- Pause History is evidence used only by the explicit reconciliation workflow.

## Blind Monthly Stripe Proof

The monthly forecast is a test of dashboard completeness, not an alternative
source of payment truth. `Stripe_Forecast_Monthly` locks one first-write-wins row
from dashboard-owned roster, price, expectation, schedule and structured-pause
evidence. The Stripe refresh endpoint must persist that row before it makes any
Stripe request; failure to lock the forecast means no provider read or cache
write occurs.

A current pause state describes the forecast date, not necessarily the whole
month. When a structured pause window overlaps the target month, weekly lessons
on and after its return date are billable again; lessons inside the half-open
pause window remain excluded. If a paused student has no reliable dated window,
the forecast stays conservatively at zero rather than inventing a return. An
`inactive_or_stopped` student is never revived by a historical pause card.

After the month closes, `Stripe_Collected_Monthly` reveals paid invoices created
in that month. Subscription ID is the preferred student match. A customer-only
invoice is matched only when that customer identifies one student; ambiguity
stays visible as unmatched money. The finance page reports both the net total
gap and the sum of student-level errors. The latter is the integrity measure:
two wrong student amounts must not cancel into an apparently correct headline.
The compact student breakdown also retains the unique UTC days on which paid
invoices were created. Those dates are calibration evidence for seasonal
patterns; they are not attendance or proof that a lesson happened.

Neither record authorises a Stripe mutation, changes payment expectation, or
proves an accounting/bank balance. Forecast discrepancies are investigation
evidence; Stripe remains the provider truth.

The default Finance view uses progressive disclosure: show the current locked
prediction or scored result, specific forecast-input gaps, attributed error
categories, and links to real finance work. Post-lock onboarding remains part of
the total prediction error but is separated from known-roster model error. The
old run-rate-vs-collection aggregate, generic percentage pause scenarios, and
"every waiting student converts" value are retired: they duplicate the scored
test or imply precision their inputs do not support. Break-even/what-if remains
a pure foundation for a later model, not a live finance surface. The Overview
may read `Waiting_List_State` only to identify onboarding completed after the
immutable forecast lock; it never changes the locked number.

Older Stripe invoices are calibration evidence, not historical forecast rows.
They can establish billing-anchor timing, seasonal invoice counts, legacy price
differences, and matching gaps, but must not be presented as a backtest against
dashboard pause/roster inputs that were never frozen. Fresh first-write-wins
months remain the score. Any later timing adjustment must be versioned and
evaluated separately before it changes the headline prediction.

Glasgow school holidays may be joined to forecast errors as versioned external
context. They must not directly reduce a Stripe forecast: lower attendance does
not imply lower collection unless First Chord's observed paid-invoice evidence
shows a stable relationship. A holiday adjustment must be evaluated against at
least one full seasonal cycle, separately from explicit student pause dates,
before it can influence the headline prediction.

Allowed payment modes are `stripe`, `manual`, and `unknown`. Approved manual
payment students are not evaluated as broken Stripe students.

Allowed expectations are:

- `setup_pending`: Stripe setup is not yet expected to be complete
- `stripe_active_expected`: normal active billing is expected
- `stripe_paused_expected`: an intentional payment pause is expected
- `inactive_or_stopped`: billing should no longer be active

For a Stripe-managed student with a blank expectation, no Stripe IDs means
setup-pending. Existing linkage means active-expected unless explicit evidence
says otherwise; stale or incomplete linkage must remain visible.

## Deterministic Issue Rules

Issue type names are API/storage contracts. Search every consumer and update
tests before changing one.

| Intent/evidence | Current issue |
| --- | --- |
| local links: neither Stripe customer nor subscription ID recorded | `STRIPE SETUP INCOMPLETE` |
| local links: customer ID absent but subscription ID recorded | `STRIPE CUSTOMER MISSING` |
| local links: customer ID recorded but subscription ID absent | `STRIPE SUBSCRIPTION MISSING` |
| live check: active-expected but no subscription found | `ACTIVE_WITHOUT_SUBSCRIPTION` |
| active-expected, subscription cancelled | `SUBSCRIPTION_CANCELLED_UNEXPECTEDLY` |
| expected state disagrees with provider pause/activity state | `SUBSCRIPTION_STATE_MISMATCH` |
| inactive/stopped but subscription remains active | `INACTIVE_STILL_BILLING` |
| latest payment evidence has failed and no retry is scheduled | `PAYMENT_FAILED` |
| failed payment has a Stripe retry scheduled | `PAYMENT_RETRYING` |
| setup-pending but both Stripe links exist | `SETUP PENDING STRIPE LINKED` |

Manual-payment cases suppress Stripe mismatch alarms. Setup-pending is normally
workflow work, not a payment failure. A paused subscription's normal void invoice
must not be misclassified as failure; a remaining balance combined with
`past_due`/`unpaid` evidence may still be a failure.

Unknown, stale, missing, or conflicting evidence must produce a reviewable
unknown/warning state—not a guessed provider fact or a consequential action.

The implementation authority is `lib/admin/stripe-snapshot-helpers.mjs`,
`lib/admin/issue-detectors.mjs`, and their focused tests. This table describes
intent; code and tests win if a new condition has been deliberately introduced.

## Read And Refresh Rules

Ordinary page reads use cheap local state and cached normalized snapshots. Live
Stripe checks are explicit or scheduled; list rendering must not query Stripe
once per student.

Every Stripe-derived display must retain `checked_at` and clearly distinguish
cached from live evidence. Agents and UI helpers consume normalized projections,
not arbitrary raw Stripe responses.

`STRIPE_API_KEY` is a restricted read key. Customers, Subscriptions, Invoices,
Prices, and Payment Intents require Read; write permissions stay disabled.
Missing Payment Intents Read must fail the refresh visibly rather than silently
classifying partial invoice evidence.

## Pause-Expectation Reconciliation

Overview, Issue Queue, and Stripe reads never update
`Students.payment_expectation`.

Two paths, and only two, may write `Students.payment_expectation` from Pause
History. Both apply the identical eligibility test below; they differ only in who
authorises the run.

**Attended — `/admin/flags`,** for any run a human wants to see first:

1. authenticated GET builds an exact preview
2. the admin reviews affected students and transitions
3. authenticated POST requires `confirm: true` and reloads current evidence
4. only eligible changes write `Students.payment_expectation`
5. each attempt and applied change appends an `Event_Log` record

**Unattended — `POST /api/cron/pause-expectations`,** nightly at 04:30 UTC via
`.github/workflows/pause-expectations.yml`. It is gated on `PAUSE_SYNC_SECRET`
(its own secret, not `SCHEDULE_REFRESH_SECRET`, so it can be revoked without
disabling the schedule caches), previews before writing, applies the same
eligible changes with the same three batched writes and the same `Event_Log`
records under actor `cron@github-actions`, and then rescans live Stripe so the
Issue Queue reflects the result.

The unattended path exists because a pause ending is a silent event: Stripe
resumes billing on its own, nothing prompts anyone to update the sheet, and the
resulting `SUBSCRIPTION_STATE_MISMATCH` issues accumulate without meaning anyone
was billed wrongly. Its extra guardrail is a cap — a plan above
`MAX_UNATTENDED_CHANGES` (25) is refused with HTTP 409 before anything is
written, naming the students it declined, because a routine night moves a
handful and an unusually large plan means an upstream input changed shape. Clear
a legitimate backlog by dispatching the workflow with a higher `maxChanges`,
which is an explicit human decision, or by using the attended path.

Either run batches all attempt events, all eligible Students-cell
updates, and all completion events into at most three normal Sheets write
requests, regardless of student count. Multiple Students rows for the same MMS
ID are collapsed to one student decision and every matching expectation cell is
aligned in the same batch. A retry always reloads current evidence and proposes
only work still outstanding.

Eligibility is deliberately narrow: Stripe-managed student, subscription-ID
Pause History match, high confidence, and coverage of a usual lesson.
Setup-pending, inactive/stopped, low-confidence, missing-schedule, invalid-window,
and no-usual-lesson cases are excluded. This narrowness is what makes the
unattended path acceptable: anything weaker already becomes an issue for a human
rather than a write. Neither path ever changes Stripe.

## Action Boundary

- Issue Queue state is not payment truth.
- Marking an issue handled does not prove provider repair.
- Drafts, summaries, or AI output never authorise payment action.
- No dashboard workflow auto-pays, auto-pauses, resumes, or cancels Stripe.
- Provider changes require their established human preview/confirmation path and
  audit evidence.

Relevant tests include `payments-helpers`, `payment-*`, `stripe-*`,
`issue-detectors`, and `issue-queue*` under `tests/admin/`.
