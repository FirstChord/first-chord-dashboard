import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecordException, buildRecordsNudgeEmail, decideRecordsNudge, payrollRecordReadiness, recordNudgeFingerprint } from '../../lib/admin/payroll-record-readiness.mjs';
import { validatePayrollReview } from '../../lib/admin/payroll-review-helpers.mjs';

function row() {
  return {
    payrollId: 'payroll_tutor_2026-09-28_2026-10-04', status: 'draft', periodOpen: false, cadenceDue: true,
    expectedAmount: 24, lessonCount: 2, teachingMinutes: 60,
    payableSlots: [
      { timing: 'past', startAt: '2026-10-01T16:00:00', students: [{ attendanceId: 'a1', studentId: 's1', studentName: 'Alice', status: 'Present', hasStudentNote: false }] },
      { timing: 'past', startAt: '2026-10-02T16:00:00', students: [{ attendanceId: 'a2', studentId: 's2', studentName: 'Bob', status: 'AbsentNoMakeup', hasStudentNote: false }] },
    ],
    reviewSlots: [],
  };
}

test('only attended lessons require practice notes; paid absence is not a missing note', () => {
  const state = payrollRecordReadiness(row());
  assert.deepEqual(state.unresolvedNotes.map((item) => item.attendanceId), ['a1']);
  assert.equal(state.ready, false);
  assert.throws(() => validatePayrollReview({ preview: row(), expectedAmount: 24, lessonCount: 2, teachingMinutes: 60 }), /practice notes/);
  const complete = row(); complete.payableSlots[0].students[0].hasStudentNote = true;
  assert.equal(payrollRecordReadiness(complete).ready, true);
  assert.doesNotThrow(() => validatePayrollReview({ preview: complete, expectedAmount: 24, lessonCount: 2, teachingMinutes: 60 }));
});

test('school exception is exact, reasoned and auditable, never a completed MMS note', () => {
  const preview = row();
  assert.throws(() => addRecordException({ row: preview, attendanceId: 'other', reason: 'Not applicable', actor: 'admin', recordedAt: '2026-10-05T10:00:00Z' }), /no longer/);
  assert.throws(() => addRecordException({ row: preview, attendanceId: 'a1', reason: 'no', actor: 'admin', recordedAt: '2026-10-05T10:00:00Z' }), /specific reason/);
  preview.recordExceptionsJson = addRecordException({ row: preview, attendanceId: 'a1', reason: 'Lesson was a supervised assessment, no practice task', actor: 'tom@example.test', recordedAt: '2026-10-05T10:00:00Z' });
  assert.equal(payrollRecordReadiness(preview).ready, true);
  assert.equal(preview.payableSlots[0].students[0].hasStudentNote, false);
  assert.match(preview.recordExceptionsJson, /tom@example.test/);
  assert.doesNotThrow(() => validatePayrollReview({ preview, expectedAmount: 24, lessonCount: 2, teachingMinutes: 60 }));
});

test('one digest is ordered, attributed to exact lessons, and never sends for uncertain or unchanged records', () => {
  const preview = row();
  preview.reviewSlots = [{ timing: 'past', startAt: '2026-09-30T15:00:00', students: [{ attendanceId: 'a0', studentName: 'Zed', status: 'Unrecorded' }] }];
  const first = decideRecordsNudge({ row: preview, contactEmail: 'tutor@example.test', verifiedAt: '2026-01-01' });
  assert.equal(first.ok, true);
  const message = buildRecordsNudgeEmail({ tutorName: 'Tutor Smith', periodStart: '2026-09-28', periodEnd: '2026-10-04', readiness: first.readiness });
  assert.ok(message.plainText.indexOf('Zed — attendance') < message.plainText.indexOf('Alice — practice note'));
  assert.match(message.plainText, /firstchord.co.uk\/dashboard/);
  assert.doesNotMatch(message.plainText, /£|invoice link/);
  preview.recordsNudgeStatus = 'sent'; preview.recordsNudgeFingerprint = first.fingerprint; preview.recordsNudgeTo = 'tutor@example.test';
  assert.equal(decideRecordsNudge({ row: preview, contactEmail: 'tutor@example.test', verifiedAt: '2026-01-01' }).reason, 'already_sent');
  assert.equal(decideRecordsNudge({ row: preview, contactEmail: 'new@example.test', verifiedAt: '2026-01-02' }).ok, true);
  preview.recordsNudgeStatus = 'unknown';
  assert.equal(decideRecordsNudge({ row: preview, contactEmail: 'tutor@example.test', verifiedAt: '2026-01-01' }).reason, 'check_gmail');
  preview.recordsNudgeStatus = '';
  preview.reviewSlots[0].students[0].attendanceId = '';
  assert.equal(decideRecordsNudge({ row: preview, contactEmail: 'tutor@example.test', verifiedAt: '2026-01-01' }).reason, 'uncertain_record');
  assert.notEqual(recordNudgeFingerprint(preview), first.fingerprint);
});
