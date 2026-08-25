---
status: canonical
audience: [human, agent]
last_verified: 2026-07-20
---
# School Policy

## Purpose

These are school-level operating rules that implementation must preserve. Field
semantics, calculations, UI patterns, and recovery details belong in their
focused documents.

## Student And Tutor Identity

- One student normally maps to one tutor.
- If a student genuinely studies separately with two tutors, prefer two MMS
  student identities and two portal/dashboard identities.
- Missing or conflicting tutor records must be shown and resolved, not guessed.
- Test students remain explicitly flagged; never infer them from a name.

## Onboarding

A student is operationally onboarded only when:

- the `Students` row and registry entry exist
- MMS student state is active
- the MMS billing profile is ready
- the first lesson has been created
- when onboarding started from a suggested MMS `Free` event, that exact source
  event has been cleared after the lesson was confirmed

Before any onboarding write begins, the admin must also confirm that the welcome
call covered the weekly payment terms and that the lesson WhatsApp group contains
the parent/student contact, assigned tutor, Finn, Tom, and Fennella. One
person may satisfy more than one role. These confirmations are human assertions,
not WhatsApp delivery evidence.

The family receives the weekly Stripe subscription link during onboarding even
when lesson one is some time away. The first payment pays for lesson one. Before
lesson two, the family decides whether to continue: continuing leaves the weekly
subscription running; stopping means cancelling future weekly payments, not
promising a refund. If lesson one is at least seven days from onboarding, create
an idempotent Planning review for the next Monday, Wednesday, or Friday so a
human checks the subscription timing before the first renewal. That review must
not read as evidence that Stripe was checked and must never mutate Stripe.

Stripe linkage remains a separate provider-reconciliation workflow and may
complete after the first lesson. A Stripe-managed setup becomes overdue for
review seven days after the first lesson.

Onboarding crosses Sheets, registry/GitHub, and MMS and can partially succeed.
Show every step result and recovery action; never collapse warnings into
unconditional success. Keep the waiting record open, and do not create
post-onboarding check-ins or notes-access follow-ups, until the canonical record
and all applicable MMS conditions above are complete.

The first-lesson Planning check-in covers three visible checks: lesson outcome
and payment decision, membership of both the lesson and community WhatsApp
groups, and receipt of the student portal link plus notes-privacy instructions.
The per-check ticks are local UI guidance; only the final Planning `done` status
is persisted, and it remains unavailable until all three are ticked.

## Lessons, Cancellation, And Leaving

- The first lesson is paid before the slot is secured.
- A student cancellation with at least one week's notice is not charged.
- For shorter notice, the normal fallback may be a Zoom lesson in the existing
  slot or tutor practice video; same-day cancellation/no-show is not eligible
  for a practice video.
- A tutor cancellation requires the explicit cover-or-cancel workflow. If
  cancelled, payment handling and truthful parent confirmation remain human
  actions.
- Families ending lessons are asked for two lessons' notice.

One-off lesson moves are not offered as swaps/make-ups. A permanent schedule
change is welcome and routed to a human to find a sustainable slot.

## Pauses And Holidays

Pause windows are evaluated against usual lesson dates. Outside July/August, a
break may normally pause payment for up to three weeks; weeks four and five are
charged, and a break of six weeks or more normally releases the slot. Summer is
handled separately from that extended-break rule.

The school normally teaches through bank holidays and summer. The standard
school-wide closure is two weeks at Christmas; Easter/summer absences are
student- or tutor-specific unless explicitly declared otherwise.

`Pause History`, Sheets payment expectation, and live Stripe state are distinct
evidence. Their alignment and reconciliation rules are in
[Payments](./payments.md). Tutor-cancellation grouping is in the
[absence contract](../workflows/tutors/absence-to-pause.md).

## Payments

Stripe is the normal recurring-payment method. Approved manual-payment cases
remain exceptions until explicitly changed and must not receive Stripe-failure
alarms. A first failed payment is reviewable evidence because Stripe may retry;
no parent action follows automatically.

Current prices and provider mechanics belong in administered configuration and
the payment/onboarding implementation, not duplicated policy prose. The
canonical payment state and action boundaries are in [Payments](./payments.md).

## Communications

Parent communication is approval-first. Drafting, classification, or copying
does not prove a message was sent. WhatsApp remains human copy/send.

Practice Chat lesson-note email is the narrow automated-send exception: the
tutor reviews the note, the final screen names the student and server-derived
parent recipient, and the tutor explicitly confirms that delivery. It does not
permit automated payment, pause, onboarding, marketing, or general messaging.

See [Practice Chat delivery](../workflows/practice-chat/delivery.md) and
[Copy and tone](./copy-and-tone.md).

## Automation Boundary

The system must not automatically send parent messages, execute payment, alter
payment expectation, change student/tutor/lesson state, archive a student, or
resolve operational work from unreviewed text or AI output.

Consequential actions require current authoritative evidence, deterministic
validation, the established human preview/confirmation, and an audit record.
When evidence conflicts, preserve source, identifiers, freshness, and
uncertainty rather than silently choosing a winner.

Repository-wide engineering boundaries are in [AGENTS.md](../../AGENTS.md) and
workflow interaction rules are in [Workflow design](./workflow-design.md).
