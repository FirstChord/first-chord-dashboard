import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runPracticeNoteGroupDelivery,
  summarisePracticeNoteGroupDelivery,
} from '../../lib/admin/practice-note-group-delivery.mjs';

const SISTERS = [
  { studentMmsId: 'sdt_M3RnJG', studentName: 'Athena', attendanceId: 'atn_a', emailRole: 'carrier' },
  { studentMmsId: 'sdt_HlXyJl', studentName: 'Sophia', attendanceId: 'atn_b', emailRole: 'covered', emailReason: 'covered_by_group_email' },
];

test('every member is delivered, one at a time, in plan order', async () => {
  const order = [];
  const result = await runPracticeNoteGroupDelivery({
    plan: SISTERS,
    deliverMember: async (entry) => {
      order.push(entry.studentName);
      return { ok: true, attendanceSaved: true, emailSent: entry.emailRole === 'carrier' };
    },
  });

  assert.deepEqual(order, ['Athena', 'Sophia']);
  assert.equal(result.status, 'completed');
  assert.equal(result.ok, true);
  assert.equal(result.attendanceSavedCount, 2);
  // Both marked, one email — the whole point of the feature.
  assert.equal(result.emailSentCount, 1);
  assert.equal(result.message, 'Athena and Sophia marked in MMS, one email sent.');
});

test('a member that throws does not stop the rest, and is named', async () => {
  const result = await runPracticeNoteGroupDelivery({
    plan: SISTERS,
    deliverMember: async (entry) => {
      if (entry.studentName === 'Athena') throw new Error('MMS attendance note save failed: 500');
      return { ok: true, attendanceSaved: true, emailSent: false };
    },
  });

  // Sophia still got marked: one sister's failure must not hold the other back.
  assert.equal(result.status, 'partial');
  assert.equal(result.ok, false);
  assert.equal(result.partialSuccess, true);
  assert.equal(result.attendanceSavedCount, 1);
  assert.deepEqual(result.failedStudents, ['Athena']);
  assert.equal(result.results[0].error, 'MMS attendance note save failed: 500');
  assert.equal(result.message, 'Sophia marked in MMS, no email sent. Still to sort: Athena.');
});

test('a group where nothing saved says so plainly', async () => {
  const result = await runPracticeNoteGroupDelivery({
    plan: SISTERS,
    deliverMember: async () => ({ ok: false, attendanceSaved: false, emailSent: false, error: 'claim failed' }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.partialSuccess, false);
  assert.match(result.message, /^Nothing was saved for Athena and Sophia\./u);
});

test('an attendance-only group reports no email rather than a missing one', async () => {
  const result = await runPracticeNoteGroupDelivery({
    plan: [
      { studentMmsId: 'sdt_1', studentName: 'Alister', attendanceId: 'atn_1', emailRole: 'none', emailReason: 'attendance_only_lesson' },
      { studentMmsId: 'sdt_2', studentName: 'Carolyn', attendanceId: 'atn_2', emailRole: 'none', emailReason: 'attendance_only_lesson' },
    ],
    deliverMember: async () => ({ ok: true, attendanceSaved: true, emailSent: false }),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.emailSentCount, 0);
  assert.equal(result.message, 'Alister and Carolyn marked in MMS, no email sent.');
  assert.deepEqual([...new Set(result.results.map((r) => r.emailReason))], ['attendance_only_lesson']);
});

test('the per-student reason survives into the result', async () => {
  const result = await runPracticeNoteGroupDelivery({
    plan: SISTERS,
    deliverMember: async () => ({ ok: true, attendanceSaved: true, emailSent: false }),
  });
  assert.equal(result.results[1].emailReason, 'covered_by_group_email');
});

test('runPracticeNoteGroupDelivery refuses to run without a delivery function', async () => {
  await assert.rejects(
    () => runPracticeNoteGroupDelivery({ plan: SISTERS }),
    /requires a deliverMember function/u,
  );
});

test('summarise handles an empty group', () => {
  const summary = summarisePracticeNoteGroupDelivery([]);
  assert.equal(summary.status, 'empty');
  assert.equal(summary.ok, false);
  assert.equal(summary.message, 'No students were delivered.');
});

test('three names read as a list', () => {
  const summary = summarisePracticeNoteGroupDelivery([
    { studentName: 'Alister', attendanceSaved: true, ok: true },
    { studentName: 'Carolyn', attendanceSaved: true, ok: true },
    { studentName: 'Thomas', attendanceSaved: true, ok: true },
  ]);
  assert.equal(summary.message, 'Alister, Carolyn and Thomas marked in MMS, no email sent.');
});
