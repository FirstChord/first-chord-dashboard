import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPaymentFieldChangeEvent,
  buildPaymentIssueActionEvent,
  buildPauseExpectationReconciliationEvent,
  buildPauseWorkflowActionEvent,
  normaliseAuditContext,
  shouldLogPaymentIssueAction,
  shouldLogPauseWorkflowAction,
  validateExpectedPaymentState,
  validatePaymentAuditContext,
} from '../../lib/admin/payment-audit-helpers.mjs';

test('validatePaymentAuditContext requires a note for flags payment actions', () => {
  assert.equal(
    validatePaymentAuditContext({
      paymentExpectation: 'setup_pending',
      auditContext: {
        source: 'admin_flags_payment_action',
        issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
        issueType: 'STRIPE SUBSCRIPTION MISSING',
        actionLabel: 'Set setup pending',
        note: '',
      },
    }),
    'A short note is required for payment actions from the issues page.',
  );
});

test('validatePaymentAuditContext requires a note for pause workflow payment actions', () => {
  assert.equal(
    validatePaymentAuditContext({
      paymentExpectation: 'stripe_paused_expected',
      auditContext: {
        source: 'admin_pause_workflow_action',
        actionLabel: 'Set Stripe paused expected',
        note: ' ',
      },
    }),
    'A short note is required for pause workflow payment actions.',
  );

  assert.equal(
    validatePaymentAuditContext({
      paymentExpectation: 'stripe_paused_expected',
      auditContext: {
        source: 'admin_pause_workflow_action',
        actionLabel: 'Set Stripe paused expected',
        note: 'Pause History shows this student is currently paused.',
      },
    }),
    '',
  );
});

test('validatePaymentAuditContext keeps direct student-detail payment edits lightweight', () => {
  assert.equal(validatePaymentAuditContext({ paymentExpectation: 'setup_pending' }), '');
  assert.equal(
    validatePaymentAuditContext({
      paymentExpectation: 'setup_pending',
      auditContext: {
        source: 'admin_student_update',
      },
    }),
    '',
  );
});

test('validateExpectedPaymentState refuses a stale detective payment action', () => {
  const student = {
    paymentMode: 'stripe',
    paymentExpectation: 'stripe_paused_expected',
  };

  assert.equal(validateExpectedPaymentState({
    expectedPaymentMode: 'stripe',
    expectedPaymentExpectation: 'stripe_paused_expected',
  }, student), '');
  assert.match(validateExpectedPaymentState({
    expectedPaymentExpectation: 'stripe_active_expected',
  }, student), /changed after this action was prepared/);
  assert.match(validateExpectedPaymentState({
    expectedPaymentMode: 'manual',
  }, student), /changed after this action was prepared/);
  assert.equal(validateExpectedPaymentState({ paymentExpectation: 'stripe_active_expected' }, student), '');
});

test('normaliseAuditContext trims issue payment action context', () => {
  assert.deepEqual(
    normaliseAuditContext({
      source: ' admin_flags_payment_action ',
      issueId: ' payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123 ',
      issueType: ' STRIPE SUBSCRIPTION MISSING ',
      actionLabel: ' Set setup pending ',
      note: ' Checked with Finn ',
    }),
    {
      source: 'admin_flags_payment_action',
      issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
      issueType: 'STRIPE SUBSCRIPTION MISSING',
      actionLabel: 'Set setup pending',
      note: 'Checked with Finn',
    },
  );
});

