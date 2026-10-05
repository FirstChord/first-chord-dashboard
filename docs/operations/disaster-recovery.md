---
status: canonical
audience: [human, agent]
last_verified: 2026-10-05
---
# Disaster Recovery

## Recovery Scope

First Chord depends on several independent stores. A Railway redeploy restores
code, not the state held in Sheets or PostgreSQL.

| Loss | Impact | Recovery evidence |
| --- | --- | --- |
| Google Sheet | Students, workflow state, logs, payroll review, assignments | Restore the latest complete local backup to a scratch Sheet, verify, then promote |
| Railway app | Dashboard, portals, APIs, crons | Redeploy a known-good GitHub commit and restore the canonical service variables |
| Neon PostgreSQL | Practice Note claims, retained lesson mirror IDs/observations and scoped payroll delivery coordination | Restore provider backup/snapshot; reconcile both delivery-claim lanes before enabling sends; rebuild mirror observations from MMS if necessary |
| Local Mac | WhatsApp capture, scheduled local backups, local tokens/tools | Rebuild from GitHub, password manager/provider consoles, and launchd templates |
| Provider credential | Affected integration reads/writes | Reissue with the minimum documented scope and replace it in Railway/local secret storage |

MMS and Stripe retain their own provider truth. Sheets owns First Chord
operational records. PostgreSQL owns the narrow Practice Note execution claim
and First Chord lesson identities/retained MMS observations. The lesson mirror
does not own current schedule or attendance truth.
Neither a UI state nor `Issue_Queue` substitutes for those owners.

Payroll adds non-rebuildable approval and email-claim coordination, not a new
payroll ledger. Sheets retains reviewed statements, responses and payment
markers; Gmail retains accepted-send evidence and Wise retains payment truth.

## Proven And Unproven Recovery

The Sheets restore drill was run on 2026-07-19: 30 tabs and 10,809 rows restored
to a scratch spreadsheet with headers and row counts verified. Re-run
`npm run restore:drill` once a term.

The following remain unproven and must not be described as guaranteed:

- a clean-machine cold start
- an end-to-end Neon PostgreSQL point-in-time restore and Practice Note claim
  reconciliation drill (the configured restore window was six hours on
  2026-08-10, but no restore was executed)
- off-machine survival of the local Sheets backup directory
- recovery of WhatsApp traffic missed while the bridge was offline

## Restore The Google Sheet

1. Run `npm run restore:drill`; it selects only a complete backup set and writes
   to a scratch spreadsheet.
2. Verify the drill passes and inspect critical tabs/headers.
3. Promote the scratch spreadsheet by changing `GOOGLE_SPREADSHEET_ID`, or
   restore selected tabs into a repaired original using the runbook.
4. Run `npm run ensure:state-tabs`, re-share access, and reapply the protected
   `Students` header row.
5. Refresh provider-derived caches from MMS/Stripe rather than restoring them as
   truth.

Never restore a set whose `manifest.json` reports failed tabs. Take a current
backup before overwriting any surviving live tab.

The local backup excludes rebuildable cache/status lanes such as
`Stripe_Amounts_Cache`, `Schedule_Context`, and `Bridge_Status`. The backup
directory is on this Mac; copy it periodically to an access-controlled
off-machine location without extending its retention window.

## Restore Practice Note Claims

A fresh database can be bootstrapped with:

```bash
npm run ensure:practice-delivery-claims
```

That creates schema, not historical claims. With claims unavailable, Practice
Note execution must remain disabled/fail 503 before MMS or Gmail. Before
re-enabling after a database loss:

1. restore the provider snapshot if available
2. compare terminal `Practice_Notes_Log` rows with Gmail IDs and MMS attendance
3. recreate/reconcile only from authoritative evidence using a reviewed recovery
   procedure
4. retain ambiguous deliveries for manual follow-up

Never delete a terminal claim or resend an ambiguous email merely to make the
stores agree. Record any recovery action.

## Restore Payroll Delivery Coordination

Before any database recovery that could affect payroll claims, set
`PAYROLL_DEFERRED_SEND_ENABLED=false` and disable its scheduled checker. Restore
`payroll_deferred_deliveries` and `payroll_email_delivery_claims` from the provider
backup with Practice Note claims, then reconcile incomplete/ambiguous payroll
work against Sheets and Gmail. Do not automatically resume waiting approvals
from an old snapshot, delete email keys to retry, or reconstruct a supposedly
unsent statement from a missing database claim. A restored older approval may
have sent after the snapshot. Known payments and tutor responses stay intact.
See [scoped rollout/recovery](./runbook.md#scoped-payroll-delivery-rollout).

## Restore The Lesson Mirror

Lesson mirror rows are rebuildable from MMS; Practice Note claims in the same
database are not. Prefer a provider restore that preserves both. If the mirror
alone must be rebuilt after database recovery:

1. keep every current application reader on its existing source (the first slice
   already does this)
2. apply the checksummed schema with
   `node scripts/apply-lesson-mirror-migrations.mjs`
3. run one small explicit window using `scripts/sync-lesson-mirror.mjs`
4. confirm both expected/received totals and stored counts with
   `node scripts/lesson-mirror-status.mjs`
5. backfill larger windows separately and repeat parity checks before enabling
   any future consumer

Do not restore a stale mirror over newer MMS truth, infer cancelled lessons from
a recovery gap, or drop/recreate the whole PostgreSQL database merely to rebuild
these tables. A failed mirror rebuild does not justify disabling the established
Practice Chat claim boundary.

## Cold Start A Replacement Mac

1. Install Node 20+, Git, Python 3, and `rg`; sign into the password manager and
   provider accounts.
2. Clone the repositories into the normal workspace and run `npm install`.
3. Recreate `.env.local` from Railway/password-manager values; re-mint local
   Google OAuth tokens rather than copying unknown files.
4. Verify read-only access, then run focused tests, full admin tests, hygiene,
   lint, and build.
5. Reinstall the Sheets backup, song-request, and WhatsApp bridge launchd agents
   from their repository instructions. QR re-link the business WhatsApp account.
6. Take a new Sheets backup and run the restore drill.

Production should keep running during a Mac rebuild. Use dashboard Quick capture
while WhatsApp automation is unavailable.

## Maintenance

When a managed Sheets tab is added, add it to the backup contract in the same
change. Keep the contract test green. Review this document after any new
authoritative store, provider write, backup mechanism, or recovery drill.
