/** @fileoverview Assembles the admin issue list from sheets, detectors, and queue state, and runs the live Stripe issue scan. */
import {
  appendEventLogRows,
  getIssueQueueRows,
  getPracticeNoteLogRows,
  getReviewFlagsRows,
  getTutorPayRows,
  upsertIssueQueueRows,
} from '@/lib/admin/sheets';
import { buildFlagsFreshnessSummary } from './health-helpers.mjs';
import { buildDuplicateMmsIdGroups, buildIdentityMismatchHint, buildIssueRecord, buildPaymentIssueRecord } from './issues-helpers.mjs';
import { buildLessonDurationIssues, buildPaymentIssues, buildPauseIssues, LESSON_DURATION_ISSUE_SOURCE } from './issue-detectors.mjs';
import { buildDisplayIssues, mergeIssuesWithQueueState, prepareIssue } from './issue-queue.js';
import { loadStudentContextCollection } from './student-context';
import { getLiveStripeSnapshot } from './stripe';
import { buildPracticeDeliveryIssues } from './practice-delivery-issues.mjs';
import { parseTutorPay } from './cost-helpers.mjs';
import { buildFinanceCoverage } from './finance-coverage.mjs';
import { buildFinanceCoverageIssues } from './finance-coverage-issues.mjs';

function buildLiveStripeDetail(snapshot) {
  return [
    `subscription_status=${snapshot.subscriptionStatus || '—'}`,
    `pause_state=${snapshot.pauseState || '—'}`,
    `actively_billing=${snapshot.activelyBilling ? 'yes' : 'no'}`,
    `latest_invoice_status=${snapshot.latestInvoiceStatus || '—'}`,
    `attempts=${snapshot.latestInvoiceAttemptCount ?? '—'}`,
    `next_attempt=${snapshot.nextPaymentAttemptAt || '—'}`,
    `decline_code=${snapshot.latestDeclineCode || '—'}`,
    `latest_invoice_amount_remaining=${snapshot.latestInvoiceAmountRemaining ?? '—'}`,
    `latest_invoice_billing_reason=${snapshot.latestInvoiceBillingReason || '—'}`,
    `latest_payment_intent=${snapshot.latestPaymentIntentStatus || '—'}`,
  ].join(', ');
}

function sortIssues(issues = []) {
  return [...issues].sort((a, b) => {
    const statusOrder = { open: 0, acknowledged: 1, ignored: 2, resolved: 3 };
    const severityOrder = { 'Needs action': 0, Warning: 1, Info: 2 };
    const statusDelta = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    const sourcePresentDelta = Number(Boolean(b.sourcePresent)) - Number(Boolean(a.sourcePresent));
    if (sourcePresentDelta !== 0) return sourcePresentDelta;
    const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    return (a.studentName || '').localeCompare(b.studentName || '');
  });
}

async function persistQueueSyncResult(syncResult) {
  await upsertIssueQueueRows(syncResult.queueUpserts);
  await appendEventLogRows(syncResult.eventRows);
}

export { buildLessonDurationIssues, buildPaymentIssues, buildPauseIssues };

export async function scanLiveStripeIssues() {
  const {
    testStudentIds,
    registryByMmsId,
    students,
  } = await loadStudentContextCollection({
    includeSchedule: true,
    excludeTestStudents: true,
  });

  const stripeStudents = students.filter(
    (student) => student.paymentMode === 'stripe' && student.paymentExpectation !== 'setup_pending',
  );
  const scannedAt = new Date().toISOString();
  const issues = [];

  for (const student of stripeStudents) {
    const { snapshot, issues: liveIssues } = await getLiveStripeSnapshot(student);

    for (const type of liveIssues) {
      issues.push(
        buildPaymentIssueRecord({
          type,
          student,
          detail: buildLiveStripeDetail(snapshot),
          stripeSnapshot: snapshot,
        }),
      );
    }
  }

  const queueRows = (await getIssueQueueRows()).filter((row) => !testStudentIds.has(row.mmsId));
  const syncResult = mergeIssuesWithQueueState({
    currentIssues: issues.map(prepareIssue),
    queueRows,
    now: scannedAt,
    managedSources: ['stripe_live'],
  });

  await persistQueueSyncResult(syncResult);

  const displayIssues = buildDisplayIssues({
    currentIssues: syncResult.mergedCurrentIssues,
    queueRows: syncResult.queueRows.filter((row) => row.source === 'stripe_live'),
    sheetByMmsId: new Map(students.map((student) => [student.mmsId, student])),
    registryByMmsId,
  });

  return {
    issues: sortIssues(displayIssues),
    scannedCount: stripeStudents.length,
    scannedAt,
  };
}

export async function getAdminIssues() {
  const [flagRows, queueRows, practiceNoteRows, tutorPayRows, studentContext] = await Promise.all([
    getReviewFlagsRows(),
    getIssueQueueRows(),
    getPracticeNoteLogRows(),
    getTutorPayRows(),
    loadStudentContextCollection({ includeSchedule: true, excludeTestStudents: true }),
  ]);
  const {
    testStudentIds,
    registryEntries: operationalRegistryEntries,
    registryByMmsId,
    students,
  } = studentContext;
  const sheetByMmsId = new Map(students.map((student) => [student.mmsId, student]));

  // Same coverage build as the finance page: sheet students already carry the
  // enriched scheduleContext + lifecycle fields buildFinanceCoverage needs.
  const financeCoverage = buildFinanceCoverage(students, {
    tutorPay: parseTutorPay(tutorPayRows),
  });

  const currentIssues = [
    ...flagRows
      .filter((flag) => !testStudentIds.has(flag.mms_id || ''))
      .map((flag) =>
      buildIssueRecord({
        flag,
        sheetStudent: sheetByMmsId.get(flag.mms_id || '') || null,
        registryEntry: registryByMmsId.get(flag.mms_id || '') || null,
        identityMismatchHint: buildIdentityMismatchHint({
          issueType: flag.flag_type || flag.category || '',
          mmsId: flag.mms_id || '',
          studentName: flag.student_name || '',
          sheetStudents: students,
          registryEntries: operationalRegistryEntries,
        }),
      }),
    )
      .filter((issue) => issue.active),
    ...buildPaymentIssues(students, registryByMmsId),
    ...buildPauseIssues(students, registryByMmsId),
    ...buildLessonDurationIssues(students, registryByMmsId),
    ...buildPracticeDeliveryIssues(practiceNoteRows, {
      testStudentIds,
      sheetByMmsId,
      registryByMmsId,
    }),
    ...buildFinanceCoverageIssues(financeCoverage, { testStudentIds }),
  ];
  const now = new Date().toISOString();
  const syncResult = mergeIssuesWithQueueState({
    currentIssues: currentIssues.map(prepareIssue),
    queueRows: queueRows.filter((row) => !testStudentIds.has(row.mmsId)),
    now,
    managedSources: ['review_flags', 'payment_static', 'practice_delivery', 'finance_coverage', LESSON_DURATION_ISSUE_SOURCE],
  });

  await persistQueueSyncResult(syncResult);

  const issues = sortIssues(buildDisplayIssues({
    currentIssues: syncResult.mergedCurrentIssues,
    queueRows: syncResult.queueRows,
    sheetByMmsId,
    registryByMmsId,
  }));

  return {
    issues,
    freshness: buildFlagsFreshnessSummary(flagRows),
    duplicateMmsIds: buildDuplicateMmsIdGroups(students),
  };
}
