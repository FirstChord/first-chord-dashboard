/** @fileoverview Merges detected issues with stored queue state, prepares rows, and builds status transitions for display. */
import { randomUUID } from 'node:crypto';
import { buildIssueId, buildIssueContextKey, normaliseIssueStatus } from './issue-queue-helpers.mjs';
import { classifyIssue } from './issues-helpers.mjs';

function joinSystems(systems = []) {
  return systems.filter(Boolean).join(', ');
}

function splitSystems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return `${value}`
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasValueChanged(previousValue, nextValue) {
  return `${previousValue || ''}` !== `${nextValue || ''}`;
}

export function normaliseSourcePresent(value) {
  return `${value || ''}`.trim().toLowerCase() === 'true' ? 'true' : 'false';
}

export function isSourcePresent(value) {
  return normaliseSourcePresent(value) === 'true';
}

export function issueSourceMatchesExpected(issueRow, expectedSourcePresent) {
  if (typeof expectedSourcePresent !== 'boolean') return true;
  return isSourcePresent(issueRow?.sourcePresent) === expectedSourcePresent;
}

function buildEventRow({ actorEmail, eventType, issue, previousStatus = '', nextStatus = '', note = '', sourcePresentBefore = '', sourcePresentAfter = '', eventDedupKey = '' }) {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    actorEmail: actorEmail || 'system',
    entityType: 'issue',
    entityId: issue.issueId,
    eventType,
    mmsId: issue.mmsId || '',
    studentName: issue.studentName || '',
    issueId: issue.issueId,
    eventDedupKey,
    payloadJson: JSON.stringify({
      previous_status: previousStatus || '',
      next_status: nextStatus || '',
      note: note || '',
      source_present_before: sourcePresentBefore,
      source_present_after: sourcePresentAfter,
      issue_type: issue.type || '',
      source: issue.source || '',
      context_key: issue.contextKey || '',
    }),
  };
}

function issueDetectedDedupeKey(issue = {}) {
  return `issue:${issue.issueId}:detected`;
}

function issueReopenedDedupeKey(issue = {}, existingRow = {}) {
  // A resolution/reappearance cycle is the unit that matters. The timestamp
  // already stored on the queue row makes retries of the same transition share
  // one key, while a later genuine resolution or disappearance creates a new
  // cycle and remains auditable.
  const cycle = existingRow.resolvedAt || existingRow.lastSeenAt || existingRow.createdAt || issue.issueId;
  return `issue:${issue.issueId}:reopened:${cycle}`;
}

export function prepareIssue(issue = {}) {
  const source = `${issue.source || ''}`.trim().toLowerCase();
  const contextKey = issue.contextKey ?? buildIssueContextKey(issue);
  const issueId = issue.issueId || buildIssueId({
    source,
    issueType: issue.type,
    mmsId: issue.mmsId,
    contextKey,
  });

  return {
    ...issue,
    id: issueId,
    issueId,
    source,
    contextKey,
  };
}

function buildQueueRowFromIssue(issue, now, existingRow = null) {
  const status = normaliseIssueStatus(existingRow?.status || 'open');

  return {
    issueId: issue.issueId,
    source: issue.source,
    issueType: issue.type,
    mmsId: issue.mmsId || '',
    contextKey: issue.contextKey || '',
    studentName: issue.studentName || '',
    severity: issue.severity || 'Info',
    status,
    owner: existingRow?.owner || '',
    createdAt: existingRow?.createdAt || now,
    updatedAt: now,
    resolvedAt: existingRow?.resolvedAt || '',
    ignoredAt: existingRow?.ignoredAt || '',
    acknowledgedAt: existingRow?.acknowledgedAt || '',
    lastSeenAt: now,
    sourcePresent: 'true',
    summary: issue.summary || '',
    detail: issue.detail || '',
    recommendedAction: issue.recommendedAction || '',
    systemsAffected: joinSystems(issue.systemsAffected),
    resolutionNote: existingRow?.resolutionNote || '',
  };
}

