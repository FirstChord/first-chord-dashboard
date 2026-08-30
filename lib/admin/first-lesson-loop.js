/** @fileoverview Composes first-lesson Planning follow-up context from bounded student, access-workflow, and lesson-mirror reads. */
import { getAdminStudents } from './students.js';
import { getStudentPortalAccessRows } from './sheets.js';
import { getLessonOccurrenceObservations } from './lesson-mirror-store.mjs';
import { buildScheduledLessonMirrorWindow } from './lesson-window-helpers.mjs';
import {
  buildFirstLessonLoopContext,
  isFirstLessonCheckinPlanningItem,
  matchFirstLessonObservation,
  parseFirstLessonLoopMetadata,
} from './first-lesson-loop-helpers.mjs';

async function safeRead(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

export async function enrichFirstLessonLoopPlanningItems(items = [], { now = new Date() } = {}) {
  const openLoops = items.filter((item) => (
    isFirstLessonCheckinPlanningItem(item)
    && !['done', 'parked'].includes(item.status)
  ));
  if (!openLoops.length) return items;

  const window = buildScheduledLessonMirrorWindow({ at: now });
  const studentExternalIds = [...new Set(openLoops
    .map((item) => parseFirstLessonLoopMetadata(item).studentMmsId)
    .filter(Boolean))];
  const [students, portalRows, lessonRead] = await Promise.all([
    safeRead(() => getAdminStudents(), []),
    safeRead(() => getStudentPortalAccessRows(), []),
    safeRead(
      () => getLessonOccurrenceObservations({
        startDate: window.startDate,
        endDateExclusive: window.endDateExclusive,
        studentExternalIds,
        limit: 3000,
        now,
      }),
      { source: { verified: false, state: 'unavailable' }, observations: [] },
    ),
  ]);
  const studentById = new Map(students.map((student) => [student.mmsId, student]));
  const portalById = new Map(portalRows.map((row) => [row.studentMmsId, row]));

  return items.map((item) => {
    if (!openLoops.includes(item)) return item;
    const metadata = parseFirstLessonLoopMetadata(item);
    const lessonEvidence = matchFirstLessonObservation({
      metadata,
      observations: lessonRead.observations,
      source: lessonRead.source,
    });
    return {
      ...item,
      firstLessonLoop: buildFirstLessonLoopContext({
        item,
        student: studentById.get(metadata.studentMmsId) || null,
        portalAccess: portalById.get(metadata.studentMmsId) || null,
        lessonEvidence,
        now,
      }),
    };
  });
}

export async function getFirstLessonLoopContextForItem(item, { now = new Date() } = {}) {
  const [enriched] = await enrichFirstLessonLoopPlanningItems([item], { now });
  return enriched?.firstLessonLoop || null;
}
