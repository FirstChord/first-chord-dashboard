/** @fileoverview Sheets-backed newsletter reads and writes: composes the monthly issue view and records priorities, contributions, consent answers and editorial decisions. */
import { randomUUID } from 'node:crypto';
import {
  appendEventLogRow,
  deleteNewsletterItemRow,
  getNewsletterIssueRows,
  getNewsletterItemRows,
  upsertNewsletterIssueRow,
  upsertNewsletterItemRow,
} from './sheets.js';
import { getOperationalAdminStudents } from './students.js';
import { resolveTutorName } from './tutor-identity.mjs';
import {
  buildClearPriorityUpdate,
  buildConsentUpdate,
  buildEditorialUpdate,
  buildNewsletterIssueRow,
  buildNewsletterItemId,
  buildNewsletterItemRow,
  buildStandingConsentIndex,
  currentIssueMonth,
  formatDeadlineLabel,
  formatIssueMonthLabel,
  groupPrioritiesByTutor,
  isEmptyRequestRow,
  normaliseIssueMonth,
  resolveNewsletterIdentity,
  summariseIssue,
} from './newsletter-helpers.mjs';
import { buildConsentRequestMessage, buildTutorRequestMessage } from './newsletter-data.js';

export { resolveNewsletterIdentity };

function studentPickerEntry(student) {
  const identity = resolveNewsletterIdentity(student);
  return {
    mmsId: student.mmsId,
    studentName: student.fullName,
    firstName: student.firstName || '',
    tutorName: identity.fcTutorId ? identity.tutorName : (resolveTutorName(student.tutor || '') || ''),
    instrument: student.instrument || '',
    fcStudentId: identity.fcStudentId || '',
    // Surfaced so Fenella can see why a student cannot be picked, instead of
    // the name silently missing from the list.
    identityIssue: identity.error || '',
  };
}

// The whole newsletter view for one month. One prefetched student pass (the
// busiest read path in the app) plus the two newsletter tabs.
export async function getNewsletterWorkflow({ issueMonth = '', currentDate = new Date() } = {}) {
  const [students, issueRows, allItemRows] = await Promise.all([
    getOperationalAdminStudents(),
    getNewsletterIssueRows(),
    // Read every month, not just this one: standing consent is derived from
    // answers given in earlier issues, so scoping the read would make the
    // school re-ask a family that already said yes to future newsletters.
    getNewsletterItemRows(),
  ]);

  const requested = normaliseIssueMonth(issueMonth);
  const month = requested
    || issueRows[0]?.issueMonth
    || currentIssueMonth(currentDate);
  const issue = issueRows.find((row) => row.issueMonth === month) || null;

  const summary = summariseIssue(allItemRows, {
    issue: issue || { issueMonth: month },
    currentDate,
  });
  const standing = buildStandingConsentIndex(allItemRows);

  const pickerStudents = students
    .filter((student) => student.mmsId && student.lifecycleStatus !== 'stopped')
    .map(studentPickerEntry)
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
  const studentByFcId = new Map(
    pickerStudents.filter((entry) => entry.fcStudentId).map((entry) => [entry.fcStudentId, entry]),
  );

  const monthLabel = formatIssueMonthLabel(month);
  const items = summary.items.map((item) => {
    const student = studentByFcId.get(item.fcStudentId) || null;
    return {
      ...item,
      // Live names win over the copy stored on the row, so a student who has
      // been renamed does not read as two people across issues.
      studentName: student?.studentName || item.studentName,
      tutorName: student?.tutorName || item.tutorName,
      consentMessage: item.consent.required && item.consent.status !== 'cleared'
        ? buildConsentRequestMessage({
          parentFirstName: firstNameOf(students, item.mmsId, 'parent'),
          studentFirstName: student?.firstName || firstNameOf(students, item.mmsId, 'student'),
          monthLabel,
          mediaDescription: 'a photo',
        })
        : '',
    };
  });

  const tutorGroups = groupPrioritiesByTutor(allItemRows, { issueMonth: month }).map((group) => ({
    ...group,
    message: buildTutorRequestMessage({
      tutorFirstName: group.tutorName === 'Unassigned' ? '' : group.tutorName,
      studentNames: group.students.map((student) => (
        studentByFcId.get(student.fcStudentId)?.firstName || student.studentName
      )),
      question: issue?.question || '',
      deadlineLabel: formatDeadlineLabel(issue?.deadline || ''),
    }),
  }));

  return {
    month,
    monthLabel,
    issue,
    issueMonths: issueRows.map((row) => row.issueMonth),
    items,
    counts: summary.counts,
    blockers: summary.blockers,
    tutorGroups,
    students: pickerStudents,
    standingConsentCount: standing.size,
  };
}

