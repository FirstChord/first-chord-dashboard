---
status: canonical
audience: [human, agent]
last_verified: 2026-07-24
---
# Student notes access rollout

Student profile URLs remain unchanged and their songs, links, and practice
resources remain public. Only the Practice Chat lesson-note panel is gated.

## Current handoff

The feature is live in both the canonical admin app and the legacy/public
student runtime. Test Studenty has been used to exercise the protected panel,
wrong/right code handling, trusted-device cookie, and manual relock. There has
been no bulk family activation: the `Student_Portal_Access` row for each student
is the authority for whether that individual profile is protected.

The current WhatsApp template explains this as “a small privacy step”. Finn
intends to revisit the angle and wording before the real-family rollout begins.
Treat that as an open copy decision, not an invitation to change the security
workflow or automate sending. The template is owned by
`buildNotesRolloutMessage()` in
`lib/admin/student-notes-access-helpers.mjs`; update its focused assertion in
`tests/admin/student-notes-access-helpers.test.mjs` at the same time.

Test Studenty's registry slug is `test`, but `https://firstchord.co.uk/test/` is
an unrelated WordPress page containing an old WPForms shortcode. For this test
record use:

```text
https://efficient-sparkle-production.up.railway.app/test
```

Do not use the direct Railway URL in real-family messaging. Real profiles keep
their established `firstchord.co.uk/<friendlyUrl>` links.

## Pickup checklist

For the next working session or agent:

1. Read this document, `docs/CURRENT_STATUS.md`,
   `docs/architecture/data/state-tabs.md`, `docs/operations/runbook.md`, and
   `docs/policies/hygiene-and-secrets.md`.
2. Ask Finn for the intended parent-facing angle, then revise only the
   human-facing template and any matching UI guidance unless he requests a
   broader workflow change.
3. Run the three focused access suites:

   ```bash
   node --test tests/admin/student-notes-access-helpers.test.mjs
   node --test tests/admin/student-notes-access-crypto.test.mjs
   node --test tests/admin/student-notes-rate-limit.test.mjs
   ```

4. Run the repository pre-deploy checks required by `AGENTS.md`, inspect
   generated diffs, commit, push, and verify the canonical admin service and the
   `efficient-sparkle` public service independently.
5. Recheck Test Studenty in a private browser before selecting a real family.
   Never put a real access code in logs, screenshots, fixtures, or Git.

## Implementation map

| Responsibility | Current source |
|---|---|
| Admin workflow page | `app/admin/workflows/student-notes-access/page.js`, `components/admin/AdminStudentNotesAccessPageClient.js` |
| Authenticated workflow API | `app/api/admin/student-notes-rollout/route.js` |
| Campaign orchestration | `lib/admin/student-notes-access.js` |
| Eligibility, progress, confirmations, and message copy | `lib/admin/student-notes-access-helpers.mjs` |
| Code encryption and verification | `lib/admin/student-notes-access-crypto.mjs` |
| Sheets adapter | `lib/admin/sheets/student-portal-access.mjs` |
| Public protected-notes read and unlock | `app/api/student-portal/[studentId]/notes/route.js`, `app/api/student-portal/[studentId]/notes/unlock/route.js` |
| Public panel | `components/student-portal/StudentNotesGate.js`, `components/student-portal/StudentNotes.js` |
| Public note-source selection and limiter | `lib/student-portal-notes.mjs`, `lib/student-notes-rate-limit.mjs` |
| Focused contracts | `tests/admin/student-notes-access-helpers.test.mjs`, `tests/admin/student-notes-access-crypto.test.mjs`, `tests/admin/student-notes-rate-limit.test.mjs`, `tests/admin/state-tab-contracts.test.mjs` |

## Staff campaign

Use `/admin/workflows/student-notes-access`.

1. Claim the family so another administrator can see who is handling it.
2. Generate or reveal the memorable code.
3. Put `First Chord notes code: <code>` and the profile link
   (`https://firstchord.co.uk/<friendlyUrl>`) in the WhatsApp group description
   and confirm that step.
4. Copy and manually send the personalised explanation (profile link included,
   code wrapped in `*…*` so WhatsApp shows it bold), then explicitly confirm
   that it was sent.
5. Activate protection. Activation is unavailable until both confirmations are
   present.

Claims may be released or deliberately taken over. A blocked family should be
marked `needs_follow_up` with the reason. Onboarding creates a visible,
non-blocking follow-up in this same queue; it never rolls back otherwise
successful Sheets, registry, or MMS work.

The explicitly flagged Test Studenty record (`sdt_fBg9JN`, registry slug
`test`) is the only test record allowed into this campaign, so the complete
lock/unlock flow can be smoke-tested without using a real family. It remains
excluded from every other operational surface. Use the direct public-runtime
URL in the handoff above because the matching WordPress path is already taken.

`Communication_Log` records a redacted copy template, not delivery and never the
real code. The workflow's `message_sent_at` is a human assertion that the
WhatsApp send happened.

## Access boundary

`Student_Portal_Access` is keyed by MMS student ID. Codes use a friendly word
plus two digits. The stored row contains an encrypted copy for authenticated
admin handover and a salted, secret-peppered verifier for public checking.
Plaintext codes must not be logged, cached, rendered into initial profile data,
or placed in audit payloads.

A protected student receives a student-scoped signed device cookie for one year
after a successful code entry. Resetting a code leaves the current credential
working until the replacement has both WhatsApp confirmations and is activated;
activation increments the credential version and invalidates previous cookies.

The public notes endpoint force-refreshes `Student_Portal_Access` before fetching
any note, so a separate public runtime cannot keep serving a stale legacy-public
decision after an administrator activates protection:

- no row or protection off: phased legacy-public note response;
- protection on and valid cookie: note response;
- protection on without a valid cookie: locked response with no note;
- Sheets/secret uncertainty for a protected student: fail closed.

The in-memory limiter allows five failed attempts per student and client in a
15-minute window. It is a light privacy control and resets with the public
service; use a shared limiter before scaling that service across replicas.

## Recovery

- A lost code can be revealed by an authenticated administrator.
- Generate a replacement if the WhatsApp description is wrong or compromised;
  both confirmations reset and must be completed again.
- If `STUDENT_PORTAL_NOTES_SECRET` is missing, restore the same value on the
  canonical admin and public portal services. Do not invent a replacement during
  an incident: rotation makes existing encrypted codes unreadable.
- If activation state is uncertain, inspect `Student_Portal_Access` and
  `Event_Log`; do not infer completion from `Communication_Log`.
