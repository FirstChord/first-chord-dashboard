---
status: canonical
audience: [human, agent]
last_verified: 2026-09-26
---
# Paying tutors

**Purpose:** turn recorded MMS lessons into an agreed tutor amount, pay the
reviewed batch through Wise, and leave both First Chord and the tutor with a
clear record.

## What each system owns

- **MMS** is the canonical attendance record and supplies the lesson dates,
  durations and tutor/student links used by payroll.
- **Pause History / WhatsApp context** is evidence for an attendance decision;
  it does not change payroll automatically.
- **`Tutor_Pay`** supplies rate, cadence, pay model, verified payroll contact
  email and default payment route. Its email is not a login or Wise identity.
- **`Payroll_Runs`** stores the frozen reviewed amount, tutor response and the
  dashboard's paid marker. It is a reconciliation ledger, not bank truth.
- **`Tutor_Wise`** supplies the saved Wise recipient details.
- **Wise** is where the payment is actually uploaded and approved.

Nothing on the payroll page sends money or WhatsApp messages automatically.
The reviewed statement page can send one explicitly approved Gmail message; it
does not schedule itself and it never pays the tutor.
For hourly tutors, each payable slot is `hourly rate × duration / 60`. A group
slot adds £2 once to that slot, regardless of duration or student count; it is
never multiplied per student.

## Regular cycle and queue

Finn approved the **Wednesday 09:00 Europe/London** cutoff and production
rollout on 26 September 2026. The rules below
apply to periods beginning on or after 21 September 2026. Cutover settlement
retains its separate human checks.

- Monday: review and explicitly email the due statements. Weekly tutors paid
  through 20 September first become due on 28 September; fortnightly tutors
  first become due on 5 October. Nothing schedules or sends itself.
- Wednesday: only confirmed statements enter that week’s file. A response at or
  after 09:00 UK time becomes eligible for the following Wednesday. A missing
  confirmation timestamp is an exception, never assumed timely. Unconfirmed
  statements and queries remain outstanding, retaining their original dates;
  the next period is not silently merged into the statement.
- The default view stays on the current Monday throughout the week. The oldest
  reviewed unpaid statement is projected into the normal queue, even if it was
  reviewed under an earlier cycle. **To handle**, **Waiting for tutors** and
  **Ready to pay** lead; **Upcoming** and recent payment history are secondary.
- Period and amount stay visible. Drafts are labelled estimates. Lesson evidence,
  corrections and period controls open on selection. Cadence remains in delivery
  settings. No payment or attendance rule is inferred from the visual grouping.

The new system requires confirmation even if an older settings row still says
`payment_route=normal`. Legacy pre-cutover normal payments retain their behavior.
A saved statement correction rechecks MMS, rejects a stale form, and clears the
old response/delivery evidence when its material basis changes. Review errors
remain beside the form.

## Private WhatsApp reminders

Open **Private WhatsApp reminder** from a reviewed statement. Check the named
tutor, dates and message; choose **This is a revised statement** only after
saving a correction. An unresolved query or known MMS drift must be resolved
before sharing a revised statement. The preview contains the private link, no
amount or student names. The same signed link renders the current saved version.

**Copy reminder** records `payroll_reminder_copied` in `Event_Log`, not delivery.
**Open WhatsApp** opens a chooser; manually select the tutor’s private one-to-one
chat and send it. Never use a group. Only **I sent this privately** records
`payroll_reminder_sent_admin_confirmed` and, if needed, the statement’s first
manual delivery. Existing email delivery remains intact. Logs contain the
payroll ID and channel, not the private bearer link or message text. These
controls never send, confirm a statement, or mark it paid.

## Monday cycle: prepare and agree the figures

1. Open **Finance → Payroll**. The date at the top is the Monday cycle date.
   A normal weekly period includes that previous Monday and ends on the Sunday
   immediately before the cycle date. A biweekly period covers the two complete
   Monday–Sunday weeks.
   A future cycle is preview-only: **Review** stays blocked until its Sunday has
   finished. If an earlier statement is still awaiting confirmation or has a
   tutor query, the next preview begins after that statement but cannot be
   reviewed until the earlier one is resolved and paid.
   **Load** only rebuilds the preview after changing this date; it does not
   create or send a payment.
2. Select a tutor. Open **Adjustments, invoice tracking and period** when the
   tutor's invoice closes on a different date. A custom end may be earlier than
   today. The adjustment changes the preview; reviewing the row freezes that
   exact period and amount.
