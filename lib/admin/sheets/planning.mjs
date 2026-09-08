/** @fileoverview Sheets adapter reading and writing planning items and the planning progress log. */
import { buildSheetRange, ensureManagedSheet, getSheetValues, getSheetsClient, getSheetsEnv, invalidateSheetReadCache, mapRowsToObjectsWithRowNumbers, PLANNING_ITEMS_HEADERS, PLANNING_ITEMS_SHEET, PLANNING_PROGRESS_LOG_HEADERS, PLANNING_PROGRESS_LOG_SHEET, upsertManagedSheetRow } from './core.mjs';

export async function getPlanningItemRows({ force = false } = {}) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: PLANNING_ITEMS_SHEET,
    requiredHeaders: PLANNING_ITEMS_HEADERS,
  });

  const values = await getSheetValues(PLANNING_ITEMS_SHEET, { force });

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    planningId: row.planning_id || '',
    title: row.title || '',
    notes: row.notes || '',
    itemType: row.item_type || '',
    planMode: row.plan_mode || '',
    owner: row.owner || '',
    status: row.status || '',
    area: row.area || '',
    linkedWorkflowId: row.linked_workflow_id || '',
    linkedStudentId: row.linked_student_id || '',
    linkedTutorId: row.linked_tutor_id || '',
    parentPlanningId: row.parent_planning_id || '',
    outcome: row.outcome || '',
    nextAction: row.next_action || '',
    targetDate: row.target_date || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    createdBy: row.created_by || '',
    lastUpdatedBy: row.last_updated_by || '',
    isPause: row.is_pause || '',
  }));
}

export async function getPlanningProgressLogRows(planningId = '') {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: PLANNING_PROGRESS_LOG_SHEET,
    requiredHeaders: PLANNING_PROGRESS_LOG_HEADERS,
  });

  const values = await getSheetValues(PLANNING_PROGRESS_LOG_SHEET);

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    progressId: row.progress_id || '',
    planningId: row.planning_id || '',
    progressNote: row.progress_note || '',
    progressType: row.progress_type || '',
    createdAt: row.created_at || '',
    createdBy: row.created_by || '',
  })).filter((row) => (!planningId || row.planningId === planningId));
}

function buildPlanningItemSheetRow(row) {
  return {
    planning_id: row.planningId || '',
    title: row.title || '',
    notes: row.notes || '',
    item_type: row.itemType || '',
    plan_mode: row.planMode || '',
    owner: row.owner || '',
    status: row.status || '',
    area: row.area || '',
    linked_workflow_id: row.linkedWorkflowId || '',
    linked_student_id: row.linkedStudentId || '',
    linked_tutor_id: row.linkedTutorId || '',
    parent_planning_id: row.parentPlanningId || '',
    outcome: row.outcome || '',
    next_action: row.nextAction || '',
    target_date: row.targetDate || '',
    created_at: row.createdAt || '',
    updated_at: row.updatedAt || '',
    created_by: row.createdBy || '',
    last_updated_by: row.lastUpdatedBy || '',
    is_pause: row.isPause || '',
  };
}

export async function upsertPlanningItemRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildPlanningItemSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: PLANNING_ITEMS_SHEET,
    requiredHeaders: PLANNING_ITEMS_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('planning_id')] || ''}`.trim() === row.planningId,
  });
}

function buildPlanningProgressLogSheetRow(row) {
  return {
    progress_id: row.progressId || '',
    planning_id: row.planningId || '',
    progress_note: row.progressNote || '',
    progress_type: row.progressType || '',
    created_at: row.createdAt || '',
    created_by: row.createdBy || '',
  };
}

export async function appendPlanningProgressLogRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: PLANNING_PROGRESS_LOG_SHEET,
    requiredHeaders: PLANNING_PROGRESS_LOG_HEADERS,
  });
  const valuesByHeader = buildPlanningProgressLogSheetRow(row);
  const nextRow = headers.map((header) => valuesByHeader[header] ?? '');

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: buildSheetRange(PLANNING_PROGRESS_LOG_SHEET, 'A:A'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [nextRow],
    },
  });
  invalidateSheetReadCache(PLANNING_PROGRESS_LOG_SHEET);
}

