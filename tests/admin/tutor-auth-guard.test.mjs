// Executable coverage for the tutor-dashboard guard.
//
// This replaces the claim that tutor-auth-route-boundary.test.mjs used to make
// by regex ("the routes mention requireTutorDashboardAccess"). That assertion
// passed whether or not the guard ran, returned the right status, or was
// reached before the data fetch. These run it.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEnforcedTutorDashboardGuard,
  resolveTutorDashboardAccess,
  resolveTutorDashboardGuard,
  tutorAuthErrorBody,
} from '../../lib/tutor-auth-contract.mjs';

const ENFORCED = {
  TUTOR_DASHBOARD_AUTH_MODE: 'pilot',
  TUTOR_DASHBOARD_EMAIL_MAP: 'kim@firstchord.co.uk=Kim,tom@firstchord.co.uk=Tom',
  TUTOR_DASHBOARD_FULL_ACCESS_EMAILS: 'office@firstchord.co.uk',
};

const sessionFor = (email) => async () => (email ? { user: { email } } : null);
const noAdmins = () => false;

function guard(overrides = {}) {
  return resolveTutorDashboardGuard({
    env: ENFORCED,
    getSession: sessionFor('kim@firstchord.co.uk'),
    isAdminEmail: noAdmins,
    ...overrides,
  });
}

// --- enforcement off ----------------------------------------------------

test('with auth mode off the guard allows everyone and never fetches a session', async () => {
  let sessionFetched = false;
  const result = await resolveTutorDashboardGuard({
    env: { TUTOR_DASHBOARD_AUTH_MODE: 'off' },
    requestedTutor: 'Kim',
    getSession: async () => { sessionFetched = true; return null; },
    isAdminEmail: noAdmins,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.access.source, 'legacy_public');
  assert.equal(sessionFetched, false, 'the public path must not pay for a session lookup');
});

test('an unrecognised auth mode falls back to OFF — the whole dashboard goes public', async () => {
  // Documented foot-gun, not an endorsement: a typo'd or renamed
  // TUTOR_DASHBOARD_AUTH_MODE in Railway silently disables the guard rather
  // than failing closed. If that default is ever changed, this test should be
  // the thing that fails and forces the decision to be deliberate.
  for (const mode of ['enabled', 'true', '1', 'on', 'yes', '', undefined]) {
    const result = await guard({ env: { ...ENFORCED, TUTOR_DASHBOARD_AUTH_MODE: mode } });
    assert.equal(result.access.enforced, false, `mode ${JSON.stringify(mode)} should read as off`);
    assert.equal(result.ok, true);
  }

  // Only these two turn it on — case and surrounding whitespace are forgiven,
  // so a copy-pasted " Pilot " from a config doc still enforces.
  for (const mode of ['pilot', 'required', ' Pilot ', 'REQUIRED']) {
    const result = await guard({ env: { ...ENFORCED, TUTOR_DASHBOARD_AUTH_MODE: mode } });
    assert.equal(result.access.enforced, true, `mode ${JSON.stringify(mode)} should enforce`);
  }
});

// --- enforced: rejection ------------------------------------------------

test('no session is 401 and never full access', async () => {
  const result = await guard({ getSession: sessionFor('') });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, 'tutor_login_required');
  assert.equal(result.access.authorized, false);
  assert.equal(result.access.fullAccess, false, 'an anonymous caller must never inherit full access');
});

test('a signed-in but unmapped email is 401, not a silent empty dashboard', async () => {
  const result = await guard({ getSession: sessionFor('stranger@gmail.com') });

  assert.equal(result.status, 401);
  assert.equal(result.access.source, 'not_allowed');
  assert.equal(result.access.tutorKeys.length, 0);
});

test('a session with no email on it fails closed', async () => {
  for (const session of [{ user: {} }, { user: { email: '' } }, { user: { email: '   ' } }, {}]) {
    const result = await guard({ getSession: async () => session });
    assert.equal(result.status, 401, `${JSON.stringify(session)} must fail closed`);
    assert.equal(result.access.fullAccess, false);
  }
});

// --- enforced: the scoping decision -------------------------------------

