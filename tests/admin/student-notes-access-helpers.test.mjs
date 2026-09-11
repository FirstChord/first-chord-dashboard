import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activatePendingNotesCredential,
  applyPendingNotesCredential,
  buildNotesGroupDescription,
  buildNotesRolloutMessage,
  canActivateNotesAccess,
  deriveNotesAccessProgress,
  isStudentEligibleForNotesRollout,
  normaliseNotesAccessCode,
  publicNotesAccessState,
  redactNotesCodeFromMessage,
} from '../../lib/admin/student-notes-access-helpers.mjs';

test('normalises friendly notes codes without making punctuation significant', () => {
  assert.equal(normaliseNotesAccessCode('  Otter-27 '), 'otter27');
  assert.equal(normaliseNotesAccessCode('otter 27'), 'otter27');
});

test('builds the WhatsApp description and family message with the code and profile link', () => {
  const message = buildNotesRolloutMessage({
    studentName: 'Ayla Smith',
    code: 'otter-27',
    friendlyUrl: 'ayla',
  });
  assert.equal(
    buildNotesGroupDescription('otter-27', 'ayla'),
    'First Chord notes code: otter-27\nhttps://firstchord.co.uk/ayla',
  );
  assert.match(message, /Ayla’s First Chord dashboard \(https:\/\/firstchord\.co\.uk\/ayla\)/);
  assert.match(message, /Practice Chat lesson notes/);
  assert.match(message, /\*otter-27\*/);
  assert.match(message, /WhatsApp group’s description/);
  assert.equal(
    redactNotesCodeFromMessage(message, 'otter-27').includes('*[ACCESS CODE]*'),
    true,
  );
});

test('omits the profile link when the student has no friendly URL', () => {
  assert.equal(buildNotesGroupDescription('otter-27'), 'First Chord notes code: otter-27');
  const message = buildNotesRolloutMessage({ studentName: 'Ayla Smith', code: 'otter-27' });
  assert.match(message, /Ayla’s First Chord dashboard\. Their/);
  assert.doesNotMatch(message, /https?:/);
});

test('redacts the access code before a copied message is logged', () => {
  const message = 'The code is otter-27 and it is in the description.';
  assert.equal(
    redactNotesCodeFromMessage(message, 'otter-27'),
    'The code is [ACCESS CODE] and it is in the description.',
  );
});

test('activation requires a pending code and both human confirmations', () => {
  assert.equal(canActivateNotesAccess({
    pendingCredentialId: 'pending-1',
    descriptionConfirmedAt: '2026-07-23T12:00:00.000Z',
    messageSentAt: '2026-07-23T12:01:00.000Z',
  }), true);
  assert.equal(canActivateNotesAccess({
    pendingCredentialId: 'pending-1',
    descriptionConfirmedAt: '2026-07-23T12:00:00.000Z',
  }), false);
});

test('a replacement stays pending without changing the active credential', () => {
  const next = applyPendingNotesCredential({
    protectionEnabled: true,
    activeCodeCiphertext: 'old-encrypted',
    activeCodeSalt: 'old-salt',
    activeCodeVerifier: 'old-verifier',
    credentialVersion: 2,
    descriptionConfirmedAt: 'old-confirmation',
    messageSentAt: 'old-message',
  }, {
    id: 'pending-3',
    ciphertext: 'new-encrypted',
    salt: 'new-salt',
    verifier: 'new-verifier',
    version: 3,
  });

  assert.equal(next.activeCodeCiphertext, 'old-encrypted');
  assert.equal(next.credentialVersion, 2);
  assert.equal(next.pendingCodeCiphertext, 'new-encrypted');
  assert.equal(next.pendingCredentialVersion, 3);
  assert.equal(next.descriptionConfirmedAt, '');
  assert.equal(next.messageSentAt, '');
});

test('activation promotes the pending credential and invalidates the previous version', () => {
  const activated = activatePendingNotesCredential({
    protectionEnabled: true,
    activeCodeCiphertext: 'old-encrypted',
    credentialVersion: 2,
    pendingCredentialId: 'pending-3',
    pendingCodeCiphertext: 'new-encrypted',
    pendingCodeSalt: 'new-salt',
    pendingCodeVerifier: 'new-verifier',
    pendingCredentialVersion: 3,
    descriptionConfirmedAt: '2026-07-23T12:00:00.000Z',
    messageSentAt: '2026-07-23T12:01:00.000Z',
    claimedBy: 'admin@example.com',
  }, {
    actorEmail: 'admin@example.com',
    now: '2026-07-23T12:02:00.000Z',
  });

  assert.equal(activated.activeCodeCiphertext, 'new-encrypted');
  assert.equal(activated.credentialVersion, 3);
  assert.equal(activated.pendingCredentialId, '');
  assert.equal(activated.claimedBy, '');
  assert.equal(activated.workflowStatus, 'completed');
});

test('campaign progress separates protected, active, remaining, and follow-up records', () => {
  const progress = deriveNotesAccessProgress([
    { state: { workflowStatus: 'completed', protectionEnabled: true } },
    { state: { workflowStatus: 'in_progress' } },
    { state: { workflowStatus: 'not_started' } },
    { state: { workflowStatus: 'needs_follow_up' } },
  ]);
  assert.deepEqual(progress, {
    total: 4,
    completed: 1,
    inProgress: 1,
    remaining: 1,
    followUp: 1,
  });
});

test('missing access state preserves the phased legacy-public default', () => {
  assert.deepEqual(publicNotesAccessState(null), {
    mode: 'legacy_public',
    protectionEnabled: false,
    credentialVersion: 0,
  });
  assert.equal(publicNotesAccessState({ protectionEnabled: true, credentialVersion: 3 }).mode, 'protected');
});

test('only the named Test Studenty profile is eligible among test records', () => {
  assert.equal(isStudentEligibleForNotesRollout({
    mmsId: 'sdt_fBg9JN',
    isTestStudent: true,
    lifecycleStatus: 'active',
    registry: { friendlyUrl: 'test' },
  }), true);
  assert.equal(isStudentEligibleForNotesRollout({
    mmsId: 'sdt_other_test',
    isTestStudent: true,
    lifecycleStatus: 'active',
    registry: { friendlyUrl: 'other-test' },
  }), false);
  assert.equal(isStudentEligibleForNotesRollout({
    mmsId: 'sdt_real',
    isTestStudent: false,
    lifecycleStatus: 'active',
    registry: { friendlyUrl: 'real' },
  }), true);
});
