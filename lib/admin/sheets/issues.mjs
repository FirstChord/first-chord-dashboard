/** @fileoverview Sheets adapter for review flags, pause history, the issue queue, and the append-only event log. */
import { columnNumberToLetter } from '../sheets-helpers.mjs';
import { buildSheetRange, EVENT_LOG_HEADERS, EVENT_LOG_SHEET, getSheetObjects, getSheetValues, getSheetsClient, getSheetsEnv, ISSUE_QUEUE_HEADERS, ISSUE_QUEUE_SHEET, invalidateSheetReadCache, mapRowsToObjectsWithRowNumbers, ensureManagedSheet, upsertManagedSheetRow, withSheetsRetry } from './core.mjs';

export async function getReviewFlagsRows() {
  return getSheetObjects('Review_Flags');
}

export async function getPauseHistoryRows() {
  return getSheetObjects("'Pause History'");
}

// Read-only audit history for projections such as the student timeline. This
// deliberately does not call ensureManagedSheet: opening a read model must
// never create or alter the append-only Event_Log tab.
export async function getEventLogRows() {
  const values = await getSheetValues(EVENT_LOG_SHEET);
  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    eventId: row.event_id || '',
    occurredAt: row.occurred_at || '',
    actorEmail: row.actor_email || '',
    entityType: row.entity_type || '',
    entityId: row.entity_id || '',
    eventType: row.event_type || '',
    mmsId: row.mms_id || '',
    studentName: row.student_name || '',
    issueId: row.issue_id || '',
    payloadJson: row.payload_json || '',
    eventDedupKey: row.event_dedupe_key || '',
  }));
}

export async function getIssueQueueRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: ISSUE_QUEUE_SHEET,
    requiredHeaders: ISSUE_QUEUE_HEADERS,
  });

  // Use the shared bounded-SWR sheet cache so repeat overview/flags reads are
  // instant while still capping stale data from external writers.
  const values = await getSheetValues(buildSheetRange(ISSUE_QUEUE_SHEET));

  const rows = mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    issueId: row.issue_id || '',
    source: row.source || '',
    issueType: row.issue_type || '',
    mmsId: row.mms_id || '',
    contextKey: row.context_key || '',
    studentName: row.student_name || '',
    severity: row.severity || '',
    status: row.status || '',
    owner: row.owner || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    resolvedAt: row.resolved_at || '',
    ignoredAt: row.ignored_at || '',
    acknowledgedAt: row.acknowledged_at || '',
    lastSeenAt: row.last_seen_at || '',
    sourcePresent: normaliseBooleanCell(row.source_present),
    summary: row.summary || '',
    detail: row.detail || '',
    recommendedAction: row.recommended_action || '',
    systemsAffected: row.systems_affected || '',
    resolutionNote: row.resolution_note || '',
  }));

  return dedupeIssueQueueRows(rows);
}

function buildIssueQueueSheetRow(row) {
  return {
    issue_id: row.issueId || '',
    source: row.source || '',
    issue_type: row.issueType || '',
    mms_id: row.mmsId || '',
    context_key: row.contextKey || '',
    student_name: row.studentName || '',
    severity: row.severity || '',
    status: row.status || '',
    owner: row.owner || '',
    created_at: row.createdAt || '',
    updated_at: row.updatedAt || '',
    resolved_at: row.resolvedAt || '',
    ignored_at: row.ignoredAt || '',
    acknowledged_at: row.acknowledgedAt || '',
    last_seen_at: row.lastSeenAt || '',
    source_present: row.sourcePresent || '',
    summary: row.summary || '',
    detail: row.detail || '',
    recommended_action: row.recommendedAction || '',
    systems_affected: row.systemsAffected || '',
    resolution_note: row.resolutionNote || '',
  };
}

function normaliseBooleanCell(value) {
  return `${value || ''}`.trim().toLowerCase() === 'true' ? 'true' : 'false';
}

function dedupeIssueQueueRows(rows = []) {
  const byIssueId = new Map();
  const passthroughRows = [];

  for (const row of rows) {
    if (!row.issueId) {
      passthroughRows.push(row);
      continue;
    }

    const existing = byIssueId.get(row.issueId);
    if (!existing || Number(row.rowNumber || 0) >= Number(existing.rowNumber || 0)) {
      byIssueId.set(row.issueId, row);
    }
  }

  return [
    ...passthroughRows,
    ...byIssueId.values(),
  ].sort((a, b) => Number(a.rowNumber || 0) - Number(b.rowNumber || 0));
}

