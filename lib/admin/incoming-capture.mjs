/** @fileoverview Incoming capture orchestration enforcing confirmed-group gates, group-specific reply evidence, and replay-safe persistence. */
import {
  normaliseIncomingMessagePayload, buildTutorPhoneLookup, matchTutorPhone,
  matchTutorSenderName, isSchoolStaffMessage, selectReplyEvidenceTarget,
  buildIncomingMessageRecord, decideAutoCaptureStatus, mergeIncomingCapture,
  buildWhatsappGroupMapRecord,
} from './incoming-message-helpers.mjs';
import { isConfirmedCaptureGroup } from './incoming-tutor-group-helpers.mjs';
const AUTO_CAPTURE_SOURCE = 'whatsapp_group_auto';
export function createIncomingMessageCapturer({
  getOperationalAdminStudents, getWhatsappGroupMapRows, getIncomingMessageInboxRows,
  getTutorPhoneRows, upsertIncomingMessageInboxRow, upsertWhatsappGroupMapRow,
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
    // no-signal parent messages land pre-archived.
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
      if (isSchoolStaffMessage(payload, getStaffPhones())
        || (confirmedGroup.groupType !== 'tutor' && tutorName)) {
        const targetRow = selectReplyEvidenceTarget(existingRows, {
          chatId: normalised.chatId,
          repliedAt: normalised.messageAt || normalised.capturedAt,
        });
        if (targetRow) {
          await upsertIncomingMessageInboxRow({
            ...targetRow,
            schoolRepliedAt: normalised.messageAt || normalised.capturedAt,
            schoolRepliedBy: tutorName || normalised.senderName || 'school',
          });
        }
        return { replyEvidence: true, stamped: targetRow ? 1 : 0, schoolReplierName: tutorName || normalised.senderName || 'school', incomingId: normalised.incomingId };
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
