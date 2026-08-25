/** @fileoverview Reads the sheet and registry state behind onboarding duplicate detection. */
import { getRegistryEntryByMmsId } from '@/lib/admin/registry';
import { getStudentsSheetRows } from '@/lib/admin/sheets';
import { evaluateOnboardingDuplicateState } from './onboarding-helpers.mjs';

export {
  buildOnboardingCompletionStatus,
  buildOnboardingRecoveryGuidance,
  createOnboardingSteps,
  evaluateOnboardingDuplicateState,
  findOnboardingCompletionBlockers,
  isOnboardingCoreOperationallyComplete,
  markOnboardingStep,
} from './onboarding-helpers.mjs';

export async function getOnboardingDuplicateState({ mmsId, tutorFullName, tutorShortName }) {
  const [sheetRows, registryEntry] = await Promise.all([
    getStudentsSheetRows(),
    getRegistryEntryByMmsId(mmsId),
  ]);

  return evaluateOnboardingDuplicateState({
    mmsId,
    tutorFullName,
    tutorShortName,
    sheetRows,
    registryEntry,
  });
}
