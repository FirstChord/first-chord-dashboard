---
status: canonical
audience: [human, agent]
last_verified: 2026-08-03
---
# Hygiene And Secrets

## Repository Boundary

Use `/Users/finnlemarinel/Desktop/FirstChord/music-school-dashboard` as the real
repository. `/Users/finnlemarinel` is also a Git working tree with an old remote;
a broad add/commit there could include unrelated personal files. Never commit
from or alter that home-directory repository without Finn's explicit approval.

Before every commit, inspect `git status --short` and the staged diff. Never add
`.env*`, provider tokens, OAuth files, local WhatsApp state/logs, or Sheets
backups.

## Known Historical Exposures

- `lib/config/theta-credentials.js` used to be tracked. It is now generated,
  ignored, and derived from the student registry, but old values remain in Git
  history. Decide whether portal credentials/password policy require rotation.
- `lib/mms-client.js` used to contain an MMS bearer/API-key token. Runtime now
  reads `MMS_BEARER_TOKEN`, but the historical token should be rotated when
  integrations can be smoke-tested safely.
- the Practice Chat transcription relay currently returns its raw OpenAI key to
  browsers. Treat the key as exposed. The replacement is built: the PWA sends
  audio to the dashboard's `POST /api/practice-notes/transcribe`, which holds a
  new `PRACTICE_CHAT_OPENAI_API_KEY`. Once tutors are on it, **revoke the relay
  key in OpenAI** — that, not relay code, is what ends the exposure.

Do not rewrite repository history casually. Rotate affected credentials and
record the operational decision.

## Secret Rules

- Railway/provider consoles and the password manager own secret values; docs own
  only variable names, scopes, symptoms, and recovery routes.
- Keep local runtime values in ignored `.env.local`/tool-specific files.
- Never expose a server secret through `NEXT_PUBLIC_*`, browser JSON, logs,
  screenshots, fixtures, or error messages.
- Provider keys use the minimum permissions required by their focused workflow.
- A shared ingest/PWA secret is a coarse caller gate, not a user identity.
- OpenAI pilots use a dedicated budget-capped project key. Do not reuse the
  exposed Practice Chat relay key; understand that `store: false` does not remove
  provider abuse-monitoring retention.
- Suspected exposure means disable/rotate first, then inspect privacy-safe
  metadata. Do not paste the secret into an incident note.

The current variable inventory and rotation/smoke routes are in the
[operations runbook](../operations/runbook.md). AI-specific scope and retention
are in [runtime integration](../architecture/ai/runtime-integration.md).

## Generated And Local Data

Do not edit generated registry artifacts to mask upstream problems. Change
`lib/config/students-registry.js` through the normal onboarding/archive path and
regenerate. `lib/config/theta-credentials.js` stays ignored.

Operational surfaces use explicit `is_test_student`/`isTestStudent` flags. Do
not infer test records from names or delete provider/Sheets records automatically.

`npm run backup:sheets` writes personal data under ignored `backups/sheets/`.
WhatsApp auth/cache/log directories also contain credentials or parent content.
Keep them private, apply the data-protection retention window, and use
[disaster recovery](../operations/disaster-recovery.md) for restore handling.

## Pre-Deploy Hygiene

Run `npm run hygiene:check`, inspect generated diffs after any config-generating
command, and smoke every integration affected by a credential/config change.
Never weaken a hygiene check to ship a secret-bearing diff.

`npm run lint` is a zero-warning gate: resolve a new warning in the same change
instead of teaching CI to accept more noise. Dependabot checks the root app and
the separately deployed WhatsApp bridge every Monday in grouped pull requests;
automation proposes versions only, while the normal tests, build, review, and
deployment boundary still decide whether an update ships.
