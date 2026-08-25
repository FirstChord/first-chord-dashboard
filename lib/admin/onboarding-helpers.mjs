/** @fileoverview Pure onboarding step creation, duplicate detection, recovery guidance, and completion assessment. */
function pickFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (`${value || ''}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  return '';
}

export function evaluateOnboardingDuplicateState({
  mmsId,
  tutorFullName,
  tutorShortName,
  sheetRows = [],
  registryEntry = null,
}) {
  const matchingSheetRows = sheetRows.filter((row) => pickFirst(row, ['mms_id', 'MMS ID', 'MMS Id', 'Student ID']) === mmsId);
  const matchingTutors = new Set(
    matchingSheetRows
      .map((row) => pickFirst(row, ['Tutor']))
      .filter(Boolean),
  );

  const hasSameTutorSheetRow = tutorFullName ? matchingTutors.has(tutorFullName) : false;
  const hasDifferentTutorSheetRow = matchingTutors.size > 0 && !hasSameTutorSheetRow;

  const registryTutor = registryEntry?.tutor || '';
  const registryMatchesTutor = Boolean(registryTutor && tutorShortName && registryTutor === tutorShortName);
  const registryExists = Boolean(registryEntry);
  const partialCanonicalRecord = hasSameTutorSheetRow && !registryExists;

  const blockingReasons = [];
  const warnings = [];

  if (partialCanonicalRecord) {
    blockingReasons.push(
      `A Students sheet row already exists for ${mmsId} with tutor ${tutorFullName}, but its registry entry is missing. Use the SHEETS ONLY recovery action instead of rerunning full onboarding.`,
    );
  } else if (hasSameTutorSheetRow) {
    blockingReasons.push(`A Students sheet row already exists for ${mmsId} with tutor ${tutorFullName}.`);
  }

  if (registryExists && registryMatchesTutor) {
    blockingReasons.push(`A registry entry already exists for ${mmsId} with tutor ${tutorShortName}.`);
  }

  if (hasDifferentTutorSheetRow) {
    warnings.push('This student already has a Students sheet row for another tutor. This may be a valid multi-lesson case.');
  }

  if (registryExists && !registryMatchesTutor) {
    warnings.push(`This student already has a registry entry for tutor ${registryTutor}. The existing portal record will be kept.`);
  }

  return {
    exactDuplicate: blockingReasons.length > 0,
    blockingReasons,
    warnings,
    matchingTutorCount: matchingTutors.size,
    matchingTutors: [...matchingTutors],
    hasSameTutorSheetRow,
    hasDifferentTutorSheetRow,
    registryExists,
    partialCanonicalRecord,
    registryTutor,
    registryMatchesTutor,
    shouldAppendRegistry: !registryExists,
  };
}

export function createOnboardingSteps() {
  return {
    registryPreflight: { status: 'pending', detail: '' },
    duplicateCheck: { status: 'pending', detail: '' },
    sheetsWrite: { status: 'pending', detail: '' },
    registryWrite: { status: 'pending', detail: '' },
    mmsActivation: { status: 'pending', detail: '' },
    mmsBillingProfile: { status: 'pending', detail: '' },
    mmsFirstLesson: { status: 'pending', detail: '' },
    mmsFreeSlot: { status: 'pending', detail: '' },
  };
}

export function markOnboardingStep(steps, stepKey, status, detail = '') {
  return {
    ...steps,
    [stepKey]: {
      status,
      detail,
    },
  };
}

export function buildOnboardingRecoveryGuidance({ steps, duplicateState = null }) {
  const guidance = [];
  const isReady = (step) => step?.status === 'succeeded' || step?.status === 'skipped';

  if (steps.registryPreflight?.status === 'failed') {
    guidance.push('No student records were written. Restore GitHub registry write access, then rerun onboarding preflight.');
  }

  if (duplicateState?.partialCanonicalRecord) {
    guidance.push('The Students row already exists but the registry entry is missing.');
    guidance.push('Do not rerun full onboarding. Use the SHEETS ONLY “Create registry entry” action, then verify MMS state separately.');
  }

  if (duplicateState?.exactDuplicate) {
    if (!duplicateState.partialCanonicalRecord) {
      guidance.push('This student already exists for the selected tutor in the current dashboard lanes.');
      guidance.push('Review the existing student record before attempting another onboarding run.');
    }
  }

  if (steps.sheetsWrite?.status === 'succeeded' && steps.registryWrite?.status === 'failed') {
    guidance.push('A Students row was written but the registry write failed.');
    guidance.push('Do not rerun full onboarding. Use the SHEETS ONLY “Create registry entry” action, then verify MMS before any MMS recovery.');
  }

  if (steps.sheetsWrite?.status === 'succeeded' && !isReady(steps.mmsActivation)) {
    guidance.push('The student is in Sheets, but MMS activation is incomplete. Retry the MMS-side workflow only after checking the live student record.');
  }

  if (isReady(steps.mmsActivation) && !isReady(steps.mmsBillingProfile)) {
    guidance.push('The student is active in MMS, but billing profile setup still needs attention before lesson creation is reliable.');
  }

  if (isReady(steps.mmsBillingProfile) && !isReady(steps.mmsFirstLesson)) {
    guidance.push('Billing is ready, but the first lesson was not confirmed. Check the calendar before retrying to avoid duplicates.');
  }

  if (steps.registryWrite?.status === 'succeeded' && steps.mmsFirstLesson?.status === 'failed') {
    guidance.push('The portal-side record exists already. Avoid re-appending registry data during recovery.');
  }

  if (isReady(steps.mmsFirstLesson) && steps.mmsFreeSlot?.status === 'failed') {
    guidance.push('The first lesson already exists in MMS, but the selected Free event was not removed.');
    guidance.push('Do not recreate the lesson. Check the calendar and remove that remaining Free event manually, or retry only the Free-slot cleanup.');
  }

  return guidance;
}

export function buildOnboardingCompletionStatus({ steps }) {
  const isReady = (step) => step?.status === 'succeeded' || step?.status === 'skipped';

  const sheetsReady = steps.sheetsWrite?.status === 'succeeded';
  const registryReady = isReady(steps.registryWrite);
  const mmsActivated = isReady(steps.mmsActivation);
  const billingReady = isReady(steps.mmsBillingProfile);
  const firstLessonReady = isReady(steps.mmsFirstLesson);
  const freeSlotReady = isReady(steps.mmsFreeSlot);

  return {
    canonicalRecord: {
      status: sheetsReady && registryReady ? 'complete' : 'incomplete',
      label: sheetsReady && registryReady ? 'Canonical student record created' : 'Canonical student record incomplete',
      detail: sheetsReady && registryReady
        ? 'Sheets and registry lanes are in place.'
        : 'A required canonical write is still incomplete.',
    },
    mmsOperationalState: {
      status: mmsActivated && billingReady && firstLessonReady && freeSlotReady ? 'complete' : mmsActivated ? 'partial' : 'incomplete',
      label: mmsActivated && billingReady && firstLessonReady && freeSlotReady ? 'MMS setup complete' : 'MMS setup still needs attention',
      detail: mmsActivated && billingReady && firstLessonReady && freeSlotReady
        ? 'Student is active, billable, has a scheduled lesson, and the selected Free event is cleared.'
        : 'Activation, billing profile, first lesson, or selected Free-event cleanup still needs follow-up.',
    },
    fcIdentityRefresh: {
      status: 'pending',
      label: 'FC identity refresh pending',
      detail: 'Run python3 generate_fc_ids.py in first-chord-brain to refresh FC exports and Review_Flags.',
    },
    portalActivation: {
      status: 'pending',
      label: 'Portal activation pending',
      detail: 'Run npm run generate-configs && git push in this repo to publish derived dashboard config changes.',
    },
  };
}

export function isOnboardingCoreOperationallyComplete({ steps = {} } = {}) {
  const isReady = (step) => step?.status === 'succeeded' || step?.status === 'skipped';

  return steps.sheetsWrite?.status === 'succeeded'
    && isReady(steps.registryWrite)
    && isReady(steps.mmsActivation)
    && isReady(steps.mmsBillingProfile)
    && isReady(steps.mmsFirstLesson);
}

// What must be true before "Complete onboarding" is allowed to run. Kept here
// rather than inline in the form so the rule is testable and can be reused by
// the route if the API ever needs the same guard.
//
export function findOnboardingCompletionBlockers(form = {}) {
  const blockers = [];

  if (!`${form?.soundsliceUrl || ''}`.trim()) {
    blockers.push({
      field: 'soundsliceUrl',
      message: 'Add the Soundslice URL before completing onboarding. The student has no practice link without it.',
    });
  }

  if (form?.humanChecks?.paymentTermsExplained !== true) {
    blockers.push({
      field: 'paymentTermsExplained',
      message: 'Confirm that the weekly Stripe subscription and first-lesson payment were explained on the welcome call.',
    });
  }

  if (form?.humanChecks?.lessonWhatsappGroupReady !== true) {
    blockers.push({
      field: 'lessonWhatsappGroupReady',
      message: 'Confirm that the lesson WhatsApp group contains the parent/student, assigned tutor, Finn, Tom and Fennella.',
    });
  }

  return blockers;
}
