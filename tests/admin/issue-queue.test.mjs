import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDisplayIssues,
  buildIssueStateChange,
  issueSourceMatchesExpected,
  mergeIssuesWithQueueState,
  prepareIssue,
} from '../../lib/admin/issue-queue.js';

test('mergeIssuesWithQueueState creates queue rows for newly detected issues', () => {
  const now = '2026-05-05T10:00:00.000Z';
  const currentIssues = [prepareIssue({
    source: 'payment_static',
    type: 'STRIPE SUBSCRIPTION MISSING',
    mmsId: 'sdt_123',
    studentName: 'Owen Example',
    severity: 'Warning',
    systemsAffected: ['Sheets', 'Stripe'],
    summary: 'Subscription missing',
    recommendedAction: 'Fix it',
  })];

  const result = mergeIssuesWithQueueState({
    currentIssues,
    queueRows: [],
    now,
    managedSources: ['payment_static'],
  });

  assert.equal(result.mergedCurrentIssues[0].status, 'open');
  assert.equal(result.mergedCurrentIssues[0].sourcePresent, true);
  assert.equal(result.queueUpserts.length, 1);
  assert.equal(result.queueUpserts[0].issueId, 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123');
  assert.equal(result.eventRows.length, 1);
  assert.equal(result.eventRows[0].eventType, 'issue_detected');
  assert.equal(result.eventRows[0].eventDedupKey, 'issue:payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123:detected');
});

test('mergeIssuesWithQueueState marks previously missing issues as reappeared', () => {
  const now = '2026-05-05T10:00:00.000Z';
  const currentIssues = [prepareIssue({
    source: 'review_flags',
    type: 'TUTOR CONFLICT',
    mmsId: 'sdt_123',
    studentName: 'Owen Example',
    severity: 'Needs action',
    systemsAffected: ['Sheets', 'Registry'],
    summary: 'Tutor mismatch',
    recommendedAction: 'Fix it',
  })];
  const queueRows = [{
    issueId: 'review_flags:TUTOR_CONFLICT:sdt_123:registry_vs_sheets',
    source: 'review_flags',
    issueType: 'TUTOR CONFLICT',
    mmsId: 'sdt_123',
    contextKey: 'registry_vs_sheets',
    studentName: 'Owen Example',
    severity: 'Needs action',
    status: 'resolved',
    owner: '',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z',
    resolvedAt: '2026-05-02T10:00:00.000Z',
    ignoredAt: '',
    acknowledgedAt: '',
    lastSeenAt: '2026-05-01T10:00:00.000Z',
    sourcePresent: 'false',
    summary: 'Tutor mismatch',
    detail: '',
    recommendedAction: 'Fix it',
    systemsAffected: 'Sheets, Registry',
    resolutionNote: '',
  }];

  const result = mergeIssuesWithQueueState({
    currentIssues,
    queueRows,
    now,
    managedSources: ['review_flags'],
  });

  assert.equal(result.mergedCurrentIssues[0].reappeared, true);
  assert.equal(result.queueUpserts[0].sourcePresent, 'true');
  assert.equal(result.eventRows[0].eventType, 'issue_reopened');
  assert.equal(result.eventRows[0].eventDedupKey, 'issue:review_flags:TUTOR_CONFLICT:sdt_123:registry_vs_sheets:reopened:2026-05-02T10:00:00.000Z');
});

test('mergeIssuesWithQueueState flips missing managed issues to source_present false', () => {
  const now = '2026-05-05T10:00:00.000Z';
  const queueRows = [{
    issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
    source: 'payment_static',
    issueType: 'STRIPE SUBSCRIPTION MISSING',
    mmsId: 'sdt_123',
    contextKey: '',
    studentName: 'Owen Example',
    severity: 'Warning',
    status: 'open',
    owner: '',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z',
    resolvedAt: '',
    ignoredAt: '',
    acknowledgedAt: '',
    lastSeenAt: '2026-05-01T10:00:00.000Z',
    sourcePresent: 'true',
    summary: 'Subscription missing',
    detail: '',
    recommendedAction: 'Fix it',
    systemsAffected: 'Sheets, Stripe',
    resolutionNote: '',
  }];

  const result = mergeIssuesWithQueueState({
    currentIssues: [],
    queueRows,
    now,
    managedSources: ['payment_static'],
  });

  assert.equal(result.queueUpserts[0].sourcePresent, 'false');
});

test('mergeIssuesWithQueueState reopens resolved issues that are still currently detected', () => {
  const now = '2026-06-03T19:20:00.000Z';
  const currentIssues = [prepareIssue({
    source: 'stripe_live',
    type: 'PAYMENT_FAILED',
    mmsId: 'sdt_BDHJJF',
    contextKey: 'sub_123',
    studentName: 'Claire Example',
    severity: 'Needs action',
    systemsAffected: ['Stripe'],
    summary: 'Payment failed',
    detail: 'latest_invoice_status=void',
    recommendedAction: 'Review payment failure',
  })];
  const queueRows = [{
    issueId: 'stripe_live:PAYMENT_FAILED:sdt_BDHJJF:sub_123',
    source: 'stripe_live',
    issueType: 'PAYMENT_FAILED',
    mmsId: 'sdt_BDHJJF',
    contextKey: 'sub_123',
    studentName: 'Claire Example',
    severity: 'Needs action',
    status: 'resolved',
    owner: '',
    createdAt: '2026-06-03T19:02:00.000Z',
    updatedAt: '2026-06-03T19:07:00.000Z',
    resolvedAt: '2026-06-03T19:07:00.000Z',
    ignoredAt: '',
    acknowledgedAt: '',
    lastSeenAt: '2026-06-03T19:02:00.000Z',
    sourcePresent: 'TRUE',
    summary: 'Payment failed',
    detail: 'latest_invoice_status=void',
    recommendedAction: 'Review payment failure',
    systemsAffected: 'Stripe',
    resolutionNote: 'System-cleared issue bulk resolved from dashboard.',
  }];

  const result = mergeIssuesWithQueueState({
    currentIssues,
    queueRows,
    now,
    managedSources: ['stripe_live'],
  });

  assert.equal(result.mergedCurrentIssues[0].status, 'open');
  assert.equal(result.mergedCurrentIssues[0].reappeared, true);
  assert.equal(result.queueUpserts[0].status, 'open');
  assert.equal(result.queueUpserts[0].resolvedAt, '');
  assert.equal(result.queueUpserts[0].sourcePresent, 'true');
  assert.equal(result.eventRows[0].eventType, 'issue_reopened');
  assert.equal(result.eventRows[0].eventDedupKey, 'issue:stripe_live:PAYMENT_FAILED:sdt_BDHJJF:sub_123:reopened:2026-06-03T19:07:00.000Z');
});

test('mergeIssuesWithQueueState does not write another event while a normal open issue remains detected', () => {
  const now = '2026-06-03T19:20:00.000Z';
  const currentIssues = [prepareIssue({
    source: 'payment_static',
    type: 'STRIPE SUBSCRIPTION MISSING',
    mmsId: 'sdt_123',
    studentName: 'Owen Example',
    severity: 'Warning',
    systemsAffected: ['Sheets', 'Stripe'],
    summary: 'Subscription missing',
    recommendedAction: 'Fix it',
  })];
  const queueRows = [{
    issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
    source: 'payment_static', issueType: 'STRIPE SUBSCRIPTION MISSING', mmsId: 'sdt_123', contextKey: '',
    studentName: 'Owen Example', severity: 'Warning', status: 'open', owner: '',
    createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-02T10:00:00.000Z', resolvedAt: '', ignoredAt: '', acknowledgedAt: '',
    lastSeenAt: '2026-06-01T10:00:00.000Z', sourcePresent: 'true', summary: 'Subscription missing', detail: '',
    recommendedAction: 'Fix it', systemsAffected: 'Sheets, Stripe', resolutionNote: '',
  }];

  const result = mergeIssuesWithQueueState({ currentIssues, queueRows, now, managedSources: ['payment_static'] });

  assert.equal(result.eventRows.length, 0);
});

test('mergeIssuesWithQueueState treats uppercase TRUE as source-present when marking missing issues cleared', () => {
  const now = '2026-06-03T19:20:00.000Z';
  const queueRows = [{
    issueId: 'stripe_live:PAYMENT_FAILED:sdt_BDHJJF:sub_123',
    source: 'stripe_live',
    issueType: 'PAYMENT_FAILED',
    mmsId: 'sdt_BDHJJF',
    contextKey: 'sub_123',
    studentName: 'Claire Example',
    severity: 'Needs action',
    status: 'open',
    owner: '',
    createdAt: '2026-06-03T19:02:00.000Z',
    updatedAt: '2026-06-03T19:07:00.000Z',
    resolvedAt: '',
    ignoredAt: '',
    acknowledgedAt: '',
    lastSeenAt: '2026-06-03T19:02:00.000Z',
    sourcePresent: 'TRUE',
    summary: 'Payment failed',
    detail: 'latest_invoice_status=void',
    recommendedAction: 'Review payment failure',
    systemsAffected: 'Stripe',
    resolutionNote: '',
  }];

  const result = mergeIssuesWithQueueState({
    currentIssues: [],
    queueRows,
    now,
    managedSources: ['stripe_live'],
  });

  assert.equal(result.queueUpserts[0].sourcePresent, 'false');
});

test('buildIssueStateChange logs previous and next state while keeping issue metadata', () => {
  const { nextRow, eventRow } = buildIssueStateChange({
    issueRow: {
      issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
      source: 'payment_static',
      issueType: 'STRIPE SUBSCRIPTION MISSING',
      mmsId: 'sdt_123',
      contextKey: '',
      studentName: 'Owen Example',
      status: 'open',
      sourcePresent: 'true',
      resolutionNote: '',
    },
    nextStatus: 'ignored',
    note: 'Handled offline',
    actorEmail: 'admin@example.com',
    now: '2026-05-05T10:00:00.000Z',
  });

  assert.equal(nextRow.status, 'ignored');
  assert.equal(nextRow.resolutionNote, 'Handled offline');
  assert.equal(eventRow.eventType, 'issue_ignored');
  assert.match(eventRow.payloadJson, /previous_status/);
});

test('detective source expectation fails closed when a case changed after review', () => {
  assert.equal(issueSourceMatchesExpected({ sourcePresent: 'false' }, false), true);
  assert.equal(issueSourceMatchesExpected({ sourcePresent: 'true' }, false), false);
  assert.equal(issueSourceMatchesExpected({ sourcePresent: 'true' }, undefined), true);
});

test('buildDisplayIssues includes persisted queue rows that are no longer currently detected', () => {
  const issues = buildDisplayIssues({
    currentIssues: [],
    queueRows: [{
      issueId: 'review_flags:TUTOR_CONFLICT:sdt_123:registry_vs_sheets',
      source: 'review_flags',
      issueType: 'TUTOR CONFLICT',
      mmsId: 'sdt_123',
      contextKey: 'registry_vs_sheets',
      studentName: 'Owen Example',
      severity: 'Needs action',
      status: 'acknowledged',
      owner: '',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-02T10:00:00.000Z',
      resolvedAt: '',
      ignoredAt: '',
      acknowledgedAt: '2026-05-02T10:00:00.000Z',
      lastSeenAt: '2026-05-01T10:00:00.000Z',
      sourcePresent: 'false',
      summary: 'Tutor mismatch',
      detail: 'Old detail',
      recommendedAction: 'Fix it',
      systemsAffected: 'Sheets, Registry',
      resolutionNote: 'Reviewed',
    }],
    sheetByMmsId: new Map([['sdt_123', { tutor: 'Fennella McCallum', paymentMode: 'stripe', paymentExpectation: 'stripe_active_expected', stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' }]]),
    registryByMmsId: new Map([['sdt_123', { tutor: 'Arion' }]]),
  });

  assert.equal(issues[0].status, 'acknowledged');
  assert.equal(issues[0].sourcePresent, false);
  assert.equal(issues[0].sheetTutor, 'Fennella McCallum');
});

test('buildDisplayIssues treats uppercase TRUE as source-present for persisted rows', () => {
  const issues = buildDisplayIssues({
    currentIssues: [],
    queueRows: [{
      issueId: 'review_flags:TUTOR_CONFLICT:sdt_123:registry_vs_sheets',
      source: 'review_flags',
      issueType: 'TUTOR CONFLICT',
      mmsId: 'sdt_123',
      contextKey: 'registry_vs_sheets',
      studentName: 'Owen Example',
      severity: 'Needs action',
      status: 'open',
      owner: '',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-02T10:00:00.000Z',
      resolvedAt: '',
      ignoredAt: '',
      acknowledgedAt: '',
      lastSeenAt: '2026-05-01T10:00:00.000Z',
      sourcePresent: 'TRUE',
      summary: 'Tutor mismatch',
      detail: 'Current detail',
      recommendedAction: 'Fix it',
      systemsAffected: 'Sheets, Registry',
      resolutionNote: '',
    }],
    sheetByMmsId: new Map(),
    registryByMmsId: new Map(),
  });

  assert.equal(issues[0].sourcePresent, true);
  assert.equal(issues[0].active, true);
});
