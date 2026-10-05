/** @fileoverview Validated pause-save runner preserving inbox evidence until a reviewed structured plan saves, with safe retries and explicit partial-success results. */
import { persistIncomingPlanningConversion } from './incoming-conversion.mjs';
import { validateIncomingPauseSource, buildReviewedIncomingPauseDraft } from './incoming-pause-helpers.mjs';
import { applyIncomingMessageReview } from './incoming-message-helpers.mjs';

export function createIncomingPauseSaver({ getIncomingMessageInboxRows, getOperationalAdminStudents, savePlanningItem, upsertIncomingMessageInboxRow, batchUpsertIncomingMessageInboxRows }) {
  return async function saveIncomingPausePlanning({ incomingId = '', snapshots = [], studentId = '', pauseDetails = {}, acknowledgement = '', actorEmail = '' } = {}) {
    const rows = await getIncomingMessageInboxRows({ force: true });
    const existing = rows.find(row => row.incomingId === incomingId);
    // A response can be lost after saving. A retry reveals the linked card, never
    // recreates it or changes its reviewed dates.
    if (existing?.createdPlanningId) return { planningId: existing.createdPlanningId, alreadyCreated: true };
    const current = validateIncomingPauseSource(rows, incomingId, snapshots);
    const lead = current.find(row => row.incomingId === incomingId);
    const students = await getOperationalAdminStudents();
    const student = students.find(row => row.mmsId === studentId);
    const source = { ...lead, messageText: current.map(row => row.messageText).join('\n') };
    const draft = buildReviewedIncomingPauseDraft({ source, student, pauseDetails, acknowledgement });
    const corrected = applyIncomingMessageReview({ ...lead, matchedMmsId: student.mmsId, matchedStudentName: student.fullName, matchConfidence: 'high' }, { status: 'needs_review', actorEmail, reviewNote: lead.reviewNote });
    const result = await persistIncomingPlanningConversion({ corrected, planningId: `planning_${incomingId}`, draft, actorEmail }, {
      savePlanningItem, upsertIncomingMessage: upsertIncomingMessageInboxRow,
    });
    const siblings = current.filter(row => row.incomingId !== incomingId).map(row => applyIncomingMessageReview({ ...row, matchedMmsId: student.mmsId, matchedStudentName: student.fullName, matchConfidence: 'high' }, {
      status: 'converted', createdPlanningId: result.planningItem.planningId, resolutionType: 'planning_task', actorEmail, reviewNote: row.reviewNote,
    }));
    let warning = '';
    if (siblings.length) {
      try { await batchUpsertIncomingMessageInboxRows(siblings); }
      catch { warning = 'The pause is saved, but some messages in this conversation remain in Inbox. Review them there; do not create another pause.'; }
    }
    return { planningId: result.planningItem.planningId, warning };
  };
}
