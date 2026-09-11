/** @fileoverview Pure eligibility, status, credential, and message-redaction rules for the student notes access rollout. */
export const STUDENT_NOTES_WORKFLOW_STATUSES = new Set([
  'not_started',
  'in_progress',
  'needs_follow_up',
  'completed',
]);
export const STUDENT_NOTES_ROLLOUT_TEST_MMS_ID = 'sdt_fBg9JN';

export function isStudentEligibleForNotesRollout(student = {}, row = null) {
  if (!student.mmsId || student.lifecycleStatus === 'stopped') return false;
  if (student.isTestStudent && student.mmsId !== STUDENT_NOTES_ROLLOUT_TEST_MMS_ID) return false;
  return Boolean(student.registry?.friendlyUrl || row?.friendlyUrl || student.hasRegistryEntry);
}

export function normaliseNotesAccessCode(value = '') {
  return `${value || ''}`.trim().toLowerCase().replace(/[\s-]+/g, '');
}

export function normaliseNotesWorkflowStatus(value = '') {
  const status = `${value || ''}`.trim().toLowerCase();
  return STUDENT_NOTES_WORKFLOW_STATUSES.has(status) ? status : 'not_started';
}

export function buildNotesProfileUrl(friendlyUrl = '') {
  const slug = `${friendlyUrl || ''}`.trim().replace(/^\/+|\/+$/g, '');
  return slug ? `https://firstchord.co.uk/${slug}` : '';
}

export function buildNotesGroupDescription(code = '', friendlyUrl = '') {
  const profileUrl = buildNotesProfileUrl(friendlyUrl);
  return profileUrl
    ? `First Chord notes code: ${code}\n${profileUrl}`
    : `First Chord notes code: ${code}`;
}

export function buildNotesRolloutMessage({ studentName = '', code = '', friendlyUrl = '', reset = false } = {}) {
  const firstName = `${studentName || ''}`.trim().split(/\s+/)[0] || 'your student';
  const profileUrl = buildNotesProfileUrl(friendlyUrl);
  const dashboard = profileUrl
    ? `${firstName}’s First Chord dashboard (${profileUrl})`
    : `${firstName}’s First Chord dashboard`;
  if (reset) {
    return `Hi everyone, we’ve updated the privacy code for ${dashboard}. Their Practice Chat lesson notes use the code *${code}*. You’ll only need to enter it once on each phone, tablet or computer, and you can always find it in this WhatsApp group’s description. Everything else on the dashboard continues to work as normal. Thanks!`;
  }
  return `Hi everyone, we’re adding a small privacy step to ${dashboard}. Their Practice Chat lesson notes will be protected with the code *${code}*. You’ll only need to enter it once on each phone, tablet or computer, and you can always find it in this WhatsApp group’s description. Everything else on the dashboard will continue to work as normal. Thanks!`;
}

export function redactNotesCodeFromMessage(body = '', code = '') {
  const target = `${code || ''}`.trim();
  if (!target) return `${body || ''}`;
  return `${body || ''}`.split(target).join('[ACCESS CODE]');
}

export function deriveNotesAccessProgress(records = []) {
  return records.reduce((summary, record) => {
    summary.total += 1;
    const status = normaliseNotesWorkflowStatus(record?.state?.workflowStatus);
    if (status === 'completed' && record?.state?.protectionEnabled) summary.completed += 1;
    else if (status === 'needs_follow_up') summary.followUp += 1;
    else if (status === 'in_progress') summary.inProgress += 1;
    else summary.remaining += 1;
    return summary;
  }, {
    total: 0,
    completed: 0,
    inProgress: 0,
    remaining: 0,
    followUp: 0,
  });
}

export function canActivateNotesAccess(state = {}) {
  return Boolean(
    state.pendingCredentialId
    && state.descriptionConfirmedAt
    && state.messageSentAt,
  );
}

export function applyPendingNotesCredential(state = {}, credential = {}) {
  return {
    ...state,
    workflowStatus: 'in_progress',
    pendingCredentialId: credential.id || '',
    pendingCodeCiphertext: credential.ciphertext || '',
    pendingCodeSalt: credential.salt || '',
    pendingCodeVerifier: credential.verifier || '',
    pendingCredentialVersion: Number(credential.version || 0),
    descriptionConfirmedAt: '',
    descriptionConfirmedBy: '',
    messageSentAt: '',
    messageSentBy: '',
    followUpNote: '',
  };
}

export function activatePendingNotesCredential(state = {}, {
  actorEmail = '',
  now = new Date().toISOString(),
} = {}) {
  if (!canActivateNotesAccess(state)) {
    throw new Error('Confirm both the WhatsApp description and sent message before activation.');
  }
  return {
    ...state,
    workflowStatus: 'completed',
    protectionEnabled: true,
    activeCodeCiphertext: state.pendingCodeCiphertext || '',
    activeCodeSalt: state.pendingCodeSalt || '',
    activeCodeVerifier: state.pendingCodeVerifier || '',
    credentialVersion: Number(state.pendingCredentialVersion || 0),
    pendingCredentialId: '',
    pendingCodeCiphertext: '',
    pendingCodeSalt: '',
    pendingCodeVerifier: '',
    pendingCredentialVersion: 0,
    activatedAt: now,
    activatedBy: actorEmail,
    claimedBy: '',
    claimedAt: '',
    followUpNote: '',
  };
}

export function publicNotesAccessState(row = null) {
  if (!row) {
    return {
      mode: 'legacy_public',
      protectionEnabled: false,
      credentialVersion: 0,
    };
  }
  return {
    mode: row.protectionEnabled ? 'protected' : 'legacy_public',
    protectionEnabled: Boolean(row.protectionEnabled),
    credentialVersion: Number(row.credentialVersion || 0),
  };
}

export function publicWorkflowState(row = {}) {
  return {
    studentMmsId: row.studentMmsId || '',
    studentName: row.studentName || '',
    friendlyUrl: row.friendlyUrl || '',
    tutorName: row.tutorName || '',
    workflowStatus: normaliseNotesWorkflowStatus(row.workflowStatus),
    protectionEnabled: Boolean(row.protectionEnabled),
    claimedBy: row.claimedBy || '',
    claimedAt: row.claimedAt || '',
    followUpNote: row.followUpNote || '',
    credentialVersion: Number(row.credentialVersion || 0),
    pendingCredentialId: row.pendingCredentialId || '',
    pendingCredentialVersion: Number(row.pendingCredentialVersion || 0),
    descriptionConfirmedAt: row.descriptionConfirmedAt || '',
    descriptionConfirmedBy: row.descriptionConfirmedBy || '',
    messageSentAt: row.messageSentAt || '',
    messageSentBy: row.messageSentBy || '',
    activatedAt: row.activatedAt || '',
    activatedBy: row.activatedBy || '',
    updatedAt: row.updatedAt || '',
    updatedBy: row.updatedBy || '',
  };
}
