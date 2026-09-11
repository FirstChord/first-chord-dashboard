/** @fileoverview Admin student reads over the shared context collection plus registry and sheet writes for a single student. */
import { appendRegistryEntry, updateRegistryEntry } from '@/lib/admin/registry';
import { updateStudentSheetRow } from '@/lib/admin/sheets';
import { generateFcStudentId, generateFriendlyUrl, normaliseInstrument } from './fc';
import { loadStudentContextCollection } from './student-context';
import { filterOperationalStudents } from './test-student-helpers.mjs';
import { getTutorShortNameByFullName } from './tutors.js';

export async function getAdminStudents() {
  const { students } = await loadStudentContextCollection({ includeFlags: true });
  // Copy before sorting: the collection is shared with the other loaders in this
  // render, so sorting in place would reorder their data too.
  return [...students].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getAdminStudentByMmsId(mmsId) {
  const { studentByMmsId } = await loadStudentContextCollection({
    includeFlags: true,
    includeSchedule: true,
  });
  return studentByMmsId.get(mmsId) || null;
}

export async function getOperationalAdminStudents() {
  const students = await getAdminStudents();
  return filterOperationalStudents(students);
}

export async function updateAdminStudent({ mmsId, sheetsUpdates = {}, registryUpdates = {} }) {
  if (Object.keys(sheetsUpdates).length > 0) {
    await updateStudentSheetRow(mmsId, sheetsUpdates);
  }

  if (Object.keys(registryUpdates).length > 0) {
    await updateRegistryEntry(mmsId, registryUpdates);
  }

  return getAdminStudentByMmsId(mmsId);
}

export async function createRegistryEntryForStudent(mmsId, registryOverrides = {}) {
  const student = await getAdminStudentByMmsId(mmsId);

  if (!student) {
    throw new Error(`Student ${mmsId} was not found in Sheets`);
  }

  if (student.registry) {
    return student;
  }

  const tutorShortName = getTutorShortNameByFullName(student.tutor);
  if (!tutorShortName) {
    throw new Error(`Could not map Sheets tutor "${student.tutor}" to a registry tutor short name`);
  }

  const instrument = normaliseInstrument(registryOverrides.instrument || student.instrument || '');
  if (!instrument) {
    throw new Error('Instrument is required to create a registry entry');
  }

  const soundsliceUrl = `${registryOverrides.soundsliceUrl || ''}`.trim();
  // A stored ID always wins; mint only for a student who has none.
  const fcStudentId = student.fcStudentId || generateFcStudentId(student.mmsId);
  const thetaUsername = `${student.firstName || ''}${student.lastName || ''}fc`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const friendlyUrl = await generateFriendlyUrl(student.firstName, student.lastName);

  await appendRegistryEntry({
    mmsId: student.mmsId,
    firstName: student.firstName,
    lastName: student.lastName,
    friendlyUrl,
    tutor: tutorShortName,
    instrument,
    soundsliceUrl,
    thetaUsername,
    fcStudentId,
  });

  return getAdminStudentByMmsId(mmsId);
}
