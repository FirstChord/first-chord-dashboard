/** @fileoverview Serialized planning saves with fresh Sheets evidence and exact open-pause duplicate rejection. */
import { randomUUID } from 'node:crypto';
import {
  normalisePlanningItem, normalisePlanningItemType, planningModeForItemType,
  normalisePlanningOwner, normalisePlanningStatus, normalisePlanningArea,
  normalisePauseFlag, serializeLinkedStudentIds,
} from './planning-helpers.mjs';
import { findExactOpenPauseDuplicate } from './planning-duplicate-helpers.mjs';

// Next can load separate route bundles in the same process. Share the queue
// across those module instances as well as callers of one saver instance.
const queueKey = Symbol.for('firstchord.planning-save-queue');
const saveQueue = globalThis[queueKey] ||= { pending: Promise.resolve() };

function buildPlanningId() {
  return `planning_${randomUUID()}`;
}

function timestamp() {
  return new Date().toISOString();
}

export function mergePlanningItem(existing = {}, updates = {}, actorEmail = '') {
  const now = timestamp();
  const existingItem = normalisePlanningItem(existing);
  const planningId = existingItem.planningId || `${updates.planningId || ''}`.trim() || buildPlanningId();
  const createdAt = existingItem.createdAt || now;
  const createdBy = existingItem.createdBy || actorEmail;
  const itemType = normalisePlanningItemType(updates.itemType ?? existingItem.itemType);
  const planMode = planningModeForItemType(itemType, updates.planMode ?? existingItem.planMode);

  return {
    planningId,
    title: `${updates.title ?? existingItem.title ?? ''}`.trim(),
    notes: `${updates.notes ?? existingItem.notes ?? ''}`.trim(),
    itemType,
    planMode,
    owner: normalisePlanningOwner(updates.owner ?? existingItem.owner),
    status: normalisePlanningStatus(updates.status ?? existingItem.status),
    area: normalisePlanningArea(updates.area ?? existingItem.area),
    linkedWorkflowId: `${updates.linkedWorkflowId ?? existingItem.linkedWorkflowId ?? ''}`.trim(),
    // Accept either a list (linkedStudentIds) or a single/comma string
    // (linkedStudentId) from the caller; persist as a comma-joined string in the
    // one column. Fall back to the existing full list when no student field is
    // sent (e.g. a status-only update) so extra students aren't dropped.
    linkedStudentId: serializeLinkedStudentIds(
      updates.linkedStudentIds ?? updates.linkedStudentId ?? existingItem.linkedStudentIds,
    ),
    linkedTutorId: `${updates.linkedTutorId ?? existingItem.linkedTutorId ?? ''}`.trim(),
    parentPlanningId: `${updates.parentPlanningId ?? existingItem.parentPlanningId ?? ''}`.trim(),
    outcome: `${updates.outcome ?? existingItem.outcome ?? ''}`.trim(),
    nextAction: `${updates.nextAction ?? existingItem.nextAction ?? ''}`.trim(),
    targetDate: `${updates.targetDate ?? existingItem.targetDate ?? ''}`.trim(),
    createdAt,
    updatedAt: now,
    createdBy,
    lastUpdatedBy: actorEmail,
    isPause: normalisePauseFlag(updates.isPause ?? existingItem.isPause),
  };
}

export function createPlanningItemSaver({ getPlanningItemRows, upsertPlanningItemRow, addPlanningProgress }) {
  // Serialize the read/check/write inside this server process. Sheets provides
  // no cross-instance transaction; a fresh read also catches external writes
  // already visible before this save starts.
  async function save({ planningId = '', item = {}, actorEmail = '', progressNote = '' }) {
    const title = `${item.title || ''}`.trim();
    if (!title) {
      throw new Error('Planning title is required');
    }

    const existingRows = await getPlanningItemRows({ force: true });
    const existing = existingRows.find((row) => row.planningId === planningId) || {};
    const row = mergePlanningItem(existing, { ...item, planningId }, actorEmail);

    const duplicate = findExactOpenPauseDuplicate(row, existingRows, existing);
    if (duplicate) {
      throw Object.assign(new Error('This pause already has a planning card.'), {
        code: 'DUPLICATE_PAUSE',
        status: 409,
        duplicatePlanningId: duplicate.planningId,
      });
    }

    await upsertPlanningItemRow(row);

    if (`${progressNote || ''}`.trim()) {
      await addPlanningProgress({
        planningId: row.planningId,
        progressNote,
        progressType: existing?.planningId ? 'note' : 'decision',
        actorEmail,
        skipItemTouch: true,
      });
    }

    return row;
  }

  return (input) => {
    const result = saveQueue.pending.then(() => save(input));
    saveQueue.pending = result.catch(() => {});
    return result;
  };
}
