/** @fileoverview Admin-gated read and patch of one admin student record, with payment and pause field changes written to the audit event log. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { normaliseInstrument } from '@/lib/admin/fc';
import {
  buildPaymentFieldChangeEvent,
  buildPaymentIssueActionEvent,
  buildPauseWorkflowActionEvent,
  normaliseAuditContext,
  shouldLogPaymentIssueAction,
  shouldLogPauseWorkflowAction,
  validateExpectedPaymentState,
  validatePaymentAuditContext,
} from '@/lib/admin/payment-audit-helpers.mjs';
import { normalisePaymentExpectation, normalisePaymentMode } from '@/lib/admin/payments-helpers.mjs';
import { getAdminStudentByMmsId, updateAdminStudent } from '@/lib/admin/students';
import { appendEventLogRows } from '@/lib/admin/sheets';

const SHEETS_FIELD_MAP = {
  firstName: 'Student forename',
  lastName: 'Student Surname',
  tutor: 'Tutor',
  instrument: 'Instrument',
  lessonLength: 'Lesson length',
  parentFirstName: 'Parent forename',
  parentLastName: 'Parent surname',
  email: 'Email',
  contactNumber: 'Contact Number',
  paymentMode: 'payment_mode',
  paymentExpectation: 'payment_expectation',
};

const REGISTRY_FIELD_MAP = {
  registryTutor: 'tutor',
  instrument: 'instrument',
  soundsliceUrl: 'soundsliceUrl',
  thetaUsername: 'thetaUsername',
};

function validatePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return ['Invalid request body'];
  }

  // Capitals are tolerated and normalised to lowercase on save (see mapUpdates),
  // so a pre-existing capitalised username no longer blocks unrelated edits
  // (e.g. changing payment expectation). Only reject non-alphanumeric characters.
  if (payload.thetaUsername && !/^[a-z0-9]+$/.test(`${payload.thetaUsername}`.toLowerCase())) {
    errors.push('Theta username must be letters and numbers only');
  }

  if (payload.soundsliceUrl && !/^https:\/\/www\.soundslice\.com\/courses\/.+/.test(payload.soundsliceUrl)) {
    errors.push('Soundslice URL must be a valid Soundslice course URL');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'paymentMode') && !normalisePaymentMode(payload.paymentMode)) {
    errors.push('Payment mode must be stripe, manual, or unknown');
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'paymentExpectation') &&
    payload.paymentExpectation &&
    !normalisePaymentExpectation(payload.paymentExpectation)
  ) {
    errors.push('Payment expectation must be setup_pending, stripe_active_expected, stripe_paused_expected, or inactive_or_stopped');
  }

  const auditContextError = validatePaymentAuditContext(payload);
  if (auditContextError) {
    errors.push(auditContextError);
  }

  return errors;
}

function mapUpdates(payload, mapping) {
  return Object.entries(mapping).reduce((acc, [inputKey, outputKey]) => {
    if (Object.prototype.hasOwnProperty.call(payload, inputKey)) {
      if (inputKey === 'instrument') {
        acc[outputKey] = normaliseInstrument(payload[inputKey]);
      } else if (inputKey === 'thetaUsername') {
        acc[outputKey] = `${payload[inputKey] || ''}`.toLowerCase();
      } else if (inputKey === 'paymentMode') {
        acc[outputKey] = normalisePaymentMode(payload[inputKey]);
      } else if (inputKey === 'paymentExpectation') {
        acc[outputKey] = normalisePaymentExpectation(payload[inputKey]);
      } else {
        acc[outputKey] = payload[inputKey];
      }
    }
    return acc;
  }, {});
}

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  const { mmsId } = await params;

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const student = await getAdminStudentByMmsId(mmsId);

  if (!student) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ student });
}

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  const { mmsId } = await params;

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const errors = validatePayload(payload);

  if (errors.length > 0) {
    return Response.json({ error: errors.join('. ') }, { status: 400 });
  }

  try {
    const previousStudent = await getAdminStudentByMmsId(mmsId);
    if (!previousStudent) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const expectedStateError = validateExpectedPaymentState(payload, previousStudent);
    if (expectedStateError) {
      return Response.json({ error: expectedStateError }, { status: 409 });
    }

    const student = await updateAdminStudent({
      mmsId,
      sheetsUpdates: mapUpdates(payload, SHEETS_FIELD_MAP),
      registryUpdates: mapUpdates(payload, REGISTRY_FIELD_MAP),
    });

    if (!student) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const eventRows = [];
    const changedPaymentFields = [];
    const now = new Date().toISOString();
    const auditContext = normaliseAuditContext(payload.auditContext);

    if (previousStudent && Object.prototype.hasOwnProperty.call(payload, 'paymentMode') && previousStudent.paymentMode !== student.paymentMode) {
      changedPaymentFields.push('payment_mode');
      eventRows.push(buildPaymentFieldChangeEvent({
        student,
        previousValue: previousStudent.paymentMode || '',
        nextValue: student.paymentMode || '',
        fieldName: 'payment_mode',
        eventType: 'payment_mode_changed',
        actorEmail: session.user.email || '',
        occurredAt: now,
        auditContext,
      }));
    }

    if (
      previousStudent &&
      Object.prototype.hasOwnProperty.call(payload, 'paymentExpectation') &&
      previousStudent.paymentExpectation !== student.paymentExpectation
    ) {
      changedPaymentFields.push('payment_expectation');
      eventRows.push(buildPaymentFieldChangeEvent({
        student,
        previousValue: previousStudent.paymentExpectation || '',
        nextValue: student.paymentExpectation || '',
        fieldName: 'payment_expectation',
        eventType: 'payment_expectation_changed',
        actorEmail: session.user.email || '',
        occurredAt: now,
        auditContext,
      }));
    }

    const issueActionLogged = shouldLogPaymentIssueAction(auditContext, changedPaymentFields);

    if (issueActionLogged) {
      eventRows.push(buildPaymentIssueActionEvent({
        student,
        actorEmail: session.user.email || '',
        occurredAt: now,
        auditContext,
        changedFields: changedPaymentFields,
      }));
    }

    const pauseWorkflowActionLogged = shouldLogPauseWorkflowAction(auditContext);

    if (pauseWorkflowActionLogged) {
      eventRows.push(buildPauseWorkflowActionEvent({
        student,
        actorEmail: session.user.email || '',
        occurredAt: now,
        auditContext,
        changedFields: changedPaymentFields,
      }));
    }

    if (eventRows.length) {
      await appendEventLogRows(eventRows);
    }

    return Response.json({
      student,
      audit: {
        changedPaymentFields,
        issueActionLogged,
        pauseWorkflowActionLogged,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}
