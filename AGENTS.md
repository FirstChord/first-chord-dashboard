# First Chord OS Agent Guide

This file applies to the whole repository. It is the short, repository-contained
entry point for coding agents. Keep durable detail in the linked docs instead of
copying it here.

## Before Making A Change

1. Read `docs/CURRENT_STATUS.md` for the active system state.
2. Read `docs/architecture/data/state-tabs.md` for data ownership, keys, writers,
   caches, logs, concurrency, and retention limits.
   For the July 2026 readiness audit outcomes and remaining gaps, use
   `docs/history/audits/agent-readiness-2026-07.md`.
3. Read the focused workflow doc and tests from the map below.
4. For auth, deployment, credentials, integration health, backups, or recovery,
   read `docs/operations/runbook.md` and
   `docs/policies/hygiene-and-secrets.md`.
5. Inspect the current implementation before trusting historical docs. Current
   code and tests beat stale snapshots, but a conflict with a canonical doc must
   be resolved or called out rather than silently ignored.

External handovers and the Obsidian vault may add operating context, but they
must not be the only source of a safety-critical implementation rule.

## Start Here: Current State

Run this first, before reading anything:

```bash
npm run state
```

It prints the branch, drift from `origin/main`, uncommitted file count, code-map
freshness and what `origin/main` is currently running. All of it is derived from
git, so unlike a handover file it cannot be out of date.

**Read the drift line before you judge the working tree.** A branch that is
behind `main` makes already-shipped files look like uncommitted work in
progress; committing them then reintroduces superseded code. If the line says
you are behind, diff changed files against `origin/main` before assuming they
are new.

## Fast Code Orientation

Use the Workflow Map below to choose the area and its safety documents. For the
next layer, query the generated source index instead of loading a large index or
starting with a broad repository search:

```bash
npm run code-map:find -- "Wise payout"
npm run code-map:impact -- lib/admin/wise-helpers.mjs
```

`code-map:find` returns matching modules, explicit source-authored module
overviews, exports with line numbers, direct test references, and direct
production consumers. An overview appears only when the file declares
`@fileoverview`; ordinary implementation comments never influence navigation.
Primary results cover `lib/admin`, `lib/songs`, and Next routes. Exact path or
export matches elsewhere in `app`, `components`, `lib`, `scripts`, or `tests`
appear in a labelled outside-scope fallback. When both metadata layers miss, find
falls back to a ripgrep body-text scan of `app`, `components`, `lib`, `scripts`,
and `tests`, reporting per-file match counts ranked by how many query terms each
file matched, plus the exact `rg` command to widen by hand; `--body` forces that
scan even on a metadata hit. Body-text hits are text occurrences, not evidence
that a file owns the behavior, and zero primary matches is never proof that code
does not exist.
`code-map:impact` walks outward from a target through the reverse static-import
graph to related tests, scripts, and app entrypoints; with no path arguments it
inspects the current git diff.
Both commands accept `--json` for agents or other tools. Static evidence can miss
dynamic/runtime relationships, so impact output narrows inspection rather than
replacing it. The browsable [generated code map](docs/reference/code-map.md) is
derived from the same index; regenerate it, never hand-edit it.

## Repository Shape

- `app/admin/`: admin pages and server-rendered composition.
- `app/api/admin/`: authenticated admin mutation/read routes.
- `app/**/route.{js,mjs,ts}`: every Next route handler is included in the
  generated code map and route-security census, including cron and public lanes.
- `components/admin/`: interactive admin UI.
- `lib/admin/*.js`: integration and workflow orchestration. These are the modules
  that talk to Sheets, MMS, Stripe, GitHub or an auth session; 30 of the 34 do.
  The exceptions are `auth.js` and the `*-data.js` static tables.
