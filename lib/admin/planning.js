/** @fileoverview Sheets-backed planning dashboard read plus item save, status change, and progress append, refreshing the recurring cards. */
import { randomUUID } from 'node:crypto';
import {
  appendPlanningProgressLogRow,
  getPlanningItemRows,
  getPlanningProgressLogRows,
  upsertPlanningItemRow,
} from './sheets.js';
import {
  attachPlanningProgress,
  buildEarlyStripeTimingReviewPlanningId,
  buildEarlyStripeTimingReviewPlanningItem,
  buildFirstLessonCheckinPlanningId,
  buildFirstLessonCheckinPlanningItem,
  buildSchoolForwardPlanningItem,
  buildMondaySchedulePlanningItem,
  buildMonthEndExpensesPlanningItem,
  buildPlanningSummary,
  normalisePlanningArea,
  normalisePauseFlag,
  normalisePlanningItem,
  normalisePlanningItemType,
  normalisePlanningOwner,
  normalisePlanningProgressType,
  normalisePlanningStatus,
  planningModeForItemType,
  serializeLinkedStudentIds,
  SCHOOL_FORWARD_PLANNING_ID,
  MONDAY_SCHEDULE_PLANNING_ID,
  MONTH_END_EXPENSES_PLANNING_ID,
  shouldRefreshSchoolForwardPlanningItem,
  shouldRefreshMondaySchedulePlanningItem,
  shouldRefreshMonthEndExpensesPlanningItem,
} from './planning-helpers.mjs';

function buildPlanningId() {
  return `planning_${randomUUID()}`;
}

function timestamp() {
  return new Date().toISOString();
}

