/** @fileoverview Server service for the incoming-message inbox, covering capture, review, correction, planning conversion, and WhatsApp group sync. */
import {
  batchUpsertWhatsappGroupMapRows,
  deleteIncomingMessageInboxRow,
  getBridgeStatusRows,
  getIncomingMessageInboxRows,
  getPlanningItemRows,
  getTutorPhoneRows,
  getWhatsappGroupMapRows,
  upsertBridgeStatusRow,
  upsertIncomingMessageInboxRow,
  upsertWhatsappGroupMapRow,
} from '@/lib/admin/sheets';
import { getOperationalAdminStudents } from './students';
import { isConfirmedCaptureGroup } from './incoming-tutor-group-helpers.mjs';
import { getActiveTutorOptions } from './tutors';
import { createIncomingMessageCapturer } from './incoming-capture.mjs';
import { createWhatsappGroupReviewer } from './incoming-group-review.mjs';
import { savePlanningItem } from './planning.js';
import { persistIncomingPlanningConversion } from './incoming-conversion.mjs';
import {
  applyIncomingMessageTextUpdate,
  applyIncomingClassificationReview,
  applyIncomingMessageSnooze,
  applyIncomingPlanningDateOverrides,
  buildGroupSyncPlan,
  buildIncomingPlanningDraft,
  buildIncomingReplyTemplate,
  resolveReviewedIncomingReply,
  buildWhatsappGroupMapRecord,
  decideSyncedGroupStatus,
  deriveIncomingMessageResolutionType,
  extractIncomingMessageDates,
  groupIncomingMessages,
  isIncomingMessageSnoozed,
  isWhatsappGroupChatId,
} from './incoming-message-helpers.mjs';

export const AUTO_CAPTURE_SOURCE = 'whatsapp_group_auto';

// Chat ids the bridge is allowed to auto-capture from — human-confirmed FC
// lesson groups only. Served to the bridge via GET ?mode=confirmed_groups.
export async function getConfirmedGroupChatIds() {
  const rows = await getWhatsappGroupMapRows();
  return rows.filter(isConfirmedCaptureGroup).map((row) => row.chatId);
}

// Bridge heartbeat (mode: bridge_status, every ~30min + on connect). One row
// per bridge id so the dashboard can tell "down" and "alive but capturing
// nothing" apart from an ordinary quiet day.
export async function recordBridgeStatus(payload = {}) {
  const row = {
    bridgeId: `${payload.bridgeId || payload.bridge_id || 'primary'}`.trim() || 'primary',
    lastHeartbeatAt: new Date().toISOString(),
    connectedAt: `${payload.connectedAt || payload.connected_at || ''}`.trim(),
    startedAt: `${payload.startedAt || payload.started_at || ''}`.trim(),
    confirmedGroups: Number(payload.confirmedGroups ?? payload.confirmed_groups) || 0,
    cachedMessages: Number(payload.cachedMessages ?? payload.cached_messages) || 0,
    bridgeVersion: `${payload.bridgeVersion || payload.bridge_version || ''}`.trim(),
    rawJson: '',
  };
  await upsertBridgeStatusRow(row);
  return row;
}

export async function getBridgeStatus({ bridgeId = 'primary' } = {}) {
  const rows = await getBridgeStatusRows();
  return rows.find((row) => row.bridgeId === bridgeId) || null;
}

export async function getIncomingMessageInbox() {
  const [rows, planningRows] = await Promise.all([
    getIncomingMessageInboxRows(),
    getPlanningItemRows().catch((error) => {
      console.warn('Incoming inbox could not load linked Planning status:', error?.message || error);
      return [];
    }),
  ]);
  const planningById = new Map(planningRows.map((row) => [row.planningId, row]));
  return groupIncomingMessages(rows).map((row) => {
    const linkedPlan = planningById.get(row.createdPlanningId);
    return {
      ...row,
      isSnoozed: isIncomingMessageSnoozed(row),
      linkedPlanningStatus: linkedPlan?.status || '',
      linkedPlanningOutcome: linkedPlan?.outcome || '',
    };
  });
}

export async function getWhatsappGroupMap() {
  const rows = await getWhatsappGroupMapRows();
  return rows.sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime());
}

export const captureIncomingMessage = createIncomingMessageCapturer({
  getOperationalAdminStudents, getWhatsappGroupMapRows, getIncomingMessageInboxRows,
  getTutorPhoneRows, upsertIncomingMessageInboxRow, upsertWhatsappGroupMapRow,
  getStaffPhones: () => process.env.INCOMING_STAFF_PHONES || '',
});

