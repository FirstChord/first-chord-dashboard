/** @fileoverview Server workflow issuing, activating, and following up student portal notes credentials. */
import crypto from 'node:crypto';
import { isStudentOwnContact } from './planning-client-helpers.mjs';
import { getAdminStudentByMmsId, getAdminStudents } from './students.js';
import {
  appendEventLogRow,
  getStudentPortalAccessRow,
  getStudentPortalAccessRows,
  upsertStudentPortalAccessRow,
} from './sheets.js';
import {
  buildStudentNotesVerifier,
  decryptStudentNotesCode,
  encryptStudentNotesCode,
  generateStudentNotesCode,
} from './student-notes-access-crypto.mjs';
import {
  activatePendingNotesCredential,
  applyPendingNotesCredential,
  deriveNotesAccessProgress,
  isStudentEligibleForNotesRollout,
  normaliseNotesWorkflowStatus,
  publicWorkflowState,
} from './student-notes-access-helpers.mjs';

function defaultState(student = {}) {
  return {
    studentMmsId: student.mmsId || '',
    studentName: student.fullName || student.studentName || '',
    friendlyUrl: student.registry?.friendlyUrl || student.friendlyUrl || '',
    tutorName: student.tutor || student.registryTutor || student.tutorName || '',
    workflowStatus: 'not_started',
    protectionEnabled: false,
    claimedBy: '',
    claimedAt: '',
    followUpNote: '',
    activeCodeCiphertext: '',
    activeCodeSalt: '',
    activeCodeVerifier: '',
    credentialVersion: 0,
    pendingCredentialId: '',
    pendingCodeCiphertext: '',
    pendingCodeSalt: '',
    pendingCodeVerifier: '',
    pendingCredentialVersion: 0,
    descriptionConfirmedAt: '',
    descriptionConfirmedBy: '',
    messageSentAt: '',
    messageSentBy: '',
    activatedAt: '',
    activatedBy: '',
    updatedAt: '',
    updatedBy: '',
  };
}

function mergeStudentState(student, row = null) {
  return {
    ...defaultState(student),
    ...(row || {}),
    studentMmsId: student.mmsId || row?.studentMmsId || '',
    studentName: student.fullName || row?.studentName || '',
    friendlyUrl: student.registry?.friendlyUrl || row?.friendlyUrl || '',
    tutorName: student.tutor || student.registryTutor || row?.tutorName || '',
    workflowStatus: normaliseNotesWorkflowStatus(row?.workflowStatus),
  };
}

export async function getStudentNotesAccessWorkflow() {
  const [students, rows] = await Promise.all([
    getAdminStudents(),
    getStudentPortalAccessRows(),
  ]);
  const rowsByMmsId = new Map(rows.map((row) => [row.studentMmsId, row]));
  const seen = new Set();
  const records = students
    .filter((student) => {
      if (seen.has(student.mmsId)) return false;
      seen.add(student.mmsId);
      return isStudentEligibleForNotesRollout(student, rowsByMmsId.get(student.mmsId));
    })
    .map((student) => ({
      student: {
        mmsId: student.mmsId,
        studentName: student.fullName,
        parentName: [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
        isOwnContact: isStudentOwnContact(student),
        tutorName: student.tutor || student.registryTutor || '',
        friendlyUrl: student.registry?.friendlyUrl || rowsByMmsId.get(student.mmsId)?.friendlyUrl || '',
        isTestStudent: Boolean(student.isTestStudent),
      },
      state: publicWorkflowState(mergeStudentState(student, rowsByMmsId.get(student.mmsId))),
    }))
    .sort((a, b) => a.student.studentName.localeCompare(b.student.studentName));

  return {
    records,
    progress: deriveNotesAccessProgress(records),
  };
}

async function logAccessEvent({
  actorEmail,
  state,
  eventType,
  payload = {},
}) {
  try {
    await appendEventLogRow({
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      actorEmail,
      entityType: 'student_portal_access',
      entityId: state.studentMmsId,
      eventType,
      mmsId: state.studentMmsId,
      studentName: state.studentName,
      issueId: '',
      payloadJson: JSON.stringify(payload),
    });
    return '';
  } catch (error) {
    console.warn('Student notes access audit write failed:', error.message);
    return 'The workflow change was saved, but its Event Log audit entry needs checking.';
  }
}

async function getCurrentState(studentMmsId) {
  const [student, row] = await Promise.all([
    getAdminStudentByMmsId(studentMmsId),
    getStudentPortalAccessRow(studentMmsId),
  ]);
  if (!student || !isStudentEligibleForNotesRollout(student, row)) {
    throw Object.assign(new Error('This student is not eligible for the notes rollout workflow'), { status: 404 });
  }
  return mergeStudentState(student, row);
}

function assertFresh(state, expectedUpdatedAt = '') {
  if (expectedUpdatedAt && state.updatedAt !== expectedUpdatedAt) {
    throw Object.assign(new Error('This student was updated by someone else. Refresh the workflow before continuing.'), { status: 409 });
  }
}

function assertClaim(state, actorEmail) {
  if (!state.claimedBy || state.claimedBy !== actorEmail) {
    throw Object.assign(new Error(`This student is currently claimed by ${state.claimedBy || 'another administrator'}.`), { status: 409 });
  }
}

function assertPending(state, pendingCredentialId = '') {
  if (!state.pendingCredentialId || state.pendingCredentialId !== pendingCredentialId) {
    throw Object.assign(new Error('The pending access code changed. Refresh before continuing.'), { status: 409 });
  }
}

async function saveState(state, actorEmail) {
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail,
  };
  await upsertStudentPortalAccessRow(next);
  return next;
}