- `lib/admin/*-helpers.mjs`: pure business rules. **No I/O, directly or through
  an import** — `npm run code-map:check` fails otherwise, because this suffix is
  what promises a module can be unit-tested without stubbing a provider. The
  suffix does not imply a same-named `.js` orchestrator: only 18 of 66 have one,
  and the rest are standalone.
- `lib/admin/*.mjs` without the `-helpers` suffix: everything else, and the
  largest group after helpers. Most are pure, but some are deliberate I/O
  boundaries (`assistant-context-readers.mjs`, `finance-snapshot-runner.mjs`,
  `practice-note-delivery-claims.mjs`). The name promises nothing here, so read
  the `@fileoverview` rather than inferring from the extension.
- `lib/admin/sheets/`: Google Sheets lane adapters.
- `tests/admin/`: focused Node tests, usually matching helper names.
- `docs/`: intent-led architecture, policy, operations, workflow, plan,
  reference, and historical documentation; start at `docs/README.md`.
- `lib/config/students-registry.js`: portal configuration source.
- `lib/student-url-mappings.js`, `lib/student-helpers.js`,
  `lib/soundslice-mappings.js`, `lib/config/instruments.js`, and the ignored
  Theta credential output: generated artifacts; do not edit them to compensate
  for an upstream problem.
- `docs/reference/code-map.md`: generated source/export/test lookup; regenerate
  with `npm run generate-code-map` and verify with `npm run code-map:check`.
- Every module in the code map's primary scope (`lib/admin`, `lib/songs`, and
  Next routes) must declare a one-line `/** @fileoverview ... */`. CI fails
  without it, because that sentence is what `code-map:find` searches — an
  undescribed module can only be found by a name someone already knows.

## Truth And State Boundaries

`docs/architecture/data/state-tabs.md` is authoritative for dashboard-owned Sheets
lanes. The compact model is:

- MMS owns lessons, calendar events, attendance, and MMS student state.
- Stripe owns provider-side customer, subscription, invoice, and payment facts.
- Google Sheets owns First Chord operational records and workflow state.
- The student registry owns portal-specific configuration.
- `Issue_Queue` is managed workflow state, not the underlying problem truth.
- `Event_Log`, `Planning_Progress_Log`, and similar logs are append-only history.
- `Schedule_Context` and Stripe snapshot lanes are caches, not provider truth.
- Derived summaries and AI proposals must never become authoritative facts merely
  because they are displayed or stored.

When combining sources, preserve identifiers, source, freshness, and uncertainty.
Do not silently choose a winner for a new conflict type.

## Workflow Map

