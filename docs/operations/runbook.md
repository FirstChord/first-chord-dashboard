---
status: canonical
audience: [human, agent]
last_verified: 2026-09-02
---
# Operations Runbook

Audience: Tom or another semi-technical operator when Finn is unavailable.

This runbook covers operational recovery for the First Chord dashboard. It is intentionally practical: what the system needs, what breaks when something expires, and the safest recovery route.

## Golden Rules

- Do not edit generated files by hand. Edit source files such as `lib/config/students-registry.js`, then run `npm run generate-configs`.
- Do not commit backups, `.env` files, local token files, or generated secret artifacts.
- Production requires `MMS_BEARER_TOKEN`. The old token remains in git history;
  rotate it when dependent tools can be coordinated safely.
- Before any deploy, run:

```bash
npm run hygiene:check
npm run code-map:check
npm run test:admin
npm run lint
npm run build
```

- Pull requests and pushes to `main` repeat clean install, tests, application
  lint, and production build in `.github/workflows/ci.yml`. A green local run is
  not a substitute for investigating a failed GitHub check.
- Railway and dashboard CI are pinned to Node 24. Keep their major versions
  aligned and do not restore an end-of-life runtime as an incident workaround.
- Pushing `main` deploys through Railway. Completed, validated repository changes
  deploy by default without a second confirmation; use the decision boundary
  below for the exceptions.
- Parent-facing, payment-affecting, and deletion/archive actions should stay human-approved.

## Default Deployment Decision

For normal completed work, finish the delivery loop: inspect the intended diff,
commit it, push `main`, watch GitHub CI and every triggered Railway service, and
smoke the affected production surface. Do not leave an ordinary validated
change local merely to ask Finn whether it should be deployed.

Stop before deployment and run it by Finn only when:

- a missing product/operational decision, explicit local-only request, failed
  safety gate, unknown production configuration/rollback path, or mixed
  worktree prevents a safe intentional release; or
- the rollout is materially risky enough to need a concise risk, rollout, smoke,
  and rollback outline first. Treat credentials, authentication/permissions,
  migrations or broad live-data repair, destructive/archive behaviour, and
  releases that execute or newly enable consequential provider actions as
  materially risky.

Try to resolve ordinary validation failures within scope before escalating
them. Deployment permission never substitutes for the existing human approval
required to send parent messages, execute payments, change attendance, archive
students, or mutate MMS/Stripe/Sheets operational truth.

## Main Systems

| System | What it owns | Dashboard dependency |
| --- | --- | --- |
| Google Sheets | Operational school truth and dashboard workflow state | Most admin pages, issues, planning, parent understanding, tutor absence, backups |
| PostgreSQL | Practice Note delivery execution claims plus the rebuildable MMS lesson mirror | Cross-instance duplicate-send protection; daily read-only lesson parity evidence |
| Registry | Portal/dashboard config truth | Student portal routes, registry-vs-Sheets issue checks |
| MMS | Lesson/scheduling/contact truth | Waiting list, schedule context, onboarding, capacity, tutor absences |
| Stripe | Payment provider truth | Payment issue checks and student Stripe refreshes |
| Railway | Hosted app runtime | Live dashboard and portal |
| GitHub | Repo, generated-config action, registry write path in production | Deploy source, workflow status, production registry writes |

## Credential And Env Inventory

These names come from real code reads of `process.env` and local token paths.

### Railway / Production Env