3. Resolve every past lesson under **Needs recording**:
   - **Present** → MMS `Present` → tutor paid.
   - **Absent · tutor paid** → MMS `AbsentNoMakeup` → tutor paid.
   - **Cancelled · £0** → MMS `AbsentNotice` → excluded from tutor pay.
   - **Tutor absent · £0** → MMS `TeacherAbsentNoMakeup` → recorded but excluded from tutor pay. Do not re-mark it as an unrecorded lesson.
   - When a high/medium-confidence payment-pause record covers the exact lesson,
     payroll may prioritise the £0 choice. This is still a human decision.

   These buttons write to the exact MMS attendance row, invalidate the payroll
   attendance cache and refresh the figure. After an attendance change made
   outside the dashboard, use **Refresh MMS & recalculate**. The page confirms
   when fresh MMS data has loaded. Draft figures update immediately; if a run
   was already reviewed, the frozen amount remains visible alongside the new
   calculation until **Save corrected amount** is clicked. That explicit save
   preserves the review boundary and clears any stale tutor confirmation when
   the statement changed. A reviewed tutor with detected MMS changes is held
   out of the visible Wise batch and its generated CSV until the correction is
   checked and saved.
4. Check the period, lesson detail, total, adjustment, notes and invoice status.
5. New-system periods always require tutor confirmation. The route selector remains only for legacy periods.
6. Click **Review and generate statement**. Review freezes the figure in
   `Payroll_Runs`; a draft or unrecorded lesson cannot silently enter the batch.
7. Open **Send statement**. The statement itself is the final preview. If the
   tutor has a verified payroll contact, click **Send email to...**. For the
   manual fallback, copy the link, share it in a private one-to-one conversation,
   then click **I shared this link privately**. Copying alone does not record a
   delivery. Never use a tutor group. The email contains the private link but no amount or
   student names.

Before the first email for a tutor, open **Tutor delivery settings** from the
payroll page. Enter the address the tutor asked the school to use and tick the
verification box only after checking it with them. This is deliberately
separate from `Tutor_Wise.recipient_email` and the Google login map.

For the September 2026 cutover, use the **Cutover through Sun 20 Sept** view.
Its progress panel is the operator checklist: choose a tutor and follow the
single **Next** instruction through Prepare → Send → Waiting/Query → Ready to
pay → Complete. Do not move to a tutor's later cycle while their cutoff remains
open; the UI and server both block that path.
The cutoff page projects saved paid statements back onto that cycle, so they
stay counted as complete even after payment advances the next payable window.
Finished tutors are collapsed below the remaining queue; a separately paid
statement awaiting the tutor's reply stays visible as unfinished.
The live queue follows `Tutor_Lifecycle`: a retired tutor drops out after their
reviewed statements are settled. Their paid historical runs and statement links
remain available; an unresolved reviewed run keeps them in the queue.

A tutor entering the cutover with no saved payroll history may have a known
historical paid-through date but no reliable amount or payment date for the old
manual invoices. In that case an explicit `Payroll_Runs` row with
`status=paid_through`, `source=manual_paid_through_attestation`, and only the
known `period_end` establishes the boundary. It is **not** a payment run:
`period_start`, amount and `paid_at` remain blank, it cannot produce a statement
or enter Wise, and its notes state who reported the boundary. The preview starts
the next day, and an override reaching back into the covered dates is blocked.
If the remaining cutoff days currently have no payable lessons, the cutoff
shows **Nothing owed**; do not fabricate a £0 payment or silently close later
dates as paid. A later MMS correction still needs review.
When an attested boundary itself reaches Sun 20 Sept, the cutoff shows **Paid
through cutoff** and is complete without inventing a statement, confirmation,
amount or payment date.

If a cutover tutor was already paid against their own invoice separately from
the Wise batch, open their cutoff card's **Already paid separately?** section.
Enter the actual payment date, check the exact saved amount against the payment
record, and tick the verification box. **Record already paid** stamps payment
only, even if the tutor has not yet confirmed. It sends no email, makes no
payment and removes that statement from Wise. The card remains **Paid · awaiting
confirmation**, and their original private link still accepts a response. If
they reply by email instead, use **Tutor confirmed by email?** after receiving
the reply; enter its date only if known. Never record confirmation before it
happens. A query on an already-paid record remains visible for resolution but
cannot create another Wise payment. `tutor_response_source` distinguishes a
signed-link response from an admin-recorded email reply, and `paid_via=manual`
means paid separately from the batch, not a claim about the payment rail.
`paid_at` is the actual payment date entered by the admin; `updated_at` is when
the dashboard recorded it. The bank or invoice remains payment truth.

## What the tutor sees

The signed link needs no login and expires after 30 days. It shows a referenced
**Payment statement** with the period, payable lesson breakdown, frozen total and
issue date. The tutor can:

- choose **Confirm — looks right**; or
- choose **Something's off** and leave a note.

Confirmation records the response and timestamp; it never pays the tutor. A
query is held out of the Wise batch until the tutor confirms the resolved
statement. If First Chord changes the period, lesson basis, amount or payment
route, saving clears the old response and sent marker so the revised statement
must be resent. Admin-only note/invoice-status edits do not. Before payment, the
tutor can change Confirmed ↔ Query raised. Once paid, responses are locked.

