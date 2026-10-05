---
status: supporting
audience: [human, agent]
last_verified: 2026-10-05
---
# Scoped payroll delivery: approval now, execution later

## The milestone

Finn approved activation on 5 October 2026 after the manual payroll and cutover
workflow had been exercised with real tutors. This is the dashboard's first
scoped background tutor-payroll statement send, not its first automatic email:
the internal newsletter-arrival notice already exists. Practice Chat also sends
parent notes after an immediate recipient-specific human confirmation.

The new boundary is **a human approves one checked period now; deterministic
code may execute that same approval later when its prerequisites clear**.
It is not a general scheduler, an AI sending permission or automatic payment.
Activation evidence and the kill switch belong in the
[runbook](../../operations/runbook.md#scoped-payroll-delivery-rollout).

## What was learned from real payroll use

- **Agreement, delivery and settlement are different facts.** Tutors may be
  paid against their own invoices before confirming a cutover statement. Record
  actual payment separately; never create a response or send another payment
  to make the queue look complete. A waived paid-cutover follow-up is an admin
  decision, not tutor agreement, and never applies to regular periods.
- **Completion needs dated evidence, not an empty current preview.** An earlier
  open statement reserves its coverage. A paid-through attestation records only
  what is known, without manufacturing an amount/date/receipt. A regular £0
  close-out records exact coverage and reason, not payment. Changed MMS evidence
  can reopen work; the completed group must preserve historical settlement.
- **Recorded does not mean payable.** `TeacherAbsentNoMakeup` is recorded tutor
  absence, not missing attendance and not paid teaching. Unknown labels stay
  reviewable. Cover affects the actual tutor's lesson evidence, not a guessed
  standing roster or a blanket historical pay override.
- **An invoice correction invalidates agreement with the old figure.** Fresh
  MMS evidence can change a reviewed calculation; an explicit corrected review
  clears stale response/delivery evidence before a new statement is shared.
  Email remains primary; private WhatsApp helps resolve queries/remind without
  becoming another payment or confirmation authority.
- **Saving and reloading are different outcomes.** A save can persist while a
  slow refresh leaves the operator staring at Saving. Feedback belongs beside
  the pressed button, with visible success/error and safe retry rules. A stuck
  screen is not evidence that repeating a consequential action is safe.
- **The useful automation removes a handoff, not a check.** One consolidated
  missing-records email sends tutors to Practice Chat; they need not email back
  to say they finished. Exact school-side anomalies can be resolved through
  reasoned exceptions, not fictitious notes. Only the newly approved period can
  proceed automatically once trusted evidence actually clears.

These are lessons from observed use, not proof that every live failure mode has
been tested. Full-cycle automatic delivery still needs one staff-approved real
period and a verified Gmail/Sheets outcome; an empty-store smoke is not that test.

## Traceable execution and ownership

The evidence chain is: named admin/exact scope and expiry; definite checklist
Gmail receipt; fresh MMS and school settings; frozen reviewed `Payroll_Runs`;
immutable statement-revision claim and Gmail receipt; actual tutor response;
human Wise approval and separate payment record. Each fact retains its own
source and time. A successful email proves sending, not receipt or agreement.

MMS owns lesson structure, attendance and note presence. `Tutor_Pay` owns rate,
cadence and the verified contact. Sheets `Payroll_Runs` owns the reviewed
statement, tutor response and recorded settlement. PostgreSQL stores only the
exact approval, execution coordination and immutable deduplication keys. Wise
remains payment truth. There is no new payroll ledger or inferred historical fact.

Approval binds the exact tutor/teacher, lesson/event/student identities, period,
lesson dates/durations, rate, cadence, verified recipient and saved school
decisions. Attendance status and note presence may improve; other changes hold
for a human. Expiry is 14 days. £0, cutover, custom/partial windows, uncertainty,
queries and conflicting coverage stay manual. No historical draft is opted in.

Fresh reads and tutor-scoped locks narrow races; they cannot make MMS, Sheets
and Gmail transactional. Claim before provider work and never automatically
recycle it. A timeout, missing receipt, interrupted worker or failed audit means
check the real statement and Gmail Sent, not blind retry. The feature flag stops
new approvals/checks but cannot unsend a provider request already started.

## Keep future scope deliberate

Broader Monday auto-invoicing, automatic reminders, WhatsApp sending, video
requirements, automated payment and a source switch to the lesson ledger are
separate decisions. None is implicitly approved by this flow. The MMS exit must
preserve identifiers, completeness and note/attendance semantics before payroll
consumes a replacement source; the rebuildable mirror is not yet payroll truth.

Canonical operator rules: [paying tutors](../../workflows/finance/paying-tutors.md).
Coordination schema/retention: [state tabs](../data/state-tabs.md#payroll-delivery-coordination-postgres).
Executed safeguards: `tests/admin/payroll-deferred-delivery.test.mjs` and
`tests/admin/money-path-invariants.test.mjs`.
