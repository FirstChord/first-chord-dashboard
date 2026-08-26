import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOnboardingCompletionStatus,
  buildOnboardingRecoveryGuidance,
  createOnboardingSteps,
  evaluateOnboardingDuplicateState,
  findOnboardingCompletionBlockers,
  isOnboardingCoreOperationallyComplete,
  markOnboardingStep,
  resolveOnboardingInstrument,
  tutorTeachesInstrument,
} from '../../lib/admin/onboarding-helpers.mjs';
import { ADMIN_TUTORS } from '../../lib/admin/tutors-data.js';
import { parseInstrumentList } from '../../lib/admin/fc-helpers.mjs';

test('blocks an exact duplicate when the same MMS ID already exists for the same tutor', () => {
  const state = evaluateOnboardingDuplicateState({
    mmsId: 'sdt_same',
    tutorFullName: 'Arion Xenos',
    tutorShortName: 'Arion',
    sheetRows: [
      { mms_id: 'sdt_same', Tutor: 'Arion Xenos' },
    ],
    registryEntry: { mmsId: 'sdt_same', tutor: 'Arion' },
  });

  assert.equal(state.exactDuplicate, true);
  assert.equal(state.shouldAppendRegistry, false);
  assert.match(state.blockingReasons.join(' '), /already exists/);
});

test('allows a multi-tutor case with warnings and keeps the existing registry entry', () => {
  const state = evaluateOnboardingDuplicateState({
    mmsId: 'sdt_multi',
    tutorFullName: 'Arion Xenos',
    tutorShortName: 'Arion',
    sheetRows: [
      { mms_id: 'sdt_multi', Tutor: 'Fennella McCallum' },
    ],
    registryEntry: { mmsId: 'sdt_multi', tutor: 'Fennella' },
  });

  assert.equal(state.exactDuplicate, false);
  assert.equal(state.shouldAppendRegistry, false);
  assert.equal(state.warnings.length, 2);
  assert.match(state.warnings.join(' '), /multi-lesson case/);
});

test('allows a brand new onboarding with no duplicate warnings', () => {
  const state = evaluateOnboardingDuplicateState({
    mmsId: 'sdt_new',
    tutorFullName: 'Arion Xenos',
    tutorShortName: 'Arion',
    sheetRows: [],
    registryEntry: null,
  });

  assert.equal(state.exactDuplicate, false);
  assert.equal(state.shouldAppendRegistry, true);
  assert.deepEqual(state.warnings, []);
});

test('blocks full onboarding and points to recovery when Sheets exists without registry', () => {
  const state = evaluateOnboardingDuplicateState({
    mmsId: 'sdt_partial',
    tutorFullName: 'Finn Le Marinel',
    tutorShortName: 'Finn',
    sheetRows: [
      { mms_id: 'sdt_partial', Tutor: 'Finn Le Marinel' },
    ],
    registryEntry: null,
  });

  assert.equal(state.exactDuplicate, true);
  assert.equal(state.partialCanonicalRecord, true);
  assert.equal(state.shouldAppendRegistry, true);
  assert.match(state.blockingReasons.join(' '), /SHEETS ONLY/);
  assert.match(state.blockingReasons.join(' '), /instead of rerunning full onboarding/i);
});

test('createOnboardingSteps starts every onboarding step in a pending state', () => {
  const steps = createOnboardingSteps();

  assert.deepEqual(Object.keys(steps), [
    'registryPreflight',
    'duplicateCheck',
    'sheetsWrite',
    'registryWrite',
    'mmsActivation',
    'mmsBillingProfile',
    'mmsFirstLesson',
    'mmsFreeSlot',
  ]);
  assert.equal(steps.mmsFirstLesson.status, 'pending');
});

test('markOnboardingStep updates only the targeted step', () => {
  const steps = createOnboardingSteps();
  const next = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students sheet at row 10.');

  assert.equal(next.sheetsWrite.status, 'succeeded');
  assert.match(next.sheetsWrite.detail, /row 10/);
  assert.equal(next.registryWrite.status, 'pending');
});

test('buildOnboardingRecoveryGuidance explains partial failure after sheets success', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'duplicateCheck', 'succeeded', 'No blocking duplicate found.');
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students sheet at row 12.');
  steps = markOnboardingStep(steps, 'registryWrite', 'succeeded', 'Appended new registry entry.');
  steps = markOnboardingStep(steps, 'mmsActivation', 'failed', 'MMS activate student failed: 500');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Skipped because MMS activation did not complete.');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because MMS activation did not complete.');

  const guidance = buildOnboardingRecoveryGuidance({ steps });

  assert.equal(guidance.length >= 1, true);
  assert.match(guidance.join(' '), /student is in Sheets/i);
});

