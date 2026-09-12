// The tutor newsletter routes all sit behind the same two checks, and this runs
// the decision logic rather than looking for a function name in the source.
//
// The thing being protected is specific: the legacy `efficient-sparkle` service
// serves /dashboard with no login AND holds Sheets credentials. A route reachable
// there is reachable by anyone who finds the URL. These routes accept free text
// about a named child and files into First Chord's Google Drive, so they must be
// inert wherever tutor auth is not enforced.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveEnforcedTutorDashboardGuard } from '../../lib/tutor-auth-contract.mjs';
import { isTutorDashboardAuthEnforced } from '../../lib/tutor-auth-helpers.mjs';
import { resolveNewsletterTutorAuth } from '../../lib/admin/newsletter-tutor-auth-contract.mjs';
import {
  buildStudentNotesToken,
  verifyStudentNotesToken,
} from '../../lib/tutor-surface-token.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SECRET = 'test-secret';
const ENFORCED = {
  TUTOR_DASHBOARD_AUTH_MODE: 'required',
  TUTOR_DASHBOARD_EMAIL_MAP: 'dean@firstchord.co.uk=Dean,kim@firstchord.co.uk=Kim',
};

// The real decision from newsletter-tutor-auth-contract.mjs, with only its two
// impure dependencies supplied. Reimplementing the logic here is what previously
// let a swap to the non-enforced guard pass unnoticed.
async function authorize({
  token = '',
  studentId = '',
  env = ENFORCED,
  sessionEmail = 'dean@firstchord.co.uk',
  secret = SECRET,
} = {}) {
  const result = await resolveNewsletterTutorAuth({
    token,
    studentId,
    secret,
    isEnforced: () => isTutorDashboardAuthEnforced(env),
    verifyToken: verifyStudentNotesToken,
    guard: async ({ requestedTutor }) => {
      const session = await resolveEnforcedTutorDashboardGuard({
        requestedTutor,
        env,
        getSession: async () => (sessionEmail ? { user: { email: sessionEmail } } : null),
        isAdminEmail: () => false,
      });
      return { ok: session.ok, status: session.status, code: session.code, access: session.access };
    },
  });
  return { ...result, code: result.code || result.body?.code };
}

const deanToken = (studentId) => buildStudentNotesToken({ studentId, tutor: 'Dean', secret: SECRET });

// --- the enforcement gate --------------------------------------------------

