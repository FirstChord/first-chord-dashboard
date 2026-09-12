/** @fileoverview The newsletter tutor authorization decision, with its impure dependencies injected so it can actually be run in a test. */
// Separated from newsletter-tutor-auth.mjs for the same reason
// tutor-auth-contract.mjs is separated from tutor-auth.js: importing the adapter
// pulls next-auth in at module scope, which puts it out of reach of `node --test`
// and leaves the only "coverage" a regex looking for a function name in the
// source.
//
// That is not a hypothetical. An earlier version of this file's test passed while
// the shared helper had been changed to import the NON-enforced guard under an
// alias — the source check saw the right string and the harness was running its
// own copy of the logic rather than the real thing. This module exists so the
// real decision runs.
//
// Two independent checks, both required:
//
// 1. The per-student capability token proves the caller got this student from a
//    tutor surface, and names the tutor. Possession, not identity.
// 2. The ENFORCED session gate. Unlike the song lanes, these routes refuse to run
//    where TUTOR_DASHBOARD_AUTH_MODE is off, because the legacy public service
//    serves /dashboard with no login and holds Sheets credentials.

export async function resolveNewsletterTutorAuth({
  token = '',
  studentId = '',
  secret = '',
  verifyToken,
  guard,
} = {}) {
  if (!secret) {
    return { ok: false, status: 503, body: { success: false, code: 'token_secret_missing' } };
  }

  const payload = verifyToken(token, { studentId, secret });
  if (!payload) {
    return { ok: false, status: 401, body: { success: false, code: 'token_required' } };
  }

  const tutor = payload.tutor || '';
  const session = await guard({ requestedTutor: tutor });
  if (!session.ok) {
    return { ok: false, status: session.status, body: session.body, code: session.code };
  }

  return { ok: true, tutor, access: session.access };
}
