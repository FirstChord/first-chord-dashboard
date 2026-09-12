// The tutor-dashboard guard, with its two impure dependencies (the NextAuth
// session and the admin-email check) injected rather than imported.
//
// lib/tutor-auth.js is the thin adapter that supplies the real ones. It exists
// separately because importing it pulls next-auth in at module scope, which is
// what previously made this logic unreachable from `node --test` — so the only
// coverage the routes had was a regex looking for the guard's name in their
// source. The decision logic lives here so it can actually be run.
import {
  canTutorDashboardAccessTutor,
  getTutorDashboardAccessForEmail,
  isTutorDashboardAuthEnforced,
} from './tutor-auth-helpers.mjs';

// Auth mode off => the pre-pilot public dashboard. Deliberately full access,
// and deliberately without touching the session.
const LEGACY_PUBLIC_ACCESS = {
  enforced: false,
  authorized: true,
  email: '',
  fullAccess: true,
  tutorKeys: [],
  source: 'legacy_public',
};

export async function resolveTutorDashboardAccess({
  env = process.env,
  getSession,
  isAdminEmail = () => false,
} = {}) {
  if (!isTutorDashboardAuthEnforced(env)) {
    return { ...LEGACY_PUBLIC_ACCESS };
  }

  const session = await getSession();
  const email = `${session?.user?.email || ''}`.trim().toLowerCase();
  const access = getTutorDashboardAccessForEmail(email, {
    isAdmin: isAdminEmail(email),
    env,
  });

  return { ...access, enforced: true };
}

export async function resolveTutorDashboardGuard({
  requestedTutor = '',
  env = process.env,
  getSession,
  isAdminEmail = () => false,
} = {}) {
  const access = await resolveTutorDashboardAccess({ env, getSession, isAdminEmail });

  if (!access.authorized) {
    return { ok: false, status: 401, code: 'tutor_login_required', access };
  }

  if (requestedTutor && !canTutorDashboardAccessTutor(access, requestedTutor)) {
    return { ok: false, status: 403, code: 'tutor_access_denied', access };
  }

  return { ok: true, status: 200, code: '', access };
}

// The stricter gate, for tutor-facing routes that must never run on an
// unauthenticated surface.
//
// `resolveTutorDashboardGuard` deliberately allows everyone when
// TUTOR_DASHBOARD_AUTH_MODE is off, because that is the legacy public dashboard
// and the song/notes lanes accept that trade. Some writes cannot: the legacy
// `efficient-sparkle` service serves /dashboard publicly *and* holds Sheets
// credentials, so a route reachable there is reachable by anyone who finds the
// URL. Accepting free text about a named child — or a file into First Chord's
// Google Drive — on those terms is not a trade worth making.
//
// So this refuses outright rather than falling back to public access. On a
// service with auth mode off the route is simply inert; on the canonical service
// it behaves like the ordinary guard. It is the first gate in the repository to
// fail closed on a missing auth mode, which is the direction
// tests/admin/tutor-auth-guard.test.mjs says to move whenever a route can afford
// it.
export async function resolveEnforcedTutorDashboardGuard({
  requestedTutor = '',
  env = process.env,
  getSession,
  isAdminEmail = () => false,
} = {}) {
  if (!isTutorDashboardAuthEnforced(env)) {
    return {
      ok: false,
      status: 503,
      code: 'tutor_auth_not_enforced',
      access: { ...LEGACY_PUBLIC_ACCESS, authorized: false, fullAccess: false },
    };
  }

  return resolveTutorDashboardGuard({ requestedTutor, env, getSession, isAdminEmail });
}

export function tutorAuthErrorBody(result = {}) {
  if (result.code === 'tutor_auth_not_enforced') {
    return {
      success: false,
      code: 'tutor_auth_not_enforced',
      message: 'This feature is only available on the signed-in First Chord dashboard.',
    };
  }

  return {
    success: false,
    code: result.code || 'tutor_login_required',
    message: result.status === 403
      ? 'This account cannot access that tutor dashboard'
      : 'Sign in with an approved First Chord Google account',
  };
}