| Name | Used by | What breaks if missing/expired | Refresh / recovery |
| --- | --- | --- | --- |
| `NEXTAUTH_SECRET` | NextAuth admin login | Admin sessions/login fail or become invalid | Set a strong secret in Railway. FINN TO FILL IN rotation source. |
| `STUDENT_PORTAL_NOTES_SECRET` | Practice Chat access-code encryption, verification, and trusted-device cookies | Protected notes fail closed; admins cannot generate/reveal codes and families cannot unlock notes | Set the same random secret of at least 32 bytes on the canonical admin service and every public student-portal service. Rotate only through the per-student reset workflow because rotation makes stored codes undecryptable and invalidates device sessions. Never reuse `NEXTAUTH_SECRET`, MMS, Sheets, or another provider credential. |
| `NEXTAUTH_URL` | NextAuth and generated dashboard links | Auth callback/link generation can point at wrong host | Set to the live Railway URL. Local default is `http://localhost:3000`. |
| `GOOGLE_CLIENT_ID` | Admin Google OAuth | Admin login unavailable | Refresh in Google Cloud OAuth app, then update Railway. FINN TO FILL IN console location. |
| `GOOGLE_CLIENT_SECRET` | Admin Google OAuth | Admin login unavailable | Refresh in Google Cloud OAuth app, then update Railway. FINN TO FILL IN console location. |
| `ADMIN_ALLOWED_EMAILS` | Admin auth allow-list | Correct users may be blocked, or wrong users may be allowed if misconfigured | Comma-separated allowed admin emails in Railway. |
| `TUTOR_DASHBOARD_AUTH_MODE` | Tutor dashboard Google-login rollout | `off` preserves the legacy public route; `pilot`/`required` enforces an approved Google session on that service's dashboard and tutor APIs | Set `pilot` only on the canonical admin service for the Finn/Tom trial. Do not enable on `efficient-sparkle` until it has the matching OAuth env or is ready to redirect. |
| `TUTOR_DASHBOARD_FULL_ACCESS_EMAILS` | Non-admin operators who need every tutor profile | Listed exact addresses can select any tutor; a wrong entry grants broad tutor-dashboard access | Optional comma-separated exact emails. Existing admins already receive full access. Never whitelist an email domain. |
| `TUTOR_DASHBOARD_EMAIL_MAP` | Exact tutor Google email → allowed tutor key(s) | A missing/wrong map blocks a tutor or could expose another tutor's roster | Optional JSON (`{"email":"Tom"}` or `{"email":["Finn","Tom"]}`) or compact `email=Tutor` pairs. Keep personal addresses in Railway, not Git. |
| `ADMIN_AI_ISSUE_BRIEFING_ENABLED` | Optional admin Issues AI pilot | `false`/missing keeps the deterministic explanation working and the AI call unavailable | Set to `true` only after the dedicated key, privacy boundary and smoke check are ready. Set back to `false` for immediate rollback. |
| `ADMIN_AI_REPLY_DRAFT_ENABLED` | Bounded incoming-message reply proposal pilot | `false`/missing keeps **Reply** on the deterministic editable template; stored proposals remain reviewable so decisions are not stranded | Finn approved the per-card pilot on 2026-08-04 under `docs/architecture/ai/tool-contracts.md`. Set to `true` only on the canonical admin Railway service; set back to `false` for immediate rollback. |
| `ADMIN_AI_OPENAI_API_KEY` | Server-side OpenAI Responses API call for issue briefing | AI pilot returns unavailable; deterministic Issues workflow is unaffected | Use a separate restricted/budget-capped project key on the canonical admin Railway service only. Do not reuse the historically exposed Practice Chat relay key. Never expose as `NEXT_PUBLIC_*`. |
| `ADMIN_AI_OPENAI_MODEL` | Optional model override shared by the bounded admin AI pilots | Defaults to `gpt-5.6-luna` | Change only with representative contract/evaluation checks; record the model used in pilot results. |
| `GOOGLE_SPREADSHEET_ID` | Admin Sheets integration | Admin data reads/writes fail | Set to the main First Chord operational Sheet ID. FINN TO FILL IN exact Sheet link. |
| `DATABASE_URL` | Practice Note delivery claim store and lesson mirror | Execute route returns 503 before MMS/Gmail work; lesson migration/sync/status commands fail | Neon PostgreSQL connection URL supplied to the Railway app. Run `npm run ensure:practice-delivery-claims` for the claim schema. Apply lesson migrations separately with `node scripts/apply-lesson-mirror-migrations.mjs` only through the reviewed rollout below. The mirror is rebuildable and owns no current MMS fact. |
| `SHEETS_REFRESH_TOKEN` | Google Sheets OAuth | Sheets reads/writes fail once token is invalid | Generate a new OAuth refresh token with Sheets scope, then update Railway. FINN TO FILL IN exact refresh procedure. |
| `SHEETS_CLIENT_ID` | Google Sheets OAuth | Sheets reads/writes fail | Update from Google Cloud OAuth credentials. |
| `SHEETS_CLIENT_SECRET` | Google Sheets OAuth | Sheets reads/writes fail | Update from Google Cloud OAuth credentials. |
| `MMS_BEARER_TOKEN` | Admin MMS integration | Waiting list, schedule refresh, capacity, onboarding MMS actions, tutor absence lesson discovery, and some portal/MMS routes fail | Required in Railway and local environments that use MMS. Rotate because the former hardcoded value remains in git history when dependent tools can be coordinated. FINN TO FILL IN exact token source. |
| `MMS_BASE_URL` | Admin MMS integration | MMS calls hit wrong host if changed | Usually `https://api.mymusicstaff.com/v1`. |
| `MMS_DEFAULT_BILLING_RATE` | MMS onboarding billing profile default | New MMS billing profile may use wrong fallback rate | Keep aligned with current lesson pricing policy. |
| `MMS_BILLING_EVENT_CATEGORY_ID` | MMS onboarding billing profile | Billing profile creation may use wrong/default category | Confirm from MMS billing event category. FINN TO FILL IN source. |
| `MMS_FIRST_LESSON_EVENT_CATEGORY_ID` | MMS first-lesson/event creation | First lesson event category may be missing or wrong | Confirm from MMS event categories. FINN TO FILL IN source. |
| `MMS_DEFAULT_TOKEN` | Older MMS proxy/tutor dashboard compatibility routes | Older dashboard/proxy routes may fail | Prefer `MMS_BEARER_TOKEN` for admin; keep this only while legacy routes need it. FINN TO FILL IN whether it can be retired. |
| `MMS_API_URL` | Older MMS proxy routes and placeholder service config | Older proxy routes may hit wrong host | Usually `https://api.mymusicstaff.com`. |
| `GITHUB_TOKEN` | Production registry reads/writes and workflow health cards | Reads fall back to the bundled deployment snapshot; registry edits fail closed; GitHub workflow health shows unknown | Use a dedicated fine-grained token owned by `FirstChord`, scoped to `first-chord-dashboard` and `first-chord-brain`, with repository `Contents: Read and write` and `Actions: Read-only`. Store it in Railway, set an expiry reminder, and rotate before expiry. |
| `GITHUB_DASHBOARD_REPO` | Overrides the dashboard's own GitHub repo name for registry writes and workflow health | Optional; defaults to `FirstChord/first-chord-dashboard` | Currently set to the same value the code defaults to, as belt and braces after the 2026-08-18 rename from `first-chord-dashbord`; safe to remove. Set it at the moment of any future rename so registry writes keep landing without waiting for a deploy, then move the default in `lib/admin/github-repos.mjs`. GitHub redirects a GET after a rename, but the registry write is a PUT where a redirect can drop the body, so the exact name is always required. The Railway service name and domain are separate and were deliberately left as `first-chord-dashbord`. |
| `GITHUB_REQUEST_TIMEOUT_MS` | GitHub registry and workflow-health requests | Optional; defaults to 30 seconds | Milliseconds, capped at 120 seconds. Raise only after confirming a healthy GitHub request legitimately needs longer. |
| `STRIPE_API_KEY` | Stripe/payment scans | Payment issue refreshes and student Stripe checks fail | Use a restricted live key with Read access for Customers, Subscriptions, Invoices, Prices, and Payment Intents. Payment Intents Read is required by the live issue scan's `latest_invoice.payment_intent` expansion. Edit permissions in Stripe; update Railway/local `.env.local` only when the key value itself is rotated. |
| `STRIPE_REQUEST_TIMEOUT_MS` | Read-only Stripe student checks and scheduled bulk refresh | Optional; defaults to 30 seconds | Milliseconds, capped at 120 seconds. Timeout failure is explicit and leaves the existing cache/state unchanged. |
| `STRIPE_PAYMENT_LINK` or `PAYMENT_LINK` | Onboarding message templates | Payment link copy falls back to placeholder | Set to current one-to-one payment link. |
| `GROUP_LESSON_PAYMENT_LINK` | Group onboarding copy | Group payment link may be wrong or use fallback | Set to current group lesson payment link. |
| `HANDBOOK_URL` | Onboarding and parent messaging copy | Handbook link may be wrong or use default | Usually `https://firstchord.co.uk/handbook`. |
| `GMAIL_CLIENT_ID` | Practice note email sending | Practice Chat Level 2 falls back to `GOOGLE_CLIENT_ID`; if neither is present, email sending fails | Optional when the Gmail refresh token was generated with the existing dashboard Google OAuth client. |
| `GMAIL_OAUTH_CLIENT_ID` | Legacy/alternate Gmail token scripts | Token minting scripts may not find the client ID if they do not fall back | Prefer `GMAIL_CLIENT_ID`; keep aliases only if a local script still reads them. |
| `GMAIL_CLIENT_SECRET` | Practice note email sending | Practice Chat Level 2 falls back to `GOOGLE_CLIENT_SECRET`; if neither is present, email sending fails | Optional when the Gmail refresh token was generated with the existing dashboard Google OAuth client. |
| `GMAIL_OAUTH_CLIENT_SECRET` | Legacy/alternate Gmail token scripts | Token minting scripts may not find the client secret if they do not fall back | Prefer `GMAIL_CLIENT_SECRET`; keep aliases only if a local script still reads them. |
| `GMAIL_REFRESH_TOKEN` | Practice note email sending | Practice Chat Level 2 cannot send First Chord parent emails once missing/revoked | Generate as `musiclessons@firstchord.co.uk` with `https://www.googleapis.com/auth/gmail.send`; do not reuse Sheets token. Re-mint with `node scripts/mint-gmail-token.mjs` (use the same OAuth client as `GMAIL_CLIENT_ID`/`GOOGLE_CLIENT_ID`). An `invalid_grant` failure means this token is dead — re-mint it. The OAuth consent screen is Internal, so tokens don't expire on a schedule. |
| `PRACTICE_NOTES_FROM_EMAIL` | Practice note email sending | Sender may default incorrectly | Usually `musiclessons@firstchord.co.uk`. |
| `PRACTICE_NOTES_FROM_NAME` | Practice note email sending | Sender display name may default incorrectly | Usually `First Chord Music School`. |
| `PRACTICE_CHAT_API_SECRET` | Practice Chat handoff guard | PWA snapshot and Level 2 writeback calls reject when the matching header is missing | A coarse shared secret passed by the trusted tutor handoff. It is not tutor identity: the Level 2 route additionally requires the self-attested tutor to match the student's single recorded tutor and the PWA's recipient-specific human confirmation. |
| `PRACTICE_NOTES_ENABLED_TUTORS` | Optional Level 2 rollout allow-list | A listed tutor's students cannot send when the name is omitted | Comma-separated canonical tutor short names. If omitted, all registered tutors are enabled. Use this only as a temporary operational restriction, not as identity proof. |
| `NEXT_PUBLIC_PRACTICE_CHAT_DASHBOARD_BASE_URL` | Practice Chat quick-link API target override | Practice Chat links may post back to the wrong Railway domain if the default changes | Optional. Defaults to the canonical admin API app `https://first-chord-dashbord-production.up.railway.app`; set it if the admin Railway domain changes. |
| `INCOMING_MESSAGE_INGEST_SECRET` | Incoming message bridge guard | Confirmed-group bridge capture and control calls are rejected; manual admin paste still works | Shared secret for external inbound-message capture. Send it as `x-firstchord-incoming-secret`. This is intake-only auth, not permission to auto-act on messages. |
| `SCHEDULE_REFRESH_SECRET` | Schedule-context refresh and lesson-mirror cron endpoints | GitHub schedule refresh cannot update `Schedule_Context`, and the lesson mirror cannot run its daily parity sweep | Must match in Railway and GitHub Actions secrets. Both endpoints fail closed when it is missing; the lesson-mirror route returns 503 before reading MMS. |
| `FINANCE_SNAPSHOT_SECRET` | Finance snapshot cron endpoint | Weekly/monthly `Finance_Snapshot` rows are not created | Must be set in Railway and GitHub Actions secrets. If missing, the cron endpoint returns 503. |
| `PAUSE_SYNC_SECRET` | Nightly pause-expectation reconciliation + Stripe rescan cron endpoint | `payment_expectation` drifts out of date as pauses end, and the Issues board reaccumulates `SUBSCRIPTION_STATE_MISMATCH` rows that mean nothing | Must match in Railway and GitHub Actions secrets. Sent as `x-firstchord-pause-secret`; the endpoint returns 503 when unset. Deliberately **not** `SCHEDULE_REFRESH_SECRET`: this is the only cron that writes `payment_expectation`, so it should be revocable on its own. |
| `NEXT_PUBLIC_PAYMENT_PAUSE_PWA_URL` | Planning/payment pause quick links | Pause task links may open the default/old pause tool URL | Set only if the pause PWA URL changes. |
| `DISABLE_API_CACHE` | API cache emergency bypass | Not required; setting `true` bypasses cache | Use only for debugging stale data. |
| `DISABLE_MMS_CACHE` | MMS cache emergency bypass | Not required; setting `true` bypasses MMS cache | Use only when debugging stale MMS reads. |
| `ANALYZE` | Next bundle analysis | No operational impact | Development-only. |

