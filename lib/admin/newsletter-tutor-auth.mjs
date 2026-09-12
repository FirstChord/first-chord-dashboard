/** @fileoverview Thin adapter supplying the real token verifier and enforced session guard to the newsletter tutor authorization decision. */
// The decision itself lives in newsletter-tutor-auth-contract.mjs, which is where
// the tests run it. This file exists only to supply the two impure dependencies,
// and importing it pulls next-auth in at module scope.
import { getTutorSurfaceTokenSecret, verifyStudentNotesToken } from '@/lib/tutor-surface-token.mjs';
import { requireEnforcedTutorDashboardAccess, tutorAuthErrorBody } from '@/lib/tutor-auth';
import { resolveNewsletterTutorAuth } from './newsletter-tutor-auth-contract.mjs';

export async function authorizeNewsletterTutorRequest({ token = '', studentId = '' } = {}) {
  return resolveNewsletterTutorAuth({
    token,
    studentId,
    secret: getTutorSurfaceTokenSecret(),
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