| Area | Main UI / API | Domain and storage code | Read before changing | Focused tests |
|---|---|---|---|---|
| Students and issues | `app/admin/students/`, `app/admin/flags/`, `app/api/admin/students/`, `app/api/admin/issues/` | `lib/admin/student-context*`, `lib/admin/students.js`, `lib/admin/issues.js`, `lib/admin/issue-detectors.mjs`, `lib/admin/issue-queue.js`, `lib/admin/sheets/students.mjs`, `lib/admin/sheets/issues.mjs` | `docs/architecture/data/ownership.md`, `docs/architecture/system/admin-loop.md` | `student-context-helpers`, `student-detail-helpers`, `issue-detectors`, `issues-helpers`, `issue-queue*`, `student-archive-helpers` |
| Waiting and onboarding | `app/admin/waiting/`, `app/admin/onboard/`, `app/api/admin/waiting/`, `app/api/admin/onboard/` | `lib/admin/waiting-workflow.js`, `lib/admin/onboarding.js`, `lib/admin/registry.js`, `lib/admin/mms.js` | `docs/policies/school.md`, `docs/architecture/data/ownership.md` | `waiting-workflow`, `onboarding-helpers`, `registry-helpers`, `mms-helpers` |
| Payments and finance | `app/admin/finance/`, student Stripe routes | `lib/admin/stripe.js`, `lib/admin/payment-*.mjs`, `lib/admin/finance-*.mjs`, `lib/admin/sheets/finance.mjs` | `docs/policies/payments.md`, finance section of `docs/CURRENT_STATUS.md` | `payments-helpers`, `payment-*`, `finance-*`, `stripe-*` |
| Payroll | `app/admin/finance/payroll/`, `app/api/admin/payroll/` | `lib/admin/payroll-*.mjs`, `lib/admin/tutor-statement*`, `lib/admin/wise-helpers.mjs`, `lib/admin/mms.js` | `docs/workflows/finance/paying-tutors.md`, `docs/architecture/data/state-tabs.md` | `payroll-*`, `mms-payroll-attendance`, `tutor-statement-*`, `wise-helpers` |
| Pauses and tutor absence | `app/admin/workflows/tutor-absence/`, planning pause actions | `lib/admin/tutor-absence*`, `lib/admin/pause-*.mjs`, `lib/admin/planning*` | `docs/workflows/tutors/absence-to-pause.md`, `docs/policies/payments.md` | `tutor-absence-helpers`, `pause-*`, `planning-helpers` |
| Planning and recurring workflows | `app/admin/planning/`, `app/admin/showcase/`, `app/admin/holidays/` | `lib/admin/planning*`, `lib/admin/showcase*`, `lib/admin/holiday-workflow*`, `lib/admin/sheets/workflows.mjs` | `docs/policies/workflow-design.md` | `planning-*`, `showcase`, `holiday-workflow` |
| Incoming WhatsApp intake | `app/admin/incoming-messages/`, `app/api/admin/incoming-messages/` | `lib/admin/incoming-messages.js`, `lib/admin/incoming-*.mjs`, `lib/admin/sheets/incoming-messages.mjs`, `tools/whatsapp-incoming-bridge/` | `docs/operations/integrations/whatsapp-incoming-bridge.md` | `incoming-*`, `whatsapp-bridge-outbound-guard` |
| Practice Chat and notes | `app/api/practice-notes/`, `app/api/admin/practice-notes/`, `app/api/practice-chat-sessions/`, `app/admin/insights/practice-chat/` | `lib/admin/practice-*.mjs`, `lib/admin/practice-notes-email.js`, `lib/admin/sheets/practice-notes.mjs`, `lib/admin/sheets/practice-chat-sessions.mjs`, `lib/config/practice-chat-eval.mjs`, `lib/config/practice-chat-baseline.mjs` | `docs/workflows/practice-chat/delivery.md`, `docs/workflows/practice-chat/evaluation.md`, `docs/plans/active/practice-chat-whisper-hardening.md` | `practice-*` |
| Parent understanding and communications | `app/admin/workflows/parent-understanding/`, `app/admin/communications/` | `lib/admin/parent-understanding*`, `lib/admin/communications*` | `docs/policies/workflow-design.md`, `docs/policies/copy-and-tone.md` | `parent-understanding-*`, `communications-helpers` |
| Health and recovery | health panels, cron routes, GitHub workflows | `lib/admin/health*`, integration adapters, `.github/workflows/` | `docs/operations/runbook.md`, `docs/operations/incidents/bug-fixes.md` | `health-helpers`, adapter/cache tests |
| Assistant-safe foundations | deterministic issue explanation plus optional tool-free AI briefing and reply proposals; no model actions or sending | `app/api/admin/issues/[mmsId]/explanation/`, `app/api/admin/issues/[mmsId]/ai-explanation/`, `app/api/admin/incoming-messages/reply-proposals/`, `components/admin/issues/IssueExplanationPanel.js`, `lib/admin/issue-explanation-*`, `lib/admin/assistant-context-*`, `lib/admin/incoming-reply-*`, `lib/admin/proposal-helpers.mjs`, `lib/admin/operations-guidance-helpers.mjs`, `lib/admin/communication-draft-proposal-helpers.mjs`, `lib/admin/incoming-eval-helpers.mjs` | `docs/architecture/ai/runtime-integration.md`, `docs/architecture/ai/tool-contracts.md`, `docs/architecture/data/state-tabs.md`, `docs/policies/hygiene-and-secrets.md` | `issue-explanation-*`, `assistant-context-*`, `incoming-reply-*`, `proposal-helpers`, `operations-guidance-helpers`, `communication-draft-proposal-helpers`, `incoming-classifier-eval`, `evaluation-fixture-privacy` |