export async function ensureStudentNotesAccessFollowUp({
  studentMmsId,
  studentName,
  friendlyUrl = '',
  tutorName = '',
  actorEmail = '',
}) {
  const existing = await getStudentPortalAccessRow(studentMmsId);
  if (existing) return publicWorkflowState(existing);
  const state = await saveState(defaultState({
    mmsId: studentMmsId,
    studentName,
    friendlyUrl,
    tutorName,
  }), actorEmail);
  return publicWorkflowState(state);
}

export async function performStudentNotesAccessAction({
  studentMmsId,
  action,
  actorEmail,
  expectedUpdatedAt = '',
  pendingCredentialId = '',
  followUpNote = '',
}) {
  const now = new Date().toISOString();
  const current = await getCurrentState(studentMmsId);
  let next = current;
  let code = '';
  let eventType = '';
  let eventPayload = {};

  if (action === 'claim') {
    if (current.claimedBy && current.claimedBy !== actorEmail && current.workflowStatus === 'in_progress') {
      throw Object.assign(new Error(`This student is already claimed by ${current.claimedBy}.`), { status: 409 });
    }
    next = {
      ...current,
      claimedBy: actorEmail,
      claimedAt: now,
      workflowStatus: current.workflowStatus === 'completed' ? 'completed' : 'in_progress',
      followUpNote: '',
    };
    eventType = 'student_notes_rollout_claimed';
  } else if (action === 'takeover') {
    next = {
      ...current,
      claimedBy: actorEmail,
      claimedAt: now,
      workflowStatus: current.workflowStatus === 'completed' ? 'completed' : 'in_progress',
    };
    eventType = 'student_notes_rollout_taken_over';
    eventPayload = { previous_claimed_by: current.claimedBy || '' };
  } else if (action === 'release') {
    assertFresh(current, expectedUpdatedAt);
    assertClaim(current, actorEmail);
    next = { ...current, claimedBy: '', claimedAt: '' };
    eventType = 'student_notes_rollout_released';
  } else if (action === 'generate') {
    assertFresh(current, expectedUpdatedAt);
    assertClaim(current, actorEmail);
    code = generateStudentNotesCode();
    const { salt, verifier } = buildStudentNotesVerifier(code);
    next = applyPendingNotesCredential(current, {
      id: crypto.randomUUID(),
      ciphertext: encryptStudentNotesCode(code),
      salt,
      verifier,
      version: Number(current.credentialVersion || 0) + 1,
    });
    eventType = current.protectionEnabled ? 'student_notes_code_reset_started' : 'student_notes_code_generated';
  } else if (action === 'reveal') {
    const ciphertext = current.pendingCodeCiphertext || current.activeCodeCiphertext;
    if (!ciphertext) {
      throw Object.assign(new Error('No access code has been generated for this student'), { status: 409 });
    }
    code = decryptStudentNotesCode(ciphertext);
    const auditWarning = await logAccessEvent({
      actorEmail,
      state: current,
      eventType: 'student_notes_code_revealed',
      payload: { credential_version: current.pendingCredentialVersion || current.credentialVersion || 0 },
    });
    return { state: publicWorkflowState(current), code, auditWarning };
  } else if (action === 'confirm_description' || action === 'confirm_sent') {
    assertFresh(current, expectedUpdatedAt);
    assertClaim(current, actorEmail);
    assertPending(current, pendingCredentialId);
    next = action === 'confirm_description'
      ? { ...current, descriptionConfirmedAt: now, descriptionConfirmedBy: actorEmail }
      : { ...current, messageSentAt: now, messageSentBy: actorEmail };
    eventType = action === 'confirm_description'
      ? 'student_notes_group_description_confirmed'
      : 'student_notes_message_sent_confirmed';
  } else if (action === 'activate') {
    assertFresh(current, expectedUpdatedAt);
    assertClaim(current, actorEmail);
    assertPending(current, pendingCredentialId);
    try {
      next = activatePendingNotesCredential(current, { actorEmail, now });
    } catch (error) {
      throw Object.assign(error, { status: 409 });
    }
    eventType = 'student_notes_protection_activated';
    eventPayload = { credential_version: next.credentialVersion };
  } else if (action === 'needs_follow_up') {
    assertFresh(current, expectedUpdatedAt);
    assertClaim(current, actorEmail);
    next = {
      ...current,
      workflowStatus: 'needs_follow_up',
      followUpNote: `${followUpNote || ''}`.trim().slice(0, 1000),
    };
    eventType = 'student_notes_rollout_follow_up_needed';
  } else {
    throw Object.assign(new Error('Unsupported student notes workflow action'), { status: 400 });
  }

  const saved = await saveState(next, actorEmail);
  const auditWarning = await logAccessEvent({
    actorEmail,
    state: saved,
    eventType,
    payload: eventPayload,
  });
  return {
    state: publicWorkflowState(saved),
    code,
    auditWarning,
  };
}
