/** @fileoverview Composes redacted student and issue context for AI assistants from the managed-tab readers and issue detectors. */
import {
  getAssistantIssueQueueRows,
  getAssistantPauseHistoryRows,
  getAssistantReviewFlagRows,
  getAssistantScheduleContextRows,
  getAssistantStudentsSheetRows,
  getAssistantWaitingStateRows,
} from './assistant-context-readers.mjs';
import {
  buildRedactedIssueContext,
  buildRedactedStudentContext,
} from './assistant-context-projections.mjs';
import { buildLessonDurationIssues, buildPaymentIssues, buildPauseIssues, LESSON_DURATION_ISSUE_SOURCE } from './issue-detectors.mjs';
import { buildIssueRecord, classifyIssue } from './issues-helpers.mjs';
import { buildStudentContextCollection } from './student-context-helpers.mjs';

const ISSUE_SOURCE_ALLOWLIST = new Set([
  'review_flags',
  'payment_static',
  'practice_delivery',
  'finance_coverage',
  'stripe_live',
]);

function validateMmsId(value) {
  const mmsId = `${value || ''}`.trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(mmsId)) {
    throw new TypeError('A valid exact MMS student ID is required');
  }
  return mmsId;
}

function validateIssueSource(value) {
  const source = `${value || ''}`.trim().toLowerCase();
  if (!ISSUE_SOURCE_ALLOWLIST.has(source)) {
    throw new TypeError('Issue source is not allowlisted');
  }
  return source;
}

function validateIssueType(value) {
  const issueType = `${value || ''}`.trim().toUpperCase();
  if (!issueType || issueType.length > 120 || !/^[A-Z0-9 _-]+$/.test(issueType)) {
    throw new TypeError('A valid exact issue type is required');
  }
  return issueType;
}

async function defaultRegistryReader() {
  const { getRegistryEntries } = await import('./registry.js');
  return getRegistryEntries();
}

function resultRows(result) {
  return result?.available ? result.rows : [];
}

function availabilityOf(result) {
  return {
    available: Boolean(result?.available),
    reason: result?.available ? '' : result?.reason || 'unavailable',
  };
}

function issueFromReviewFlag({ flag, student, registryEntry }) {
  if (!flag) return null;
  return buildIssueRecord({
    flag,
    sheetStudent: student,
    registryEntry,
    identityMismatchHint: null,
  });
}

function findCurrentIssue({ source, issueType, mmsId, student, registryEntry, registryByMmsId, flagRows }) {
  if (source === 'payment_static') {
    if (!student) return null;
    return [
      ...buildPaymentIssues([student], registryByMmsId),
      ...buildPauseIssues([student], registryByMmsId),
    ].find((issue) => `${issue.type || ''}`.trim().toUpperCase() === issueType) || null;
  }

  if (source === LESSON_DURATION_ISSUE_SOURCE) {
    if (!student) return null;
    return buildLessonDurationIssues([student], registryByMmsId)
      .find((issue) => `${issue.type || ''}`.trim().toUpperCase() === issueType) || null;
  }

  if (source === 'review_flags') {
    const flag = flagRows.find((row) => {
      const rowMmsId = `${row.mms_id || row['MMS ID'] || row.student_mms_id || ''}`.trim();
      const rowType = `${row.flag_type || row.category || row.Category || ''}`.trim().toUpperCase();
      return rowMmsId === mmsId && rowType === issueType;
    });
    return issueFromReviewFlag({
      flag,
      student,
      registryEntry,
    });
  }

  return null;
}

