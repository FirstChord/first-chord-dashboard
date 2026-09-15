import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPracticeNoteLessonGroup,
  describePracticeNoteGroupDelivery,
  joinStudentNames,
  normaliseLessonGroupAttendance,
  planPracticeNoteGroupDelivery,
} from '../../lib/admin/practice-notes-group-helpers.mjs';

// The real shape MMS returns for a shared lesson: one event, one attendance
// record per student, and the two sisters already out of step with each other.
const PAPADAKIS_ATTENDANCES = [
  {
    ID: 'atn_zHxv19Js',
    EventID: 'evt_zrTw33JV',
    StudentID: 'sdt_HlXyJl',
    StudentFullName: 'Sophia Papadakis',
    AttendanceStatus: 'Unrecorded',
  },
  {
    ID: 'atn_zHxv1hJH',
    EventID: 'evt_zrTw33JV',
    StudentID: 'sdt_M3RnJG',
    StudentFullName: 'Athena Papadakis',
    AttendanceStatus: 'Present',
  },
];

const YIOTA = { recipientProfileId: 'prt_sc6jJw', name: 'Yiota Vlachaki', email: 'yiotavl@gmail.com' };

function sistersRecipients() {
  return new Map([
    ['sdt_HlXyJl', [YIOTA]],
    ['sdt_M3RnJG', [YIOTA]],
  ]);
}

test('joinStudentNames reads as a sentence at one, two, and more', () => {
  assert.equal(joinStudentNames([]), '');
  assert.equal(joinStudentNames(['Athena']), 'Athena');
  assert.equal(joinStudentNames(['Athena', 'Sophia']), 'Athena and Sophia');
  assert.equal(joinStudentNames(['Alister', 'Carolyn', 'Thomas']), 'Alister, Carolyn and Thomas');
  assert.equal(joinStudentNames(['Athena', '', '  ']), 'Athena');
});

test('normaliseLessonGroupAttendance falls back to first and last name', () => {
  assert.equal(
    normaliseLessonGroupAttendance({ StudentFirstName: 'Lena', StudentLastName: 'Maclachlan' }).studentName,
    'Lena Maclachlan',
  );
});

test('the launched student leads the group and every member keeps their own attendance record', () => {
  const group = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });

  assert.equal(group.isGroup, true);
  assert.equal(group.memberCount, 2);
  assert.equal(group.leadPresent, true);
  assert.deepEqual(group.members.map((m) => m.studentName), ['Athena Papadakis', 'Sophia Papadakis']);
  // Distinct attendance records on the one shared event — that is what makes a
  // single group action able to mark each student individually.
  assert.deepEqual(group.members.map((m) => m.attendanceId), ['atn_zHxv1hJH', 'atn_zHxv19Js']);
  assert.equal(new Set(group.members.map((m) => m.eventId)).size, 1);
  // Already out of step, which is the state this feature exists to fix.
  assert.deepEqual(group.members.map((m) => m.attendanceStatus), ['Present', 'Unrecorded']);
});

test('a lesson with one student is not a group', () => {
  const group = buildPracticeNoteLessonGroup({
    attendances: [PAPADAKIS_ATTENDANCES[0]],
    leadStudentMmsId: 'sdt_HlXyJl',
  });
  assert.equal(group.isGroup, false);
  assert.equal(group.memberCount, 1);
});

test('siblings sharing one parent inbox get one email naming both', () => {
  const { members } = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });
  const { plan, emailCount, attendanceCount } = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: sistersRecipients(),
  });

  // Both marked, one email.
  assert.equal(attendanceCount, 2);
  assert.equal(emailCount, 1);

  const [athena, sophia] = plan;
  assert.equal(athena.emailRole, 'carrier');
  assert.equal(athena.emailStudentLabel, 'Athena Papadakis and Sophia Papadakis');
  assert.equal(athena.recipient.email, 'yiotavl@gmail.com');

  // Covered, not skipped: "no email was needed" and "the email failed" must
  // never read the same in the log.
  assert.equal(sophia.emailRole, 'covered');
  assert.equal(sophia.emailReason, 'covered_by_group_email');
  assert.equal(sophia.coveredBy, 'sdt_M3RnJG');
});

