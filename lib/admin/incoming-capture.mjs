/** @fileoverview Incoming capture orchestration enforcing confirmed-group gates, group-specific reply evidence, and replay-safe persistence. */
import {
  normaliseIncomingMessagePayload, buildTutorPhoneLookup, matchTutorPhone,
  matchTutorSenderName, isSchoolStaffMessage, selectReplyEvidenceTarget,
  buildIncomingMessageRecord, decideAutoCaptureStatus, mergeIncomingCapture,
  buildWhatsappGroupMapRecord,
} from './incoming-message-helpers.mjs';
import { isConfirmedCaptureGroup } from './incoming-tutor-group-helpers.mjs';
import { appendSchoolReply, findCapturedSchoolReply } from './incoming-reply-evidence-helpers.mjs';
const AUTO_CAPTURE_SOURCE = 'whatsapp_group_auto';
export function createIncomingMessageCapturer({
  getOperationalAdminStudents, getWhatsappGroupMapRows, getIncomingMessageInboxRows,
  getTutorPhoneRows, upsertIncomingMessageInboxRow, upsertWhatsappGroupMapRow,
  patchIncomingMessageReplyEvidence = upsertIncomingMessageInboxRow,
  getStaffPhones = () => '',
}) {
  return async function captureIncomingMessage(payload = {}, { actorEmail = '' } = {}) {
    const normalised = normaliseIncomingMessagePayload({
      ...payload,
      capturedBy: payload?.capturedBy || payload?.captured_by || actorEmail,
    });

    if (!normalised.messageText) {
      throw new Error('Incoming message text is required');
    }

    const [students, groupMapRows, existingRows, tutorPhoneRows] = await Promise.all([
      getOperationalAdminStudents(),
      getWhatsappGroupMapRows(),
      getIncomingMessageInboxRows(),
      getTutorPhoneRows(),
    ]);
    const tutorPhoneLookup = buildTutorPhoneLookup(tutorPhoneRows);

    // Auto-captured group traffic: only confirmed FC groups get through, staff
    // messages become reply evidence on open items instead of new rows, and
    // positively recognised no-action parent messages land pre-archived.
    const isAutoCapture = normalised.source === AUTO_CAPTURE_SOURCE;
    if (isAutoCapture) {
      const confirmedGroup = groupMapRows.find((row) => row.chatId === normalised.chatId && isConfirmedCaptureGroup(row));
      if (!confirmedGroup) {
        return { skipped: 'not_confirmed_group', incomingId: normalised.incomingId };
      }

      // Admin replies never become inbox rows. In tutor groups, the tutor's own
      // messages are inbound work; tutor recognition suppresses only lesson-group replies. Our own account / a staff
      // number, or a tutor replying in the lesson group from their own number
      // (Tutor_Phones) — a tutor's reply is evidence someone from school engaged,
      // not a parent message to classify, and never a "handled" state (only Tom/Finn
      // stamping done marks handled). Stamp open items as reply evidence, naming the
      // tutor when we know them. When the number doesn't resolve (LID-addressed
      // groups can hide it), fall back to the sender's push name against this
      // group's own tutor from the group map.
      const tutorName = matchTutorPhone(payload, tutorPhoneLookup)
        || matchTutorSenderName(normalised.senderName, confirmedGroup.tutorName);
      const isAdmin = isSchoolStaffMessage(payload, getStaffPhones());
      if (isAdmin
        || (confirmedGroup.groupType !== 'tutor' && tutorName)) {
        const replyRows = await getIncomingMessageInboxRows({ force: true });
        const alreadyCaptured = findCapturedSchoolReply(replyRows, {
          ...normalised, externalMessageId: normalised.externalMessageId || normalised.incomingId,
        });
        const targetRow = alreadyCaptured || selectReplyEvidenceTarget(replyRows, {
          chatId: normalised.chatId,
          repliedAt: normalised.messageAt || normalised.capturedAt,
          repliedToExternalMessageId: normalised.repliedToExternalMessageId,
        });
        const ownAccount = payload.fromMe === true || payload.from_me === true;
        const ownName = ownAccount && !normalised.capturedBy.includes('@') ? normalised.capturedBy : '';
        const schoolReplierName = ownName || (isAdmin ? '' : tutorName)
          || (normalised.senderName !== 'me' ? normalised.senderName : '') || ownName || 'School';
        let stamped = 0;
        if (targetRow && !alreadyCaptured) {
          const result = await patchIncomingMessageReplyEvidence(appendSchoolReply(targetRow, {
            externalMessageId: normalised.externalMessageId || normalised.incomingId,
            repliedAt: normalised.messageAt || normalised.capturedAt,
            repliedBy: schoolReplierName,
            role: isAdmin ? 'admin' : 'tutor',
            association: normalised.repliedToExternalMessageId ? 'quoted' : 'nearest',
            text: normalised.messageText,
          }));
          stamped = result?.updated === false ? 0 : 1;
        }
        return { replyEvidence: true, stamped, schoolReplierName, incomingId: normalised.incomingId };
      }
    }

    const fresh = buildIncomingMessageRecord({
      ...payload,
      capturedBy: payload?.capturedBy || payload?.captured_by || actorEmail,
    }, { students, groupMapRows });

    if (isAutoCapture && fresh.status === 'inbox') {
      fresh.status = decideAutoCaptureStatus(fresh);
      if (fresh.status === 'ignored') {
        fresh.matchReasons = [fresh.matchReasons, 'auto-archived: no operational signal (auto-captured group message)'].filter(Boolean).join(' | ');
      }
    }

    // Bridge replays (reconnect/restart) re-send the same star event; only write
    // when the capture is new or recovers text for a placeholder row.
    const existing = existingRows.find((entry) => entry.incomingId === fresh.incomingId);
    const { action, record } = mergeIncomingCapture(existing, fresh);
    if (action === 'skip') {
      return record;
    }

    await upsertIncomingMessageInboxRow(record);

    const firstPassGroupMapRecord = buildWhatsappGroupMapRecord(record);
    if (firstPassGroupMapRecord) {
      const existingGroup = groupMapRows.find((entry) => entry.chatId === record.chatId);
      const groupMapRecord = buildWhatsappGroupMapRecord(record, existingGroup);
      await upsertWhatsappGroupMapRow(groupMapRecord);
    }

    return record;
  };
}
