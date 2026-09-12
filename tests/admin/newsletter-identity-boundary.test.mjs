// Architectural absence, which is one of the two things a source-text check is
// legitimately for: no newsletter module may mint a First Chord student ID.
//
// A stored fcStudentId is authoritative and is never recomputed
// (docs/architecture/data/ownership.md). The newsletter *resolves* a student
// onto the id they already have and refuses when it cannot — if any module here
// ever reaches for generateFcStudentId instead, a contribution about a child
// could be filed under an id nothing else in the school agrees with. Exactly the
// failure the 2026-09 convergence work existed to end.
//
// Targets are discovered from disk rather than listed, so a newsletter module
// added later is covered without anyone remembering to add it here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function walk(dir, matches, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, matches, found);
    } else if (matches(full)) {
      found.push(full);
    }
  }
  return found;
}

const newsletterFiles = walk(
  repoRoot,
  (file) => /newsletter/iu.test(path.basename(file))
    && /\.(js|mjs)$/u.test(file)
    && !file.includes(`${path.sep}tests${path.sep}`)
    && (
      file.includes(`${path.sep}lib${path.sep}`)
      || file.includes(`${path.sep}app${path.sep}`)
      || file.includes(`${path.sep}components${path.sep}`)
    ),
);

test('newsletter modules were actually discovered', () => {
  // A glob that silently matches nothing is a test that proves nothing.
  assert.ok(
    newsletterFiles.length >= 4,
    `expected to find the newsletter modules, found ${newsletterFiles.length}`,
  );
});

// Real use, not prose: an import of the minting module, or a call to it. A bare
// mention must not trip this, because the modules deliberately *document* that
// they never mint — and a check that punished the explanation would push the
// explanation out of the code.
const MINTING_USE = [
  /\bfrom\s+['"][^'"]*fc-id(?:\.mjs)?['"]/u,
  /\brequire\(\s*['"][^'"]*fc-id(?:\.mjs)?['"]/u,
  /\bgenerateFcStudentId\s*\(/u,
  /\bgenerateFcStudentId\s*[,}]/u, // named in an import list
];

test('no newsletter module mints a First Chord student ID', () => {
  const offenders = [];
  for (const file of newsletterFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (MINTING_USE.some((pattern) => pattern.test(source))) {
      offenders.push(path.relative(repoRoot, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'The newsletter must resolve a stored fcStudentId, never mint one: '
    + offenders.join(', '),
  );
});

test('the newsletter refuses an unresolved identity rather than storing a name', async () => {
  // The companion to the absence check above: proving the module does not mint
  // an id is only half the guarantee — it must also decline to proceed without
  // one, instead of quietly filing the contribution under a student name.
  const { resolveNewsletterIdentity } = await import('../../lib/admin/newsletter-helpers.mjs');

  assert.equal(
    resolveNewsletterIdentity({ fullName: 'Hayley Adams', mmsId: 'sdt_WFQ7Js' }).error,
    'fc_identity_unresolved',
  );
  assert.equal(
    resolveNewsletterIdentity({
      fullName: 'Hayley Adams',
      mmsId: 'sdt_WFQ7Js',
      fcStudentId: 'fc_std_fa157fc5',
      provenance: { conflicts: [{ field: 'fcStudentId', severity: 'high' }] },
    }).error,
    'fc_identity_conflict',
    'a sheet/registry disagreement must block, not pick a winner',
  );

  const resolved = resolveNewsletterIdentity({
    fullName: 'Hayley Adams',
    firstName: 'Hayley',
    mmsId: 'sdt_WFQ7Js',
    fcStudentId: 'fc_std_fa157fc5',
    tutor: 'Dean Louden',
    provenance: { conflicts: [] },
  });
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.fcStudentId, 'fc_std_fa157fc5');
  // The full name resolves to the canonical short name and its FC tutor id.
  assert.equal(resolved.tutorName, 'Dean');
  assert.equal(resolved.fcTutorId, 'fc_tut_6133f361');

  // An unrecognised tutor leaves the FC tutor id blank rather than guessing; the
  // contribution still belongs to a real student.
  const unknownTutor = resolveNewsletterIdentity({
    fullName: 'Hayley Adams',
    mmsId: 'sdt_WFQ7Js',
    fcStudentId: 'fc_std_fa157fc5',
    tutor: 'Someone Not On The Roster',
    provenance: { conflicts: [] },
  });
  assert.equal(unknownTutor.error, undefined);
  assert.equal(unknownTutor.fcTutorId, '');
});