function buildIssueFromQueueRow(queueRow, { sheetStudent = null, registryEntry = null } = {}) {
  const classification = classifyIssue(queueRow.issueType || '');

  return {
    id: queueRow.issueId,
    issueId: queueRow.issueId,
    source: queueRow.source || '',
    contextKey: queueRow.contextKey || '',
    type: queueRow.issueType || '',
    mmsId: queueRow.mmsId || '',
    studentName: queueRow.studentName || queueRow.mmsId || '',
    detail: queueRow.detail || '',
    generatedDate: queueRow.lastSeenAt || queueRow.createdAt || '',
    severity: queueRow.severity || classification.severity,
    systemsAffected: splitSystems(queueRow.systemsAffected).length ? splitSystems(queueRow.systemsAffected) : classification.systemsAffected,
    summary: queueRow.summary || classification.summary,
    recommendedAction: queueRow.recommendedAction || classification.recommendedAction,
    actionLabel: classification.actionLabel,
    messageable: classification.messageable,
    hasSheetRow: Boolean(sheetStudent),
    hasRegistryEntry: Boolean(registryEntry),
    sheetTutor: sheetStudent?.tutor || '',
    registryTutor: registryEntry?.tutor || '',
    email: sheetStudent?.email || '',
    paymentMode: sheetStudent?.paymentMode || '',
    stripeCustomerId: sheetStudent?.stripeCustomerId || '',
    stripeSubscriptionId: sheetStudent?.stripeSubscriptionId || '',
    paymentExpectation: sheetStudent?.paymentExpectation || '',
    lifecycleStatus: sheetStudent?.lifecycleStatus || '',
    lifecycleLabel: sheetStudent?.lifecycleLabel || '',
    lifecycleConfidence: sheetStudent?.lifecycleConfidence || '',
    lifecycleReasons: sheetStudent?.lifecycleReasons || [],
    lifecycleWarnings: sheetStudent?.lifecycleWarnings || [],
    paymentValueContext: sheetStudent?.paymentValueContext || null,
    active: isSourcePresent(queueRow.sourcePresent),
    adminStudentPath: queueRow.mmsId ? `/admin/students/${queueRow.mmsId}` : '',
    status: normaliseIssueStatus(queueRow.status),
    sourcePresent: isSourcePresent(queueRow.sourcePresent),
    lastSeenAt: queueRow.lastSeenAt || '',
    createdAt: queueRow.createdAt || '',
    updatedAt: queueRow.updatedAt || '',
    resolutionNote: queueRow.resolutionNote || '',
    reappeared: false,
  };
}

export function buildIssueStateChange({ issueRow, nextStatus, note, actorEmail, now }) {
  const previousStatus = normaliseIssueStatus(issueRow?.status);
  const normalisedNextStatus = normaliseIssueStatus(nextStatus);

  const nextRow = {
    ...issueRow,
    status: normalisedNextStatus,
    updatedAt: now,
    resolutionNote: note ?? issueRow.resolutionNote ?? '',
  };

  if (normalisedNextStatus === 'acknowledged' && !nextRow.acknowledgedAt) {
    nextRow.acknowledgedAt = now;
  }

  if (normalisedNextStatus === 'ignored' && !nextRow.ignoredAt) {
    nextRow.ignoredAt = now;
  }

  if (normalisedNextStatus === 'resolved' && !nextRow.resolvedAt) {
    nextRow.resolvedAt = now;
  }

  const eventType = normalisedNextStatus === 'acknowledged'
    ? 'issue_acknowledged'
    : normalisedNextStatus === 'ignored'
      ? 'issue_ignored'
      : 'issue_resolved';

  return {
    nextRow,
    eventRow: buildEventRow({
      actorEmail,
      eventType,
      issue: {
        issueId: issueRow.issueId,
        mmsId: issueRow.mmsId,
        studentName: issueRow.studentName,
        type: issueRow.issueType,
        source: issueRow.source,
        contextKey: issueRow.contextKey,
      },
      previousStatus,
      nextStatus: normalisedNextStatus,
      note: note ?? '',
      sourcePresentBefore: issueRow.sourcePresent,
      sourcePresentAfter: issueRow.sourcePresent,
    }),
  };
}

