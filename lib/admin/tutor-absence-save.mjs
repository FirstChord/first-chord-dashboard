/** @fileoverview Tutor-absence save orchestration with guarded resolution and retryable completion of the matching Planning capture. */
import { buildTutorAbsencePlanningId } from './planning-helpers.mjs';
import {
  assertTutorAbsenceResolutionReady,
  normaliseTutorAbsenceDecision,
  normaliseTutorAbsenceStatus,
  parseTutorAbsenceStateRow,
} from './tutor-absence-helpers.mjs';

export function createTutorAbsenceWorkflowSaver({
  getTutorAbsenceStateRows,
  upsertTutorAbsenceStateRow,
  createStructuredPausePlanningFromCancellation,
  syncTutorAbsenceEarlyNoticePlanning,
  getPlanningItemRows,
  savePlanningItem,
}) {
  return async function saveTutorAbsenceWorkflow({
    absenceId,
    tutorShortName,
    tutorName,
    absenceDate,
    status = 'in_progress',
    decision = '',
    coverTutorShortName = '',
    coverTutorName = '',
    affectedLessons = [],
    messageState = {},
    note = '',
    updatedBy = '',
  }) {
    const now = new Date().toISOString();
    const existingRows = absenceId ? await getTutorAbsenceStateRows(absenceId) : [];
    const existing = existingRows[0] ? parseTutorAbsenceStateRow(existingRows[0]) : null;
    const normalisedStatus = normaliseTutorAbsenceStatus(status);
    assertTutorAbsenceResolutionReady({
      status: normalisedStatus,
      lessons: affectedLessons,
      messageState,
      decision,
      coverTutorName,
    });

    const row = {
      absenceId,
      tutorShortName,
      tutorName,
      absenceDate,
      status: normalisedStatus,
      decision: normaliseTutorAbsenceDecision(decision),
      coverTutorShortName,
      coverTutorName,
      affectedLessonsJson: JSON.stringify(affectedLessons || []),
      messageStateJson: JSON.stringify(messageState || {}),
      note,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      resolvedAt: normalisedStatus === 'resolved' ? existing?.resolvedAt || now : '',
      updatedBy,
    };

    await upsertTutorAbsenceStateRow(row);
    let createdPausePlanningIds;
    try {
      createdPausePlanningIds = await createStructuredPausePlanningFromCancellation({
        row,
        actorEmail: updatedBy,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_PAUSE') {
        error.message = 'Tutor absence decision saved. This pause already has a planning card. Review the existing card before retrying the handoff.';
      }
      throw error;
    }
    const earlyNoticePlanning = row.decision === 'cancel_day'
      ? await syncTutorAbsenceEarlyNoticePlanning({ actorEmail: updatedBy })
      : { createdPlanningIds: [], createdFinalConfirmationIds: [] };

    let resolvedPlanningId = '';
    if (row.status === 'resolved' && ['cover', 'cancel_day'].includes(row.decision)) {
      try {
        const captureId = buildTutorAbsencePlanningId(row.tutorShortName, row.absenceDate);
        const planningItems = await getPlanningItemRows({ force: true });
        const capture = planningItems.find((item) => item.planningId === captureId);
        // Only the existing capture for this tutor/date is owned by this handoff.
        // Preserve manually parked/completed cards, and never fabricate a missing one.
        if (capture?.linkedWorkflowId === 'tutor-absence'
          && capture.linkedTutorId === row.tutorShortName
          && ['inbox', 'active', 'waiting'].includes(capture.status)) {
          await savePlanningItem({
            planningId: captureId,
            item: {
              title: capture.title,
              status: 'done',
              isPause: false,
              outcome: row.decision === 'cover'
                ? 'Covered — tutor, briefing, calendar and parent messages confirmed.'
                : 'Cancelled — parent messages and payment handling confirmed.',
              nextAction: 'Completed when the tutor absence was explicitly resolved.',
            },
            actorEmail: updatedBy,
            progressNote: 'Completed from Resolve absence after the server checked the required workflow steps.',
          });
          resolvedPlanningId = captureId;
        }
      } catch (cause) {
        throw Object.assign(new Error(
          'Absence saved as resolved, but its Planning card could not be closed. Click Resolve absence again to retry.',
          { cause },
        ), { code: 'TUTOR_ABSENCE_PLANNING_SYNC_FAILED', status: 503 });
      }
    }

    return {
      ...row,
      affectedLessons,
      messageState,
      createdPausePlanningIds,
      resolvedPlanningId,
      createdEarlyNoticePlanningIds: earlyNoticePlanning.createdPlanningIds,
      createdFinalConfirmationPlanningIds: earlyNoticePlanning.createdFinalConfirmationIds,
    };
  };
}
