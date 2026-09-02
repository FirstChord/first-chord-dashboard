import test from 'node:test';
import assert from 'node:assert/strict';

import { WORKFLOW_DIRECTORY_GROUPS } from '../../lib/admin/workflow-directory.mjs';

const previousDestinations = [
  '/admin/lessons',
  '/admin/tutors',
  '/admin/waiting',
  '/admin/showcase',
  '/admin/holidays',
  '/admin/workflows/parent-understanding',
  '/admin/workflows/student-notes-access',
  '/admin/workflows/tutor-absence',
  '/admin/workflows/cover-bank',
  '/admin/incoming-messages',
  '/admin/finance/payroll',
  '/admin/finance',
].sort();

test('workflow directory groups every existing destination exactly once', () => {
  const destinations = WORKFLOW_DIRECTORY_GROUPS
    .flatMap((group) => group.items.map((item) => item.href));

  assert.deepEqual([...destinations].sort(), previousDestinations);
  assert.equal(new Set(destinations).size, destinations.length);
});

test('workflow directory uses the agreed stable mental model', () => {
  assert.deepEqual(
    WORKFLOW_DIRECTORY_GROUPS.map((group) => group.title),
    ['Families & enquiries', 'Tutors & cover', 'Regular school routines', 'School checks'],
  );
});

test('workflow directory replaces internal or ambiguous labels', () => {
  const labels = WORKFLOW_DIRECTORY_GROUPS.flatMap((group) => group.items.map((item) => item.title));

  assert.ok(labels.includes('Parent Check-ins'));
  assert.ok(labels.includes('Tutor Changes'));
  assert.ok(labels.includes('Lesson Calendar & Data Checks'));
  assert.ok(!labels.includes('Lesson Parity'));
});
