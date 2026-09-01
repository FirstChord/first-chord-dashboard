import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSetupIssue,
  isRecordIssue,
  isPaymentIssue,
  isPauseIssue,
  needsLiveStripeReview,
  shouldRefreshStripeFirst,
  issueMatchesView,
  paymentQuickActionResolvesIssue,
  getPaymentQuickActions,
  getPrimaryPaymentQuickAction,
  getIssueCategoryLabel,
  getIssueShortLabel,
  getStudentLabel,
  getIssueStory,
  getIssueWhatToDo,
  getIssueWorkBucket,
  getDetectiveResolution,
  summariseStripeSnapshot,
} from '../../lib/admin/issues-client-helpers.mjs';

test('work buckets reserve the default queue for current exceptional cases', () => {
  const active = { status: 'open', sourcePresent: true };
  assert.equal(getIssueWorkBucket({ ...active, type: 'PAYMENT_FAILED' }), 'needs_you');
  assert.equal(getIssueWorkBucket({ ...active, type: 'PAYMENT_RETRYING' }), 'waiting');
  assert.equal(getIssueWorkBucket({ ...active, type: 'SHEETS ONLY' }), 'data_health');
  assert.equal(getIssueWorkBucket({ ...active, type: 'FINANCE DATA GAP' }), 'data_health');
  assert.equal(getIssueWorkBucket({ ...active, type: 'TUTOR CONFLICT' }), 'needs_you');
  assert.equal(getIssueWorkBucket({ ...active, type: 'PAYMENT_FAILED', sourcePresent: false }), 'history');
  assert.equal(getIssueWorkBucket({ ...active, type: 'PAYMENT_FAILED', status: 'resolved' }), 'history');
});

test('issue classification predicates bucket types correctly', () => {
  assert.equal(isSetupIssue({ type: 'STRIPE CUSTOMER MISSING' }), true);
  assert.equal(isSetupIssue({ type: 'PAYMENT_FAILED' }), false);
  assert.equal(isRecordIssue({ type: 'TUTOR CONFLICT' }), true);
  assert.equal(isPaymentIssue({ type: 'PAYMENT_FAILED' }), true);
  assert.equal(isPaymentIssue({ type: 'SHEETS ONLY' }), false);
  assert.equal(isPauseIssue({ type: 'PAUSE EXPECTATION STALE' }), true);
  assert.equal(needsLiveStripeReview({ type: 'INACTIVE_STILL_BILLING' }), true);
  assert.equal(needsLiveStripeReview({ type: 'PAYMENT SETUP PENDING' }), false);
  assert.equal(shouldRefreshStripeFirst({ type: 'PAUSE EXPECTATION STALE' }), false); // pause-only, not a live-Stripe-first case
  assert.equal(shouldRefreshStripeFirst({ type: 'PAYMENT_FAILED' }), true);
});

test('issueMatchesView routes issues to the right filter', () => {
  assert.equal(issueMatchesView({ type: 'PAYMENT_FAILED' }, 'payment_risk'), true);
  assert.equal(issueMatchesView({ type: 'PAUSE EXPECTATION STALE' }, 'pause'), true);
  assert.equal(issueMatchesView({ type: 'STRIPE CUSTOMER MISSING' }, 'setup'), true);
  assert.equal(issueMatchesView({ type: 'TUTOR CONFLICT' }, 'records'), true);
  assert.equal(issueMatchesView({ type: 'PAYMENT_FAILED' }, 'all'), true);
  // "cleared" = open/acknowledged but no longer detected at source
  assert.equal(issueMatchesView({ type: 'PAYMENT_FAILED', status: 'open', sourcePresent: false }, 'cleared'), true);
  assert.equal(issueMatchesView({ type: 'PAYMENT_FAILED', status: 'open', sourcePresent: true }, 'cleared'), false);
});

test('paymentQuickActionResolvesIssue only resolves matching expectation transitions', () => {
  const setPaused = { payload: { paymentExpectation: 'stripe_paused_expected' } };
  const setActive = { payload: { paymentExpectation: 'stripe_active_expected' } };
  assert.equal(paymentQuickActionResolvesIssue({ type: 'PAUSE EXPECTATION MISMATCH' }, setPaused), true);
  assert.equal(paymentQuickActionResolvesIssue({ type: 'PAUSE EXPECTATION MISMATCH' }, setActive), false);
  assert.equal(paymentQuickActionResolvesIssue({ type: 'PAUSE EXPECTATION STALE' }, setActive), true);
  assert.equal(
    paymentQuickActionResolvesIssue({ type: 'SUBSCRIPTION_STATE_MISMATCH', paymentExpectation: 'stripe_paused_expected' }, setActive),
    true,
  );
  assert.equal(paymentQuickActionResolvesIssue({ type: 'PAYMENT_FAILED' }, setActive), false);
  assert.equal(paymentQuickActionResolvesIssue({ type: 'PAUSE EXPECTATION MISMATCH' }, { payload: {} }), false);
});

test('getPrimaryPaymentQuickAction finds the right action by payload, not label', () => {
  const actions = [
    { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } },
    { label: 'Confirm pause — expect payments paused', payload: { paymentExpectation: 'stripe_paused_expected' } },
  ];
  assert.equal(getPrimaryPaymentQuickAction({ type: 'PAUSE EXPECTATION MISMATCH' }, actions).label, 'Confirm pause — expect payments paused');
  assert.equal(getPrimaryPaymentQuickAction({ type: 'PAUSE EXPECTATION STALE' }, actions).label, 'Expect payments active');
  assert.equal(getPrimaryPaymentQuickAction({ type: 'PAYMENT_FAILED' }, actions), null);
});