### Local Development Files

| File | Used by | What breaks if missing | Recovery |
| --- | --- | --- | --- |
| `.env.local` | Local Next.js runtime | Local admin pages lose access to env-backed services | Recreate from Railway env values. Do not commit. |
| `.env` | Some local scripts/tools | Local scripts may fail | Prefer `.env.local` for app runtime. Do not commit. |
| `~/token_musiclessons.json` | Local Google Sheets auth fallback in `lib/admin/sheets.js` | Local Sheets reads/writes fail unless env OAuth values are present | Regenerate Google OAuth token JSON. FINN TO FILL IN exact command/account. |
| `lib/config/theta-credentials.js` | Student portal Theta login lookup | Student portal credential lookup fails if config generation has not run | Run `npm run generate-configs`. This file is generated and ignored. |

### Local Tool Env

These are used by local helper tools rather than the Railway app. Keep them out of git.

| Name | Used by | What breaks if missing | Recovery |
| --- | --- | --- | --- |
| `DASHBOARD_BASE_URL` or `INCOMING_MESSAGE_WEBHOOK_URL` | `tools/whatsapp-incoming-bridge` | Confirmed-group capture posts to the wrong dashboard or fails | Set to the canonical admin Railway URL. |
| `INCOMING_MESSAGE_INGEST_SECRET` | `tools/whatsapp-incoming-bridge` | Bridge posts are rejected by the dashboard API | Must match Railway's value. Store in the bridge `.env`, not in git. |
| `BAILEYS_AUTH_DIR` | WhatsApp bridge local session | Bridge may ask for a new WhatsApp pairing or use a different session | Defaults to the local auth folder. Keep this private and local. |
| `BAILEYS_LOG_LEVEL` / `LOG_LEVEL` | WhatsApp bridge logging | No operational breakage | Optional debugging only. |
| `BRIDGE_LOG_PATH`, `BRIDGE_LOG_MAX_BYTES`, `BRIDGE_LOG_MAX_FILES`, `BRIDGE_LOG_MAX_AGE_DAYS` | Privacy-safe structured bridge logging | Defaults still provide a bounded `logs/bridge.log`; incorrect overrides can retain too much or too little operational history | Defaults: 2 MiB per file, four rotations, 14-day maximum age. Do not point the log outside a private ignored directory. |
| `DRY_RUN` | WhatsApp bridge testing | Messages may be logged but not posted when set true | Use for local testing only. |
| `WHATSAPP_CACHE_PATH`, `WHATSAPP_CACHE_LIMIT`, `WHATSAPP_CACHE_MAX_AGE_DAYS`, `WHATSAPP_CAPTURED_BY`, `WRITE_STARRED_LOG`, `SYNC_GROUPS_ON_START`, `GROUP_SYNC_MAX_ATTEMPTS`, `GROUP_SYNC_WAIT_MS` | WhatsApp bridge capture/group-map helpers | Cache, capture attribution, legacy debug-log, or sync behaviour may differ from expected | Leave defaults unless debugging the bridge. Document any permanent change in `docs/operations/integrations/whatsapp-incoming-bridge.md`. |

