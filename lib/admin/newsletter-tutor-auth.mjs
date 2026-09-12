/** @fileoverview Thin adapter supplying the real token verifier and enforced session guard to the newsletter tutor authorization decision. */
// The decision itself lives in newsletter-tutor-auth-contract.mjs, which is where
// the tests run it. This file exists only to supply the two impure dependencies,
// and importing it pulls next-auth in at module scope.
import { getTutorSurfaceTokenSecret, verifyStudentNotesToken } from '@/lib/tutor-surface-token.mjs';
import { isTutorDashboardAuthEnforced } from '@/lib/tutor-auth-helpers.mjs';
import { requireEnforcedTutorDashboardAccess, tutorAuthErrorBody } from '@/lib/tutor-auth';
import { resolveNewsletterTutorAuth } from './newsletter-tutor-auth-contract.mjs';

export async function authorizeNewsletterTutorRequest({ token = '', studentId = '' } = {}) {
  return resolveNewsletterTutorAuth({
    token,
    studentId,
    secret: getTutorSurfaceTokenSecret(),
    // Checked before any token work, so this route is visibly unavailable on a
    // service where tutor auth is off rather than merely unusable.
    isEnforced: () => isTutorDashboardAuthEnforced(process.env),
    verifyToken: verifyStudentNotesToken,
    guard: async ({ requestedTutor }) => {
      const session = await requireEnforcedTutorDashboardAccess({ requestedTutor });
      return {
        ok: session.ok,
        status: session.status,
        code: session.code,
        access: session.access,
        body: tutorAuthErrorBody(session),
      };
    },
  });
}