function sortPlanningItems(items = []) {
  const statusOrder = {
    active: 0,
    waiting: 1,
    inbox: 2,
    parked: 3,
    done: 4,
  };
  const typeOrder = {
    initiative: 0,
    action: 1,
    idea: 2,
  };

  return [...items].sort((a, b) => (
    (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
    || `${a.targetDate || '9999-12-31'}`.localeCompare(`${b.targetDate || '9999-12-31'}`)
    || (typeOrder[a.itemType] ?? 99) - (typeOrder[b.itemType] ?? 99)
    || `${b.updatedAt || b.createdAt || ''}`.localeCompare(`${a.updatedAt || a.createdAt || ''}`)
    || a.title.localeCompare(b.title)
  ));
}

export async function getPlanningDashboard() {
  let [itemRows, progressRows] = await Promise.all([
    getPlanningItemRows(),
    getPlanningProgressLogRows(),
  ]);
  itemRows = await ensureSystemPlanningItems(itemRows);
  const items = sortPlanningItems(attachPlanningProgress(itemRows, progressRows));

  return {
    items,
    progressRows,
    summary: buildPlanningSummary(items),
  };
}

async function ensureRecurringSystemItem(itemRows, { planningId, shouldRefresh, build }, now) {
  const existing = itemRows.find((row) => row.planningId === planningId) || {};

  if (!shouldRefresh(existing, now)) {
    return itemRows;
  }

  const nextItem = build({
    now,
    existingItem: existing,
    skipToday: normalisePlanningStatus(existing.status) === 'done',
  });
  await upsertPlanningItemRow(nextItem);

  return [...itemRows.filter((row) => row.planningId !== planningId), nextItem];
}

async function ensureSystemPlanningItems(itemRows = [], now = new Date()) {
  let rows = itemRows;
  rows = await ensureRecurringSystemItem(rows, {
    planningId: SCHOOL_FORWARD_PLANNING_ID,
    shouldRefresh: shouldRefreshSchoolForwardPlanningItem,
    build: buildSchoolForwardPlanningItem,
  }, now);
  rows = await ensureRecurringSystemItem(rows, {
    planningId: MONDAY_SCHEDULE_PLANNING_ID,
    shouldRefresh: shouldRefreshMondaySchedulePlanningItem,
    build: buildMondaySchedulePlanningItem,
  }, now);
  rows = await ensureRecurringSystemItem(rows, {
    planningId: MONTH_END_EXPENSES_PLANNING_ID,
    shouldRefresh: shouldRefreshMonthEndExpensesPlanningItem,
    build: buildMonthEndExpensesPlanningItem,
  }, now);
  return rows;
}

function mergePlanningItem(existing = {}, updates = {}, actorEmail = '') {
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

export async function savePlanningItem({ planningId = '', item = {}, actorEmail = '', progressNote = '' }) {
  const title = `${item.title || ''}`.trim();
  if (!title) {
    throw new Error('Planning title is required');
  }

  const existingRows = await getPlanningItemRows();
  const existing = existingRows.find((row) => row.planningId === planningId) || {};
  const row = mergePlanningItem(existing, { ...item, planningId }, actorEmail);

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

export async function createFirstLessonCheckinPlanningItem({
  mmsId,
  studentName,
  tutorName = '',
  lessonDate,
  lessonTime = '',
  actorEmail = '',
  now = new Date(),
}) {
  const item = buildFirstLessonCheckinPlanningItem({
    mmsId,
    studentName,
    tutorName,
    lessonDate,
    lessonTime,
    now,
  });
  // Deterministic id keyed on the student makes re-onboarding upsert the same
  // task instead of creating a duplicate. Fall back to a generated id only when
  // mmsId is missing (should not happen during onboarding).
  const planningId = `${mmsId || ''}`.trim() ? buildFirstLessonCheckinPlanningId(mmsId) : '';
  return savePlanningItem({ planningId, item, actorEmail });
}

export async function createEarlyStripeTimingReviewPlanningItem({
  mmsId,
  studentName,
  lessonDate,
  actorEmail = '',
  now = new Date(),
}) {
  const item = buildEarlyStripeTimingReviewPlanningItem({
    mmsId,
    studentName,
    lessonDate,
    now,
  });
  const planningId = `${mmsId || ''}`.trim() ? buildEarlyStripeTimingReviewPlanningId(mmsId) : '';
  return savePlanningItem({ planningId, item, actorEmail });
}

export async function updatePlanningStatus({
  planningId,
  status,
  actorEmail = '',
  progressNote = '',
}) {
  const existingRows = await getPlanningItemRows();
  const existing = existingRows.find((row) => row.planningId === planningId);

  if (!existing) {
    throw new Error(`Planning item ${planningId} was not found`);
  }

  const row = mergePlanningItem(existing, {
    status: normalisePlanningStatus(status),
  }, actorEmail);

  await upsertPlanningItemRow(row);

  await addPlanningProgress({
    planningId,
    progressNote: progressNote || `Status changed to ${row.status}`,
    progressType: 'status_change',
    actorEmail,
    skipItemTouch: true,
  });

  return row;
}

export async function addPlanningProgress({
  planningId,
  progressNote,
  progressType = 'note',
  actorEmail = '',
  nextAction,
  targetDate,
  status,
  skipItemTouch = false,
}) {
  const note = `${progressNote || ''}`.trim();
  if (!planningId) {
    throw new Error('planningId is required');
  }
  if (!note) {
    throw new Error('Progress note is required');
  }

  const existingRows = await getPlanningItemRows();
  const existing = existingRows.find((row) => row.planningId === planningId);
  if (!existing) {
    throw new Error(`Planning item ${planningId} was not found`);
  }

  const now = timestamp();
  const progressRow = {
    progressId: `planning_progress_${randomUUID()}`,
    planningId,
    progressNote: note,
    progressType: normalisePlanningProgressType(progressType),
    createdAt: now,
    createdBy: actorEmail,
  };

  await appendPlanningProgressLogRow(progressRow);

  if (!skipItemTouch || typeof nextAction !== 'undefined' || typeof targetDate !== 'undefined' || status) {
    const itemUpdates = {};
    if (typeof nextAction !== 'undefined') {
      itemUpdates.nextAction = nextAction;
    }
    // Ongoing plans reschedule to the next meeting day as part of logging a session.
    if (typeof targetDate !== 'undefined') {
      itemUpdates.targetDate = targetDate;
    }
    if (status) {
      itemUpdates.status = normalisePlanningStatus(status);
    }

    await upsertPlanningItemRow(mergePlanningItem(existing, itemUpdates, actorEmail));
  }

  return progressRow;
}