## Secret Handling Notes

- `lib/config/theta-credentials.js` used to be tracked. It is now generated locally/build-time and ignored.
- Git history still contains old Theta credential material. We have not rewritten history. Credential rotation or portal-password policy changes are Finn's decision.
- `lib/mms-client.js` used to contain a hardcoded MMS bearer token/API-key JWT. This is more sensitive than the Theta username file because it can grant MMS API access. The code now requires `MMS_BEARER_TOKEN`, but the old token remains in git history. Rotate the MMS API key as the highest-priority post-migration hygiene action when it is operationally safe.

## Railway Project Map

As of 13 June 2026, the Railway account has three relevant projects:

| Project | Service | Domain | Role | Env shape |
| --- | --- | --- | --- | --- |
| `pure-spontaneity` | `first-chord-dashbord` | `https://first-chord-dashbord-production.up.railway.app` | Canonical admin/API runtime. Use this for `/admin`, Practice Chat note writes, Gmail sends, Sheets writes, Stripe scans, and internal operating-system work. | Full admin env: Google OAuth, Sheets, Gmail, Stripe, GitHub, MMS, admin auth. |
| `efficient-sparkle` | `efficient-sparkle` and `first-chord-dashbord` | `https://efficient-sparkle-production.up.railway.app`, `https://first-chord-dashbord-production-d599.up.railway.app` | Legacy/public tutor-student dashboard runtime. `/dashboard` works here. `/admin` is not fully configured on the old public domain. | MMS env plus the four Sheets variables (`GOOGLE_SPREADSHEET_ID`, `SHEETS_REFRESH_TOKEN`, `SHEETS_CLIENT_ID`, `SHEETS_CLIENT_SECRET`) and `STUDENT_PORTAL_NOTES_SECRET`. No Gmail/Stripe/GitHub/admin auth. Protected notes fail closed if either Sheets access or the notes secret is unavailable. |
| `awake-connection` | `enhanced-music-lesson-notes` | `https://enhanced-music-lesson-notes-production.up.railway.app` | Practice Chat speech/Whisper relay. | OpenAI relay env only. |

The `dashbord` misspelling in the Railway service names and domains is deliberate and stays. The GitHub repository was renamed to `FirstChord/first-chord-dashboard` on 2026-08-18, which is a separate system: these domains are generated from the Railway **service** name. Do not rename the service to match — `railway domain` allows only one Railway-provided domain per service, so there is no overlap window, and the current host is hardcoded in five cron workflows, `components/navigation/QuickLinks.js`, `tools/whatsapp-incoming-bridge/bridge.js`, `NEXT_PUBLIC_PRACTICE_CHAT_DASHBOARD_BASE_URL`, the Practice Chat PWA, and tutor bookmarks. A custom domain is the non-breaking route; it is parked in the Obsidian Idea Incubator ("The dashboard URL tutors use is a misspelled Railway hostname").

Do not assume a GitHub deploy to one Railway service means all Railway services have the same environment variables. Practice Chat quick links should use the canonical admin API base URL for writeback, even if the tutor opens the public dashboard from an older domain.

### AI issue briefing pilot recovery

For the exact request flow, provider payload, safe log fields and error-code
map, see `docs/architecture/ai/runtime-integration.md`.

The generated detective opinion is non-consequential and the deterministic case
file is always the fallback. The separately displayed **Yes** resolution comes
from the code allowlist and still requires the admin press; disabling AI does not
remove or change that existing deterministic action. If model calls fail, become
slow, produce validation failures, or show materially misleading wording:

1. Set `ADMIN_AI_ISSUE_BRIEFING_ENABLED=false` on the canonical admin Railway
   service and redeploy/restart. No Sheets/provider reconciliation is required.
2. Confirm **Ask the detective** still loads the checked assessment, evidence,
   caveats and next step without a generated opinion.
3. Inspect runtime metadata by opaque request ID. Logs must not contain the
   prompt, model output, MMS ID, student name, contact details or provider IDs.
4. Fix/evaluate locally with synthetic or redacted fixtures before re-enabling.
5. Rotate `ADMIN_AI_OPENAI_API_KEY` if exposure is suspected; do not rotate or
   interrupt the separate Practice Chat transcription key as part of this step.

### Incoming reply proposal pilot recovery