test('students with different parents each get their own email', () => {
  const { members } = buildPracticeNoteLessonGroup({
    attendances: [
      { ID: 'atn_1', EventID: 'evt_1', StudentID: 'sdt_a', StudentFullName: 'Ada Two', AttendanceStatus: 'Unrecorded' },
      { ID: 'atn_2', EventID: 'evt_1', StudentID: 'sdt_b', StudentFullName: 'Ben One', AttendanceStatus: 'Unrecorded' },
    ],
    leadStudentMmsId: 'sdt_a',
  });
  const { plan, emailCount } = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: new Map([
      ['sdt_a', [{ email: 'one@example.com', name: 'One' }]],
      ['sdt_b', [{ email: 'two@example.com', name: 'Two' }]],
    ]),
  });

  assert.equal(emailCount, 2);
  assert.deepEqual(plan.map((entry) => entry.emailRole), ['carrier', 'carrier']);
  assert.deepEqual(plan.map((entry) => entry.emailStudentLabel), ['Ada Two', 'Ben One']);
});

test('recipient matching ignores address case and padding', () => {
  const { members } = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });
  const { emailCount } = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: new Map([
      ['sdt_M3RnJG', [{ email: 'Yiotavl@Gmail.com ' }]],
      ['sdt_HlXyJl', [{ email: ' yiotavl@gmail.com' }]],
    ]),
  });
  assert.equal(emailCount, 1);
});

test('an attendance-only lesson marks everyone and emails nobody', () => {
  // The ukulele orchestra: adults with their own contacts, where a parent
  // practice-note email is the wrong shape entirely.
  const { members } = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });
  const { plan, emailCount, attendanceCount } = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: sistersRecipients(),
    sendEmails: false,
  });

  assert.equal(attendanceCount, 2);
  assert.equal(emailCount, 0);
  assert.deepEqual(plan.map((entry) => entry.emailRole), ['none', 'none']);
  assert.deepEqual([...new Set(plan.map((entry) => entry.emailReason))], ['attendance_only_lesson']);
});

test('a member with no email-capable contact is named, not silently dropped', () => {
  const { members } = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });
  const { plan, emailCount, attendanceCount } = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: new Map([['sdt_M3RnJG', [YIOTA]]]),
  });

  // Still marked present — a missing email is not a reason to skip attendance.
  assert.equal(attendanceCount, 2);
  assert.equal(emailCount, 1);
  assert.equal(plan[1].emailRole, 'none');
  assert.equal(plan[1].emailReason, 'no_email_capable_recipient');
  assert.equal(plan[0].emailStudentLabel, 'Athena Papadakis');
});

test('the summary line says who is marked and who is emailed', () => {
  const { members } = buildPracticeNoteLessonGroup({
    attendances: PAPADAKIS_ATTENDANCES,
    leadStudentMmsId: 'sdt_M3RnJG',
  });
  const sisters = planPracticeNoteGroupDelivery({ members, recipientsByStudentMmsId: sistersRecipients() });

  assert.equal(
    describePracticeNoteGroupDelivery({ plan: sisters.plan }),
    'Athena Papadakis and Sophia Papadakis will be marked present. One email: Athena Papadakis and Sophia Papadakis → yiotavl@gmail.com.',
  );
  assert.match(
    describePracticeNoteGroupDelivery({ plan: sisters.plan, attendanceStatus: 'AbsentNoMakeup' }),
    /^Athena Papadakis and Sophia Papadakis will be marked absent with no makeup\./u,
  );

  const orchestra = planPracticeNoteGroupDelivery({
    members,
    recipientsByStudentMmsId: sistersRecipients(),
    sendEmails: false,
  });
  assert.match(
    describePracticeNoteGroupDelivery({ plan: orchestra.plan, sendEmails: false }),
    /No practice-note email is sent for this lesson\.$/u,
  );
  assert.equal(describePracticeNoteGroupDelivery({ plan: [] }), 'No students found on this lesson.');
});