test('a scoped tutor reaching for another tutor is 403, not 401', async () => {
  // The status split matters to the client: 401 sends you to the login page,
  // 403 means you are logged in as the wrong person. Collapsing them would put
  // an authenticated tutor into a login loop.
  const result = await guard({ requestedTutor: 'Tom' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'tutor_access_denied');
  assert.equal(result.access.authorized, true, 'they are authenticated — just not for Tom');
});

test('a scoped tutor reaching for their own tutor is allowed', async () => {
  const result = await guard({ requestedTutor: 'Kim' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.access.source, 'tutor_email_map');
});

test('tutor scoping is case-insensitive on both sides', async () => {
  for (const requestedTutor of ['kim', 'KIM', ' Kim ']) {
    assert.equal((await guard({ requestedTutor })).ok, true, `${requestedTutor} should match Kim`);
  }
  assert.equal((await guard({ getSession: sessionFor('KIM@FirstChord.co.uk'), requestedTutor: 'Kim' })).ok, true);
});

test('an admin passes for any tutor', async () => {
  const result = await guard({ requestedTutor: 'Tom', isAdminEmail: (email) => email === 'kim@firstchord.co.uk' });

  assert.equal(result.ok, true);
  assert.equal(result.access.fullAccess, true);
  assert.equal(result.access.source, 'admin');
});

test('an unauthenticated caller is still 401 on an unscoped request', async () => {
  // Routes that take no ?tutor= must not fall through the scoping branch into ok.
  const result = await guard({ requestedTutor: '', getSession: sessionFor('') });

  assert.equal(result.status, 401);
});

// --- shapes the routes depend on ----------------------------------------

test('the error body distinguishes login-required from access-denied', async () => {
  const denied = tutorAuthErrorBody(await guard({ requestedTutor: 'Tom' }));
  const anonymous = tutorAuthErrorBody(await guard({ getSession: sessionFor('') }));

  assert.equal(denied.success, false);
  assert.equal(denied.code, 'tutor_access_denied');
  assert.match(denied.message, /cannot access that tutor dashboard/);

  assert.equal(anonymous.code, 'tutor_login_required');
  assert.match(anonymous.message, /Sign in/);
});

test('resolveTutorDashboardAccess always reports whether enforcement was on', async () => {
  // app/dashboard/page.js branches on access.enforced && !access.authorized;
  // an access object missing `enforced` would render the dashboard to anyone.
  const enforced = await resolveTutorDashboardAccess({
    env: ENFORCED, getSession: sessionFor(''), isAdminEmail: noAdmins,
  });
  const off = await resolveTutorDashboardAccess({
    env: { TUTOR_DASHBOARD_AUTH_MODE: 'off' }, getSession: sessionFor(''), isAdminEmail: noAdmins,
  });

  assert.equal(enforced.enforced, true);
  assert.equal(enforced.authorized, false);
  assert.equal(off.enforced, false);
  assert.equal(off.authorized, true);
});

// --- the enforced gate ------------------------------------------------------
//
// The ordinary guard deliberately lets everyone through when auth mode is off,
// because that is the legacy public dashboard. These cover the stricter gate
// used by newsletter capture and media upload, which must be inert there.

test('the enforced gate refuses every falsy or typo’d auth mode, and never fetches a session', async () => {
  for (const mode of ['off', 'enabled', 'true', '1', 'on', 'yes', '', undefined]) {
    let sessionFetched = false;
    const result = await resolveEnforcedTutorDashboardGuard({
      env: { ...ENFORCED, TUTOR_DASHBOARD_AUTH_MODE: mode },
      requestedTutor: 'Kim',
      getSession: async () => { sessionFetched = true; return { user: { email: 'kim@firstchord.co.uk' } }; },
      isAdminEmail: noAdmins,
    });

    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} must not pass the enforced gate`);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'tutor_auth_not_enforced');
    assert.equal(result.access.authorized, false);
    assert.equal(result.access.fullAccess, false, 'the public path must never confer full access here');
    assert.equal(sessionFetched, false, 'refusal happens before any session lookup');
  }
});

test('the enforced gate behaves like the ordinary guard once auth is enforced', async () => {
  const allowed = await resolveEnforcedTutorDashboardGuard({
    env: ENFORCED,
    requestedTutor: 'Kim',
    getSession: sessionFor('kim@firstchord.co.uk'),
    isAdminEmail: noAdmins,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.status, 200);

  const wrongTutor = await resolveEnforcedTutorDashboardGuard({
    env: ENFORCED,
    requestedTutor: 'Tom',
    getSession: sessionFor('kim@firstchord.co.uk'),
    isAdminEmail: noAdmins,
  });
  assert.equal(wrongTutor.ok, false);
  assert.equal(wrongTutor.status, 403, 'a mapped tutor still cannot reach another tutor');

  const signedOut = await resolveEnforcedTutorDashboardGuard({
    env: ENFORCED,
    requestedTutor: 'Kim',
    getSession: sessionFor(''),
    isAdminEmail: noAdmins,
  });
  assert.equal(signedOut.ok, false);
  assert.equal(signedOut.status, 401);
});

test('the enforced refusal reads as unavailable, not as a login prompt', () => {
  const body = tutorAuthErrorBody({ status: 503, code: 'tutor_auth_not_enforced' });
  assert.equal(body.success, false);
  assert.equal(body.code, 'tutor_auth_not_enforced');
  // Telling a tutor to "sign in" on a service that has no sign-in would send
  // them round a loop with nothing to click.
  assert.ok(!/sign in/iu.test(body.message), body.message);
});
