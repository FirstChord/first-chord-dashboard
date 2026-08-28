import test from 'node:test';
import assert from 'node:assert/strict';

import { getStudentDashboardFirstName } from '../../lib/student-portal-display.mjs';

test('student dashboard heading uses the registry first name instead of a joined legacy name', () => {
  assert.equal(getStudentDashboardFirstName({ id: 'sdt_f576Jx', name: 'Ninagavlin' }), 'Nina');
  assert.equal(getStudentDashboardFirstName({ id: 'sdt_BpDPJZ', name: 'Calanclacherty' }), 'Calan');
});

test('student dashboard heading has safe fallbacks outside the registry', () => {
  assert.equal(getStudentDashboardFirstName({ name: 'Ada Lovelace' }, {}), 'Ada');
  assert.equal(getStudentDashboardFirstName({}, {}), 'Student');
});