test('detective offers one-button resolution only for deterministic existing actions', () => {
  const setActive = { label: 'Expect payments active', payload: { paymentExpectation: 'stripe_active_expected' } };
  const stale = getDetectiveResolution({
    status: 'open',
    sourcePresent: true,
    type: 'PAUSE EXPECTATION STALE',
  }, setActive);
  assert.equal(stale.kind, 'payment_quick_action');
  assert.equal(stale.buttonLabel, 'Yes, solve it');
  assert.equal(stale.action, setActive);

  const sourceGone = getDetectiveResolution({
    status: 'acknowledged',
    sourcePresent: false,
    type: 'PAYMENT_FAILED',
  });
  assert.equal(sourceGone.kind, 'resolve_source_absent');

  assert.equal(getDetectiveResolution({
    status: 'open',
    sourcePresent: true,
    type: 'PAYMENT_FAILED',
  }, setActive), null);
  assert.equal(getDetectiveResolution({
    status: 'resolved',
    sourcePresent: false,
    type: 'PAYMENT_FAILED',
  }), null);
});

test('getIssueCategoryLabel reflects the predicate buckets', () => {
  assert.equal(getIssueCategoryLabel({ type: 'PAUSE EXPECTATION STALE' }), 'Pause');
  assert.equal(getIssueCategoryLabel({ type: 'PAYMENT_FAILED' }), 'Payment');
  // Quirk surfaced by extraction: setup types are also payment issues, and the payment
  // check runs first, so setup types label as 'Payment' — the 'Setup' branch is currently
  // unreachable. Documented here; left as-is (behaviour-preserving refactor).
  assert.equal(getIssueCategoryLabel({ type: 'STRIPE CUSTOMER MISSING' }), 'Payment');
  assert.equal(getIssueCategoryLabel({ type: 'TUTOR CONFLICT' }), 'Records');
  assert.equal(getIssueCategoryLabel({ type: 'SOMETHING ELSE' }), 'Issue');
});

test('getIssueShortLabel gives every current issue type concise deterministic copy', () => {
  assert.equal(getIssueShortLabel({ type: 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY' }), 'Billing stopped unexpectedly');
  assert.equal(getIssueShortLabel({ type: 'PAYMENT_FAILED' }), 'Payment needs attention');
  assert.equal(getIssueShortLabel({ type: 'PAYMENT_RETRYING' }), 'Stripe retry scheduled');
  assert.equal(getIssueShortLabel({ type: 'PAUSE EXPECTATION MISMATCH' }), 'Pause state mismatch');
  assert.equal(getIssueShortLabel({ type: 'PRACTICE NOTE DELIVERY FAILED' }), 'Practice note not delivered');
  assert.equal(getIssueShortLabel({ type: 'FINANCE DATA GAP' }), 'Finance data missing');
  assert.equal(getIssueShortLabel({ type: ' SOMETHING NEW ' }), 'Review issue');
});

test('story/what-to-do copy and student label handle source-gone + fallbacks', () => {
  assert.equal(getStudentLabel({ mmsId: 'sdt_x' }), 'sdt_x');
  assert.equal(getStudentLabel({ studentName: 'Ada' }), 'Ada');
  assert.match(getIssueStory({ studentName: 'Ada', type: 'PAYMENT_FAILED', sourcePresent: true }), /failed in Stripe/);
  assert.match(getIssueStory({ studentName: 'Ada', sourcePresent: false }), /no longer sees it/);
  assert.match(getIssueWhatToDo({ sourcePresent: false }), /mark it resolved/);
  assert.match(getIssueWhatToDo({ type: 'TUTOR CONFLICT', sourcePresent: true }), /which tutor is correct/);
});

test('summariseStripeSnapshot composes a readable line', () => {
  assert.equal(summariseStripeSnapshot(null), '');
  const line = summariseStripeSnapshot(
    { subscriptionFound: true, subscriptionStatus: 'active', pauseState: 'paused', activelyBilling: false, latestInvoiceStatus: 'paid' },
    ['PAUSE EXPECTATION STALE'],
  );
  assert.match(line, /Subscription active/);
  assert.match(line, /Pause state: paused/);
  assert.match(line, /Not actively billing/);
  assert.match(line, /Invoice: paid/);
  assert.match(line, /Issues: PAUSE EXPECTATION STALE/);
});

test('getPaymentQuickActions offers per-type expectation corrections, none for manual payers', () => {
  // Manual payer with a non-setup issue type: no quick actions.
  assert.deepEqual(getPaymentQuickActions({ paymentMode: 'manual', type: 'PAYMENT_FAILED' }), []);

  // Setup-pending types offer actions regardless of payment mode.
  const setup = getPaymentQuickActions({ paymentMode: 'manual', type: 'PAYMENT SETUP PENDING' });
  assert.deepEqual(setup.map((a) => a.payload.paymentExpectation), ['stripe_active_expected', '']);

  // The pause pair route to opposite primary expectations.
  const mismatch = getPaymentQuickActions({ paymentMode: 'stripe', type: 'PAUSE EXPECTATION MISMATCH' });
  assert.equal(mismatch[0].payload.paymentExpectation, 'stripe_paused_expected');
  const stale = getPaymentQuickActions({ paymentMode: 'stripe', type: 'PAUSE EXPECTATION STALE' });
  assert.equal(stale[0].payload.paymentExpectation, 'stripe_active_expected');

  // Unknown stripe-mode types fall through to no actions.
  assert.deepEqual(getPaymentQuickActions({ paymentMode: 'stripe', type: 'TUTOR CONFLICT' }), []);
});
