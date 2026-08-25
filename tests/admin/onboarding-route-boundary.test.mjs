import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeSource = await readFile(
  new URL('../../app/api/admin/onboard/route.js', import.meta.url),
  'utf8',
);
const formSource = await readFile(
  new URL('../../components/admin/AdminOnboardForm.js', import.meta.url),
  'utf8',
);

test('onboarding verifies the registry write path before the first canonical write', () => {
  const registryPreflight = routeSource.indexOf('await assertRegistryWriteAvailable()');
  const firstCanonicalWrite = routeSource.indexOf('const primaryRecord = await appendCanonicalStudent');

  assert.notEqual(registryPreflight, -1);
  assert.notEqual(firstCanonicalWrite, -1);
  assert.ok(registryPreflight < firstCanonicalWrite);
  assert.match(routeSource, /No Students row was written because registry preflight failed/);
});

test('human completion checks fail before any onboarding write path begins', () => {
  const humanGate = routeSource.indexOf('const completionBlockers = findOnboardingCompletionBlockers(payload)');
  const registryPreflight = routeSource.indexOf('await assertRegistryWriteAvailable()');

  assert.notEqual(humanGate, -1);
  assert.ok(humanGate < registryPreflight);
  assert.match(routeSource, /blockers: completionBlockers/);
  assert.match(formSource, /Payment terms explained on the welcome call/);
  assert.match(formSource, /Lesson WhatsApp group is ready/);
});

test('onboarding preserves an explicit registry-after-Sheets partial failure', () => {
  assert.match(routeSource, /registryError\.onboardingStage = 'registryWrite'/);
  assert.match(routeSource, /error\.onboardingStage === 'registryWrite'/);
  assert.match(routeSource, /'sheetsWrite',\s*'succeeded'/);
  assert.match(routeSource, /'registryWrite', 'failed'/);
});

test('post-onboarding closeout waits for core readiness, not ancillary cleanup', () => {
  assert.match(routeSource, /const postOnboardingReady = isOnboardingCoreOperationallyComplete\(\{ steps \}\)/);
  assert.match(routeSource, /Waiting status remains open because the canonical record or core MMS lesson setup is incomplete/);
  assert.match(routeSource, /First-lesson check-in was not queued because the canonical record or core MMS lesson setup is incomplete/);
  assert.match(routeSource, /Early Stripe timing review was not queued because the canonical record or core MMS lesson setup is incomplete/);
  assert.match(routeSource, /Student notes privacy follow-up was not queued because the canonical record or core MMS lesson setup is incomplete/);
});

test('the submit path surfaces partial work as a human summary with technical recovery detail', () => {
  assert.match(formSource, /Onboarding needs attention/);
  assert.match(formSource, /The finished steps have been saved/);
  assert.match(formSource, /Technical details/);
  assert.match(formSource, /result\.recoveryGuidance/);
});

// The read-only preflight endpoint was removed once every check it reported was
// enforced at submit. Keep that true: a reintroduced dry run is a sign the write
// path stopped being safe to press.
test('every state the removed preflight reported is still checked before the first write', () => {
  const duplicateCheck = routeSource.indexOf('duplicateState = await getOnboardingDuplicateState');
  const siblingCheck = routeSource.indexOf('const secondDuplicateState = secondStudentDetails?.mmsId');
  const freeSlotCheck = routeSource.indexOf('await getValidatedMmsFreeCalendarSlot');
  const firstCanonicalWrite = routeSource.indexOf('const primaryRecord = await appendCanonicalStudent');

  for (const index of [duplicateCheck, siblingCheck, freeSlotCheck]) {
    assert.notEqual(index, -1);
    assert.ok(index < firstCanonicalWrite);
  }

  // Blocking states stop the run; the idempotent ones are absorbed, not repeated.
  // The partial-record wording itself is pinned in onboarding-helpers.test.mjs.
  assert.match(routeSource, /recoveryGuidance: buildOnboardingRecoveryGuidance\(\{\s*\n?\s*steps,\s*\n?\s*duplicateState/);
  assert.match(routeSource, /activation\?\.alreadyActive \? 'skipped' : 'succeeded'/);
  assert.match(routeSource, /billingProfile\?\.alreadyExists/);
  assert.match(routeSource, /lesson\?\.duplicateSkipped \? 'skipped' : 'succeeded'/);
});
