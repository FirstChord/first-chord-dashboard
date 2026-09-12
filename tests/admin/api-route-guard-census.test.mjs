// A census of every API route and the guard it applies.
//
// This is a lint rule, not a behaviour test — it reads source text, and it can
// only ever prove that a guard is *mentioned in the right place*, never that it
// works. The behaviour lives in tutor-auth-guard.test.mjs, which runs the real
// guard. What this adds is the thing an executable test cannot: coverage of
// routes nobody has written a test for yet.
//
// It replaced tutor-auth-route-boundary.test.mjs, which hardcoded a list of
// seven route paths. A route added after that list was written was simply not
// checked, and nothing failed. Here the route list is discovered from disk, so
// a new unguarded route fails this test until someone classifies it below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP_ROOT = fileURLToPath(new URL('../../app', import.meta.url));

async function discoverRoutes(directory = APP_ROOT) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await discoverRoutes(full));
    else if (entry.name === 'route.js') found.push(full);
  }
  return found.sort();
}

const GUARD_PATTERNS = {
  // `authorizeNewsletterTutorRequest` is the stricter variant: per-student token
  // plus a session guard that refuses outright where TUTOR_DASHBOARD_AUTH_MODE is
  // off, instead of falling back to public access. Listed under `tutor` so the
  // ordering test below (guard before any data call) covers those routes too.
  tutor: /requireTutorDashboardAccess|requireEnforcedTutorDashboardAccess|authorizeNewsletterTutorRequest/,
  admin: /user\?\.isAdmin|isAllowedAdminEmail|requireAdmin/,
  token: /verifyStudentNotesToken|verifyStatementToken|verifyStudentNotesSession|authorizeNotesRequest|verifyTutorSurfaceToken|verifyStudentNotesCode/,
  secret: /x-firstchord-[a-z-]+-secret|CRON_SECRET|PRACTICE_CHAT_API_SECRET|authenticatePracticeChatRequest|SCHEDULE_REFRESH_SECRET|createFinanceSnapshotPostHandler|createStripeAmountsPostHandler/,
};

function guardsFor(source) {
  return Object.entries(GUARD_PATTERNS)
    .filter(([, pattern]) => pattern.test(source))
    .map(([name]) => name);
}

// Routes that are reachable without any of the guards above, each with the
// reason it is safe. Adding a route here should be a deliberate act.
const DECLARED_PUBLIC = new Map([
  ['api/auth/[...nextauth]/route.js', 'the NextAuth handler itself — it *is* the login endpoint'],
  ['api/auth/mms/route.js', 'stores a caller-supplied MMS token in their own httpOnly cookie; grants no access'],
]);

const routes = await discoverRoutes();
const relative = (file) => path.relative(APP_ROOT, file);

test('every API route applies a guard or is a declared public endpoint', async () => {
  const unguarded = [];
  for (const file of routes) {
    const source = await readFile(file, 'utf8');
    const name = relative(file);
    if (guardsFor(source).length === 0 && !DECLARED_PUBLIC.has(name)) {
      unguarded.push(name);
    }
  }

  assert.deepEqual(
    unguarded,
    [],
    `Unguarded API routes. Add a guard, or declare them in DECLARED_PUBLIC with a reason:\n  ${unguarded.join('\n  ')}`,
  );
});

test('declared public routes still exist and are still unguarded', async () => {
  // Stops the exemption list rotting into a lie: an entry that has since been
  // guarded, or deleted, should be removed from it.
  for (const [name, reason] of DECLARED_PUBLIC) {
    const file = routes.find((candidate) => relative(candidate) === name);
    assert.ok(file, `DECLARED_PUBLIC lists ${name}, which no longer exists — remove it`);
    const guards = guardsFor(await readFile(file, 'utf8'));
    assert.deepEqual(guards, [], `${name} is now guarded (${guards}) — remove its exemption ("${reason}")`);
  }
});

test('the tutor session guard is reached before any data module is called', async () => {
  // The claim the old regex test could not make. `requireTutorDashboardAccess`
  // appearing anywhere in the file satisfied it — including below the fetch it
  // was supposed to gate.
  const failures = [];

  for (const file of routes) {
    const source = await readFile(file, 'utf8');
    if (!GUARD_PATTERNS.tutor.test(source)) continue;

    // Identifiers imported from a data module (anything under lib/admin or the
    // MMS client), excluding the auth imports themselves.
    const dataIdentifiers = [...source.matchAll(/import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+'([^']+)'/g)]
      .filter(([, , , from]) => /lib\/(admin|mms)/.test(from) && !/tutor-auth|admin\/auth/.test(from))
      .flatMap(([, defaultName, named]) => (
        defaultName ? [defaultName] : named.split(',').map((entry) => entry.trim().split(/\s+as\s+/).pop())
      ))
      .filter(Boolean);

    // Check each exported handler body independently.
    const handlers = [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g)];
    for (const [index, handler] of handlers.entries()) {
      const start = handler.index;
      const end = index + 1 < handlers.length ? handlers[index + 1].index : source.length;
      const body = source.slice(start, end);

      const guardAt = body.search(GUARD_PATTERNS.tutor);
      if (guardAt === -1) continue; // this handler is gated another way

      for (const identifier of dataIdentifiers) {
        const callAt = body.search(new RegExp(`\\b${identifier}\\s*[(.]`));
        if (callAt !== -1 && callAt < guardAt) {
          failures.push(`${relative(file)} ${handler[1]}: calls ${identifier}() before the tutor guard`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `Data access before the session guard:\n  ${failures.join('\n  ')}`);
});

test('the student portal keeps a family-code boundary, not the tutor session', async () => {
  // Carried over from tutor-auth-route-boundary: the two surfaces must not
  // converge on one guard, because a tutor session must never open a parent's
  // portal and vice versa.
  const portalRoutes = routes.filter((file) => relative(file).startsWith('api/student-portal/'));
  assert.ok(portalRoutes.length > 0, 'expected student-portal routes to exist');

  for (const file of portalRoutes) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /requireTutorDashboardAccess/, `${relative(file)} must not use the tutor session`);
    assert.ok(guardsFor(source).includes('token'), `${relative(file)} must keep its own code/session boundary`);
  }
});

test('the dashboard server page redirects unauthorised pilot users before rendering', async () => {
  // Also carried over from tutor-auth-route-boundary. This one stays a source
  // check: it is a server component, so there is no handler to call. The
  // decision it branches on (access.enforced / access.authorized) is covered
  // executably in tutor-auth-guard.test.mjs.
  const source = await readFile(new URL('../../app/dashboard/page.js', import.meta.url), 'utf8');

  assert.match(source, /getTutorDashboardAccess\(\)/u);
  assert.match(source, /access\.enforced && !access\.authorized/u);
  assert.match(source, /redirect\('\/tutor\/login'\)/u);
  assert.match(source, /filterTutorOptionsForAccess/u);
});

test('the census is non-trivial — it is actually finding routes', () => {
  // Guards the discovery itself: a broken walker returning [] would make every
  // test above pass vacuously.
  assert.ok(routes.length >= 55, `expected to discover the full Next route surface, found ${routes.length}`);
});