test('buildOnboardingRecoveryGuidance treats idempotent skipped MMS steps as ready', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students.');
  steps = markOnboardingStep(steps, 'registryWrite', 'succeeded', 'Registry entry created.');
  steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'Already active.');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Billing profile already existed.');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'failed', 'Lesson creation failed.');

  const guidance = buildOnboardingRecoveryGuidance({ steps });
  const message = guidance.join(' ');

  assert.doesNotMatch(message, /MMS activation is incomplete/);
  assert.doesNotMatch(message, /billing profile setup still needs attention/);
  assert.match(message, /first lesson was not confirmed/);
});

test('buildOnboardingRecoveryGuidance stops before writes when registry preflight fails', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'registryPreflight', 'failed', 'GitHub registry token is read-only.');

  const guidance = buildOnboardingRecoveryGuidance({ steps });

  assert.match(guidance.join(' '), /No student records were written/);
  assert.match(guidance.join(' '), /GitHub registry write access/);
});

test('buildOnboardingRecoveryGuidance directs a missing registry record to narrow recovery', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'registryPreflight', 'succeeded', 'Registry write path is available.');
  steps = markOnboardingStep(steps, 'duplicateCheck', 'failed', 'Students exists but registry is missing.');

  const guidance = buildOnboardingRecoveryGuidance({
    steps,
    duplicateState: {
      exactDuplicate: true,
      partialCanonicalRecord: true,
    },
  });

  assert.match(guidance.join(' '), /Do not rerun full onboarding/);
  assert.match(guidance.join(' '), /Create registry entry/);
});

test('buildOnboardingRecoveryGuidance identifies a registry failure after Sheets succeeded', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students.');
  steps = markOnboardingStep(steps, 'registryWrite', 'failed', 'GitHub registry update failed: 403');

  const guidance = buildOnboardingRecoveryGuidance({ steps });

  assert.match(guidance.join(' '), /Students row was written/);
  assert.match(guidance.join(' '), /SHEETS ONLY/);
});

test('buildOnboardingRecoveryGuidance explains exact duplicate blocks', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'duplicateCheck', 'failed', 'A Students sheet row already exists.');

  const guidance = buildOnboardingRecoveryGuidance({
    steps,
    duplicateState: {
      exactDuplicate: true,
    },
  });

  assert.match(guidance.join(' '), /already exists/i);
  assert.match(guidance.join(' '), /existing student record/i);
});

test('buildOnboardingCompletionStatus marks canonical and MMS state separately', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students sheet at row 10.');
  steps = markOnboardingStep(steps, 'registryWrite', 'succeeded', 'Appended new registry entry.');
  steps = markOnboardingStep(steps, 'mmsActivation', 'succeeded', 'Student activated in MMS.');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'succeeded', 'Billing profile is ready.');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'failed', 'MMS create lesson failed.');
  steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'The Free event was kept because the lesson was not confirmed.');

  const status = buildOnboardingCompletionStatus({ steps });

  assert.equal(status.canonicalRecord.status, 'complete');
  assert.equal(status.mmsOperationalState.status, 'partial');
  assert.equal(status.fcIdentityRefresh.status, 'pending');
  assert.equal(status.portalActivation.status, 'pending');
});

test('buildOnboardingCompletionStatus treats skipped idempotent MMS steps as ready', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students sheet at row 10.');
  steps = markOnboardingStep(steps, 'registryWrite', 'skipped', 'Existing registry entry retained.');
  steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'Student was already active in MMS.');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Existing billing profile reused in MMS.');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Matching recurring lesson series already existed in MMS.');
  steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'No MMS Free source event was selected.');

  const status = buildOnboardingCompletionStatus({ steps });

  assert.equal(status.canonicalRecord.status, 'complete');
  assert.equal(status.mmsOperationalState.status, 'complete');
});

test('free-slot cleanup failure keeps MMS onboarding partial without suggesting another lesson', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded', 'Inserted into Students.');
  steps = markOnboardingStep(steps, 'registryWrite', 'succeeded', 'Registry entry created.');
  steps = markOnboardingStep(steps, 'mmsActivation', 'succeeded', 'Student activated.');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'succeeded', 'Billing ready.');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'succeeded', 'Lesson created.');
  steps = markOnboardingStep(steps, 'mmsFreeSlot', 'failed', 'Free event removal failed.');

  const status = buildOnboardingCompletionStatus({ steps });
  const guidance = buildOnboardingRecoveryGuidance({ steps }).join(' ');

  assert.equal(status.mmsOperationalState.status, 'partial');
  assert.match(guidance, /first lesson already exists/i);
  assert.match(guidance, /Do not recreate the lesson/i);
  assert.match(guidance, /remove that remaining Free event manually/i);
  assert.equal(isOnboardingCoreOperationallyComplete({ steps }), true);
});

