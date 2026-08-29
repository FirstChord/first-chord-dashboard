/** @fileoverview Server workflow for tutor absences, spanning schedule review, cover candidates, generated planning cards, and pause handoffs. */
import { getMmsTutorCalendarEventsForDate } from './mms.js';
import { savePlanningItem } from './planning.js';
import {
  deleteTutorAbsenceStateRow,
  getPlanningItemRows,
  getTutorAbsenceStateRows,
  upsertTutorAbsenceStateRow,
} from './sheets.js';
import { getOperationalAdminStudents } from './students.js';
import { getTutorOptionsWithLifecycle } from './tutors.js';
import { getCoverBankWorkflow } from './cover-bank.js';
import { rankCoverCandidates, weekdayFromDateInput } from './cover-bank-helpers.mjs';
import { buildTutorAbsencePlanningId, TUTOR_ABSENCE_NOTICE_PLANNING_MARKER } from './planning-helpers.mjs';
import {
  assertTutorAbsenceResolutionReady,
  buildCoverTutorOptions,
  buildTutorAbsenceCancellationMessageGroups,
  buildTutorAbsenceEarlyNoticePlanningBundle,
  buildTutorAbsenceFinalConfirmationPlanningItems,
  buildTutorAbsenceId,
  buildTutorAbsencePausePlanningBundle,
  compareTutorAbsenceLessonSnapshots,
  isTutorAbsenceGeneratedPlanningItemMutable,
  normaliseTutorAbsenceDecision,
  expandTutorAbsenceEvent,
  normaliseTutorAbsenceStatus,
  parseTutorAbsenceStateRow,
  scopeTutorAbsenceLessonSnapshots,
  selectObsoleteTutorAbsenceFinalConfirmationPlanningIds,
  shouldSyncGeneratedTutorAbsencePlanningItem,
  summariseTutorAbsenceState,
} from './tutor-absence-helpers.mjs';

function serialise(value) {
  return JSON.stringify(value || {});
}

function buildStudentMap(students = []) {
  return new Map(students.filter((student) => student.mmsId).map((student) => [student.mmsId, student]));
}

