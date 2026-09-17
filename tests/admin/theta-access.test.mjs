import assert from 'node:assert/strict';
import test from 'node:test';

import { STUDENTS_REGISTRY } from '../../lib/config/students-registry.js';
import {
  enhanceStudentsWithThetaAccess,
  getThetaAccessForStudent,
  THETA_MUSIC_LOGIN_URL,
} from '../../lib/theta-access.mjs';

test('Theta access is enabled only for Caroline Bingley', () => {
  const enabledStudentIds = Object.entries(STUDENTS_REGISTRY)
    .filter(([, student]) => student.thetaEnabled === true)
    .map(([studentId]) => studentId);

  assert.deepEqual(enabledStudentIds, ['sdt_QbBNJq']);
  assert.deepEqual(getThetaAccessForStudent('sdt_QbBNJq'), {
    studentId: 'sdt_QbBNJq',
    loginUrl: THETA_MUSIC_LOGIN_URL,
  });

  assert.equal(getThetaAccessForStudent('sdt_QP01Jp'), null);
  assert.equal(getThetaAccessForStudent(''), null);
});

test('tutor roster enrichment exposes only the public Theta link', () => {
  const students = enhanceStudentsWithThetaAccess([
    { mms_id: 'sdt_QbBNJq', name: 'Caroline Bingley' },
    { mms_id: 'sdt_QP01Jp', name: 'Yarah Love' },
  ]);

  assert.deepEqual(students[0], {
    mms_id: 'sdt_QbBNJq',
    name: 'Caroline Bingley',
    hasTheta: true,
    thetaUrl: THETA_MUSIC_LOGIN_URL,
  });
  assert.deepEqual(students[1], {
    mms_id: 'sdt_QP01Jp',
    name: 'Yarah Love',
  });
  assert.equal('thetaUsername' in students[0], false);
  assert.equal('thetaCredentials' in students[0], false);
});
