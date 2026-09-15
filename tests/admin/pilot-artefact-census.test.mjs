import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Practice Chat Level 2 was piloted against a single test account, and three of
// its error messages kept that account's name after the pilot ended. A tutor
// whose real student had no attendance record was told the lesson could not be
// found for "Test Studenty" — which reads as a broken tool rather than as
// missing data, and names a student who is not theirs.
//
// A scan rather than a unit test, because the fault was in a string inside a
// function that needs MMS, Gmail and Sheets to call. The class of bug is
// "pilot-era placeholder left in a message a human reads", and the cheapest
// durable guard is to refuse the placeholder anywhere it could be shown.
const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'admin');
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

// The pilot account itself is still a legitimate registry entry, so this checks
// the display name that would be shown to a person, not the MMS id.
const PILOT_PLACEHOLDER = 'Test Studenty';

function collectSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (/\.(mjs|js)$/u.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

test('no pilot placeholder name survives in tutor-facing server code', () => {
  const offenders = [...collectSourceFiles(LIB_DIR), ...collectSourceFiles(APP_DIR)]
    .filter((file) => readFileSync(file, 'utf8').includes(PILOT_PLACEHOLDER))
    .map((file) => path.relative(path.join(LIB_DIR, '..', '..'), file));

  assert.deepEqual(
    offenders,
    [],
    `Pilot placeholder "${PILOT_PLACEHOLDER}" is still present in: ${offenders.join(', ')}. Messages a tutor reads must name the student in front of them.`,
  );
});