If reply proposals fail validation, become slow, or produce materially
misleading wording, set `ADMIN_AI_REPLY_DRAFT_ENABLED=false` on the canonical
admin Railway service and redeploy/restart. **Reply** then opens the standard
editable template without a model call; stored proposals remain visible so an
admin can use, edit, or discard them. No message is sent automatically and no
Sheets/provider reconciliation is required. Inspect only privacy-safe request
metadata; do not add parent message text, proposal bodies, student identifiers,
or contact details to logs. Fix and
evaluate with synthetic/redacted fixtures before re-enabling. If the shared
restricted AI key may be exposed, rotate it and re-check both AI pilots.

## Lesson Mirror Parity Runbook

Phase 2 runs `.github/workflows/lesson-mirror.yml` daily at 05:45 UTC. Its
secret-gated `POST /api/cron/lesson-mirror` request derives a bounded London-date
window: 14 days back, today, and 42 days ahead. It reads MMS calendar and
attendance sequentially, verifies both reported totals, then writes only the
First Chord PostgreSQL mirror in one transaction. `/admin/lessons` is the
authenticated read-only evidence and exception surface;
`/admin/lessons/exceptions` expands lesson-shaped non-observations into bounded
same-student and same-series clues without making a cancellation decision;
`/admin/lessons/calendar` shows a weekly, MMS-backed view of rows re-seen in the
latest verified run. `/admin` separately reports mirror freshness and workflow
health. Tutor Changes optionally reads the latest verified
event/participation observations for its compact lesson timeline, but fails open
to the existing schedule-cache view and does not use SQL to derive relationship
phase or perform work. MMS remains schedule and attendance truth.

Applying the schema is a production migration. Before doing so, confirm the
target `DATABASE_URL`, Neon backup/PITR position, a known-good application
rollback commit, and that `practice_note_delivery_claims` is healthy. Then run:

```bash
node scripts/apply-lesson-mirror-migrations.mjs
node scripts/lesson-mirror-status.mjs
```

For the initial production rollout on 2026-08-10, the Neon restore window was
confirmed at six hours before migration. Migration `001_initial_lesson_mirror`
and the bounded `2026-08-01` to `2026-08-29` reconciliation then succeeded with
772/772 calendar rows, 767/767 attendance rows, 219 series, 772 events and 767
participations. This is rollout evidence, not a substitute for checking the
current restore window before a future migration.

The migration runner is checksummed, serialised with an advisory lock and refuses
an applied migration whose SQL later changed. Application requests never create
these tables.

For the first bounded reconciliation, choose explicit end-exclusive dates. Do
not hide a historical backfill inside this first run:

```bash
node scripts/sync-lesson-mirror.mjs \
  --start 2026-08-01 \
  --end-exclusive 2026-08-29 \
  --write-mirror
node scripts/lesson-mirror-status.mjs
```

Healthy evidence is `status=succeeded`, equal expected/received counts for both
MMS endpoints, and plausible series/event/participation counts. Group lessons
make participation count differ from event count; that is expected. Output is
counts and opaque IDs only, never student names or credentials.

If a run fails:

1. inspect the run ID and bounded failure category;
2. fix token, date window, pagination ceiling, migration or database health;
3. rerun the same bounded window—the writes are idempotent and revisions append
   only when state actually changes; and
4. do not mark unseen rows cancelled or repair provider state from the mirror.

For a manual retry, dispatch the **Lesson Mirror** GitHub workflow. For a
diagnostic fixed window, use:

```bash
node scripts/sync-lesson-mirror.mjs --start YYYY-MM-DD --end-exclusive YYYY-MM-DD
node scripts/lesson-mirror-status.mjs
```

Then inspect `/admin/lessons`, `/admin/lessons/exceptions`, and the current week
on `/admin/lessons/calendar`. Expected and received totals must match. A failed
attempt is visible in health/history but cannot replace the last successful
snapshot; a previously seen row absent from a successful sweep is “not observed”
evidence, not a cancellation.

Immediate rollback is to disable the Lesson Mirror workflow and revert the code.
There is no consumer cutover or MMS mutation to undo. Leave the additive tables
and append-only revisions in place while reviewing the failed rollout; do not
drop them as an emergency gesture, and never touch Practice Chat claims. Existing
school workflows continue against their current owners while the parity job is
disabled.

## Component Recovery Matrix

This is the first place to look when something is down. The detailed docs linked in the final column remain the source for edge cases.

