import { getServerSession } from 'next-auth';
import { authOptions, isAllowedAdminEmail } from '@/lib/admin/auth';
import {
  resolveEnforcedTutorDashboardGuard,
  resolveTutorDashboardAccess,
  resolveTutorDashboardGuard,
  tutorAuthErrorBody,
} from '@/lib/tutor-auth-contract.mjs';

// Thin adapter: supplies the real session + admin lookup to the decision logic
// in tutor-auth-contract.mjs, which is where the tests run it.
function realDependencies(env) {
  return {
    env,
    getSession: () => getServerSession(authOptions),
    isAdminEmail: isAllowedAdminEmail,
  };
}

export async function getTutorDashboardAccess({ env = process.env } = {}) {
  return resolveTutorDashboardAccess(realDependencies(env));
}

export async function requireTutorDashboardAccess({
  requestedTutor = '',
  env = process.env,
} = {}) {
  return resolveTutorDashboardGuard({
    requestedTutor,
    ...realDependencies(env),
  });
}

// For tutor-facing routes that must not exist on the legacy public service:
// refuses with 503 `tutor_auth_not_enforced` when TUTOR_DASHBOARD_AUTH_MODE is
// off, instead of falling back to public access.
export async function requireEnforcedTutorDashboardAccess({
  requestedTutor = '',
  env = process.env,
} = {}) {
  return resolveEnforcedTutorDashboardGuard({
    requestedTutor,
    ...realDependencies(env),
  });
}

export { tutorAuthErrorBody };
