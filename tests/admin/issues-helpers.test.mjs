import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDuplicateMmsIdGroups,
  buildIdentityMismatchHint,
  buildIssueRecord,
  buildPaymentIssueRecord,
  classifyIssue,
  isIssueActive,
} from '../../lib/admin/issues-helpers.mjs';

test('buildDuplicateMmsIdGroups flags an MMS ID shared by two students', () => {
  const groups = buildDuplicateMmsIdGroups([
    { mmsId: 'sdt_QP01Jp', fullName: 'Yarah Love' },
    { mmsId: 'sdt_QP01Jp', fullName: 'Elliot N/A' },
    { mmsId: 'sdt_yLBVJQ', fullName: 'Elliot' },
    { mmsId: 'sdt_unique', fullName: 'Solo Student' },
    { mmsId: '', fullName: 'No Id' },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].mmsId, 'sdt_QP01Jp');
  assert.deepEqual(groups[0].students, ['Yarah Love', 'Elliot N/A']);
});

test('buildDuplicateMmsIdGroups returns nothing when all MMS IDs are unique', () => {
  const groups = buildDuplicateMmsIdGroups([
    { mmsId: 'sdt_a', fullName: 'A' },
    { mmsId: 'sdt_b', fullName: 'B' },
  ]);
  assert.deepEqual(groups, []);
});

test('classifyIssue maps current review flag types into actionable admin metadata', () => {
  assert.deepEqual(classifyIssue('TUTOR CONFLICT').severity, 'Needs action');
  assert.deepEqual(classifyIssue('SHEETS ONLY').systemsAffected, ['Sheets']);
  assert.deepEqual(classifyIssue('REGISTRY ONLY').systemsAffected, ['Registry']);
  assert.deepEqual(classifyIssue('PAYMENT SETUP PENDING').severity, 'Warning');
  assert.deepEqual(classifyIssue('FC ID CONFLICT').systemsAffected, ['Registry', 'Sheets']);
  assert.deepEqual(classifyIssue('FC ID DUPLICATE').severity, 'Needs action');
  assert.notEqual(classifyIssue('FC ID MALFORMED').summary, 'Unclassified issue');
  assert.deepEqual(classifyIssue('SETUP PENDING STRIPE LINKED').summary, 'Stripe linkage exists but payment expectation is still setup pending');
  assert.deepEqual(classifyIssue('STRIPE SUBSCRIPTION MISSING').systemsAffected, ['Sheets', 'Stripe']);
  assert.deepEqual(classifyIssue('PAYMENT_FAILED').severity, 'Needs action');
  assert.deepEqual(classifyIssue('SUBSCRIPTION_STATE_MISMATCH').systemsAffected, ['Sheets', 'Stripe']);
  assert.deepEqual(classifyIssue('PAUSE EXPECTATION MISMATCH').systemsAffected, ['Sheets', 'Pause', 'Stripe']);
  assert.deepEqual(classifyIssue('PAUSE EXPECTATION STALE').severity, 'Warning');
  assert.deepEqual(classifyIssue('FINANCE DATA GAP').severity, 'Warning');
  assert.deepEqual(classifyIssue('FINANCE DATA GAP').systemsAffected, ['Finance']);
  assert.equal(classifyIssue('FINANCE DATA GAP').messageable, false);
});

test('buildIssueRecord enriches live review flag rows with linked-system state', () => {
  const issue = buildIssueRecord({
    flag: {
      flag_type: 'TUTOR CONFLICT',
      mms_id: 'sdt_test',
      student_name: 'Test Studenty',
      detail: 'registry=Arion vs sheets=Fennella McCallum',
      generated_date: '2026-04-16',
    },
    sheetStudent: {
      mmsId: 'sdt_test',
      tutor: 'Fennella McCallum',
    },
    registryEntry: {
      mmsId: 'sdt_test',
      tutor: 'Arion',
    },
  });

  assert.equal(issue.severity, 'Needs action');
  assert.equal(issue.source, 'review_flags');
  assert.equal(issue.contextKey, 'registry_vs_sheets');
  assert.equal(issue.issueId, 'review_flags:TUTOR_CONFLICT:sdt_test:registry_vs_sheets');
  assert.equal(issue.hasSheetRow, true);
  assert.equal(issue.hasRegistryEntry, true);
  assert.equal(issue.sheetTutor, 'Fennella McCallum');
  assert.equal(issue.registryTutor, 'Arion');
  assert.equal(issue.adminStudentPath, '/admin/students/sdt_test');
});

