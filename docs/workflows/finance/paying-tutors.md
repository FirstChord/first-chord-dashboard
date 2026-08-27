---
status: canonical
audience: [human, agent]
last_verified: 2026-07-30
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
- **`Tutor_Pay`** supplies rate, cadence, pay model and default payment route.
- **`Payroll_Runs`** stores the frozen reviewed amount, tutor response and the
  dashboard's paid marker. It is a reconciliation ledger, not bank truth.
- **`Tutor_Wise`** supplies the saved Wise recipient details.
- **Wise** is where the payment is actually uploaded and approved.

Nothing on the payroll page sends money or WhatsApp messages automatically.
For hourly tutors, each payable slot is `hourly rate × duration / 60`. A group
slot adds £2 once to that slot, regardless of duration or student count; it is
never multiplied per student.

## Before Wednesday: prepare and agree the figures

1. Open **Finance → Payroll**. The date at the top is the intended pay date.
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
5. Choose the payment route:
   - **Pay normally · confirmation optional** lets a reviewed row enter the Wise
     batch without waiting for the tutor.
   - **Tutor confirmation required** holds it out until the tutor confirms.
6. Click **Review and generate statement**. Review freezes the figure in
   `Payroll_Runs`; a draft or unrecorded lesson cannot silently enter the batch.
7. Open **Send statement**, click **Copy link and mark sent**, then paste the link
   into the tutor's WhatsApp conversation. The dashboard does not send it.

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

## Wednesday: create and pay the Wise batch

1. Open Payroll and check the date. If Wednesday is already selected, there is
   no need to click **Load**.
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
   disputes are held out; duplicate reviewed rows with different totals raise an
   amount-conflict warning.
4. Click **Download Wise CSV**. The CSV contains every eligible reviewed-unpaid
   tutor, regardless of the preview date or custom window currently on screen.
   The pay-date parameter only names the downloaded file. An older reviewed row
   remains in future batches until it is marked paid.
5. Upload the CSV to Wise, verify recipients and amounts, and approve the
   transfers in Wise.
6. Only after Wise accepts the payment, return to the same browser session and
   click **Mark batch paid**. The button deliberately unlocks only after the CSV
   has been downloaded in that session.

## After payment

Marking the batch paid stamps the included `Payroll_Runs` rows and removes them
from future Wise batches. The same tutor link now renders a dated **Payment
receipt**. The tutor can reopen the WhatsApp link and save the receipt as a PDF;
resend the same link if useful.

## Safety checks and recovery

- Never click **Mark batch paid** before approving the transfer in Wise.
- A confirmation is agreement with the figure, not proof of payment.
- Unknown MMS attendance statuses fall to review; they never silently pay.
- If an MMS write fails, the row stays unresolved and shows the error.
- If a tutor disputes a statement, resolve it and get a fresh confirmation. A
  material statement change automatically clears the stale confirmation and
  returns the run to **Ready to send**.
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
- Wise selection/CSV: `lib/admin/wise-helpers.mjs`,
  `app/admin/finance/payroll/wise-csv/route.js`
- State and fragile contracts: `docs/architecture/data/state-tabs.md`
