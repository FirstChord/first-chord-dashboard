/** @fileoverview Exact open structured-pause identity and duplicate-save error contracts. */
import { parseLinkedStudentIds } from './planning-helpers.mjs';
import { isOpenPlanningItem, isPausePlanningItem } from './planning-client-helpers.mjs';

// Only structured labels are evidence. Incomplete or conflicting dates and
// free text must never become a reason to block a different task.
function labelledValue(notes, label) {
  const values = [...notes.matchAll(new RegExp(`^${label}:\\s*([^\\r\\n]+)`, 'gmi'))]
    .map((match) => match[1].trim().replace(/\.$/, '').trim());
  return values.length === 1 ? values[0] : '';
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function structuredPauseIdentity(item = {}) {
  if (!isPausePlanningItem(item)) return '';
  const students = parseLinkedStudentIds(item.linkedStudentIds ?? item.linkedStudentId).sort();
  if (!students.length) return '';
  const notes = `${item.notes || ''}`;
  const type = labelledValue(notes, 'Pause type').toLowerCase();
  const single = labelledValue(notes, 'Lesson date');
  const first = labelledValue(notes, 'First lesson to pause date');
  const back = labelledValue(notes, 'Returning from date');
  if (type === 'single lesson' && validDate(single)
    && !/^First lesson to pause date:|^Returning from date:/mi.test(notes)) {
    return JSON.stringify([students, 'single', single]);
  }
  if (type === 'away period' && validDate(first) && validDate(back) && back > first
    && !/^Lesson date:/mi.test(notes)) {
    return JSON.stringify([students, 'range', first, back]);
  }
  return '';
}

export function findExactOpenPauseDuplicate(item, rows = [], existing = {}) {
  if (!isOpenPlanningItem(item)) return null;
  const identity = structuredPauseIdentity(item);
  if (!identity) return null;
  // Same-card retries and ordinary notes/owner edits remain usable even when
  // older duplicate rows already exist. Date/student/type changes are checked.
  if (existing.planningId && isOpenPlanningItem(existing)
    && structuredPauseIdentity(existing) === identity) return null;
  return rows.find((row) => row.planningId && row.planningId !== item.planningId
    && isOpenPlanningItem(row) && structuredPauseIdentity(row) === identity) || null;
}

export function planningSaveErrorBody(error, fallback = 'Planning save failed') {
  return {
    error: error.message || fallback,
    ...(error.code === 'DUPLICATE_PAUSE' ? {
      code: error.code,
      duplicatePlanningId: error.duplicatePlanningId,
    } : {}),
  };
}

export function planningSaveClientError(body, fallback = 'Planning save failed') {
  return Object.assign(new Error(body.error || fallback), {
    duplicatePlanningId: body.code === 'DUPLICATE_PAUSE' ? body.duplicatePlanningId : '',
  });
}
