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

// Rerunning a completed onboarding is a dead end by design: the guard refuses
// before Sheets, the registry or MMS are touched. The usual reason for the
// rerun is to get the messages back, so the block returns them and the form
// presents the state as information rather than damage.
test('a blocked rerun of a complete record returns its messages and reads as information', () => {
  const blockIndex = routeSource.indexOf('if (blockingReasons.length > 0)');
  const firstWrite = routeSource.indexOf('const primaryRecord = await appendCanonicalStudent');

  assert.notEqual(blockIndex, -1);
  assert.ok(blockIndex < firstWrite, 'the duplicate block must precede every canonical write');

  const block = routeSource.slice(blockIndex, firstWrite);
  assert.match(block, /alreadyOnboarded/u);
  assert.match(block, /welcomeMessage: buildWelcomeMessage/u);
  assert.match(block, /soundsliceFollowup: buildSoundsliceFollowup/u);

  assert.match(formSource, /errorState\?\.alreadyOnboarded/u);
  assert.match(formSource, /Already onboarded/u);
});

// A Students row without its registry entry is unfinished work, not a
// reassuring duplicate — it must keep the attention panel and the SHEETS ONLY
// recovery guidance rather than being reported as already done.
test('a partial canonical record is never reported as already onboarded', () => {
  const blockIndex = routeSource.indexOf('if (blockingReasons.length > 0)');
  const block = routeSource.slice(blockIndex, routeSource.indexOf('const primaryRecord = await appendCanonicalStudent'));

  assert.match(block, /!duplicateState\.partialCanonicalRecord/u);
  assert.match(block, /!secondDuplicateState\?\.partialCanonicalRecord/u);
});