export async function upsertIssueQueueRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildIssueQueueSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: ISSUE_QUEUE_SHEET,
    requiredHeaders: ISSUE_QUEUE_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('issue_id')] || ''}`.trim() === row.issueId,
  });
}

export async function upsertIssueQueueRows(rowsToSync = []) {
  if (!rowsToSync.length) {
    return;
  }

  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: ISSUE_QUEUE_SHEET,
    requiredHeaders: ISSUE_QUEUE_HEADERS,
  });

  const values = await getSheetValues(ISSUE_QUEUE_SHEET);
  const [, ...existingRows] = values;
  const issueIdIndex = headers.findIndex((header) => header === 'issue_id');
  const existingRowMap = new Map(
    existingRows.map((row, index) => [`${row[issueIdIndex] || ''}`.trim(), index + 2]),
  );
  const endColumn = columnNumberToLetter(headers.length);
  const updates = [];
  const appends = [];

  for (const row of rowsToSync) {
    const valuesByHeader = buildIssueQueueSheetRow(row);
    const nextRow = headers.map((header) => valuesByHeader[header] ?? '');
    const existingRowNumber = existingRowMap.get(row.issueId);

    if (existingRowNumber) {
      updates.push({
        range: buildSheetRange(ISSUE_QUEUE_SHEET, `A${existingRowNumber}:${endColumn}${existingRowNumber}`),
        values: [nextRow],
      });
    } else {
      appends.push(nextRow);
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
  }

  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: buildSheetRange(ISSUE_QUEUE_SHEET, 'A:A'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: appends,
      },
    });
  }

  invalidateSheetReadCache(ISSUE_QUEUE_SHEET);
}

export async function updateIssueQueueRow(issueId, updates) {
  const rows = await getIssueQueueRows();
  const existingRow = rows.find((row) => row.issueId === issueId);

  if (!existingRow) {
    throw new Error(`Issue queue row ${issueId} was not found`);
  }

  await upsertIssueQueueRow({
    ...existingRow,
    ...updates,
    issueId,
  });
}

function buildEventLogSheetRow(row) {
  return {
    event_id: row.eventId || '',
    occurred_at: row.occurredAt || '',
    actor_email: row.actorEmail || '',
    entity_type: row.entityType || '',
    entity_id: row.entityId || '',
    event_type: row.eventType || '',
    mms_id: row.mmsId || '',
    student_name: row.studentName || '',
    issue_id: row.issueId || '',
    payload_json: row.payloadJson || '',
    event_dedupe_key: row.eventDedupKey || '',
  };
}

// Serialise event writes inside one server process. Combined with the stable
// event_dedupe_key below, this prevents two simultaneous dashboard reads from
// appending the same machine-generated exception transition. A database unique
// constraint remains the eventual cross-process solution; Sheets has none.
async function withEventLogAppendLock(operation) {
  const previous = globalThis.__firstChordEventLogAppendLock || Promise.resolve();
  let release;
  globalThis.__firstChordEventLogAppendLock = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function getEventDedupeKey(row = {}) {
  return `${row.eventDedupKey || ''}`.trim();
}

function filterDuplicateEventRows(rows = [], existingValues = []) {
  const [headers = [], ...existingRows] = existingValues;
  const dedupeIndex = headers.indexOf('event_dedupe_key');
  const knownKeys = new Set(
    dedupeIndex >= 0
      ? existingRows.map((entry) => `${entry[dedupeIndex] || ''}`.trim()).filter(Boolean)
      : [],
  );
  const seenInBatch = new Set();

  return rows.filter((row) => {
    const key = getEventDedupeKey(row);
    // Human/consequential actions stay strictly append-only. Only callers that
    // deliberately supply a stable machine-transition key are de-duplicated.
    if (!key) return true;
    if (knownKeys.has(key) || seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
}

export async function appendEventLogRow(row) {
  return appendEventLogRows([row]);
}

export async function appendEventLogRows(rows = []) {
  if (!rows.length) {
    return { appended: 0, deduplicated: 0 };
  }

  return withEventLogAppendLock(async () => {
    const { spreadsheetId } = getSheetsEnv();
    const sheets = await getSheetsClient();

    if (!sheets || !spreadsheetId) {
      throw new Error('Google Sheets admin credentials are not configured');
    }

    const headers = await ensureManagedSheet({
      sheets,
      spreadsheetId,
      sheetName: EVENT_LOG_SHEET,
      requiredHeaders: EVENT_LOG_HEADERS,
    });

    const hasDedupeKeys = rows.some((row) => getEventDedupeKey(row));
    let rowsToAppend = rows;
    if (hasDedupeKeys) {
      // Do not rely on a bounded-stale read when making an idempotency decision.
      // A previous append invalidates this scope, so the serialised next writer
      // sees its key before it can append another copy.
      invalidateSheetReadCache(EVENT_LOG_SHEET);
      rowsToAppend = filterDuplicateEventRows(rows, await getSheetValues(EVENT_LOG_SHEET));
    }

    if (!rowsToAppend.length) {
      return { appended: 0, deduplicated: rows.length };
    }

    const values = rowsToAppend.map((row) => {
      const valuesByHeader = buildEventLogSheetRow(row);
      return headers.map((header) => valuesByHeader[header] ?? '');
    });

    await withSheetsRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId,
      range: buildSheetRange(EVENT_LOG_SHEET, 'A:A'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    }));
    invalidateSheetReadCache(EVENT_LOG_SHEET);
    return { appended: rowsToAppend.length, deduplicated: rows.length - rowsToAppend.length };
  });
}
