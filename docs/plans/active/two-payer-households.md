---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-17
---
# Two-Payer Households

## Outcome

A student can have more than one parent who receives their practice notes, and
more than one Stripe subscription paying for their lessons, without the
dashboard quietly dropping one of them.

The prompting case is Calan Clacherty (`sdt_BpDPJZ`). His parents Ross and Clare
are separated and split the lessons between them. Both are now in MMS.

This plan covers the two places the system is flat where the household is
plural. It deliberately does **not** cover the FC identity layer (see
"Deferred").

## The shape of the problem

The dashboard models one parent and one payer per student:

- MMS holds `Family.Parents[]`, an array. The dashboard's recipient builder is
  already plural, but every consumer downstream takes `[0]`.
- Sheets `Students` holds one `stripe_customer_id` / `stripe_subscription_id`,
  and those columns are owned by Payment Pause — the dashboard must not write
  them.

Neither flatness is wrong as a default. Both need a way to say "and also".

## Decisions taken

**Practice notes go to the first MMS parent in `To:` and every other parent in
`Bcc:`, as one send.** Considered and rejected: two separate emails (a
per-recipient send status would have to be threaded through the delivery claim
and `Practice_Notes_Log`, which is keyed one row per note); both parents on the
`To:` line (each would see the other's address and a reply-all would reach
both). Bcc keeps addresses private for one send, one message id, one log row.
Its cost is that it is asymmetric — the Bcc'd parent's reply reaches First Chord
only — and that the tutor must be able to see who is being copied before they
confirm. The Practice Chat confirm step therefore names them.

