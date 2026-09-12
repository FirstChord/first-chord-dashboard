/** @fileoverview Sheets adapter for the newsletter lane: monthly issue rows and per-student contribution items, both keyed upsert. */
import {
  ensureManagedSheet,
  getSheetValues,
  getSheetsClient,
  getSheetsEnv,
  invalidateSheetReadCache,
  mapRowsToObjectsWithRowNumbers,
  NEWSLETTER_ISSUES_HEADERS,
  NEWSLETTER_ISSUES_SHEET,
  NEWSLETTER_ITEMS_HEADERS,
  NEWSLETTER_ITEMS_SHEET,
  upsertManagedSheetRow,
} from './core.mjs';

// A runtime without Sheets env (the legacy public service) renders no newsletter
// at all. Warn so an empty page is traceable to configuration rather than
// mistaken for "nothing has been asked for this month".
function warnMissingSheets(what) {
  console.warn(`Newsletter ${what} read skipped: Google Sheets credentials are not configured on this runtime.`);
}

export async function getNewsletterIssueRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    warnMissingSheets('issues');
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: NEWSLETTER_ISSUES_SHEET,
    requiredHeaders: NEWSLETTER_ISSUES_HEADERS,
  });

  const values = await getSheetValues(NEWSLETTER_ISSUES_SHEET);

  return mapRowsToObjectsWithRowNumbers(values)
    .map((row) => ({
      rowNumber: row.__rowNumber,
      issueMonth: row.issue_month || '',
      question: row.question || '',
      deadline: row.deadline || '',
      intro: row.intro || '',
      openedAt: row.opened_at || '',
      openedBy: row.opened_by || '',
      updatedAt: row.updated_at || '',
    }))
    .filter((row) => row.issueMonth)
    // Newest issue first: the current month is what someone opening the page
    // almost always wants.
    .sort((a, b) => b.issueMonth.localeCompare(a.issueMonth));
}

export function buildNewsletterIssueSheetRow(row) {
  return {
    issue_month: row.issueMonth || '',
    question: row.question || '',
    deadline: row.deadline || '',
    intro: row.intro || '',
    opened_at: row.openedAt || '',
    opened_by: row.openedBy || '',
    updated_at: row.updatedAt || '',
  };
}

export async function upsertNewsletterIssueRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildNewsletterIssueSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: NEWSLETTER_ISSUES_SHEET,
    requiredHeaders: NEWSLETTER_ISSUES_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) =>
      `${entry[headers.indexOf('issue_month')] || ''}`.trim() === row.issueMonth,
  });
}

// `issueMonth` filters to one issue. Callers that need consent history across
// months (standing permission is derived from earlier answers) must read the
// whole tab — pass nothing.
export async function getNewsletterItemRows(issueMonth = '') {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    warnMissingSheets('items');
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: NEWSLETTER_ITEMS_SHEET,
    requiredHeaders: NEWSLETTER_ITEMS_HEADERS,
  });

  const values = await getSheetValues(NEWSLETTER_ITEMS_SHEET);

  return mapRowsToObjectsWithRowNumbers(values)
    .map((row) => ({
      rowNumber: row.__rowNumber,
      itemId: row.item_id || '',
      issueMonth: row.issue_month || '',
      fcStudentId: row.fc_student_id || '',
      studentName: row.student_name || '',
      fcTutorId: row.fc_tutor_id || '',
      tutorName: row.tutor_name || '',
      mmsId: row.mms_id || '',
      requestedAt: row.requested_at || '',
      requestedBy: row.requested_by || '',
      capturedAt: row.captured_at || '',
      capturedBy: row.captured_by || '',
      tutorText: row.tutor_text || '',
      tutorResponse: row.tutor_response || '',
      hasMedia: row.has_media || '',
      consentAskedAt: row.consent_asked_at || '',
      consentAnswer: row.consent_answer || '',
      consentRecordedAt: row.consent_recorded_at || '',
      editorial: row.editorial || '',
      updatedAt: row.updated_at || '',
    }))
    .filter((row) => row.itemId)
    .filter((row) => (!issueMonth || row.issueMonth === issueMonth));
}

export function buildNewsletterItemSheetRow(row) {
  return {
    item_id: row.itemId || '',
    issue_month: row.issueMonth || '',
    fc_student_id: row.fcStudentId || '',
    student_name: row.studentName || '',
    fc_tutor_id: row.fcTutorId || '',
    tutor_name: row.tutorName || '',
    mms_id: row.mmsId || '',
    requested_at: row.requestedAt || '',
    requested_by: row.requestedBy || '',
    captured_at: row.capturedAt || '',
    captured_by: row.capturedBy || '',
    tutor_text: row.tutorText || '',
    tutor_response: row.tutorResponse || '',
    has_media: row.hasMedia || '',
    consent_asked_at: row.consentAskedAt || '',
    consent_answer: row.consentAnswer || '',
    consent_recorded_at: row.consentRecordedAt || '',
    editorial: row.editorial || '',
    updated_at: row.updatedAt || '',
  };
}

export async function upsertNewsletterItemRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildNewsletterItemSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: NEWSLETTER_ITEMS_SHEET,
    requiredHeaders: NEWSLETTER_ITEMS_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) =>
      `${entry[headers.indexOf('item_id')] || ''}`.trim() === row.itemId,
  });
}

// Removing an untouched priority row. Deliberately narrow: the orchestration
// layer only reaches this for a row where nothing has arrived, nobody has
// replied and no permission conversation has started (isEmptyRequestRow).
// Anything else is demoted to an extra instead, so an arrival is never lost.
export async function deleteNewsletterItemRow(itemId = '') {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const target = `${itemId || ''}`.trim();
  if (!target) return { deleted: false };

  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: NEWSLETTER_ITEMS_SHEET,
    requiredHeaders: NEWSLETTER_ITEMS_HEADERS,
  });
  const values = await getSheetValues(NEWSLETTER_ITEMS_SHEET, { force: true });
  const [, ...rows] = values;
  const idIndex = headers.indexOf('item_id');
  const rowIndex = rows.findIndex((entry) => `${entry[idIndex] || ''}`.trim() === target);
  if (rowIndex === -1) return { deleted: false };

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [NEWSLETTER_ITEMS_SHEET],
    includeGridData: false,
  });
  const sheet = metadata.data.sheets?.find(
    (entry) => entry.properties?.title === NEWSLETTER_ITEMS_SHEET,
  );
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') {
    throw new Error('Could not resolve Newsletter_Items sheet metadata');
  }

  const targetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: targetRowNumber - 1, endIndex: targetRowNumber },
          },
        },
      ],
    },
  });

  invalidateSheetReadCache(NEWSLETTER_ITEMS_SHEET);
  return { deleted: true, rowNumber: targetRowNumber };
}