The link includes **Print or save PDF**. This is a First Chord payment record,
not a replacement for any invoice the freelancer is required to issue.

The tutor's existing **Every week** or **Every two weeks** choice is recorded by
an admin in **Tutor delivery settings**; tutors are not asked to choose again.
A reviewed unpaid statement locks cadence correction. For a biweekly tutor, the
payroll page marks the alternating short window **Not due this week** and
refuses to review/email it early.

## After confirmation: create and pay the Wise batch

1. Open Payroll and check the cycle date. If the intended Monday is already
   selected, there is no need to click **Load**.
2. Read the top line and open **Ready to pay**. Check the tutor count and amount,
   not only the headline total. The bottom of the section names every tutor in
   the current Wise CSV and shows their amount, so the batch can be checked at a
   glance before downloading it.
   - `£X ready` is the total of all eligible saved reviewed-but-unpaid rows.
   - `N lessons need review` is a separate school-wide attendance count. It does
     not block a tutor whose own run is already reviewed and confirmed.
   - `N awaiting` counts confirmation-required reviewed rows still waiting for a
     tutor response.
3. Check any warnings. A missing `Tutor_Wise` recipient is omitted from the CSV;
   disputes are held out; duplicate reviewed rows with different totals are excluded until the conflict is resolved.
4. Click **Download Wise CSV**. The CSV contains the eligible reviewed statements in the visible batch, including carried periods. Download checks fresh MMS attendance, current confirmation and recipient data; a changed figure refuses the file and asks for review. The browser session retains this exact CSV and a signed statement snapshot, which expires after seven days. Treat the retained CSV as sensitive payment/recipient data; it is cleared after recording or explicitly discarding an unused file. New confirmations do not join an already-downloaded batch.
5. Upload the CSV to Wise, verify recipients and amounts, and approve the
   transfers in Wise.
6. Only after Wise accepts the payment, return to the same browser session and
   tick the confirmation that all transfers in this exact file were approved, then click **Record batch paid**. It uses the signed downloaded snapshot, not the current queue. A failed download never unlocks recording. The snapshot survives reloads in the same browser tab; do not discard it after any payment has been approved.

## After payment

Recording the batch paid stamps the included `Payroll_Runs` rows and removes them
from future Wise batches. The same tutor link now renders a dated **Payment
receipt**. The tutor can reopen the WhatsApp link and save the receipt as a PDF;
resend the same link if useful.

## Safety checks and recovery

- If recording partially fails, keep the downloaded batch and retry recording.
  Already-paid rows are skipped; never upload/pay again to repair a dashboard
  record. A changed statement, dispute, missing row or separate payment refuses
  recording and needs reconciliation against Wise.
- If only part of a Wise upload was actually paid, do not confirm the whole
  batch. Keep its file and reconcile the exact transfers before recording.
- Losing the browser snapshot or exceeding seven days requires checking Wise
  and the saved statements; re-downloading is not proof that payment is needed.
- Sheets remains last-write-wins. Fresh reads and signed fingerprints narrow
  stale-state errors but are not a database transaction across users/services.

- Never click **Mark batch paid** before approving the transfer in Wise.
- A confirmation is agreement with the figure, not proof of payment.
- Unknown MMS attendance statuses fall to review; they never silently pay.
- If an MMS write fails, the row stays unresolved and shows the error.
- `sending` or `unknown` statement delivery means Gmail may already have the
  email. Check the `musiclessons@` Sent folder; do not press send again merely
  to make the dashboard green.
- If a tutor disputes a statement, resolve it and get a fresh confirmation. A
  material statement change automatically clears the stale confirmation and
  returns the run to **Ready to send**.
- An unresolved reviewed statement blocks every later row for that tutor from
  the Wise batch, even if a later row was saved by an older version of the UI.
- If the Wise CSV total is unexpected, stop and inspect every tutor in **Ready to
  pay**. The batch is intentionally based on saved reviewed-unpaid rows, not just
  the date currently loaded.

## Implementation references

- Payroll UI: `app/admin/finance/payroll/page.js`
- Attendance write-through: `app/api/admin/payroll/attendance/route.js`,
  `lib/admin/mms.js`
- Payroll classification/window logic: `lib/admin/payroll-helpers.mjs`
- Confirmation and printable record: `lib/admin/tutor-statement.js`,
  `lib/admin/tutor-statement-helpers.mjs`, `app/pay/statement/[token]/page.js`
- Contact/cadence: `lib/admin/tutor-payroll-preferences*`,
  `app/admin/finance/payroll/settings/`
- Email delivery: `lib/admin/tutor-statement-email*`,
  `app/api/admin/payroll/send-statement-email/`
- Wise selection/CSV: `lib/admin/wise-helpers.mjs`,
  `app/admin/finance/payroll/wise-csv/route.js`
- State and fragile contracts: `docs/architecture/data/state-tabs.md`