**The household bills as two full-price fortnightly subscriptions, one per
parent, mirroring the alternating rota.** Half the weekly rate on a weekly
cadence was considered and rejected: the alternating plans already exist, and
the arithmetic is identical either way. `mapSubscriptionToAmounts` divides by
`interval_count`, so two full-price fortnightly subscriptions land on exactly
the same weekly figure as one full-price weekly one — no code depends on which
shape is used. The cost is operational, not numerical: a cancelled lesson or a
holiday falls in one parent's week, so a credit or pause is one parent's, and
the pause workflow reaches only the primary subscription (see "What this does
not do"). Half-weekly would have removed that question; keeping the existing
plans was worth more than removing it.

**Billing splits live in a new dashboard-owned `Split_Billing` tab, not in a
widened `Students` row.** A `stripe_customer_id_2` column would be a write into
a Payment-Pause-owned lane, would hard-code "exactly two", and would put a payer
concept in a student row. `Students` keeps its existing IDs as the *primary*
payer, so Payment Pause, the pause workflow and every issue detector in
`docs/policies/payments.md` keep working untouched.

## Part 1 — Practice notes reach every parent

Today `buildPracticeNoteEmailRecipients`
(`lib/admin/practice-notes-mms-helpers.mjs:146`) already returns all active,
email-capable parents. Four consumers then take `[0]`, so as of Ross and Clare
both existing in MMS, exactly one of them receives Calan's notes and nothing
records that the other did not.

| Change | File |
|---|---|
| `Bcc:` header when `bccEmails` is non-empty | `lib/admin/practice-notes-email-helpers.mjs` → `buildGmailRawMessage` |
| accept and forward `bccRecipients`, report `bccEmails` in the result | `lib/admin/practice-notes-email.js` → `sendPracticeNoteEmail` |
| pass `recipients.slice(1)` as bcc | `lib/admin/mms.js` (~1148) |
| carry the bcc list into the log payload | `app/api/practice-notes/mms-test/route.js` |
| `bcc_recipient_emails` column | `lib/admin/sheets/core.mjs` → `PRACTICE_NOTES_LOG_HEADERS` |
| buildRow + read mapping for the new column | `lib/admin/practice-notes-helpers.mjs` |
| name the copied parents at the confirm step | `practice-chat/public/src/app.js` (separate repo + deploy) |

The confirm gate at `route.js:145` is unchanged: the tutor still confirms the
exact `To:` address. The gate proves the note is going to the right household;
the new line below it says who else is on it.

`recipients[0]` stays MMS's own parent order. That is stable per record and it
is the parent of record; inventing a separate primary-parent rule here would be
a second source of truth for something MMS already answers.

## Part 2 — `Split_Billing`

New tab, `mms_id` keyed, one row per additional payer. It records **links, not
money**: Stripe still owns the amounts, and a row here only tells the matcher
that a second subscription belongs to this student.

```
mms_id | student_name | payer_label | stripe_customer_id |
stripe_subscription_id | share_pct | active | notes | updated_at
```

`share_pct` is documentation of the arrangement for a human reading the tab, not
an input to any calculation — the amounts always come from Stripe.

| Change | File |
|---|---|
| tab name, headers, managed-sheet registration | `lib/admin/sheets/core.mjs` |
| `getSplitBillingRows()` | `lib/admin/sheets/stripe-cache.mjs` |
| `buildSplitBillingIndex()`; sum instead of pick-one; extra collection match entries | `lib/admin/stripe-amounts-helpers.mjs` |
| `payer_label` column | `STRIPE_AMOUNTS_CACHE_HEADERS` |
| inject `getSplitBilling` | `lib/admin/stripe-amounts-endpoint.mjs` |
| wire the reader | `app/api/cron/stripe-amounts/route.js` |

Three behaviour changes:

1. **`buildStripeAmountsCacheRows`** emits one cache row per matched payer
   subscription rather than one per student. `Stripe_Amounts_Cache` is a
   full-replace tab, so this needs no key change, and each row stays a faithful
   mirror of one real subscription rather than a blended fiction.
2. **`buildStripeAmountsMap`** sums weekly/monthly per `mms_id`, deduplicated by
   subscription id, instead of last-write-wins. `resolveStudentRevenue`
   (`lib/admin/finance-helpers.mjs:32`) reads that value as the student's whole
   weekly revenue, so the sum is what it already expects.
3. **`buildStripeCollectionMatchStudents`** emits an extra match entry per
   secondary payer, so the second parent's paid invoices attach to the student
   instead of landing in `unmatched_collection`.

(3) is the one that actually matters. Without it, every month forever, Clare's
invoices appear in the finance view as "Stripe money not matched to a student"
(`components/finance/AdminFinanceView.js:93`) with real pounds attached — a
permanent false positive in the exact signal built to catch real billing
mistakes. A reconciliation gap you learn to ignore is worse than no gap at all.

## What this does not do

- **No Stripe mutation.** Consistent with `docs/policies/payments.md`: this is
  matching and reporting only. Finn creates both subscriptions in Stripe by
  hand, then records the secondary one in `Split_Billing`. Note that in Stripe
  the billing cadence lives on the *price*, not the subscription, so a
  fortnightly subscription needs a price with `recurring.interval_count = 2` —
  the same amount as the existing weekly price, on a different cadence.
- **No change to pause.** The absence→pause path still acts on the single
  `stripe_subscription_id` in `Students`. With alternating weeks this matters:
  pausing for a missed lesson pauses the primary parent regardless of whose week
  it was. Until that is closed, an absence in the secondary parent's week is a
  manual Stripe adjustment.
- **No issue detector for split households.** A student whose `Split_Billing`
  row points at a dead subscription will not raise anything yet.

## Deferred: the FC identity layer

`FC_People` and `FC_Parent_Student_Links` will still only know one parent per
student. `generate_fc_ids.py` never calls MMS — it builds the whole FC layer
from the Sheets `Students` tab, which has a single `Parent forename` /
`Parent surname` / `Email`. The link table is already shaped for many parents
and `lookup.py:363` already prints "Parent(s)" and iterates, so the read side is
ready; what is missing is a source the generator can read.

That needs its own decision (a second parent block on the `Students` tab, versus
a bulk MMS fetch in the generator) and has no consumer waiting on it today.