| Component | Purpose / owner | Healthy state and evidence | Safe retry | Do not retry blindly | Related docs/tests/pages |
| --- | --- | --- | --- | --- | --- |
| Admin app, auth, and Railway deploy | Hosts `/admin`, portals, APIs, and authenticated operating workflows. Owner: Finn. | Railway service `pure-spontaneity` is serving the canonical domain; `/admin/login` works; `npm run test:admin` and `npm run build` pass locally. | Railway redeploy of the last good commit; local rebuild; restart service after env changes. | Do not push/redeploy untested code to fix a live outage unless local build passes or rollback is the explicit plan. | This runbook; `docs/operations/incidents/bug-fixes.md`; `/admin`; `/admin/login`. |
| Google Sheets state store | Operational school truth and dashboard workflow state. Owner: Finn/Tom depending on workflow. | Admin pages load; writes persist; backup script completes; managed tabs match `docs/architecture/data/state-tabs.md`. | Re-run a failed save only after checking the page did not already write; run `npm run backup:sheets` for recovery snapshots; run `npm run ensure:state-tabs` when tabs are missing. | Do not rename headers/tabs casually. Do not bulk paste over a tab without first duplicating it or using a dated backup. | `docs/architecture/data/state-tabs.md`; `scripts/backup-sheets-tabs.mjs`; `npm run backup:sheets`; `/admin/planning`, `/admin/issues`. |
| MMS integration | External lesson, schedule, attendance, contact, and billing-continuity source. Owner: Finn. | MMS health card is healthy; waiting list/capacity/tutor absence lesson lookup return expected data; `MMS_BEARER_TOKEN` is present. | Restart after env changes; refresh specific schedule caches; use `DISABLE_MMS_CACHE=true` briefly only for stale-read diagnosis. | Do not assume an empty MMS result means no lessons exist until token, date, tutor ID, and cache have been checked. Do not drop MMS attendance writes while payroll still relies on MMS. | `/admin/waiting`; `/admin/capacity`; `/admin/workflows/tutor-absence`; `lib/admin/mms.js`; `docs/workflows/tutors/absence-to-pause.md`. |
| Waiting-list onboarding | Turns a selected Waiting student and optional exact MMS `Free` event into canonical records plus MMS activation, billing and first lesson. Owner: Finn/Tom. | Every onboarding step is visible. After the first lesson is confirmed, a selected Free event is deleted from that occurrence forward with MMS's explicit `DeletionType: Future` options. Waiting closeout and genuine first-lesson/privacy follow-ups depend on canonical + core MMS lesson readiness, not this ancillary cleanup. | Before writes, return to Waiting and choose the current suggestion if Free-event validation says stale. After lesson success plus Free-event failure, inspect MMS and remove only the remaining selected `Free` event manually; the first-lesson and privacy cards should still exist. | Never rerun full onboarding or recreate the lesson after `mmsFirstLesson` succeeded. Never delete a Free event before lesson confirmation, reconstruct an event ID from tutor/time, or request the whole recurring history; deletion starts at the selected occurrence and applies only to future events. | `/admin/waiting`; `/admin/onboard`; `docs/architecture/data/ownership.md`; `tests/admin/mms-free-slot.test.mjs`; `tests/admin/onboarding-helpers.test.mjs`. |
| Lesson mirror | Rebuildable MMS lesson series/event/student-participation observations and stable First Chord IDs. Owner: Finn. | `/admin/lessons` is healthy and under 36 hours old; latest calendar and attendance expected/received totals match; **Lesson Mirror Daily** is healthy on `/admin`; Tutor Changes labels detailed lesson observations verified and still derives relationship phase from the schedule cache. No operational workflow depends on it. | Re-dispatch `.github/workflows/lesson-mirror.yml` after fixing the bounded failure, or re-run the same explicit end-exclusive window with the operator command. Tutor Changes fails open while the mirror is unavailable. | Do not infer cancellation from non-observation, map raw attendance labels to completion/payroll truth, merge replacement event IDs heuristically, write MMS, delete revisions/claims, or treat SQL as current provider truth. | `/admin/lessons`; `/admin/tutors`; `.github/workflows/lesson-mirror.yml`; `docs/plans/active/lesson-occurrence-model.md`; `scripts/sync-lesson-mirror.mjs`; `scripts/lesson-mirror-status.mjs`; `tests/admin/lesson-mirror-*.test.mjs`; `tests/admin/lesson-occurrence-helpers.test.mjs`. |
| Practice Chat and Gmail delivery | Captures lesson notes, optionally marks attendance, and sends parent emails. Owner: Finn. | The final tutor screen names the selected student and exact server-derived parent email, and requires the recipient-specific checkbox; the selected tutor self-attests and matches the student's single recorded tutor assignment. `Practice_Notes_Log` records that self-attestation, Gmail ID, MMS attendance ID, and completed state; `practice_note_delivery_claims` holds one matching terminal claim. | If a draft/snapshot failed before provider work, re-run after checking the selected lesson. After an MMS-success/Gmail-error row, follow up manually—the route deliberately refuses to retry an ambiguous Gmail send. A matching request parks a claim left `claimed` for 15 minutes as manual follow-up without provider replay; then compare PostgreSQL, Sheets, MMS, and Gmail. | Do not double-submit parent emails, delete/reset a terminal or abandoned claim to “try again,” or change note text to bypass the delivery key. Do not treat `acting_tutor` as verified identity; investigate a mismatch or missing/conflicting tutor record before sending. | `docs/workflows/practice-chat/delivery.md`; `docs/architecture/data/state-tabs.md`; `tests/admin/practice-notes-*.test.mjs`; student detail recent notes panel. |
| Incoming WhatsApp bridge | Captures live messages from confirmed lesson groups into a review inbox. Owner: Finn/Tom for local operation. | Bridge is connected; heartbeat is fresh; confirmed-group count is non-zero; one live confirmed-group message appears once in `Incoming_Message_Inbox`. | Use Quick capture for urgent misses; restart/re-link the single bridge; signal a live group sync when mappings are stale. | Do not expect star or cache replay, run two sockets on one auth directory, or let captured evidence auto-act. | `docs/operations/integrations/whatsapp-incoming-bridge.md`; `tools/whatsapp-incoming-bridge/README.md`; `/admin/incoming-messages`. |
| Tutor absence and pause bridge | Turns tutor-away decisions into cover/cancel communication and structured pause plans. Owner: Finn/Tom. | Tutor absence record shows the chosen outcome; cancelled dates produce grouped structured pause planning items; superseded single-day plans are parked; finance pause forecast reads the grouped item. | Repair/merge structured pause dates from the planning card if capture was messy; park duplicate plans instead of deleting history unless they are test records. | Do not run Stripe pauses automatically from tutor absence. Do not message parents before cover/cancel decision is confirmed. | `docs/workflows/tutors/absence-to-pause.md`; `/admin/workflows/tutor-absence`; `/admin/planning`; tests around tutor absence pause planning. |
| Finance snapshots and payroll context | Read-only finance estimate, blind Stripe forecast/reveal, expenses, payroll review, and Wise preparation. Owner: Finn/Tom. | `/admin` shows healthy Finance Snapshot, Stripe Amounts, and Finance Data cards; the current month has one `Finance_Snapshot` baseline and one immutable `Stripe_Forecast_Monthly` row; the previous month has a `Stripe_Collected_Monthly` reveal; `/admin/finance` shows net and student-level forecast error; `Payroll_Runs` reflects review/payment state. | Re-run the Stripe Amounts workflow with its normal secret: it first finds/locks the current forecast and only then reads Stripe. A failed forecast lock makes the endpoint fail before provider reads. Monthly finance snapshots retry on days 1–7. Correct roster, pricing, schedule, expectation, or structured-pause inputs for future forecasts; do not rewrite a locked month to improve its score. | Never backdate/fabricate a forecast or baseline, edit/delete a locked forecast after seeing Stripe, treat forecasts/caches as Stripe or accounting truth, or mark payroll paid unless Tom has actually paid it. An unmatched invoice must stay unmatched until an authoritative identifier resolves it. | `/admin`; `/admin/finance`; `/admin/payroll`; `.github/workflows/finance-snapshot.yml`; `.github/workflows/stripe-amounts.yml`; `docs/policies/payments.md`; finance/payroll tests. |
| Backups and restore | Local recovery copy of operational Sheets tabs. Owner: Finn, with Tom able to follow runbook. | `npm run backup:sheets` creates dated CSV/JSON files plus `manifest.json`; no failed tabs; planning reminder moves 17 days forward; `launchctl print gui/$(id -u)/com.firstchord.sheets-backup` shows a non-zero `runs` and `last exit code = 0`. | Re-run after fixing auth/network; restore into a duplicate/temp Sheet tab first. | Do not commit backups. Do not overwrite live tabs without comparing headers and taking a current backup. | Backup section below; `scripts/backup-sheets-tabs.mjs`; `backups/sheets/` ignored directory. |