test('post-onboarding work waits for the lesson but not ancillary Free-slot cleanup', () => {
  let steps = createOnboardingSteps();
  steps = markOnboardingStep(steps, 'sheetsWrite', 'succeeded');
  steps = markOnboardingStep(steps, 'registryWrite', 'succeeded');
  steps = markOnboardingStep(steps, 'mmsActivation', 'succeeded');
  steps = markOnboardingStep(steps, 'mmsBillingProfile', 'succeeded');
  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'failed');
  steps = markOnboardingStep(steps, 'mmsFreeSlot', 'failed');

  assert.equal(isOnboardingCoreOperationallyComplete({ steps }), false);

  steps = markOnboardingStep(steps, 'mmsFirstLesson', 'succeeded');
  assert.equal(isOnboardingCoreOperationallyComplete({ steps }), true);
});

const readyCompletionForm = {
  soundsliceUrl: 'https://www.soundslice.com/courses/16914/',
  humanChecks: {
    paymentTermsExplained: true,
    lessonWhatsappGroupReady: true,
  },
};

test('completion is blocked until a Soundslice URL is present', () => {
  const blockers = findOnboardingCompletionBlockers({
    ...readyCompletionForm,
    soundsliceUrl: '',
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].field, 'soundsliceUrl');
  assert.match(blockers[0].message, /Soundslice URL/u);

  // Whitespace is the realistic miss: the field looks filled in the form.
  assert.equal(findOnboardingCompletionBlockers({ ...readyCompletionForm, soundsliceUrl: '   ' }).length, 1);
});

test('completion requires both human payment and WhatsApp confirmations', () => {
  const missingBoth = findOnboardingCompletionBlockers({
    ...readyCompletionForm,
    humanChecks: {},
  });
  assert.deepEqual(missingBoth.map((blocker) => blocker.field), [
    'paymentTermsExplained',
    'lessonWhatsappGroupReady',
  ]);
  assert.match(missingBoth[0].message, /weekly Stripe subscription/u);
  assert.match(missingBoth[1].message, /assigned tutor, Finn, Tom and Fennella/u);
  assert.equal(findOnboardingCompletionBlockers({}).length, 3);
  assert.equal(findOnboardingCompletionBlockers().length, 3);
});

test('Soundslice and both human confirmations clear every completion blocker', () => {
  assert.deepEqual(findOnboardingCompletionBlockers(readyCompletionForm), []);
});

test('onboarding opens on the instrument the waiting-list suggestion was made for', () => {
  // The reported failure: a note asking for both puts a guitar-only tutor on the
  // waiting list, then onboarding collapsed the whole note to Ukulele and offered
  // only the ukulele tutors — so the suggested tutor could not be selected.
  const noteInstruments = parseInstrumentList('Guitar and Ukulele');
  const hamish = { shortName: 'Hamish', ...ADMIN_TUTORS.Hamish };

  assert.equal(
    resolveOnboardingInstrument({ requestedInstrument: 'Guitar', noteInstruments, requestedTutor: hamish }),
    'Guitar',
  );
  // No instrument on the link (an older bookmark): the requested tutor still
  // settles which of the two instruments this is.
  assert.equal(
    resolveOnboardingInstrument({ noteInstruments, requestedTutor: hamish }),
    'Guitar',
  );
  // Nothing requested at all: first instrument the note asks for.
  assert.equal(resolveOnboardingInstrument({ noteInstruments }), 'Guitar');
  assert.equal(resolveOnboardingInstrument({}), '');
});

test('tutorTeachesInstrument matches on the teaching lane, not the portal label', () => {
  const hamish = ADMIN_TUTORS.Hamish;
  const finn = ADMIN_TUTORS.Finn;

  assert.equal(tutorTeachesInstrument(hamish, 'Guitar'), true);
  assert.equal(tutorTeachesInstrument(hamish, 'Electric Guitar'), true);
  assert.equal(tutorTeachesInstrument(hamish, 'Ukulele'), false);
  assert.equal(tutorTeachesInstrument(finn, 'Ukulele'), true);
  // No instrument chosen yet: everyone stays selectable.
  assert.equal(tutorTeachesInstrument(hamish, ''), true);
});
