/** @fileoverview Reads inbox evidence for the existing pause builder and saves only a human-reviewed structured pause before linking the exact source messages. */
import { getIncomingMessageInboxRows, batchUpsertIncomingMessageInboxRows, upsertIncomingMessageInboxRow } from './sheets';
import { getOperationalAdminStudents } from './students';
import { savePlanningItem } from './planning';
import { createIncomingPauseSaver } from './incoming-pause-save.mjs';
import { selectIncomingPauseSource } from './incoming-pause-helpers.mjs';

export async function getIncomingPausePlanningContext(incomingId = '') {
  return selectIncomingPauseSource(await getIncomingMessageInboxRows(), incomingId);
}

export const saveIncomingPausePlanning = createIncomingPauseSaver({
  getIncomingMessageInboxRows, getOperationalAdminStudents, savePlanningItem,
  upsertIncomingMessageInboxRow, batchUpsertIncomingMessageInboxRows,
});