test('a perfectly valid token is refused where tutor auth is not enforced', async () => {
  // The heart of it: possession of a capability token is not enough on a public
  // surface. This is what keeps an upload endpoint off efficient-sparkle.
  for (const mode of ['off', undefined, '', 'true', 'enabled']) {
    const result = await authorize({
      token: deanToken('sdt_abc'),
      studentId: 'sdt_abc',
      env: { ...ENFORCED, TUTOR_DASHBOARD_AUTH_MODE: mode },
    });
    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} must refuse`);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'tutor_auth_not_enforced');
  }
});

test('enforcement is refused before any token or secret work happens', async () => {
  // Ordering, not just outcome. Verifying an HMAC on a service where the route
  // must not function is wasted work, and — the part that matters — it makes the
  // two services indistinguishable from outside: both answered `token_required`
  // when probed without a token, so nothing external could confirm the public one
  // was actually inert.
  let tokenVerified = false;
  const result = await resolveNewsletterTutorAuth({
    token: deanToken('sdt_abc'),
    studentId: 'sdt_abc',
    secret: '',
    isEnforced: () => false,
    verifyToken: (...args) => { tokenVerified = true; return verifyStudentNotesToken(...args); },
    guard: async () => { throw new Error('the session guard must not be reached'); },
  });

  assert.equal(result.status, 503);
  assert.equal(result.code, 'tutor_auth_not_enforced');
  assert.equal(tokenVerified, false, 'no token work on a surface where the route is inert');
  // Note it reports enforcement, NOT the missing secret it was also given.
  assert.equal(result.body.code, 'tutor_auth_not_enforced');
});

test('with auth enforced, a valid token and matching session is allowed', async () => {
  const result = await authorize({ token: deanToken('sdt_abc'), studentId: 'sdt_abc' });
  assert.equal(result.ok, true);
  assert.equal(result.tutor, 'Dean');
});

// --- the token half --------------------------------------------------------

test('a token for one student cannot be replayed against another', async () => {
  const result = await authorize({ token: deanToken('sdt_abc'), studentId: 'sdt_other' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, 'token_required');
});

test('a missing, forged or expired token is refused', async () => {
  assert.equal((await authorize({ token: '', studentId: 'sdt_abc' })).status, 401);
  assert.equal((await authorize({ token: 'nonsense.signature', studentId: 'sdt_abc' })).status, 401);

  // Signed with a different secret.
  const forged = buildStudentNotesToken({ studentId: 'sdt_abc', tutor: 'Dean', secret: 'other-secret' });
  assert.equal((await authorize({ token: forged, studentId: 'sdt_abc' })).status, 401);

  const expired = buildStudentNotesToken({
    studentId: 'sdt_abc',
    tutor: 'Dean',
    secret: SECRET,
    now: Date.now() - 48 * 60 * 60 * 1000,
  });
  assert.equal((await authorize({ token: expired, studentId: 'sdt_abc' })).status, 401);
});

test('with no token secret configured the routes refuse rather than skip the check', async () => {
  const result = await authorize({ token: deanToken('sdt_abc'), studentId: 'sdt_abc', secret: '' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, 'token_secret_missing');
});

// --- the session half ------------------------------------------------------

test('a token naming a tutor the signed-in account cannot access is refused', async () => {
  // Kim is signed in; the token claims Dean. Possession of a token must not let
  // one tutor act as another.
  const result = await authorize({
    token: deanToken('sdt_abc'),
    studentId: 'sdt_abc',
    sessionEmail: 'kim@firstchord.co.uk',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('a signed-out caller with a valid token is refused', async () => {
  const result = await authorize({
    token: deanToken('sdt_abc'),
    studentId: 'sdt_abc',
    sessionEmail: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

// --- architectural absence -------------------------------------------------

test('every tutor newsletter route uses the enforced gate, not the ordinary one', () => {
  // The ordinary requireTutorDashboardAccess allows everyone when auth mode is
  // off, which is correct for the song lanes and wrong here. Discovered from disk
  // so a route added later is covered.
  const dir = path.join(repoRoot, 'app/api/newsletter');
  const routes = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'route.js'))
    .filter((file) => fs.existsSync(file));

  assert.ok(routes.length >= 3, `expected the tutor newsletter routes, found ${routes.length}`);

  for (const route of routes) {
    const source = fs.readFileSync(route, 'utf8');
    const relative = path.relative(repoRoot, route);
    assert.ok(
      source.includes('authorizeNewsletterTutorRequest'),
      `${relative} must authorize through the shared enforced helper`,
    );
    assert.ok(
      !/requireTutorDashboardAccess\b/u.test(source),
      `${relative} must not use the non-enforced guard`,
    );
  }
});

test('the shared adapter cannot quietly swap in the non-enforced guard', () => {
  // An import alias defeats "does the file mention the right name?": swapping to
  // `requireTutorDashboardAccess as requireEnforcedTutorDashboardAccess` left the
  // expected string present while the behaviour became public-by-default. So the
  // non-enforced name must not appear in this file at all — and the executable
  // tests above now run the real decision, which is the actual protection.
  const helper = fs.readFileSync(
    path.join(repoRoot, 'lib/admin/newsletter-tutor-auth.mjs'),
    'utf8',
  );
  assert.ok(helper.includes('requireEnforcedTutorDashboardAccess'));
  assert.ok(helper.includes('verifyStudentNotesToken'), 'both halves live together');
  assert.ok(
    !/\brequireTutorDashboardAccess\b/u.test(helper),
    'the non-enforced guard must not be imported here, under any alias',
  );
});

test('the media route refuses before reading a byte when Drive is unconfigured', () => {
  // Order matters: checking the credential after streaming the body means a
  // tutor watches an upload complete and then fail.
  const source = fs.readFileSync(path.join(repoRoot, 'app/api/newsletter/media/route.js'), 'utf8');
  const driveCheck = source.indexOf('isNewsletterDriveConfigured');
  const bodyUse = source.indexOf('body: request.body');
  assert.ok(driveCheck > -1 && bodyUse > -1);
  assert.ok(driveCheck < bodyUse, 'the configuration check must precede any use of the body');

  const authCheck = source.indexOf('authorizeNewsletterTutorRequest');
  assert.ok(authCheck > -1 && authCheck < driveCheck, 'authorization comes first of all');
});

test('the text route refuses a file-shaped field instead of dropping it', () => {
  // A silently discarded upload is the failure where a tutor believes a photo of
  // a child was delivered.
  const source = fs.readFileSync(path.join(repoRoot, 'app/api/newsletter/items/route.js'), 'utf8');
  assert.ok(source.includes('media_not_supported'));
});