function firstNameOf(students, mmsId, which) {
  const student = students.find((entry) => entry.mmsId === mmsId);
  if (!student) return '';
  return which === 'parent'
    ? `${student.parentFirstName || ''}`.trim()
    : `${student.firstName || ''}`.trim();
}

// --- writes ---------------------------------------------------------------

export async function saveNewsletterIssue({
  issueMonth = '',
  question = '',
  deadline = '',
  intro = '',
  actorEmail = '',
} = {}) {
  const existingRows = await getNewsletterIssueRows();
  const existingRow = existingRows.find((row) => row.issueMonth === normaliseIssueMonth(issueMonth)) || null;

  const result = buildNewsletterIssueRow({
    issueMonth,
    question,
    deadline,
    intro,
    existingRow,
    actorEmail,
  });
  if (result.error) return { error: result.error };

  await upsertNewsletterIssueRow(result.row);

  // Opening an issue is the consequential moment worth remembering; editing its
  // question later is not, and logging every keystroke would turn Event_Log into
  // a change feed.
  if (!existingRow) {
    await appendEventLogRow({
      eventId: `evt_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      actorEmail,
      entityType: 'newsletter_issue',
      entityId: result.row.issueMonth,
      eventType: 'newsletter_issue_opened',
      payloadJson: JSON.stringify({ question: result.row.question, deadline: result.row.deadline }),
    });
  }

  return { issue: result.row, created: !existingRow };
}

// Assigns the exact set of priority students for an issue. Students already
// requested stay untouched (their original ask keeps its date); students
// dropped from the set are demoted to extras if something arrived, and removed
// outright only when the row is completely untouched.
export async function setNewsletterPriorities({
  issueMonth = '',
  mmsIds = [],
  actorEmail = '',
} = {}) {
  const month = normaliseIssueMonth(issueMonth);
  if (!month) return { error: 'invalid_issue_month' };

  const [students, existingItems] = await Promise.all([
    getOperationalAdminStudents(),
    getNewsletterItemRows(month),
  ]);

  const studentByMmsId = new Map(students.map((student) => [student.mmsId, student]));
  const wanted = [...new Set(mmsIds.map((id) => `${id || ''}`.trim()).filter(Boolean))];

  const assigned = [];
  const unresolved = [];

  for (const mmsId of wanted) {
    const student = studentByMmsId.get(mmsId);
    if (!student) {
      unresolved.push({ mmsId, reason: 'student_not_found' });
      continue;
    }
    const identity = resolveNewsletterIdentity(student);
    if (identity.error) {
      unresolved.push({ mmsId, studentName: student.fullName, reason: identity.error });
      continue;
    }

    // The priority row for a student in a month has exactly one id.
    const priorityItemId = buildNewsletterItemId({
      issueMonth: month,
      fcStudentId: identity.fcStudentId,
    });
    const existingRow = existingItems.find((item) => item.itemId === priorityItemId) || null;

    const result = buildNewsletterItemRow({
      issueMonth: month,
      fcStudentId: identity.fcStudentId,
      studentName: identity.studentName,
      mmsId: identity.mmsId,
      fcTutorId: identity.fcTutorId,
      tutorName: identity.tutorName,
      requested: true,
      existingRow,
      actorEmail,
    });
    if (result.error) {
      unresolved.push({ mmsId, studentName: student.fullName, reason: result.error });
      continue;
    }

    await upsertNewsletterItemRow(result.row);
    assigned.push(result.row);
  }

  // Anything previously requested that is no longer in the set.
  const keptFcIds = new Set(assigned.map((row) => row.fcStudentId));
  const removed = [];
  const demoted = [];
  for (const item of existingItems) {
    if (!item.requestedAt) continue;
    if (keptFcIds.has(item.fcStudentId)) continue;

    if (isEmptyRequestRow(item)) {
      await deleteNewsletterItemRow(item.itemId);
      removed.push(item.itemId);
      continue;
    }
    // Something arrived, or a permission conversation started. Never delete:
    // clear the request and let it stand as an unsolicited contribution.
    const cleared = buildClearPriorityUpdate({ existingRow: item });
    if (!cleared.error) {
      await upsertNewsletterItemRow(cleared.row);
      demoted.push(item.itemId);
    }
  }

  return { assigned: assigned.length, removed, demoted, unresolved };
}

// Fenella recording something that arrived (by WhatsApp, in person, however).
// The same builder the tutor surface will use in slice 1b.
export async function recordNewsletterContribution({
  issueMonth = '',
  mmsId = '',
  itemId = '',
  tutorText = '',
  tutorResponse = '',
  hasMedia = false,
  captureTicket = '',
  actorEmail = '',
} = {}) {
  const month = normaliseIssueMonth(issueMonth);
  if (!month) return { error: 'invalid_issue_month' };

  const students = await getOperationalAdminStudents();
  const student = students.find((entry) => entry.mmsId === `${mmsId || ''}`.trim());
  if (!student) return { error: 'student_not_found' };

  const identity = resolveNewsletterIdentity(student);
  if (identity.error) return { error: identity.error };

  const existingItems = await getNewsletterItemRows(month);
  const ticket = `${captureTicket || ''}`.trim();
  const target = `${itemId || ''}`.trim();

  // Editing an existing contribution addresses it by id. FC ids contain
  // underscores, so the id is never taken apart to recover its ticket — it is
  // matched whole, and checked against the student it claims to belong to.
  let existingRow = null;
  if (target) {
    existingRow = existingItems.find((item) => item.itemId === target) || null;
    if (!existingRow) return { error: 'item_not_found' };
    if (existingRow.fcStudentId !== identity.fcStudentId) return { error: 'item_student_mismatch' };
  } else {
    // Without a ticket this lands on the student's request row for the month, so
    // a first capture updates the ask rather than sitting beside it. With a
    // ticket it is an additional contribution, and a resubmitted save resolves
    // to the same id — so a retry on a flaky connection updates one row instead
    // of recording the same story twice.
    const computedId = buildNewsletterItemId({
      issueMonth: month,
      fcStudentId: identity.fcStudentId,
      captureTicket: ticket,
    });
    existingRow = existingItems.find((item) => item.itemId === computedId) || null;
  }

  const result = buildNewsletterItemRow({
    issueMonth: month,
    fcStudentId: identity.fcStudentId,
    studentName: identity.studentName,
    mmsId: identity.mmsId,
    fcTutorId: identity.fcTutorId,
    tutorName: identity.tutorName,
    captureTicket: ticket,
    tutorText,
    tutorResponse,
    hasMedia,
    existingRow,
    actorEmail,
  });
  if (result.error) return { error: result.error };

  await upsertNewsletterItemRow(result.row);
  return { item: result.row };
}

export async function recordNewsletterConsent({
  itemId = '',
  asked = false,
  answer = '',
  actorEmail = '',
} = {}) {
  const allItems = await getNewsletterItemRows();
  const existingRow = allItems.find((item) => item.itemId === `${itemId || ''}`.trim()) || null;
  if (!existingRow) return { error: 'item_not_found' };

  const result = buildConsentUpdate({ existingRow, asked, answer });
  if (result.error) return { error: result.error };

  await upsertNewsletterItemRow(result.row);

  // A recorded permission decision about a child's image is worth remembering
  // beyond the row itself — it is the evidence that the school asked and what
  // the answer was. The act of copying the message is not; Communication_Log
  // already records that.
  if (answer) {
    await appendEventLogRow({
      eventId: `evt_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      actorEmail,
      entityType: 'newsletter_item',
      entityId: existingRow.itemId,
      eventType: 'newsletter_media_consent_recorded',
      mmsId: existingRow.mmsId,
      studentName: existingRow.studentName,
      payloadJson: JSON.stringify({
        answer: result.row.consentAnswer,
        issueMonth: existingRow.issueMonth,
        fcStudentId: existingRow.fcStudentId,
      }),
    });
  }

  return { item: result.row };
}

export async function setNewsletterEditorial({ itemId = '', editorial = '' } = {}) {
  const allItems = await getNewsletterItemRows();
  const target = `${itemId || ''}`.trim();
  const existingRow = allItems.find((item) => item.itemId === target) || null;
  if (!existingRow) return { error: 'item_not_found' };

  // Standing consent is recomputed here from current evidence rather than
  // trusted from the client, so the guard cannot be talked out of by a stale
  // page.
  const standing = buildStandingConsentIndex(allItems).get(existingRow.fcStudentId) || null;

  const result = buildEditorialUpdate({ existingRow, editorial, standingConsent: standing });
  if (result.error) return { error: result.error };

  await upsertNewsletterItemRow(result.row);
  return { item: result.row };
}