export function createAssistantContextService(overrides = {}) {
  const readers = {
    getStudents: getAssistantStudentsSheetRows,
    getRegistry: defaultRegistryReader,
    getFlags: getAssistantReviewFlagRows,
    getPauses: getAssistantPauseHistoryRows,
    getWaiting: getAssistantWaitingStateRows,
    getSchedule: getAssistantScheduleContextRows,
    getQueue: getAssistantIssueQueueRows,
    ...overrides,
  };

  async function loadContext({ mmsId, currentDate, includeQueue = false }) {
    const [rawSheetRows, registryEntries, flagRows, pauseHistoryRows, waiting, schedule, queue] = await Promise.all([
      readers.getStudents(),
      readers.getRegistry(),
      readers.getFlags(),
      readers.getPauses(),
      readers.getWaiting(),
      readers.getSchedule(),
      includeQueue
        ? readers.getQueue()
        : Promise.resolve({ available: false, reason: 'not_requested', rows: [] }),
    ]);

    const collection = buildStudentContextCollection({
      rawSheetRows,
      registryEntries,
      flagRows,
      pauseHistoryRows,
      waitingRows: resultRows(waiting),
      scheduleRows: schedule?.available ? schedule.rows : null,
      excludeTestStudents: true,
      currentDate,
    });

    return {
      student: collection.students.find((entry) => entry.mmsId === mmsId) || null,
      registryByMmsId: collection.registryByMmsId,
      flagRows,
      queueRows: resultRows(queue),
      availability: {
        waitingState: availabilityOf(waiting),
        scheduleContext: availabilityOf(schedule),
        issueQueue: availabilityOf(queue),
      },
    };
  }

  return {
    async getStudentContext({ mmsId: rawMmsId, currentDate = new Date(), generatedAt } = {}) {
      const mmsId = validateMmsId(rawMmsId);
      const loaded = await loadContext({ mmsId, currentDate });
      return {
        found: Boolean(loaded.student),
        context: loaded.student
          ? buildRedactedStudentContext(loaded.student, { generatedAt })
          : null,
        availability: loaded.availability,
      };
    },

    async getIssueContext({
      mmsId: rawMmsId,
      source: rawSource,
      issueType: rawIssueType,
      currentDate = new Date(),
      generatedAt,
    } = {}) {
      const mmsId = validateMmsId(rawMmsId);
      const source = validateIssueSource(rawSource);
      const issueType = validateIssueType(rawIssueType);
      const loaded = await loadContext({ mmsId, currentDate, includeQueue: true });
      const registryEntry = loaded.registryByMmsId.get(mmsId) || null;
      // A REGISTRY ONLY issue has no Students row by definition. Permit that
      // exact, non-test registry subject, but do not expose arbitrary queue-only
      // identifiers that are absent from both canonical student stores.
      if (!loaded.student && !registryEntry) {
        return { found: false, context: null, availability: loaded.availability };
      }

      const queueRow = loaded.queueRows.find((row) => (
        row.mmsId === mmsId
        && `${row.source || ''}`.trim().toLowerCase() === source
        && `${row.issueType || ''}`.trim().toUpperCase() === issueType
      )) || null;
      const detectorEvaluated = source === 'review_flags' || source === 'payment_static';
      const currentIssue = findCurrentIssue({
        source,
        issueType,
        mmsId,
        student: loaded.student,
        registryEntry,
        registryByMmsId: loaded.registryByMmsId,
        flagRows: loaded.flagRows,
      });
      const fixedIssueCopy = classifyIssue(issueType);
      const issue = currentIssue || {
        source,
        type: issueType,
        severity: fixedIssueCopy.severity || queueRow?.severity || '',
        systemsAffected: fixedIssueCopy.systemsAffected || [],
        summary: fixedIssueCopy.summary || '',
        recommendedAction: fixedIssueCopy.recommendedAction || '',
        active: detectorEvaluated ? false : undefined,
      };

      return {
        found: Boolean(queueRow || currentIssue),
        context: buildRedactedIssueContext({
          issue,
          queueRow,
          studentContext: loaded.student,
          detectorEvaluated,
          generatedAt,
        }),
        availability: loaded.availability,
      };
    },
  };
}

export const assistantContextService = createAssistantContextService();
