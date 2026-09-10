/** @fileoverview Sheets adapter for the incoming-message inbox, bridge status, tutor phones, and the WhatsApp group map. */
import {
  BRIDGE_STATUS_HEADERS,
  BRIDGE_STATUS_SHEET,
  buildSheetRange,
  ensureManagedSheet,
  getSheetValues,
  getSheetsClient,
  getSheetsEnv,
  INCOMING_MESSAGE_INBOX_HEADERS,
  INCOMING_MESSAGE_INBOX_SHEET,
  invalidateSheetReadCache,
  mapRowsToObjectsWithRowNumbers,
  TUTOR_PHONES_SHEET,
  upsertManagedSheetRow,
  WHATSAPP_GROUP_MAP_HEADERS,
  WHATSAPP_GROUP_MAP_SHEET,
  withSheetsRetry,
} from './core.mjs';
import { columnNumberToLetter } from '../sheets-helpers.mjs';
import { deriveIncomingMessageResolutionType } from '../incoming-message-helpers.mjs';

export async function getIncomingMessageInboxRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: INCOMING_MESSAGE_INBOX_SHEET,
    requiredHeaders: INCOMING_MESSAGE_INBOX_HEADERS,
  });

  const values = await getSheetValues(INCOMING_MESSAGE_INBOX_SHEET);

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    incomingId: row.incoming_id || '',
    matchedTutorName: row.matched_tutor_name || '',
    source: row.source || '',
    externalMessageId: row.external_message_id || '',
    capturedAt: row.captured_at || '',
    messageAt: row.message_at || '',
    chatId: row.chat_id || '',
    chatName: row.chat_name || '',
    groupType: row.group_type || 'student',
    matchedTutorId: row.matched_tutor_id || '',
    senderName: row.sender_name || '',
    senderPhone: row.sender_phone || '',
    messageText: row.message_text || '',
    capturedBy: row.captured_by || '',
    suspectedCategory: row.suspected_category || '',
    proposedCategory: row.proposed_category || row.suspected_category || '',
    proposedIntent: row.proposed_intent || '',
    proposedActionability: row.proposed_actionability || '',
    classificationIntent: row.classification_intent || '',
    classificationActionability: row.classification_actionability || '',
    classificationConfidence: row.classification_confidence || '',
    classificationVersion: row.classification_version || '',
    classificationEvidence: row.classification_evidence || '',
    classificationDecision: row.classification_decision || (row.reviewed_at ? 'legacy' : 'unreviewed'),
    matchedMmsId: row.matched_mms_id || '',
    matchedStudentName: row.matched_student_name || '',
    matchConfidence: row.match_confidence || '',
    matchReasons: row.match_reasons || '',
    status: row.status || '',
    reviewNote: row.review_note || '',
    reviewedBy: row.reviewed_by || '',
    reviewedAt: row.reviewed_at || '',
    createdPlanningId: row.created_planning_id || '',
    resolutionType: deriveIncomingMessageResolutionType({
      resolutionType: row.resolution_type,
      status: row.status,
      createdPlanningId: row.created_planning_id,
    }),
    snoozedUntil: row.snoozed_until || '',
    schoolRepliedAt: row.school_replied_at || '',
    schoolRepliedBy: row.school_replied_by || '',
    rawJson: row.raw_json || '',
  }));
}

export function buildIncomingMessageSheetRow(row) {
  return {
    incoming_id: row.incomingId || '',
    matched_tutor_name: row.matchedTutorName || '',
    source: row.source || '',
    external_message_id: row.externalMessageId || '',
    captured_at: row.capturedAt || '',
    message_at: row.messageAt || '',
    chat_id: row.chatId || '',
    chat_name: row.chatName || '',
    group_type: row.groupType || 'student',
    matched_tutor_id: row.matchedTutorId || '',
    sender_name: row.senderName || '',
    sender_phone: row.senderPhone || '',
    message_text: row.messageText || '',
    captured_by: row.capturedBy || '',
    suspected_category: row.suspectedCategory || '',
    proposed_category: row.proposedCategory || row.suspectedCategory || '',
    proposed_intent: row.proposedIntent || '',
    proposed_actionability: row.proposedActionability || '',
    classification_intent: row.classificationIntent || '',
    classification_actionability: row.classificationActionability || '',
    classification_confidence: row.classificationConfidence || '',
    classification_version: row.classificationVersion || '',
    classification_evidence: row.classificationEvidence || '',
    classification_decision: row.classificationDecision || '',
    matched_mms_id: row.matchedMmsId || '',
    matched_student_name: row.matchedStudentName || '',
    match_confidence: row.matchConfidence || '',
    match_reasons: row.matchReasons || '',
    status: row.status || '',
    review_note: row.reviewNote || '',
    reviewed_by: row.reviewedBy || '',
    reviewed_at: row.reviewedAt || '',
    created_planning_id: row.createdPlanningId || '',
    resolution_type: row.resolutionType || '',
    snoozed_until: row.snoozedUntil || '',
    school_replied_at: row.schoolRepliedAt || '',
    school_replied_by: row.schoolRepliedBy || '',
    raw_json: row.rawJson || '',
  };
}

export async function upsertIncomingMessageInboxRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildIncomingMessageSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: INCOMING_MESSAGE_INBOX_SHEET,
    requiredHeaders: INCOMING_MESSAGE_INBOX_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('incoming_id')] || ''}`.trim() === row.incomingId,
  });
}

export async function deleteIncomingMessageInboxRow(incomingId = '') {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) return { deleted: false };

  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: INCOMING_MESSAGE_INBOX_SHEET,
    requiredHeaders: INCOMING_MESSAGE_INBOX_HEADERS,
  });
  const values = await getSheetValues(INCOMING_MESSAGE_INBOX_SHEET);
  const [, ...rows] = values;
  const idIdx = headers.indexOf('incoming_id');
  const rowIndex = rows.findIndex((entry) => `${entry[idIdx] || ''}`.trim() === incomingKey);
  if (rowIndex === -1) return { deleted: false };

  const metadata = await sheets.spreadsheets.get({ spreadsheetId, ranges: [INCOMING_MESSAGE_INBOX_SHEET], includeGridData: false });
  const sheet = metadata.data.sheets?.find((entry) => entry.properties?.title === INCOMING_MESSAGE_INBOX_SHEET);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') {
    throw new Error('Could not resolve Incoming_Message_Inbox sheet metadata');
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

  invalidateSheetReadCache(INCOMING_MESSAGE_INBOX_SHEET);
  return { deleted: true, rowNumber: targetRowNumber };
}

export async function getBridgeStatusRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: BRIDGE_STATUS_SHEET,
    requiredHeaders: BRIDGE_STATUS_HEADERS,
  });

  const values = await getSheetValues(BRIDGE_STATUS_SHEET);

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    bridgeId: row.bridge_id || '',
    lastHeartbeatAt: row.last_heartbeat_at || '',
    connectedAt: row.connected_at || '',
    startedAt: row.started_at || '',
    confirmedGroups: Number(row.confirmed_groups) || 0,
    cachedMessages: Number(row.cached_messages) || 0,
    bridgeVersion: row.bridge_version || '',
    rawJson: row.raw_json || '',
  }));
}

export async function upsertBridgeStatusRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = {
    bridge_id: row.bridgeId || 'primary',
    last_heartbeat_at: row.lastHeartbeatAt || '',
    connected_at: row.connectedAt || '',
    started_at: row.startedAt || '',
    confirmed_groups: `${row.confirmedGroups ?? ''}`,
    cached_messages: `${row.cachedMessages ?? ''}`,
    bridge_version: row.bridgeVersion || '',
    raw_json: row.rawJson || '',
  };
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: BRIDGE_STATUS_SHEET,
    requiredHeaders: BRIDGE_STATUS_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('bridge_id')] || ''}`.trim() === (row.bridgeId || 'primary'),
  });
}

// Tutor WhatsApp numbers (personal data — sheet only, never git). Read
// tolerantly: the tab is human-maintained, so the name/phone columns are matched
// by trimmed, lower-cased header rather than an exact snake_case contract, and a
// missing tab simply turns tutor recognition off (returns []) rather than erroring.
export async function getTutorPhoneRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  let values;
  try {
    values = await getSheetValues(TUTOR_PHONES_SHEET);
  } catch {
    return [];
  }

  if (!values?.length) {
    return [];
  }

  const [headers = [], ...rows] = values;
  const normalisedHeaders = headers.map((header) => `${header || ''}`.trim().toLowerCase());
  const nameIndex = normalisedHeaders.findIndex((header) => header === 'name' || header === 'tutor');
  const phoneIndex = normalisedHeaders.findIndex((header) => header.startsWith('phone') || header.includes('number'));
  if (nameIndex === -1 || phoneIndex === -1) {
    return [];
  }

  return rows
    .map((row) => ({
      tutorName: `${row[nameIndex] || ''}`.trim(),
      phone: `${row[phoneIndex] || ''}`.trim(),
    }))
    .filter((row) => row.tutorName && row.phone);
}