export function mergeIssuesWithQueueState({ currentIssues = [], queueRows = [], now, managedSources = [] }) {
  const preparedIssues = currentIssues.map(prepareIssue);
  const queueById = new Map(queueRows.map((row) => [row.issueId, row]));
  const currentById = new Map(preparedIssues.map((issue) => [issue.issueId, issue]));
  const nextQueueById = new Map(queueById);
  const queueUpserts = [];
  const eventRows = [];
  const mergedCurrentIssues = [];

  for (const issue of preparedIssues) {
    const existingRow = queueById.get(issue.issueId) || null;
    let nextRow;
    let reappeared = false;

    if (!existingRow) {
      nextRow = buildQueueRowFromIssue(issue, now);
      queueUpserts.push(nextRow);
      // Detection is an exception worth remembering once. Subsequent healthy
      // dashboard reads only refresh current workflow state; they do not add
      // history rows for the same unresolved issue.
      eventRows.push(buildEventRow({
        actorEmail: 'system',
        eventType: 'issue_detected',
        issue,
        previousStatus: '',
        nextStatus: 'open',
        sourcePresentBefore: '',
        sourcePresentAfter: 'true',
        eventDedupKey: issueDetectedDedupeKey(issue),
      }));
    } else {
      nextRow = { ...existingRow };
      const nextSystemsAffected = joinSystems(issue.systemsAffected);
      const fieldUpdates = {
        source: issue.source,
        issueType: issue.type,
        mmsId: issue.mmsId || '',
        contextKey: issue.contextKey || '',
        studentName: issue.studentName || '',
        severity: issue.severity || nextRow.severity || 'Info',
        summary: issue.summary || '',
        detail: issue.detail || '',
        recommendedAction: issue.recommendedAction || '',
        systemsAffected: nextSystemsAffected,
      };

      let changed = false;
      for (const [key, value] of Object.entries(fieldUpdates)) {
        if (hasValueChanged(nextRow[key], value)) {
          nextRow[key] = value;
          changed = true;
        }
      }

      const previousSourcePresent = normaliseSourcePresent(nextRow.sourcePresent);
      const previousStatus = normaliseIssueStatus(existingRow.status);

      if (previousSourcePresent !== 'true') {
        nextRow.sourcePresent = 'true';
        nextRow.lastSeenAt = now;
        changed = true;
        reappeared = true;
        eventRows.push(buildEventRow({
          actorEmail: 'system',
          eventType: 'issue_reopened',
          issue,
          previousStatus,
          nextStatus: previousStatus === 'resolved' ? 'open' : previousStatus,
          sourcePresentBefore: existingRow.sourcePresent,
          sourcePresentAfter: 'true',
          eventDedupKey: issueReopenedDedupeKey(issue, existingRow),
        }));
      } else if (!nextRow.lastSeenAt) {
        nextRow.lastSeenAt = now;
        changed = true;
      }

      if (previousStatus === 'resolved') {
        nextRow.status = 'open';
        nextRow.resolvedAt = '';
        nextRow.sourcePresent = 'true';
        nextRow.updatedAt = now;
        changed = true;
        reappeared = true;
        if (previousSourcePresent === 'true') {
          eventRows.push(buildEventRow({
            actorEmail: 'system',
            eventType: 'issue_reopened',
            issue,
            previousStatus,
            nextStatus: 'open',
            sourcePresentBefore: existingRow.sourcePresent,
            sourcePresentAfter: 'true',
            eventDedupKey: issueReopenedDedupeKey(issue, existingRow),
          }));
        }
      }

      if (changed) {
        nextRow.updatedAt = now;
        queueUpserts.push(nextRow);
      }
    }

    nextQueueById.set(issue.issueId, nextRow);
    mergedCurrentIssues.push({
      ...issue,
      status: normaliseIssueStatus(nextRow.status),
      sourcePresent: true,
      lastSeenAt: nextRow.lastSeenAt || now,
      createdAt: nextRow.createdAt || now,
      updatedAt: nextRow.updatedAt || now,
      resolutionNote: nextRow.resolutionNote || '',
      reappeared,
    });
  }

  for (const row of queueRows) {
    if (!managedSources.includes(row.source) || currentById.has(row.issueId)) {
      continue;
    }

    if (normaliseSourcePresent(row.sourcePresent) === 'true') {
      const nextRow = {
        ...row,
        sourcePresent: 'false',
        updatedAt: now,
      };
      queueUpserts.push(nextRow);
      nextQueueById.set(row.issueId, nextRow);
    }
  }

  return {
    mergedCurrentIssues,
    queueRows: [...nextQueueById.values()],
    queueUpserts,
    eventRows,
  };
}

export function buildDisplayIssues({ currentIssues = [], queueRows = [], sheetByMmsId = new Map(), registryByMmsId = new Map() }) {
  const currentById = new Map(currentIssues.map((issue) => [issue.issueId, issue]));
  const displayIssues = [...currentIssues];

  for (const queueRow of queueRows) {
    if (currentById.has(queueRow.issueId)) {
      continue;
    }

    displayIssues.push(buildIssueFromQueueRow(queueRow, {
      sheetStudent: sheetByMmsId.get(queueRow.mmsId || '') || null,
      registryEntry: registryByMmsId.get(queueRow.mmsId || '') || null,
    }));
  }

  return displayIssues;
}
