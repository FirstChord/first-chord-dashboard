---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-21
---
# Tutor Payroll: Phase 3 Pilot And Scheduling

## Shipped Foundation

Payroll review produces a frozen tutor statement from `Payroll_Runs`. A signed,
30-day bearer link at `/pay/statement/<token>` lets the named tutor confirm or
raise a query without login. Responses are idempotently stored on the payroll
row; disputes stay out of the Wise batch. Confirmation never moves money and
paid runs lock further responses.

Do not rebuild the shipped Phase 1/2 flow. Current behaviour lives in
`lib/admin/tutor-statement*`, `app/pay/statement/[token]/`, payroll helpers, and
focused tests.

## Shipped Phase 3 Pilot

The source contains the manual pilot path:

- `Tutor_Pay.contact_email` and `contact_email_verified_at` are separate from
  Wise recipient data;
- admins carry forward each tutor's already-recorded weekly or biweekly choice
  and maintain the verified statement address at
  `/admin/finance/payroll/settings`;
- cadence corrections are refused while a reviewed run remains unpaid, take effect
  from the day after the last paid-through period (or today before a first run),
  and append actor/before/after/effective timing to `Event_Log`;
- the payroll preview derives whether a complete cadence has accrued. A
  biweekly tutor cannot be reviewed after only one week;
- ordinary periods are Monday-inclusive/Sunday-inclusive in storage, equivalent
  to Monday-to-Monday with the second Monday excluded;
- the one-off 21 September 2026 cutover settles legacy pay through Sunday 20
  September, requires tutor confirmation, and refuses to infer an unrecorded
  historical start date;
- future periods remain preview-only until their final Sunday has finished;
- an unresolved earlier statement reserves its dates, blocks later review, and
  blocks every later row for that tutor from Wise until it is resolved;
- the cutover screen provides a progress queue and one next action per tutor so
  a second operator can run it without knowing the underlying ledger model;
- the reviewed statement page is the preview for one explicit Gmail send to a
  verified address. The email contains no amount or student names, only the
  private 30-day statement link;
- `Payroll_Runs` records the delivery claim/result. A `sending` or `unknown`
  result blocks automatic retry and instructs the admin to check Gmail Sent.

This remains a code and operator pilot until the existing cadence choices and
verified contact details are populated and the risky rollout checks below pass.

## Remaining Goal

- populate and verify active tutors' payroll contact addresses;
- transcribe the tutors' existing cadence choices rather than asking them again;
- run several manual email cycles across weekly and biweekly tutors;
- add an admin batch preview only after the one-at-a-time path has representative
  evidence;
- schedule due-statement email only after delivery, confirmation, dispute,
  ambiguous-Gmail, and missed-email evidence is understood;
- add a private one-to-one WhatsApp reminder workflow for overdue confirmations,
  never a payroll link or pay detail in a tutor group.

## Decisions Recorded

- weekly and biweekly are the carried-forward cadence choices;
- a reviewed unpaid statement freezes cadence until paid or reopened;
- otherwise the new cadence begins with the next unpaid period after the last
  paid-through date;
- email is primary; WhatsApp is a private reminder/escalation channel;
- the existing 30-day bearer-link lifetime stays unchanged for the pilot.

## Scheduling Evidence Still Needed

- successful and failed delivery counts, including whether Gmail timeouts are
  actually found in Sent;
- confirmation/query response times by channel;
- proof that biweekly due dates survive several alternating Mondays;
- the reminder threshold (start with a human judgement around 24–48 hours);
- an agreed pilot cohort and rollback owner.

## Guardrails

- no auto-pay and no Wise API mutation
- tutor confirmation is a review signal, not payment approval
- outbound messages remain human-previewed during the pilot
- statements contain student names and tutor pay; enforce tutor-scoped access,
  short-lived links, minimal logs, and the data-protection policy
- Gmail uncertainty is manual follow-up, never a blind retry

## Done When

Every active tutor has a verified contact and recorded cadence, the manual email pilot
has representative evidence, and scheduled delivery (if enabled) preserves the
same preview, uncertainty, confirmation, and human payment boundaries.