Test names in the table refer to `tests/admin/*.test.mjs`.

## Non-Obvious Hazards

- Issue reads may synchronize `Issue_Queue`, but they must not change student
  payment truth. High-confidence Pause History reconciliation is an explicit
  preview-and-confirm action on `/admin/flags`; only its confirmed POST may write
  `Students.payment_expectation`, and every change must append `Event_Log`.
  Its normal write contract is three batched Sheets requests for the whole run:
  attempt events, all matching Students cells, then completion events. Do not
  replace those batches with per-student append/update loops; a retry must reload
  current evidence and propose only outstanding changes.
- Onboarding writes across Sheets, the registry, and MMS. It can partially
  succeed. Preserve step results and recovery detail; never turn a warning into
  unconditional success.
- Pause planning dates are also encoded in exact note labels parsed by
  `lib/admin/pause-forecast.mjs`. Copy changes can affect finance forecasts.
- Sheets updates are generally last-write-wins. Do not assume transactional
  claims or safe concurrent mutation.
- Practice Chat is a **narrow side panel next to the dashboard**, roughly 520px,
  on a desktop screen. It installs as a PWA and its live URL still says `pwa`,
  but no tutor opens it on a phone — design and check its screens at side-panel
  width, not mobile. Its code is a separate repo outside this tree:
  `~/Desktop/Tools:Games/FC Admin Tools/practice-chat/` (GitHub `practicechatpwa`,
  Firebase `practice-chat-pwa.web.app`; that domain is pinned in
  `lib/admin/practice-chat-auth.mjs` and `components/navigation/QuickLinks.js`
  and must not be renamed).
- Practice Chat Level 2 is a documented trusted-tutor exception: the selected
  tutor is self-attested and must match the student's one clear recorded tutor
  assignment; the final screen must name the server-derived recipient and
  require a human confirmation. Preserve the PostgreSQL delivery-key claim and
  manual handling of ambiguous Gmail failures.
- `Communication_Log` means a message was copied to send, not proven sent.
- Incoming-message classifications, matched students, and reply drafts are
  proposals. They do not authorise archive, pause, payment, planning, or
  messaging actions. Existing reply decisions must remain reviewable when the
  AI draft feature flag is disabled.
- Public tutor surfaces deliberately trade stronger identity for low friction.
  Do not add sensitive reads or consequential writes before tutor auth exists,
  apart from the documented, narrow Practice Chat Level 2 trusted-tutor flow.
- `npm run test:admin`, `npm run build`, `npm run dev`, and `npm run validate`
  run config generation first. Inspect the generated diff and never commit local
  credentials or unrelated generated churn.

## Approval And Action Boundaries

Keep truth, calculations, validation, permissions, workflow state, and
consequential actions deterministic.

Do not add automatic sending, payment execution, attendance changes, student
activation/archive, issue resolution, payment-expectation changes, or planning
state changes from unreviewed text or AI output. A proposal must be shown with
its evidence, validated by existing rules, approved at the established human
boundary, executed by the existing workflow, and logged.

Never expose broad Sheets, MMS, Stripe, Gmail, shell, filesystem, or arbitrary
HTTP access to an assistant. Prefer narrow read models and typed action proposals.
`docs/architecture/ai/tool-contracts.md` is the design allowlist for future dashboard AI
capabilities. A model-supplied confirmation is never human approval.

## Default Delivery And Deployment

