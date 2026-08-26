/** @fileoverview Tutor option lists and short-name, full-name, and instrument lookups over the roster, merged with lifecycle state. */
import { ADMIN_TUTORS } from './tutors-data.js';
import { getTutorLifecycleRows } from './sheets.js';
import { normaliseTeachingInstrument } from './fc-helpers.mjs';

export { ADMIN_TUTORS } from './tutors-data.js';
// Defined in the pure identity module; re-exported so existing callers are unchanged.
export { getTutorFullNameByShortName, getTutorShortNameByFullName } from './tutor-identity.mjs';

export function getAllTutorOptions() {
  return Object.entries(ADMIN_TUTORS).map(([shortName, tutor]) => ({
    shortName,
    fullName: tutor.fullName,
    teacherId: tutor.teacherId,
    instruments: tutor.instruments,
  }));
}

export function normaliseTutorLifecycleStatus(value = '') {
  const status = `${value || ''}`.trim().toLowerCase();
  return ['active', 'leaving', 'retired'].includes(status) ? status : 'active';
}

// The generated tutor list is the durable identity layer. Lifecycle rows only
// overlay operational availability; missing rows deliberately mean active so
// existing tutors keep working before the first lifecycle record is written.
export async function getTutorOptionsWithLifecycle() {
  const [tutors, lifecycleRows] = await Promise.all([
    getAllTutorOptions(),
    getTutorLifecycleRows(),
  ]);
  const lifecycleByTeacherId = new Map(
    lifecycleRows.filter((row) => row.teacherId).map((row) => [row.teacherId, row]),
  );

  return tutors.map((tutor) => {
    const lifecycle = lifecycleByTeacherId.get(tutor.teacherId) || {};
    return {
      ...tutor,
      lifecycleStatus: normaliseTutorLifecycleStatus(lifecycle.status),
      finalTeachingDate: lifecycle.finalTeachingDate || '',
      retiredAt: lifecycle.retiredAt || '',
      replacementTutorShortName: lifecycle.replacementTutorShortName || '',
      lifecycleNote: lifecycle.note || '',
      lifecycleCreatedAt: lifecycle.createdAt || '',
      lifecycleUpdatedAt: lifecycle.updatedAt || '',
    };
  });
}

export async function getActiveTutorOptions() {
  const tutors = await getTutorOptionsWithLifecycle();
  return tutors.filter((tutor) => tutor.lifecycleStatus !== 'retired');
}

export function getTutorsForInstrument(instrument) {
  const needle = normaliseTeachingInstrument(instrument).toLowerCase().trim();
  if (!needle) {
    return getAllTutorOptions();
  }

  return getAllTutorOptions().filter((tutor) => tutor.instruments.includes(needle));
}