// The reviewer pasted the real message text into a placeholder row: re-run
// classification/matching on the real text and reopen the row for action.
export async function updateIncomingMessageText({ incomingId = '', messageText = '', actorEmail = '' } = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  const [existingRows, students, groupMapRows] = await Promise.all([
    getIncomingMessageInboxRows(),
    getOperationalAdminStudents(),
    getWhatsappGroupMapRows(),
  ]);
  const row = existingRows.find((entry) => entry.incomingId === incomingKey);
  if (!row) {
    throw new Error(`Incoming message ${incomingKey} was not found`);
  }

  const next = applyIncomingMessageTextUpdate(row, { messageText, students, groupMapRows, actorEmail });
  await upsertIncomingMessageInboxRow(next);
  return next;
}

export async function updateIncomingMessageReview({ incomingId, status = '', reviewNote = '', createdPlanningId = '', resolutionType = '', classificationActionability = '', actorEmail = '' }) {
  const existing = await getIncomingMessageInboxRows();
  const row = existing.find((entry) => entry.incomingId === incomingId);
  if (!row) {
    throw new Error(`Incoming message ${incomingId} was not found`);
  }

  const nextStatus = status || row.status || 'inbox';
  const nextPlanningId = typeof createdPlanningId === 'string' ? createdPlanningId : row.createdPlanningId;
  const classificationReview = applyIncomingClassificationReview(row, {
    actionability: classificationActionability || (nextStatus === 'ignored' ? 'no_action' : ''),
  });
  const next = {
    ...classificationReview,
    status: nextStatus,
    reviewNote: typeof reviewNote === 'string' ? reviewNote : row.reviewNote,
    createdPlanningId: nextPlanningId,
    resolutionType: deriveIncomingMessageResolutionType({ resolutionType, status: nextStatus, createdPlanningId: nextPlanningId }),
    snoozedUntil: '',
    reviewedBy: actorEmail || row.reviewedBy || '',
    reviewedAt: new Date().toISOString(),
  };

  await upsertIncomingMessageInboxRow(next);
  return next;
}

export async function snoozeIncomingMessage({ incomingId = '', snoozedUntil = '', actorEmail = '' } = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  const existing = await getIncomingMessageInboxRows();
  const row = existing.find((entry) => entry.incomingId === incomingKey);
  if (!row) {
    throw new Error(`Incoming message ${incomingKey} was not found`);
  }

  const next = applyIncomingMessageSnooze(row, { snoozedUntil, actorEmail });
  await upsertIncomingMessageInboxRow(next);
  return next;
}

export async function correctIncomingMessage({
  incomingId,
  category = '',
  actionability = '',
  matchedMmsId = null,
  reviewNote = '',
  confirmGroupMap = false,
  actorEmail = '',
  status = 'needs_review',
} = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  const [existingRows, students, groupRows] = await Promise.all([
    getIncomingMessageInboxRows(),
    getOperationalAdminStudents(),
    getWhatsappGroupMapRows(),
  ]);
  const row = existingRows.find((entry) => entry.incomingId === incomingKey);
  if (!row) {
    throw new Error(`Incoming message ${incomingKey} was not found`);
  }

  const hasStudentDecision = matchedMmsId !== null && matchedMmsId !== undefined;
  const selectedStudentId = `${matchedMmsId || ''}`.trim();
  const selectedStatus = `${status || 'needs_review'}`.trim();
  const selectedStudent = students.find((student) => student.mmsId === selectedStudentId);
  const correctionReasons = [];

  const classificationReview = applyIncomingClassificationReview(row, { category, actionability });
  const next = {
    ...classificationReview,
    status: ['inbox', 'needs_review', 'converted', 'ignored'].includes(selectedStatus) ? selectedStatus : 'needs_review',
    reviewedBy: actorEmail || row.reviewedBy || '',
    reviewedAt: new Date().toISOString(),
    snoozedUntil: '',
  };
  next.resolutionType = deriveIncomingMessageResolutionType({ status: next.status, createdPlanningId: next.createdPlanningId });

  if (next.suspectedCategory !== row.suspectedCategory) {
    correctionReasons.push(`reviewer corrected category to ${next.suspectedCategory}`);
  }
  if (next.classificationActionability !== row.classificationActionability) {
    correctionReasons.push(`reviewer corrected actionability to ${next.classificationActionability}`);
  }

  if (hasStudentDecision && selectedStudentId) {
    if (!selectedStudent) {
      throw new Error(`Student ${selectedStudentId} was not found`);
    }
    next.matchedMmsId = selectedStudent.mmsId || '';
    next.matchedStudentName = selectedStudent.fullName || '';
    next.matchConfidence = 'high';
    if (selectedStudent.mmsId !== row.matchedMmsId) {
      correctionReasons.push('reviewer corrected matched student');
    }
  } else if (hasStudentDecision) {
    if (row.matchedMmsId) correctionReasons.push('reviewer cleared matched student');
    next.matchedMmsId = '';
    next.matchedStudentName = '';
    next.matchConfidence = 'none';
  }

  if (confirmGroupMap && (row.groupType === 'tutor'
    || groupRows.some(group => group.chatId === row.chatId && group.groupType === 'tutor'))) {
    throw new Error('Tutor group links must be reviewed in WhatsApp groups, not changed by selecting a student');
  }
  if (confirmGroupMap && !isWhatsappGroupChatId(next.chatId)) {
    throw new Error('Only WhatsApp group chats can be confirmed in the group map');
  }

  const note = `${reviewNote || ''}`.trim();
  if (note) {
    next.reviewNote = [row.reviewNote, note].filter(Boolean).join(' | ');
  }
  next.matchReasons = [row.matchReasons, ...correctionReasons].filter(Boolean).join(' | ');

  await upsertIncomingMessageInboxRow(next);

  if (confirmGroupMap && next.chatId && next.matchedMmsId) {
    const groupStudent = selectedStudent || students.find((student) => student.mmsId === next.matchedMmsId);
    const existingGroup = groupRows.find((entry) => entry.chatId === next.chatId);
    const groupMapRecord = buildWhatsappGroupMapRecord({
      ...next,
      groupMapStatus: 'confirmed',
      matchedFcId: groupStudent?.fcStudentId || '',
      parentName: [groupStudent?.parentFirstName, groupStudent?.parentLastName].filter(Boolean).join(' ').trim(),
      parentPhone: groupStudent?.contactNumber || '',
      tutorName: groupStudent?.tutor || groupStudent?.registryTutor || '',
      instrument: groupStudent?.instrument || '',
      confirmedBy: actorEmail,
      confirmedAt: new Date().toISOString(),
    }, existingGroup);
    if (groupMapRecord) {
      await upsertWhatsappGroupMapRow(groupMapRecord);
    }
  }

  return next;
}