function enrichAbsenceLessonsWithStudents(lessons = [], studentByMmsId = new Map()) {
  return (lessons || []).map((lesson) => {
    const student = studentByMmsId.get(lesson.studentMmsId) || {};
    if (!student.mmsId) {
      return lesson;
    }

    return {
      ...lesson,
      studentName: lesson.studentName || student.fullName || '',
      parentName: lesson.parentName || [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
      parentEmail: lesson.parentEmail || student.email || '',
      parentPhone: lesson.parentPhone || student.contactNumber || '',
      instrument: lesson.instrument || student.instrument || '',
      tutor: lesson.tutor || student.tutor || '',
      paymentMode: student.paymentMode || lesson.paymentMode || '',
      paymentExpectation: student.paymentExpectation || lesson.paymentExpectation || '',
      stripeCustomerId: student.stripeCustomerId || lesson.stripeCustomerId || '',
      stripeSubscriptionId: student.stripeSubscriptionId || lesson.stripeSubscriptionId || '',
    };
  });
}

async function loadLiveTutorAbsenceLessons({ selectedTutor, selectedDate }) {
  const [students, events] = await Promise.all([
    getOperationalAdminStudents(),
    getMmsTutorCalendarEventsForDate({
      teacherId: selectedTutor.teacherId,
      date: selectedDate,
    }),
  ]);
  const studentByMmsId = buildStudentMap(students);
  return events
    // One entry per student, so a sibling pair or a class booking reaches every
    // household instead of collapsing to whoever MMS happened to list first.
    .flatMap((event) => expandTutorAbsenceEvent(event, studentByMmsId))
    .filter((lesson) => lesson.eventId && lesson.studentMmsId)
    .sort((a, b) => a.lessonTime.localeCompare(b.lessonTime) || a.studentName.localeCompare(b.studentName));
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function resolveTutor(tutorShortName = '', tutors = []) {
  return tutors.find((tutor) => tutor.shortName === tutorShortName) || null;
}

function collectTutorAbsenceNoticeEnabledIds(planningItems = []) {
  return new Set(
    planningItems
      .filter((item) => `${item.notes || ''}`.includes(TUTOR_ABSENCE_NOTICE_PLANNING_MARKER))
      .map((item) => buildTutorAbsenceId({
        tutorShortName: item.linkedTutorId || `${item.notes || ''}`.match(/^Tutor:\s*(\S+)/mu)?.[1] || '',
        absenceDate: `${item.notes || ''}`.match(/^Tutor absence date:\s*(\d{4}-\d{2}-\d{2})$/mu)?.[1] || '',
      }))
      .filter(Boolean),
  );
}

async function createStructuredPausePlanningFromCancellation({
  row = {},
  actorEmail = '',
} = {}) {
  if (row.decision !== 'cancel_day') {
    return [];
  }

  const [allAbsenceRows, existingRows] = await Promise.all([
    getTutorAbsenceStateRows(),
    getPlanningItemRows(),
  ]);
  const noticeEnabledAbsenceIds = collectTutorAbsenceNoticeEnabledIds(existingRows);
  const relatedRows = allAbsenceRows
    .map(parseTutorAbsenceStateRow)
    .filter((absence) => (
      absence.tutorShortName === row.tutorShortName
      && absence.decision === 'cancel_day'
      && absence.status !== 'resolved'
    ))
    .map((absence) => ({
      ...absence,
      requiresDatedPaymentTool: noticeEnabledAbsenceIds.has(absence.absenceId),
    }));

  const {
    plans,
    supersededPlanningIds,
    supersededPlanningPrefixes,
  } = buildTutorAbsencePausePlanningBundle({ rows: relatedRows });

  if (!plans.length) {
    return [];
  }

  const existingIds = new Set(existingRows.map((item) => item.planningId).filter(Boolean));
  const newPlanIds = new Set(plans.map((plan) => plan.planningId));
  const supersededIds = new Set(supersededPlanningIds);

  for (const existing of existingRows) {
    if (!existing.planningId || newPlanIds.has(existing.planningId)) {
      continue;
    }
    const matchesGroupedPrefix = supersededPlanningPrefixes.some((prefix) => (
      prefix && existing.planningId.startsWith(prefix)
    ));
    if (matchesGroupedPrefix) {
      supersededIds.add(existing.planningId);
    }
  }

  const created = [];

  for (const planningId of supersededIds) {
    if (!existingIds.has(planningId) || newPlanIds.has(planningId)) {
      continue;
    }
    const existing = existingRows.find((item) => item.planningId === planningId) || {};
    if (!isTutorAbsenceGeneratedPlanningItemMutable(existing)) {
      continue;
    }
    if (existing.status === 'parked' && existing.nextAction === 'Superseded by a grouped tutor-absence away-period pause plan.') {
      continue;
    }
    await savePlanningItem({
      planningId,
      item: {
        ...existing,
        status: 'parked',
        nextAction: 'Superseded by a grouped tutor-absence away-period pause plan.',
      },
      actorEmail,
      progressNote: 'Parked because a grouped away-period pause plan now covers these tutor absence dates.',
    });
  }

  for (const plan of plans) {
    const existing = existingRows.find((item) => item.planningId === plan.planningId) || {};
    if (!shouldSyncGeneratedTutorAbsencePlanningItem({ existing, next: plan.item })) {
      continue;
    }
    const saved = await savePlanningItem({
      planningId: plan.planningId,
      item: plan.item,
      actorEmail,
      progressNote: plan.progressNote,
    });
    if (!existingIds.has(plan.planningId)) {
      created.push(saved.planningId);
      existingIds.add(saved.planningId);
    }
  }

  return created;
}

// Early notices are intentionally opt-in. Only capture cards written after the
// v1 marker was introduced participate, so pre-existing absence/pause work is
// never backfilled, regrouped or changed by this communication-only layer.
export async function syncTutorAbsenceEarlyNoticePlanning({ actorEmail = '' } = {}) {
  const [absenceRaw, planningItems] = await Promise.all([
    getTutorAbsenceStateRows(),
    getPlanningItemRows(),
  ]);
  const noticeEnabledAbsenceIds = collectTutorAbsenceNoticeEnabledIds(planningItems);
  const rows = absenceRaw
    .map(parseTutorAbsenceStateRow)
    .filter((row) => noticeEnabledAbsenceIds.has(row.absenceId));
  const { plans } = buildTutorAbsenceEarlyNoticePlanningBundle({ rows });
  const finalConfirmationPlans = buildTutorAbsenceFinalConfirmationPlanningItems({ rows });
  const nextIds = new Set(plans.map((plan) => plan.planningId));
  const prefixes = new Set(plans.map((plan) => plan.prefix).filter(Boolean));
  const obsoleteFinalConfirmationIds = selectObsoleteTutorAbsenceFinalConfirmationPlanningIds({
    planningItems,
    absenceIds: rows.map((row) => row.absenceId),
    currentPlanningIds: finalConfirmationPlans.map((plan) => plan.planningId),
  });

  for (const existing of planningItems) {
    if (!existing.planningId || nextIds.has(existing.planningId) || existing.status === 'done') continue;
    if (!prefixes.size || ![...prefixes].some((prefix) => existing.planningId.startsWith(prefix))) continue;
    if (existing.linkedWorkflowId !== 'tutor-absence-notice' || existing.status === 'parked') continue;
    if (!isTutorAbsenceGeneratedPlanningItemMutable(existing)) continue;
    await savePlanningItem({
      planningId: existing.planningId,
      item: {
        ...existing,
        status: 'parked',
        nextAction: 'Superseded by a broader tutor-absence early-notice plan.',
      },
      actorEmail,
      progressNote: 'Parked because the changed tutor-absence dates now have a broader early notice plan.',
    });
  }

  const createdPlanningIds = [];
  for (const plan of plans) {
    const existing = planningItems.find((item) => item.planningId === plan.planningId) || {};
    if (!shouldSyncGeneratedTutorAbsencePlanningItem({ existing, next: plan.item })) continue;
    const hasCompletedEarlierNotice = planningItems.some((item) => (
      item.planningId !== plan.planningId
      && item.status === 'done'
      && item.linkedWorkflowId === 'tutor-absence-notice'
      && item.planningId.startsWith(plan.prefix)
    ));
    const item = hasCompletedEarlierNotice
      ? {
        ...plan.item,
        title: `Update: ${plan.item.title}`,
        nextAction: 'Dates changed after an earlier absence notice. Send this updated notice before relying on the final pause card.',
      }
      : plan.item;
    const saved = await savePlanningItem({
      planningId: plan.planningId,
      item,
      actorEmail,
      progressNote: plan.progressNote,
    });
    if (!existing.planningId) createdPlanningIds.push(saved.planningId);
  }

  for (const planningId of obsoleteFinalConfirmationIds) {
    const existing = planningItems.find((item) => item.planningId === planningId);
    if (!existing) continue;
    await savePlanningItem({
      planningId,
      item: {
        ...existing,
        status: 'parked',
        nextAction: 'Replaced by the dated tutor-absence pause card with the payment tool.',
      },
      actorEmail,
      progressNote: 'Parked because an undated paused-expected flag no longer counts as proof that this tutor absence payment action was completed.',
    });
  }

  const createdFinalConfirmationIds = [];
  for (const plan of finalConfirmationPlans) {
    const existing = planningItems.find((item) => item.planningId === plan.planningId) || {};
    if (!shouldSyncGeneratedTutorAbsencePlanningItem({ existing, next: plan.item })) continue;
    const saved = await savePlanningItem({
      planningId: plan.planningId,
      item: plan.item,
      actorEmail,
      progressNote: plan.progressNote,
    });
    if (!existing.planningId) createdFinalConfirmationIds.push(saved.planningId);
  }

  return { createdPlanningIds, createdFinalConfirmationIds };
}

export async function getTutorAbsenceWorkflow({ tutorShortName = '', absenceDate = '' } = {}) {
  const allTutors = await getTutorOptionsWithLifecycle();
  const tutors = allTutors.filter((tutor) => tutor.lifecycleStatus !== 'retired');
  const selectedTutor = resolveTutor(tutorShortName, allTutors);
  const selectedDate = absenceDate || todayInputValue();
  const absenceId = selectedTutor && selectedDate
    ? buildTutorAbsenceId({ tutorShortName: selectedTutor.shortName, absenceDate: selectedDate })
    : '';
  const stateRows = absenceId ? await getTutorAbsenceStateRows(absenceId) : [];
  const savedState = stateRows[0] ? parseTutorAbsenceStateRow(stateRows[0]) : null;
  let lessons = savedState?.affectedLessons || [];
  let loadError = '';

  if (selectedTutor?.teacherId && selectedDate && !lessons.length) {
    try {
      lessons = await loadLiveTutorAbsenceLessons({ selectedTutor, selectedDate });
    } catch (error) {
      loadError = error.message || 'Could not load MMS lessons for this tutor/date.';
    }
  } else if (lessons.length) {
    try {
      const students = await getOperationalAdminStudents();
      lessons = enrichAbsenceLessonsWithStudents(lessons, buildStudentMap(students));
    } catch {
      // Keep the saved lesson snapshot usable even if the enrichment read fails.
    }
  }

  // Cover-bank candidates are context, never a gate — a bank read failure must
  // not take the absence workflow down with it.
  let coverCandidates = [];
  if (selectedTutor && selectedDate) {
    try {
      const coverBank = await getCoverBankWorkflow();
      coverCandidates = rankCoverCandidates({
        coverBankRecords: coverBank.records,
        weekday: weekdayFromDateInput(selectedDate),
        neededInstruments: lessons.map((lesson) => lesson.instrument),
        absentTutorKey: selectedTutor.shortName,
      });
    } catch {
      coverCandidates = [];
    }
  }

  const messageState = savedState?.messageState || {};
  const allStateRows = await getTutorAbsenceStateRows();
  const parsedStateRows = allStateRows.map(parseTutorAbsenceStateRow);
  const summary = summariseTutorAbsenceState({
    lessons,
    messageState,
    decision: savedState?.decision || '',
    coverTutorName: savedState?.coverTutorName || '',
  });

  return {
    tutors,
    selectedTutor,
    selectedDate,
    absenceId,
    lessons,
    coverOptions: selectedTutor
      ? buildCoverTutorOptions({ absentTutor: selectedTutor, lessons, tutors })
      : [],
    coverCandidates,
    state: savedState || {
      absenceId,
      tutorShortName: selectedTutor?.shortName || '',
      tutorName: selectedTutor?.fullName || '',
      absenceDate: selectedDate,
      status: lessons.length ? 'in_progress' : 'draft',
      decision: '',
      coverTutorShortName: '',
      coverTutorName: '',
      affectedLessons: lessons,
      messageState,
      note: '',
      createdAt: '',
      updatedAt: '',
      resolvedAt: '',
      updatedBy: '',
    },
    summary,
    cancellationMessageGroups: buildTutorAbsenceCancellationMessageGroups({
      rows: parsedStateRows,
      tutorShortName: selectedTutor?.shortName || '',
    }).filter((group) => group.missedDates.includes(selectedDate)),
    loadError,
  };
}

// The saved lesson snapshot is the operational record, but parent notices and
// payment completion must fail loud if MMS has changed underneath it. This read
// never mutates the snapshot, planning, payment or reconciliation state.
export async function getTutorAbsenceScheduleReview({ absenceId = '', studentMmsId = '' } = {}) {
  const savedRows = await getTutorAbsenceStateRows(absenceId);
  const state = savedRows[0] ? parseTutorAbsenceStateRow(savedRows[0]) : null;
  if (!state?.absenceId) {
    return { ready: false, reason: 'missing_absence_record', message: 'The tutor absence record is missing.' };
  }
  const selectedTutor = resolveTutor(state.tutorShortName, await getTutorOptionsWithLifecycle());
  if (!selectedTutor?.teacherId) {
    return { ready: false, reason: 'missing_tutor', message: 'The tutor could not be resolved in MMS.' };
  }
  if (!state.affectedLessons.length) {
    return { ready: false, reason: 'missing_snapshot', message: 'No saved lesson snapshot is available to verify.' };
  }

  let liveLessons;
  try {
    liveLessons = await loadLiveTutorAbsenceLessons({
      selectedTutor,
      selectedDate: state.absenceDate,
    });
  } catch (error) {
    return {
      ready: false,
      reason: 'mms_load_failed',
      message: error.message || 'MMS could not be checked. Do not continue until it loads.',
    };
  }

  const scopedLessons = scopeTutorAbsenceLessonSnapshots({
    expectedLessons: state.affectedLessons,
    liveLessons,
    studentMmsId,
  });
  if (studentMmsId && !scopedLessons.expectedLessons.length) {
    return {
      ready: false,
      reason: 'missing_student_snapshot',
      message: 'No saved lesson snapshot is available for this student.',
    };
  }

  return compareTutorAbsenceLessonSnapshots(scopedLessons);
}

export async function saveTutorAbsenceWorkflow({
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
    messageStateJson: serialise(messageState),
    note,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    resolvedAt: normalisedStatus === 'resolved' ? existing?.resolvedAt || now : '',
    updatedBy,
  };

  await upsertTutorAbsenceStateRow(row);
  const createdPausePlanningIds = await createStructuredPausePlanningFromCancellation({
    row,
    actorEmail: updatedBy,
  });
  const earlyNoticePlanning = row.decision === 'cancel_day'
    ? await syncTutorAbsenceEarlyNoticePlanning({ actorEmail: updatedBy })
    : { createdPlanningIds: [], createdFinalConfirmationIds: [] };

  return {
    ...row,
    affectedLessons,
    messageState,
    createdPausePlanningIds,
    createdEarlyNoticePlanningIds: earlyNoticePlanning.createdPlanningIds,
    createdFinalConfirmationPlanningIds: earlyNoticePlanning.createdFinalConfirmationIds,
  };
}

export async function deleteTutorAbsenceWorkflow(absenceId = '') {
  return deleteTutorAbsenceStateRow(absenceId);
}

function serialiseTutorAbsenceRow(row = {}, updatedBy = '') {
  const now = new Date().toISOString();
  return {
    absenceId: row.absenceId,
    tutorShortName: row.tutorShortName,
    tutorName: row.tutorName,
    absenceDate: row.absenceDate,
    status: row.status,
    decision: row.decision,
    coverTutorShortName: row.coverTutorShortName,
    coverTutorName: row.coverTutorName,
    affectedLessonsJson: JSON.stringify(row.affectedLessons || []),
    messageStateJson: serialise(row.messageState),
    note: row.note,
    createdAt: row.createdAt || now,
    updatedAt: now,
    resolvedAt: row.resolvedAt || '',
    updatedBy,
  };
}

export async function markTutorAbsenceCancellationGroupMessaged({
  groupKey = '',
  updatedBy = '',
} = {}) {
  if (!groupKey) {
    throw new Error('groupKey is required');
  }

  const rows = (await getTutorAbsenceStateRows()).map(parseTutorAbsenceStateRow);
  const groups = buildTutorAbsenceCancellationMessageGroups({ rows });
  const group = groups.find((candidate) => candidate.groupKey === groupKey);
  if (!group) {
    throw new Error('Grouped cancellation message was not found');
  }

  const byAbsenceId = new Map(rows.map((row) => [row.absenceId, row]));
  const touched = new Set();

  for (const occurrence of group.occurrences) {
    const row = byAbsenceId.get(occurrence.absenceId);
    if (!row || touched.has(`${occurrence.absenceId}:${occurrence.eventId}`)) {
      continue;
    }

    row.messageState = {
      ...(row.messageState || {}),
      [occurrence.eventId]: {
        ...(row.messageState?.[occurrence.eventId] || {}),
        messaged: true,
        groupedMessageKey: group.groupKey,
      },
    };
    touched.add(`${occurrence.absenceId}:${occurrence.eventId}`);
  }

  const absenceIdsToSave = new Set(group.occurrences.map((occurrence) => occurrence.absenceId));
  for (const absenceId of absenceIdsToSave) {
    const row = byAbsenceId.get(absenceId);
    if (!row) continue;
    await upsertTutorAbsenceStateRow(serialiseTutorAbsenceRow(row, updatedBy));
  }

  return {
    groupKey: group.groupKey,
    updatedLessons: touched.size,
  };
}

export async function getTutorAbsenceOverviewSummary() {
  const rows = await getTutorAbsenceStateRows();
  const openRows = rows
    .map(parseTutorAbsenceStateRow)
    // Cancelled dates have been handed to their grouped pause cards. They are
    // still tracked and will resolve automatically, but are not a fresh item
    // for the Tutor Absence list to make the user work through again.
    .filter((row) => row.status && row.status !== 'resolved' && row.decision !== 'cancel_day')
    .sort((a, b) => (
      a.absenceDate.localeCompare(b.absenceDate)
      || a.tutorName.localeCompare(b.tutorName)
    ));
  const unresolvedMessages = openRows.reduce((sum, row) => (
    sum + summariseTutorAbsenceState({
      lessons: row.affectedLessons,
      messageState: row.messageState,
    }).remainingMessages
  ), 0);
  const firstOpenAbsence = openRows[0] || null;

  return {
    openAbsences: openRows.length,
    unresolvedMessages,
    firstOpenAbsence: firstOpenAbsence
      ? {
        absenceId: firstOpenAbsence.absenceId,
        tutorShortName: firstOpenAbsence.tutorShortName,
        tutorName: firstOpenAbsence.tutorName,
        absenceDate: firstOpenAbsence.absenceDate,
        status: firstOpenAbsence.status,
      }
      : null,
  };
}

// Read-only list of logged tutor absences for the workflow page, so every saved
// absence is reachable (not just the first open one). Open absences first, then
// resolved, each sorted by date.
export async function getOpenTutorAbsences() {
  const rows = await getTutorAbsenceStateRows();
  return rows
    .map(parseTutorAbsenceStateRow)
    .filter((row) => (
      row.absenceId
      && row.absenceDate
      && row.tutorShortName
      && row.status !== 'resolved'
      && row.decision !== 'cancel_day'
    ))
    .map((row) => {
      const summary = summariseTutorAbsenceState({
        lessons: row.affectedLessons,
        messageState: row.messageState,
        decision: row.decision,
        coverTutorName: row.coverTutorName,
      });
      return {
        absenceId: row.absenceId,
        tutorShortName: row.tutorShortName,
        tutorName: row.tutorName,
        absenceDate: row.absenceDate,
        status: row.status,
        decision: row.decision,
        totalLessons: summary.totalLessons,
        remainingMessages: summary.remainingMessages,
      };
    })
    .sort((a, b) => (
      a.absenceDate.localeCompare(b.absenceDate)
      || a.tutorName.localeCompare(b.tutorName)
    ));
}

// A cancelled date delegates its final parent/payment work to one or more
// structured pause cards. Once every current card that represents the date is
// done, close the dated absence record and its original Planning capture card.
// This is intentionally derived from the plan bundle rather than a fragile
// one-to-one id: one student may have several cancelled dates in one period.
export async function syncTutorAbsenceHandoffsFromPlanning({ actorEmail = '' } = {}) {
  const [absenceRaw, planningItems] = await Promise.all([
    getTutorAbsenceStateRows(),
    getPlanningItemRows(),
  ]);
  const noticeEnabledAbsenceIds = collectTutorAbsenceNoticeEnabledIds(planningItems);
  const rows = absenceRaw
    .map(parseTutorAbsenceStateRow)
    .map((row) => ({
      ...row,
      requiresDatedPaymentTool: noticeEnabledAbsenceIds.has(row.absenceId),
    }));
  const bundle = buildTutorAbsencePausePlanningBundle({ rows });
  const finalConfirmationPlans = buildTutorAbsenceFinalConfirmationPlanningItems({
    rows: rows.filter((row) => noticeEnabledAbsenceIds.has(row.absenceId)),
  });
  const planningById = new Map(planningItems.map((item) => [item.planningId, item]));
  const resolvedAbsenceIds = [];

  for (const row of rows) {
    if (row.decision !== 'cancel_day' || row.status === 'resolved') continue;

    const relatedPlans = [
      ...bundle.plans.filter((plan) => (
      `${plan.item.notes || ''}`.includes(row.absenceId)
      )),
      ...finalConfirmationPlans.filter((plan) => `${plan.item.notes || ''}`.includes(row.absenceId)),
    ];

    // A missing plan is not evidence of completion. Leave the dated record
    // visible to the underlying system until a real final-action card exists.
    if (!relatedPlans.length) continue;
    const allDone = relatedPlans.every((plan) => planningById.get(plan.planningId)?.status === 'done');
    if (!allDone) continue;

    const now = new Date().toISOString();
    await upsertTutorAbsenceStateRow(serialiseTutorAbsenceRow({
      ...row,
      status: 'resolved',
      resolvedAt: row.resolvedAt || now,
    }, actorEmail));

    const captureId = buildTutorAbsencePlanningId(row.tutorShortName, row.absenceDate);
    const captureCard = planningById.get(captureId);
    if (captureCard && captureCard.status !== 'done') {
      await savePlanningItem({
        planningId: captureId,
        item: {
          ...captureCard,
          status: 'done',
          outcome: 'Cancelled date completed through its linked structured pause card(s).',
          nextAction: 'Completed automatically when the linked pause work was finished.',
        },
        actorEmail,
        progressNote: 'Completed automatically: all linked tutor-absence pause cards are done.',
      });
    }
    resolvedAbsenceIds.push(row.absenceId);
  }

  return { resolvedAbsenceIds };
}
