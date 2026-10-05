/** @fileoverview Sheets adapter reading and upserting tutor lifecycle rows. */
import {
  ensureManagedSheet,
  getSheetValues,
  getSheetsClient,
  getSheetsEnv,
  mapRowsToObjectsWithRowNumbers,
  TUTOR_LIFECYCLE_HEADERS,
  TUTOR_LIFECYCLE_SHEET,
  upsertManagedSheetRow,
} from './core.mjs';

export async function getTutorLifecycleRows(options = {}) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: TUTOR_LIFECYCLE_SHEET,
    requiredHeaders: TUTOR_LIFECYCLE_HEADERS,
  });

  const values = await getSheetValues(TUTOR_LIFECYCLE_SHEET, options);
  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    teacherId: row.teacher_id || '',
    tutorShortName: row.tutor_short_name || '',
    tutorName: row.tutor_name || '',
    status: row.status || '',
    finalTeachingDate: row.final_teaching_date || '',
    retiredAt: row.retired_at || '',
    replacementTutorShortName: row.replacement_tutor_short_name || '',
    note: row.note || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    updatedBy: row.updated_by || '',
  }));
}

export async function upsertTutorLifecycleRow(row = {}) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const teacherId = `${row.teacherId || ''}`.trim();
  if (!teacherId) throw new Error('Tutor MMS teacher ID is required');

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: TUTOR_LIFECYCLE_SHEET,
    requiredHeaders: TUTOR_LIFECYCLE_HEADERS,
    valuesByHeader: {
      teacher_id: teacherId,
      tutor_short_name: `${row.tutorShortName || ''}`.trim(),
      tutor_name: `${row.tutorName || ''}`.trim(),
      status: `${row.status || 'active'}`.trim(),
      final_teaching_date: `${row.finalTeachingDate || ''}`.trim(),
      retired_at: `${row.retiredAt || ''}`.trim(),
      replacement_tutor_short_name: `${row.replacementTutorShortName || ''}`.trim(),
      note: `${row.note || ''}`.trim(),
      created_at: `${row.createdAt || ''}`.trim(),
      updated_at: `${row.updatedAt || ''}`.trim(),
      updated_by: `${row.updatedBy || ''}`.trim(),
    },
    matchesRow: (entry, headers) => `${entry[headers.indexOf('teacher_id')] || ''}`.trim() === teacherId,
  });
}