For a completed, in-scope repository change, deployment is the default finish.
After the relevant checks pass, inspect the final diff, commit only the intended
files, push `main`, monitor GitHub CI and every triggered Railway service, and
smoke-test the affected production surface. Do not stop merely to ask Finn
whether to deploy, and do not present deployment as an optional follow-up for
ordinary code, test, or documentation changes.

Pause before deployment only when one of these applies:

- a product or operational decision genuinely needs Finn's answer, the user
  explicitly asked for local-only/unpublished work, or an unresolved blocker
  prevents a safe release;
- relevant validation is failing or unavailable and cannot be repaired within
  scope, production configuration or the rollback path is unknown, or unrelated
  worktree changes prevent an intentional commit;
- the rollout is materially risky and Finn needs a concise risk, rollout, smoke,
  and rollback outline before approving it. Examples include credentials,
  authentication/permissions, schema or data migrations, broad live-state
  repair, destructive/archive behaviour, or a release that itself executes or
  enables payment, messaging, attendance, registry, MMS, Stripe, or Sheets
  mutations.

Default deployment authority covers publishing the reviewed repository change;
it does not authorise carrying out consequential school/provider actions after
deployment. The human approval boundaries above remain in force.

## Validation By Change Type

Start with the smallest matching test file, then run the full admin suite.

```bash
node --test tests/admin/<focused-file>.test.mjs
node --test tests/admin/*.test.mjs
npm run code-map:check
npm run hygiene:check
npm run lint
```

Use the direct `node --test` command during a read-only investigation because
`npm run test:admin` has a config-generating pretest hook.

- Pure rule change: add/update focused fixtures, including unknown and failure
  cases; run the full admin suite.
- Sheets adapter change: verify header/key compatibility, append/upsert behavior,
  cache invalidation, and no accidental unbounded reads.
- API mutation change: check auth, validation, idempotency/retry, partial failure,
  audit logging, and the client error path.
- Finance/payroll/pause change: test dates, money rounding, unknown evidence,
  test-student exclusion, and provider-vs-cache labeling; manually inspect the
  relevant review screen without executing payment.
- Messaging change: verify recipient and student scoping, preview/copy wording,
  duplicate-send protection, and that no send occurs without its explicit gate.
- UI-only change: verify loading, success, error, empty, narrow viewport, and
  keyboard/focus behavior. Do not rely on a full-page reload to mask stale state.
  For a Playwright/browser pass, record the routes and viewport actually
  inspected. Tool discovery alone is not a visual check: if no browser instance
  connects, say the pass was unavailable and do not claim that Playwright saw
  the interface.
- Deployment/config change: run the production build only when writes to generated
  local artifacts are acceptable, inspect `git diff`, then use the runbook smoke
  checks for every affected integration.

The current suite mainly covers helpers; route and component behavior still need
manual checks unless a change adds contract-level coverage.

`.github/workflows/ci.yml` repeats documentation/code-map checks, install, admin
tests, application lint, and a production build for pull requests and pushes to
`main`. Do not weaken or skip a failing check to merge a change; fix the failure
or document why the workflow itself is wrong.

## Safe Change And Recovery Checklist

Before finishing:

1. Confirm the authoritative owner for every field read or written.
2. Start with `npm run code-map:impact -- <path>`, then search for all consumers
   of changed exports, labels, tab headers, event types, and route payload fields
   that conservative static analysis may not see.
3. Preserve fail-safe handling for missing, stale, conflicting, or unknown data.
4. Add or update tests and note any required manual check.
5. Inspect `git status --short` and `git diff`; preserve unrelated user changes.
6. Update the focused canonical doc when ownership, workflow, security, recovery,
   or an integration contract changes.
7. For rollback, revert the code/deploy first, then follow
   `docs/operations/runbook.md`. Do not reverse append-only logs or repair
   provider/Sheets state by guesswork; reconcile from authoritative evidence and
   record the recovery action.