test('isIssueActive returns false once a tutor conflict is resolved', () => {
  const active = isIssueActive({
    flagType: 'TUTOR CONFLICT',
    sheetStudent: { tutor: 'Arion Xenos' },
    registryEntry: { tutor: 'Arion' },
  });

  assert.equal(active, false);
});

test('isIssueActive returns false once a sheets-only issue gains a registry entry', () => {
  const active = isIssueActive({
    flagType: 'SHEETS ONLY',
    sheetStudent: { tutor: 'Arion Xenos' },
    registryEntry: { tutor: 'Arion' },
  });

  assert.equal(active, false);
});

test('buildIdentityMismatchHint finds registry matches for sheets-only issues', () => {
  const hint = buildIdentityMismatchHint({
    issueType: 'SHEETS ONLY',
    mmsId: 'sdt_sheet',
    studentName: 'Tabitha Slocombe',
    registryEntries: [{
      mmsId: 'sdt_registry',
      firstName: 'Tabitha',
      lastName: 'Slocombe',
      tutor: 'Chloe',
    }],
  });

  assert.equal(hint.system, 'Registry');
  assert.equal(hint.mmsId, 'sdt_registry');
  assert.match(hint.description, /Possible same-name match/);
});

test('buildIdentityMismatchHint finds sheet matches for registry-only issues', () => {
  const hint = buildIdentityMismatchHint({
    issueType: 'REGISTRY ONLY',
    mmsId: 'sdt_registry',
    studentName: 'Tabitha Slocombe',
    sheetStudents: [{
      mmsId: 'sdt_sheet',
      fullName: 'Tabitha Slocombe',
      tutor: 'Stef McGlinchey',
    }],
  });

  assert.equal(hint.system, 'Sheets');
  assert.equal(hint.mmsId, 'sdt_sheet');
  assert.equal(hint.tutor, 'Stef McGlinchey');
});

test('buildPaymentIssueRecord creates a Stripe issue with current payment linkage state', () => {
  const issue = buildPaymentIssueRecord({
    type: 'STRIPE SUBSCRIPTION MISSING',
    student: {
      mmsId: 'sdt_test',
      fullName: 'Owen Example',
      tutor: 'Chloe Mak',
      registryTutor: 'Chloe',
      paymentMode: 'stripe',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: '',
      registryEntry: { mmsId: 'sdt_test' },
      lifecycleStatus: 'active',
      lifecycleLabel: 'Active',
      lifecycleConfidence: 'medium',
      lifecycleReasons: ['Payment expectation is stripe_active_expected.'],
      lifecycleWarnings: ['Stripe linkage is incomplete for an active-expected student.'],
      paymentValueContext: {
        baselineWeeklyLabel: '£25',
        baselineMonthlyLabel: '£108.33',
      },
    },
  });

  assert.equal(issue.type, 'STRIPE SUBSCRIPTION MISSING');
  assert.equal(issue.source, 'payment_static');
  assert.equal(issue.paymentMode, 'stripe');
  assert.equal(issue.stripeCustomerId, 'cus_123');
  assert.equal(issue.stripeSubscriptionId, '');
  assert.equal(issue.lifecycleStatus, 'active');
  assert.equal(issue.lifecycleLabel, 'Active');
  assert.deepEqual(issue.lifecycleWarnings, ['Stripe linkage is incomplete for an active-expected student.']);
  assert.equal(issue.paymentValueContext.baselineWeeklyLabel, '£25');
  assert.equal(issue.adminStudentPath, '/admin/students/sdt_test');
});

test('buildPaymentIssueRecord describes stale setup state when Stripe linkage exists', () => {
  const issue = buildPaymentIssueRecord({
    type: 'SETUP PENDING STRIPE LINKED',
    student: {
      mmsId: 'sdt_setup',
      fullName: 'Charlie Example',
      tutor: 'Tom Walters',
      registryTutor: 'Tom',
      paymentMode: 'stripe',
      paymentExpectation: 'setup_pending',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      registryEntry: { mmsId: 'sdt_setup' },
    },
  });

  assert.equal(issue.type, 'SETUP PENDING STRIPE LINKED');
  assert.equal(issue.source, 'payment_static');
  assert.equal(issue.summary, 'Stripe linkage exists but payment expectation is still setup pending');
  assert.match(issue.paymentReason, /both Stripe customer and subscription IDs/);
});