export async function getWhatsappGroupMapRows() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: WHATSAPP_GROUP_MAP_SHEET,
    requiredHeaders: WHATSAPP_GROUP_MAP_HEADERS,
  });

  const values = await getSheetValues(WHATSAPP_GROUP_MAP_SHEET);

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    chatId: row.chat_id || '',
    chatName: row.chat_name || '',
    groupType: row.group_type || 'student',
    matchedTutorId: row.matched_tutor_id || '',
    firstSeenAt: row.first_seen_at || '',
    lastSeenAt: row.last_seen_at || '',
    lastIncomingId: row.last_incoming_id || '',
    lastMessageAt: row.last_message_at || '',
    lastSenderName: row.last_sender_name || '',
    lastSenderPhone: row.last_sender_phone || '',
    matchedMmsId: row.matched_mms_id || '',
    matchedFcId: row.matched_fc_id || '',
    matchedStudentName: row.matched_student_name || '',
    additionalMmsIds: row.additional_mms_ids || '',
    parentName: row.parent_name || '',
    parentPhone: row.parent_phone || '',
    tutorName: row.tutor_name || '',
    instrument: row.instrument || '',
    matchConfidence: row.match_confidence || '',
    matchReasons: row.match_reasons || '',
    status: row.status || '',
    confirmedBy: row.confirmed_by || '',
    confirmedAt: row.confirmed_at || '',
    notes: row.notes || '',
    rawJson: row.raw_json || '',
  }));
}

export function buildWhatsappGroupMapSheetRow(row) {
  return {
    chat_id: row.chatId || '',
    chat_name: row.chatName || '',
    group_type: row.groupType || 'student',
    matched_tutor_id: row.matchedTutorId || '',
    first_seen_at: row.firstSeenAt || '',
    last_seen_at: row.lastSeenAt || '',
    last_incoming_id: row.lastIncomingId || '',
    last_message_at: row.lastMessageAt || '',
    last_sender_name: row.lastSenderName || '',
    last_sender_phone: row.lastSenderPhone || '',
    matched_mms_id: row.matchedMmsId || '',
    matched_fc_id: row.matchedFcId || '',
    matched_student_name: row.matchedStudentName || '',
    additional_mms_ids: row.additionalMmsIds || '',
    parent_name: row.parentName || '',
    parent_phone: row.parentPhone || '',
    tutor_name: row.tutorName || '',
    instrument: row.instrument || '',
    match_confidence: row.matchConfidence || '',
    match_reasons: row.matchReasons || '',
    status: row.status || '',
    confirmed_by: row.confirmedBy || '',
    confirmed_at: row.confirmedAt || '',
    notes: row.notes || '',
    raw_json: row.rawJson || '',
  };
}

export async function upsertWhatsappGroupMapRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildWhatsappGroupMapSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: WHATSAPP_GROUP_MAP_SHEET,
    requiredHeaders: WHATSAPP_GROUP_MAP_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('chat_id')] || ''}`.trim() === row.chatId,
  });
}

// Writes many group-map rows in one pass: a single batchUpdate for existing
// rows plus a single append for new ones (two API calls total, vs one per row).
// Needed because a full group sync can touch 100+ groups — per-row upserts blow
// past the ingest request timeout.
export async function batchUpsertWhatsappGroupMapRows(rows = []) {
  if (!rows.length) return { updated: 0, appended: 0 };

  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: WHATSAPP_GROUP_MAP_SHEET,
    requiredHeaders: WHATSAPP_GROUP_MAP_HEADERS,
  });
  const values = await getSheetValues(WHATSAPP_GROUP_MAP_SHEET);
  const [, ...existing] = values;
  const chatIdIdx = headers.indexOf('chat_id');
  const rowNumberByChatId = new Map();
  existing.forEach((entry, index) => {
    const id = `${entry[chatIdIdx] || ''}`.trim();
    if (id && !rowNumberByChatId.has(id)) rowNumberByChatId.set(id, index + 2);
  });

  const endColumn = columnNumberToLetter(headers.length);
  const updates = [];
  const appends = [];

  for (const row of rows) {
    const valuesByHeader = buildWhatsappGroupMapSheetRow(row);
    const rowValues = headers.map((header) => valuesByHeader[header] ?? '');
    const rowNumber = rowNumberByChatId.get(`${row.chatId || ''}`.trim());
    if (rowNumber) {
      updates.push({
        range: buildSheetRange(WHATSAPP_GROUP_MAP_SHEET, `A${rowNumber}:${endColumn}${rowNumber}`),
        values: [rowValues],
      });
    } else {
      appends.push(rowValues);
    }
  }

  if (updates.length) {
    await withSheetsRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    }));
  }
  if (appends.length) {
    await withSheetsRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId,
      range: buildSheetRange(WHATSAPP_GROUP_MAP_SHEET, 'A:A'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    }));
  }

  invalidateSheetReadCache(WHATSAPP_GROUP_MAP_SHEET);
  return { updated: updates.length, appended: appends.length };
}