// Closes the loop: apply any final correction, then create a linked Planning_Item
// and hand back a copy-paste WhatsApp reply. The planning id is derived from the
// incoming id so re-converting upserts the same task instead of duplicating.
export async function convertIncomingMessageToPlanning({
  incomingId,
  category = '',
  actionability = '',
  matchedMmsId = null,
  reviewNote = '',
  confirmGroupMap = false,
  startDate = null,
  returnDate = null,
  reviewedReply = null,
  actorEmail = '',
} = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  const corrected = await correctIncomingMessage({
    incomingId: incomingKey,
    category,
    actionability,
    matchedMmsId,
    reviewNote,
    confirmGroupMap,
    actorEmail,
    // Keep the source row visibly open until the linked Planning_Item has
    // actually saved. A failed plan write must never create a false closure.
    status: 'needs_review',
  });

  const students = await getOperationalAdminStudents();
  const student = students.find((entry) => entry.mmsId === corrected.matchedMmsId) || {};

  // One extraction pass feeds both the reply (dates confirmed back to the
  // parent) and the plan (absence categories become a structured pause item).
  const extraction = applyIncomingPlanningDateOverrides(
    extractIncomingMessageDates(corrected),
    {
      ...(startDate !== null ? { startDate } : {}),
      ...(returnDate !== null ? { returnDate } : {}),
    },
  );
  const deterministicReply = buildIncomingReplyTemplate({
    groupType: corrected.groupType,
    category: corrected.suspectedCategory,
    senderName: corrected.senderName,
    parentName: [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
    studentName: corrected.matchedStudentName || student.fullName || '',
    tutorName: student.tutor || student.registryTutor || '',
    startDate: extraction.startDate,
    returnDate: extraction.returnDate,
  });
  const replyTemplate = resolveReviewedIncomingReply(reviewedReply, deterministicReply);

  const planningId = `${corrected.createdPlanningId || ''}`.trim() || `planning_${corrected.incomingId}`;
  const draft = buildIncomingPlanningDraft({ record: corrected, student, replyTemplate, extraction });
  const { planningItem, row } = await persistIncomingPlanningConversion({
    corrected,
    planningId,
    draft,
    actorEmail,
  }, {
    savePlanningItem,
    upsertIncomingMessage: upsertIncomingMessageInboxRow,
  });

  return {
    row,
    planningId: planningItem.planningId,
    replyTemplate,
  };
}

// Bulk-imports every First Chord group the bridge can see. Metadata only — no
// message content. Confirmed groups are never downgraded; they only get their
// name/last-active refreshed. Everything else lands as a `review` hint for
// human triage in the group map.
export async function syncWhatsappGroups({ groups = [] } = {}) {
  const [students, existingRows, tutors] = await Promise.all([
    getOperationalAdminStudents(),
    getWhatsappGroupMapRows(),
    getActiveTutorOptions(),
  ]);

  const { records, summary } = buildGroupSyncPlan({ groups, students, tutors });
  const existingByChatId = new Map(existingRows.map((row) => [row.chatId, row]));

  // Build every row in memory, then write them in one batched call — a full
  // sync can touch 100+ groups, and per-row upserts time out the request.
  const rowsToWrite = [];
  for (const record of records) {
    const existing = existingByChatId.get(record.chatId);

    // Don't let a fresh guess overwrite a human-confirmed group — just refresh
    // the display name and last-active timestamp.
    if (existing?.status === 'confirmed') {
      const refreshed = buildWhatsappGroupMapRecord({
        chatId: record.chatId,
        chatName: record.chatName,
        messageAt: record.lastActiveAt,
        groupMapStatus: 'confirmed',
      }, existing);
      if (refreshed) rowsToWrite.push(refreshed);
      continue;
    }

    if (existing?.status === 'ignored') {
      continue;
    }

    const student = record.matchedMmsId
      ? students.find((entry) => entry.mmsId === record.matchedMmsId)
      : null;

    const groupMapRecord = buildWhatsappGroupMapRecord({
      chatId: record.chatId,
      chatName: record.chatName,
      messageAt: record.lastActiveAt,
      groupType: record.groupType,
      matchedTutorId: record.matchedTutorId,
      tutorName: record.tutorName,
      matchedMmsId: record.matchedMmsId,
      matchedFcId: student?.fcStudentId || '',
      matchedStudentName: record.matchedStudentName,
      matchConfidence: record.matchConfidence,
      matchReasons: record.matchReasons,
      instrument: student?.instrument || record.instrument || '',
      groupMapStatus: decideSyncedGroupStatus(existing?.status || '', Boolean(record.matchedMmsId || record.groupType === 'tutor')),
    }, existing || {});
    if (groupMapRecord) rowsToWrite.push(groupMapRecord);
  }

  await batchUpsertWhatsappGroupMapRows(rowsToWrite);

  return { summary };
}

// Confirms or ignores a WhatsApp group directly from the group map (no message
// needed). Confirming stores the full student context so future messages from
// the group match at high confidence.
export const reviewWhatsappGroup = createWhatsappGroupReviewer({
  getOperationalAdminStudents, getWhatsappGroupMapRows, getActiveTutorOptions, upsertWhatsappGroupMapRow,
});

// Manually attach an additional student to a group (siblings sharing one chat).
// Stored as a comma list in `additional_mms_ids`; matching then disambiguates
// by the name in each message.
export async function addStudentToGroup({ chatId = '', mmsId = '', actorEmail = '' } = {}) {
  const chatKey = `${chatId || ''}`.trim();
  const studentId = `${mmsId || ''}`.trim();
  if (!isWhatsappGroupChatId(chatKey)) {
    throw new Error('Only WhatsApp group chats can hold multiple students');
  }
  if (!studentId) {
    throw new Error('A student is required');
  }

  const [students, groupRows] = await Promise.all([
    getOperationalAdminStudents(),
    getWhatsappGroupMapRows(),
  ]);
  const existing = groupRows.find((row) => row.chatId === chatKey);
  if (!existing) {
    throw new Error(`Group ${chatKey} was not found`);
  }
  if (existing.groupType === 'tutor') throw new Error('Tutor groups cannot have linked sibling students');
  if (!students.find((entry) => entry.mmsId === studentId)) {
    throw new Error(`Student ${studentId} was not found`);
  }

  // Already the primary or already added → no-op.
  const current = `${existing.additionalMmsIds || ''}`.split(',').map((id) => id.trim()).filter(Boolean);
  if (existing.matchedMmsId === studentId || current.includes(studentId)) {
    return existing;
  }

  const record = buildWhatsappGroupMapRecord({
    chatId: chatKey,
    additionalMmsIds: [...current, studentId].join(','),
    groupMapStatus: existing.status || 'confirmed',
    confirmedBy: actorEmail || existing.confirmedBy || '',
    confirmedAt: existing.confirmedAt || new Date().toISOString(),
  }, existing);
  await upsertWhatsappGroupMapRow(record);
  return record;
}

export async function deleteIncomingMessage({ incomingId = '' } = {}) {
  const incomingKey = `${incomingId || ''}`.trim();
  if (!incomingKey) {
    throw new Error('incomingId is required');
  }

  return deleteIncomingMessageInboxRow(incomingKey);
}
