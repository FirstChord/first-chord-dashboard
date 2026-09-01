/** @fileoverview Builds and validates the audit events written whenever a payment field, payment issue action, or pause action changes. */
import { randomUUID } from 'node:crypto';

const FLAGS_PAYMENT_ACTION_SOURCE = 'admin_flags_payment_action';
const PAUSE_WORKFLOW_ACTION_SOURCE = 'admin_pause_workflow_action';
const NOTE_REQUIRED_SOURCES = new Set([
  FLAGS_PAYMENT_ACTION_SOURCE,
  PAUSE_WORKFLOW_ACTION_SOURCE,
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normaliseText(value) {
  return `${value || ''}`.trim();
}

export function normaliseAuditContext(auditContext = {}) {
  if (!auditContext || typeof auditContext !== 'object') {
    return {};
  }

  return {
    source: normaliseText(auditContext.source),
    issueId: normaliseText(auditContext.issueId),
    issueType: normaliseText(auditContext.issueType),
    actionLabel: normaliseText(auditContext.actionLabel),
    note: normaliseText(auditContext.note),
  };
}

export function validatePaymentAuditContext(payload = {}) {
  const auditContext = normaliseAuditContext(payload.auditContext);
  const changesPaymentField = hasOwn(payload, 'paymentMode') || hasOwn(payload, 'paymentExpectation');

  if (
    changesPaymentField &&
    NOTE_REQUIRED_SOURCES.has(auditContext.source) &&
    !auditContext.note
  ) {
    return auditContext.source === PAUSE_WORKFLOW_ACTION_SOURCE
      ? 'A short note is required for pause workflow payment actions.'
      : 'A short note is required for payment actions from the issues page.';
  }

  return '';
}

export function validateExpectedPaymentState(payload = {}, currentStudent = null) {
  if (!currentStudent) return '';

  if (
    hasOwn(payload, 'expectedPaymentMode')
    && normaliseText(payload.expectedPaymentMode) !== normaliseText(currentStudent.paymentMode)
  ) {
    return 'Payment mode changed after this action was prepared. Refresh the case and review it again.';
  }

  if (
    hasOwn(payload, 'expectedPaymentExpectation')
    && normaliseText(payload.expectedPaymentExpectation) !== normaliseText(currentStudent.paymentExpectation)
  ) {
    return 'Payment expectation changed after this action was prepared. Refresh the case and review it again.';
  }

  return '';
}

function buildAuditPayload({
  auditContext = {},
  source = 'admin_student_update',
  previousValue = '',
  nextValue = '',
  fieldName = '',
}) {
  return JSON.stringify({
    previous_value: previousValue || '',
    next_value: nextValue || '',
    source,
    issue_id: auditContext.issueId || '',
    issue_type: auditContext.issueType || '',
    action_label: auditContext.actionLabel || '',
    note: auditContext.note || '',
    field_name: fieldName || '',
  });
}

export function buildPaymentFieldChangeEvent({
  student,
  previousValue = '',
  nextValue = '',
  fieldName,
  eventType,
  actorEmail = '',
  occurredAt,
  auditContext = {},
}) {
  const source = auditContext.source || 'admin_student_update';

  return {
    eventId: randomUUID(),
    occurredAt,
    actorEmail,
    entityType: 'student',
    entityId: student.mmsId,
    eventType,
    mmsId: student.mmsId,
    studentName: student.fullName || student.mmsId,
    issueId: auditContext.issueId || '',
    payloadJson: buildAuditPayload({
      auditContext,
      source,
      previousValue,
      nextValue,
      fieldName,
    }),
  };
}

export function buildPaymentIssueActionEvent({
  student,
  actorEmail = '',
  occurredAt,
  auditContext = {},
  changedFields = [],
}) {
  return {
    eventId: randomUUID(),
    occurredAt,
    actorEmail,
    entityType: 'issue',
    entityId: auditContext.issueId || '',
    eventType: 'payment_issue_action_taken',
    mmsId: student.mmsId,
    studentName: student.fullName || student.mmsId,
    issueId: auditContext.issueId || '',
    payloadJson: JSON.stringify({
      source: auditContext.source || '',
      issue_id: auditContext.issueId || '',
      issue_type: auditContext.issueType || '',
      action_label: auditContext.actionLabel || '',
      note: auditContext.note || '',
      changed_fields: changedFields,
    }),
  };
}

export function buildPauseWorkflowActionEvent({
  student,
  actorEmail = '',
  occurredAt,
  auditContext = {},
  changedFields = [],
}) {
  return {
    eventId: randomUUID(),
    occurredAt,
    actorEmail,
    entityType: 'student',
    entityId: student.mmsId,
    eventType: 'pause_workflow_action_taken',
    mmsId: student.mmsId,
    studentName: student.fullName || student.mmsId,
    issueId: '',
    payloadJson: JSON.stringify({
      source: auditContext.source || '',
      action_label: auditContext.actionLabel || '',
      note: auditContext.note || '',
      changed_fields: changedFields,
    }),
  };
}

export function buildPauseExpectationReconciliationEvent({
  student,
  previousValue = '',
  nextValue = '',
  actorEmail = '',
  occurredAt,
  reason = '',
}) {
  return buildPaymentFieldChangeEvent({
    student,
    previousValue,
    nextValue,
    fieldName: 'payment_expectation',
    eventType: 'payment_expectation_reconciled',
    actorEmail,
    occurredAt,
    auditContext: {
      source: 'pause_history_explicit_reconciliation',
      actionLabel: 'Reconcile payment expectation from Pause History',
      note: reason,
    },
  });
}

export function buildPauseExpectationReconciliationAttemptEvent({
  student,
  previousValue = '',
  nextValue = '',
  actorEmail = '',
  occurredAt,
  reason = '',
}) {
  return buildPaymentFieldChangeEvent({
    student,
    previousValue,
    nextValue,
    fieldName: 'payment_expectation',
    eventType: 'payment_expectation_reconciliation_attempted',
    actorEmail,
    occurredAt,
    auditContext: {
      source: 'pause_history_explicit_reconciliation',
      actionLabel: 'Attempt payment expectation reconciliation from Pause History',
      note: reason,
    },
  });
}

export function shouldLogPaymentIssueAction(auditContext = {}, changedFields = []) {
  return auditContext.source === FLAGS_PAYMENT_ACTION_SOURCE && changedFields.length > 0;
}

export function shouldLogPauseWorkflowAction(auditContext = {}) {
  return auditContext.source === PAUSE_WORKFLOW_ACTION_SOURCE;
}