## If MMS API Is Failing

Symptoms:

- Waiting list cannot load or refresh.
- Schedule context refresh fails.
- Capacity/free-slot data looks stale.
- Tutor absence lesson lookup finds no lessons when MMS clearly has lessons.
- Onboarding MMS activation, billing profile, or first lesson creation fails.

Checks:

```bash
rg "MMS_BEARER_TOKEN|MMS_DEFAULT_TOKEN" .env.local .env
npm run build
```

Recovery:

1. Confirm `MMS_BEARER_TOKEN` is present in Railway env for production or `.env.local` locally.
2. If local only is failing, restart the dev server after editing `.env.local`.
3. If production is failing, update Railway env and redeploy/restart the service.
4. If token is expired, refresh it from MMS/session source. FINN TO FILL IN exact source.
5. Use `DISABLE_MMS_CACHE=true` only briefly if stale cached MMS reads are suspected.

## If Google Sheets Auth Is Failing

Symptoms:

- Admin overview fails.
- Issue/planning/parent-understanding/tutor-absence state does not save.
- Error mentions Sheets, OAuth, spreadsheet ID, or missing tab.

Checks:

```bash
rg "GOOGLE_SPREADSHEET_ID|SHEETS_REFRESH_TOKEN|SHEETS_CLIENT_ID|SHEETS_CLIENT_SECRET" .env.local .env
ls ~/token_musiclessons.json
npm run test:admin
```

Recovery:

1. In production, confirm Railway has `GOOGLE_SPREADSHEET_ID`, `SHEETS_REFRESH_TOKEN`, `SHEETS_CLIENT_ID`, and `SHEETS_CLIENT_SECRET`.
2. Locally, either use those env vars or ensure `~/token_musiclessons.json` exists.
3. If the refresh token has expired/revoked, generate a new one with Google Sheets scope and update Railway/local env. FINN TO FILL IN exact command/account.
4. If a tab is missing, compare against `docs/architecture/data/state-tabs.md`. The app can create some managed state tabs, but do not rename tabs casually.

## If Google Sheets Write Quota Is Exceeded

Symptoms:

- Google reports `Quota exceeded` for `Write requests per minute per user`.
- A confirmed save or reconciliation returns HTTP 429 or a raw Sheets quota
  message.
- The page may have completed an earlier non-transactional write before a later
  audit or state write failed.

Immediate recovery:

1. Stop clicking the action repeatedly and allow at least one minute for the
   per-user quota window to clear.
2. Reload the workflow before retrying. Never infer success or failure solely
   from the browser error because the earlier step may already be stored.
3. For **Sync pause expectations**, return to `/admin/flags` and run it again.
   Its GET preview reloads Pause History, schedule context, and current Students
   values, so it proposes only changes still outstanding. Do not edit Stripe or
   manually repeat every proposed Students change.
4. If diagnostic/API detail is available, interpret the failed stage as:
   - `attempt_log`: no Students batch was attempted;
   - `student_batch_write`: outcome is unknown, so reload and preview before any
     retry;
   - `completion_log`: the Students changes were applied, but the completion
     audit batch may be missing. Preserve the attempt evidence and record any
     manual recovery rather than guessing or deleting log rows.
5. If quota errors continue after the minute window, check for another bulk
   writer or repeated browser action before increasing quotas. Review the code
   for per-row write loops; do not work around the problem by removing audit
   events or the confirmation boundary.

The pause-expectation path should normally use exactly three write requests for
the whole confirmed run: one attempt-event append, one Students
`values.batchUpdate`, and one completion-event append. Multiple Students rows
for one MMS ID are one decision and are aligned in that single update request.
The regression contract is in
`tests/admin/pause-expectation-reconciliation.test.mjs` and
`tests/admin/sheets-helpers.test.mjs`.

## If GitHub Registry Auth Is Failing

Symptoms:

- Authenticated admin pages or the incoming-message PWA report `GitHub registry fetch failed: 401`.
- Registry edits from onboarding, student detail, or archive workflows fail.
- GitHub workflow health cards show unknown.

Read availability is fail-safe: a failed production GitHub registry read falls
back to the registry snapshot bundled into the deployed commit. The fallback is
read-only. Registry writes still require a successful fresh GitHub read and
authenticated GitHub update, so an expired token cannot authorise a stale write.
If another registry commit lands between read and write, the dashboard fetches
the new file, reapplies only the requested student mutation, and retries once.
It must never retry merely by pairing stale whole-file contents with the newer
SHA, because that would erase the concurrent commit while reporting success.

Recovery:

1. Create a dedicated fine-grained GitHub token owned by `FirstChord`.
2. Limit repository access to `first-chord-dashboard` and `first-chord-brain`.
3. Grant repository `Contents: Read and write` and `Actions: Read-only`.
4. In Railway project `pure-spontaneity`, service `first-chord-dashbord`,
   production environment, replace `GITHUB_TOKEN`.
5. Review and deploy Railway's staged variable change.
6. Confirm `/admin` and the incoming-message PWA load, workflow health is
   available, and one normal registry edit can preview/save through its existing
   human approval boundary.
7. Revoke the expired token and record the new expiry reminder. Never paste the
   token into logs, docs, chat, or source control.

## If Railway Deploy Is Broken

Symptoms:

- Live site returns `502 Bad Gateway`.
- Railway says deploys are paused or limited.
- GitHub push happened but live URL did not change.

Checks:

```bash
npm run test:admin
npm run build
railway status
railway logs
railway domain
```

Recovery:

1. Confirm local tests/build pass. If local build fails, fix code before redeploying.
2. Check Railway dashboard for paused deploys or limited access.
3. Confirm the service that owns the live public URL. See `docs/operations/incidents/bug-fixes.md` for the previous 502 service/domain mismatch.
4. If Railway is linked locally:

```bash
railway redeploy
```

5. If redeploy does not move the correct service and the code builds locally:

