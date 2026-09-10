/** @fileoverview Admin group-review orchestration validating student or tutor links before enabling WhatsApp capture. */
import { isWhatsappGroupChatId, buildWhatsappGroupMapRecord } from './incoming-message-helpers.mjs';
import { buildConfirmedTutorGroupFields } from './incoming-tutor-group-helpers.mjs';

export function createWhatsappGroupReviewer({
  getOperationalAdminStudents, getWhatsappGroupMapRows, getActiveTutorOptions, upsertWhatsappGroupMapRow,
}) {
  return async function reviewWhatsappGroup({ chatId = '', matchedMmsId = '', matchedTutorId = '', groupType = '', status = 'confirmed', actorEmail = '' } = {}) {
    const chatKey = `${chatId || ''}`.trim();
    if (!isWhatsappGroupChatId(chatKey)) {
      throw new Error('Only WhatsApp group chats can be reviewed in the group map');
    }

    const nextStatus = ['confirmed', 'ignored', 'review'].includes(status) ? status : 'confirmed';
    const [students, groupRows] = await Promise.all([
      getOperationalAdminStudents(),
      getWhatsappGroupMapRows(),
    ]);
    const existing = groupRows.find((row) => row.chatId === chatKey);
    if (!existing) throw new Error('Sync this WhatsApp group before confirming it');
    const selectedType = groupType || existing.groupType || 'student';
    if (!['student', 'tutor'].includes(selectedType)) throw new Error('Choose a student or tutor group');

    if (nextStatus === 'confirmed' && selectedType === 'tutor') {
      const tutors = await getActiveTutorOptions();
      const record = buildWhatsappGroupMapRecord({
        chatId: chatKey,
        ...buildConfirmedTutorGroupFields(matchedTutorId, tutors),
        matchConfidence: 'high',
        matchReasons: 'tutor group confirmed by admin',
        groupMapStatus: 'confirmed',
        confirmedBy: actorEmail,
        confirmedAt: new Date().toISOString(),
      }, existing);
      await upsertWhatsappGroupMapRow(record);
      return record;
    }

    if (nextStatus === 'confirmed') {
      const student = students.find((entry) => entry.mmsId === `${matchedMmsId}`.trim());
      if (!student) {
        throw new Error('A matched student is required to confirm a group');
      }
      const record = buildWhatsappGroupMapRecord({
        chatId: chatKey,
        chatName: existing.chatName || '',
        groupType: 'student',
        matchedTutorId: '',
        additionalMmsIds: existing.groupType === 'tutor' ? '' : existing.additionalMmsIds || '',
        matchedMmsId: student.mmsId || '',
        matchedFcId: student.fcStudentId || '',
        matchedStudentName: student.fullName || '',
        parentName: [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
        parentPhone: student.contactNumber || '',
        tutorName: student.tutor || student.registryTutor || '',
        instrument: student.instrument || existing.instrument || '',
        matchConfidence: 'high',
        matchReasons: 'confirmed from group sync review',
        groupMapStatus: 'confirmed',
        confirmedBy: actorEmail,
        confirmedAt: new Date().toISOString(),
      }, existing);
      await upsertWhatsappGroupMapRow(record);
      return record;
    }

    const record = buildWhatsappGroupMapRecord({
      chatId: chatKey,
      chatName: existing.chatName || '',
      groupMapStatus: nextStatus,
    }, existing);
    await upsertWhatsappGroupMapRow(record);
    return record;
  };
}