test('buildPaymentFieldChangeEvent includes issue context in payload_json', () => {
  const event = buildPaymentFieldChangeEvent({
    student: {
      mmsId: 'sdt_123',
      fullName: 'Owen Example',
    },
    previousValue: 'stripe_active_expected',
    nextValue: 'setup_pending',
    fieldName: 'payment_expectation',
    eventType: 'payment_expectation_changed',
    actorEmail: 'admin@example.com',
    occurredAt: '2026-05-11T12:00:00.000Z',
    auditContext: {
      source: 'admin_flags_payment_action',
      issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
      issueType: 'STRIPE SUBSCRIPTION MISSING',
      actionLabel: 'Set setup pending',
      note: 'Family has not completed setup yet.',
    },
  });

  const payload = JSON.parse(event.payloadJson);

  assert.equal(event.eventType, 'payment_expectation_changed');
  assert.equal(event.entityType, 'student');
  assert.equal(event.issueId, 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123');
  assert.equal(payload.source, 'admin_flags_payment_action');
  assert.equal(payload.previous_value, 'stripe_active_expected');
  assert.equal(payload.next_value, 'setup_pending');
  assert.equal(payload.issue_type, 'STRIPE SUBSCRIPTION MISSING');
  assert.equal(payload.action_label, 'Set setup pending');
  assert.equal(payload.note, 'Family has not completed setup yet.');
});

test('buildPaymentIssueActionEvent records the issue-level payment outcome', () => {
  const event = buildPaymentIssueActionEvent({
    student: {
      mmsId: 'sdt_123',
      fullName: 'Owen Example',
    },
    actorEmail: 'admin@example.com',
    occurredAt: '2026-05-11T12:00:00.000Z',
    auditContext: {
      source: 'admin_flags_payment_action',
      issueId: 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123',
      issueType: 'STRIPE SUBSCRIPTION MISSING',
      actionLabel: 'Set setup pending',
      note: 'Family has not completed setup yet.',
    },
    changedFields: ['payment_expectation'],
  });

  const payload = JSON.parse(event.payloadJson);

  assert.equal(event.eventType, 'payment_issue_action_taken');
  assert.equal(event.entityType, 'issue');
  assert.equal(event.entityId, 'payment_static:STRIPE_SUBSCRIPTION_MISSING:sdt_123');
  assert.deepEqual(payload.changed_fields, ['payment_expectation']);
  assert.equal(payload.note, 'Family has not completed setup yet.');
});

test('buildPauseWorkflowActionEvent records pause workflow outcomes', () => {
  const event = buildPauseWorkflowActionEvent({
    student: {
      mmsId: 'sdt_123',
      fullName: 'Owen Example',
    },
    actorEmail: 'admin@example.com',
    occurredAt: '2026-05-11T12:00:00.000Z',
    auditContext: {
      source: 'admin_pause_workflow_action',
      actionLabel: 'Set Stripe paused expected',
      note: 'Pause History shows an active pause.',
    },
    changedFields: ['payment_expectation'],
  });

  const payload = JSON.parse(event.payloadJson);

  assert.equal(event.eventType, 'pause_workflow_action_taken');
  assert.equal(event.entityType, 'student');
  assert.equal(event.entityId, 'sdt_123');
  assert.deepEqual(payload.changed_fields, ['payment_expectation']);
  assert.equal(payload.action_label, 'Set Stripe paused expected');
  assert.equal(payload.note, 'Pause History shows an active pause.');
});

test('buildPauseExpectationReconciliationEvent identifies the admin and explicit source', () => {
  const event = buildPauseExpectationReconciliationEvent({
    student: {
      mmsId: 'sdt_123',
      fullName: 'Owen Example',
    },
    previousValue: 'stripe_active_expected',
    nextValue: 'stripe_paused_expected',
    actorEmail: 'admin@example.com',
    occurredAt: '2026-07-14T12:00:00.000Z',
    reason: 'Pause History and usual lesson coverage agree.',
  });

  const payload = JSON.parse(event.payloadJson);
  assert.equal(event.eventType, 'payment_expectation_reconciled');
  assert.equal(event.actorEmail, 'admin@example.com');
  assert.equal(payload.source, 'pause_history_explicit_reconciliation');
  assert.equal(payload.action_label, 'Reconcile payment expectation from Pause History');
  assert.equal(payload.note, 'Pause History and usual lesson coverage agree.');
});

test('shouldLogPaymentIssueAction only logs changed issue-originated payment actions', () => {
  assert.equal(
    shouldLogPaymentIssueAction({ source: 'admin_flags_payment_action' }, ['payment_mode']),
    true,
  );
  assert.equal(
    shouldLogPaymentIssueAction({ source: 'admin_flags_payment_action' }, []),
    false,
  );
  assert.equal(
    shouldLogPaymentIssueAction({ source: 'admin_student_update' }, ['payment_mode']),
    false,
  );
});

test('shouldLogPauseWorkflowAction logs pause workflow actions even when no field changed', () => {
  assert.equal(shouldLogPauseWorkflowAction({ source: 'admin_pause_workflow_action' }), true);
  assert.equal(shouldLogPauseWorkflowAction({ source: 'admin_flags_payment_action' }), false);
});