```bash
railway up --detach
```

6. Verify the live URL with:

```bash
curl -I https://efficient-sparkle-production.up.railway.app/dashboard
```

Rollback:

1. Use Railway's Deployments view to redeploy the last known-good deployment.
2. If the bad deploy came from a commit and needs code rollback, revert the commit in git, run tests/build, then push/redeploy.
3. Do not use destructive git reset on shared branches.

## If Dashboard Login Is Failing

Symptoms:

- `/admin/login` says auth is not configured.
- Google sign-in fails.
- Login succeeds but admin pages redirect or deny access.

Checks:

```bash
rg "NEXTAUTH_SECRET|NEXTAUTH_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ADMIN_ALLOWED_EMAILS" .env.local .env
```

Recovery:

1. Confirm Railway has all auth env vars.
2. Confirm `NEXTAUTH_URL` exactly matches the live Railway URL.
3. Confirm Google OAuth authorized redirect URI includes:

```text
https://<railway-domain>/api/auth/callback/google
```

4. Confirm the user's email is included in `ADMIN_ALLOWED_EMAILS`.
5. If Google client secret was rotated, update Railway and redeploy/restart.

## Deploy Process

Before deploying, confirm every affected integration has its required Railway
environment and choose smoke checks from the component recovery matrix.

1. Confirm repo:

```bash
git rev-parse --show-toplevel
```

Expected:

```text
/Users/finnlemarinel/Desktop/FirstChord/music-school-dashboard
```

2. Run:

```bash
npm run docs:check
npm run code-map:check
npm run test:admin
npm run lint
npm run build
```

3. Commit intentionally.
4. Push `main` by default after the checks and diff review pass. Pause only at
   the documented default-deployment decision boundary:

```bash
git push origin main
```

5. Watch Railway deploy and smoke-test:

- `/admin`
- `/admin/flags`
- `/admin/planning`
- `/admin/workflows/parent-understanding`
- one student portal page

For runtime or incoming-bridge changes, also confirm `railway ssh node -v`
matches the pinned Node major, the bridge heartbeat is fresh with a non-zero
confirmed-group count, and one labelled intake test is stored exactly once.
Archive the labelled test row afterward. A manual test proves dashboard intake
but does not clear the “no auto-capture” warning; only a real
`whatsapp_group_auto` capture does.

## Sheets Backups

Default backup location:

```text
backups/sheets/
```

This directory is ignored by git and must not be committed because it contains student and parent data.

Manual backup command (the schedule below runs the same thing):

```bash
npm run backup:sheets
```

Before first use or after adding a new dashboard-owned state tab, verify/create managed tabs:

```bash
npm run ensure:state-tabs
```

Local fortnightly schedule:

```bash
npm run install:backup-schedule
```

This installs a macOS LaunchAgent:

```text
~/Library/LaunchAgents/com.firstchord.sheets-backup.plist
```

It runs the backup on the **1st and 15th of each month at 10:00** from the
dashboard repo, invoking `node scripts/backup-sheets-tabs.mjs` directly. Two
details are deliberate and should not be "simplified" back:

- The schedule is `StartCalendarInterval`, not `StartInterval`. An interval is
  counted from when launchd loads the job, so every reboot restarts it and a
  fortnightly job on a machine that reboots never fires — this agent sat at
  `runs = 0` from June to August 2026 for exactly that reason. A calendar time
  is absolute and launchd runs a missed one on the next wake.
- launchd is given an absolute `node` path and the script path rather than
  `npm run backup:sheets`. `npm` is a symlink to a `.js` file with a
  `#!/usr/bin/env node` shebang, and launchd's default `PATH`
  (`/usr/bin:/bin:/usr/sbin:/sbin`) does not contain node, so the job could not
  have launched even with a correct schedule.

Confirm it is genuinely scheduled — not merely installed — with:

```bash
launchctl print gui/$(id -u)/com.firstchord.sheets-backup
```

`runs` counts executions since load and `last exit code` should be 0. A long-installed
agent still reporting `runs = 0` has never fired. Force a real run with
`launchctl kickstart -p gui/$(id -u)/com.firstchord.sheets-backup`.

Logs are written to:

```text
backups/sheets/launchd.out.log
backups/sheets/launchd.err.log
```

The backup script also updates the existing Planning layer with a recurring action:

```text
Run operational Sheets backup
```

After each successful backup, its target date is moved 17 days forward, and if a
backup is missed it appears through the existing dated planning/overview flow as
due or overdue. The threshold is 17 rather than 14 because the widest legitimate
gap the 1st/15th schedule can leave is 17 days (the 15th of a 31-day month to the
1st); a 14-day threshold would show the card overdue most months and train the
reader to ignore it. Since the run is now scheduled, treat that card as an alarm
that the automation has stopped, not as a routine chore.

Backup coverage is pinned against the managed state-tab contract by tests. If
`docs/architecture/data/state-tabs.md` gains a dashboard-owned tab, update
`scripts/backup-sheets-tabs.mjs` in the same change or record why it is excluded.

Retention policy for now:

- Keep local dated backups in `backups/sheets/`.
- Keep only the latest 8 backup sets. The backup script prunes older dated folders after a successful backup.
- This retention cap matters because the backups include communication/WhatsApp message evidence, which is useful for recovery but sensitive.
- Do not upload to public storage.
- FINN TO FILL IN whether a private Google Drive backup folder should become the long-term destination.

Restore principle:

1. Open the dated backup folder.
2. Find the affected tab CSV/JSON.
3. Compare headers with the current Google Sheet tab.
4. Restore rows by copying from CSV/JSON into the matching tab, or into a temporary tab first for inspection.
5. For full-tab restore, create a duplicate tab before overwriting anything.

## Known Gaps Finn Should Fill

- Rotate the exposed MMS API key/token that used to be hardcoded in git history when dependent tools can be coordinated.
- Exact source/steps for refreshing MMS bearer tokens.
- Exact Google Cloud project and OAuth refresh-token generation steps.
- Current owner and expiry/rotation policy for `GITHUB_TOKEN`.
- Whether `MMS_DEFAULT_TOKEN` can be retired after legacy MMS routes are reviewed.
- Whether old Theta credential material in git history needs rotation or a portal-password policy change.
- Whether Sheets backups should be copied to a private Google Drive folder after each local run.
