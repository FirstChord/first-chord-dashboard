import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLessonDurationIssues, buildPaymentIssues, buildPauseIssues } from '../../lib/admin/issue-detectors.mjs';

function student(overrides = {}) {
  return {
    mmsId: 'sdt_issue',
    fullName: 'Issue Example',
    paymentMode: 'stripe',
    paymentExpectation: 'stripe_active_expected',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    ...overrides,
  };
}

test('static payment detector preserves setup and missing-linkage branches', () => {
  const types = buildPaymentIssues([
    student({ mmsId: 'both_missing', stripeCustomerId: '', stripeSubscriptionId: '' }),
    student({ mmsId: 'customer_missing', stripeCustomerId: '' }),
    student({ mmsId: 'subscription_missing', stripeSubscriptionId: '' }),
    student({ mmsId: 'setup_linked', paymentExpectation: 'setup_pending' }),
    student({ mmsId: 'setup_unlinked', paymentExpectation: 'setup_pending', stripeCustomerId: '', stripeSubscriptionId: '' }),
  ]).map((issue) => issue.type);

  assert.deepEqual(types, [
    'STRIPE SETUP INCOMPLETE',
    'STRIPE CUSTOMER MISSING',
    'STRIPE SUBSCRIPTION MISSING',
    'SETUP PENDING STRIPE LINKED',
  ]);
});

test('pause detector ignores low-confidence and upcoming pauses', () => {
  const issues = buildPauseIssues([
    student({
      mmsId: 'low',
      pauseSummary: { hasPauseHistory: true, currentlyPaused: true, matchConfidence: 'low' },
    }),
    student({
      mmsId: 'upcoming',
      paymentExpectation: 'stripe_paused_expected',
      pauseSummary: { hasPauseHistory: true, upcomingPause: true, matchConfidence: 'high' },
    }),
  ]);
  assert.deepEqual(issues, []);
});

test('pause detector emits only when the deterministic decision requires review', () => {
  const [issue] = buildPauseIssues([student({
    pauseSummary: { hasPauseHistory: true, currentlyPaused: true, matchConfidence: 'high' },
    pauseExpectationDecision: {
      shouldCreateIssue: true,
      expectedPaymentExpectation: 'stripe_paused_expected',
    },
  })]);
  assert.equal(issue.type, 'PAUSE EXPECTATION MISMATCH');
});

const BILLING_PROFILE_WARNING =
  'Billing profile lesson duration does not match the next calendar event duration.';

function durationStudent(overrides = {}) {
  const { scheduleContext, ...rest } = overrides;
  return {
    mmsId: 'sdt_duration',
    fullName: 'Duration Example',
    lifecycleStatus: 'active',
    instrument: 'Guitar',
    lessonLength: '30',
    scheduleContext: {
      status: 'found',
      durationMinutes: '45',
      warnings: [],
      ...scheduleContext,
    },
    ...rest,
  };
}

test('lesson duration detector fires when the sheet and the MMS calendar disagree', () => {
  const [issue, ...rest] = buildLessonDurationIssues([durationStudent()]);

  assert.equal(rest.length, 0);
  assert.equal(issue.type, 'LESSON DURATION MISMATCH');
  assert.equal(issue.source, 'lesson_duration');
  // Keyed on the student alone, so a changing mix of disagreements updates the
  // same card instead of spawning one per combination.
  assert.equal(issue.contextKey, 'sdt_duration');
  assert.deepEqual(issue.lessonDuration, {
    mmsMinutes: 45,
    sheetMinutes: 30,
    sheetDisagrees: true,
    billingProfileDisagrees: false,
    pricedApart: true,
  });
  // The money is quoted from the live price table, and MMS is named as the side
  // the forecast actually uses.
  assert.match(issue.detail, /The MMS calendar books 45 minutes; the Students sheet says 30\./u);
  assert.match(issue.detail, /forecast prices from MMS at £33 a week; on the sheet duration it would be £25\./u);
});

test('lesson duration detector stays quiet when nothing disagrees', () => {
  assert.deepEqual(buildLessonDurationIssues([durationStudent({ lessonLength: '45' })]), []);
});

test('lesson duration detector says so when a disagreement costs nothing', () => {
  // 20 and 25 minutes are both off the price table, so neither prices — the
  // durations differ but the forecast does not move.
  const [issue] = buildLessonDurationIssues([
    durationStudent({ lessonLength: '20', scheduleContext: { durationMinutes: '25' } }),
  ]);

  assert.equal(issue.lessonDuration.pricedApart, false);
  assert.match(issue.detail, /Both durations price the same, so the forecast is unaffected\./u);
});

test('lesson duration detector catches an MMS billing profile that disagrees with its own calendar', () => {
  // Florence Bartlett's shape: sheet and calendar agree at 45, the MMS billing
  // profile still says 30 — invisible until something compares them.
  const [issue] = buildLessonDurationIssues([
    durationStudent({
      lessonLength: '45',
      scheduleContext: { durationMinutes: '45', warnings: [BILLING_PROFILE_WARNING] },
    }),
  ]);

  assert.equal(issue.lessonDuration.sheetDisagrees, false);
  assert.equal(issue.lessonDuration.billingProfileDisagrees, true);
  assert.match(issue.detail, /MMS itself would invoice the wrong length\./u);
});

test('lesson duration detector ignores students it cannot or should not price', () => {
  assert.deepEqual(buildLessonDurationIssues([
    // Left the school: a stale duration is history, not a task.
    durationStudent({ mmsId: 'sdt_left', lifecycleStatus: 'inactive' }),
    // No cached MMS lesson: nothing to disagree with. That gap is finance
    // coverage's concern, not a mismatch.
    durationStudent({ mmsId: 'sdt_nosched', scheduleContext: { status: 'not_found' } }),
    // A blank sheet cell is missing, not contradictory.
    durationStudent({ mmsId: 'sdt_blank', lessonLength: '' }),
    // Test rows never reach the queue.
    durationStudent({ mmsId: 'sdt_test', isTestStudent: true }),
  ]), []);
});
