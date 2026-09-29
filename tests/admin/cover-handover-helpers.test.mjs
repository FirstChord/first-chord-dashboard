import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  buildCoverHandoverContext,
  fallbackCoverHandoverSummary,
  validateCoverHandoverEvent,
} from '../../lib/admin/cover-handover-helpers.mjs';
import { createCoverHandoverPdf } from '../../lib/admin/cover-handover-pdf.mjs';

const state = {
  absenceDate: '2026-09-30',
  affectedLessons: [
    { studentMmsId: 'sdt_A', studentName: 'Ada Example', lessonTime: '10:00', instrument: 'Piano' },
    { studentMmsId: 'sdt_B', studentName: 'Ben Example', lessonTime: '11:00', instrument: 'Guitar' },
  ],
};

test('cover handover keeps each student scoped and excludes future, old and undelivered notes', () => {
  const students = buildCoverHandoverContext({
    state,
    practiceRows: [
      { studentMmsId: 'sdt_A', lessonDate: '2026-09-23', operationStatus: 'completed', whatWeDid: 'Major scales', practiceGoals: 'Hands together at 70%' },
      { studentMmsId: 'sdt_A', lessonDate: '2026-09-30', operationStatus: 'completed', whatWeDid: 'Future note' },
      { studentMmsId: 'sdt_A', lessonDate: '2026-06-01', operationStatus: 'completed', whatWeDid: 'Old note' },
      { studentMmsId: 'sdt_A', lessonDate: '2026-09-24', operationStatus: 'pending', whatWeDid: 'Undelivered note' },
      { studentMmsId: 'sdt_C', lessonDate: '2026-09-25', operationStatus: 'completed', whatWeDid: 'Unrelated student' },
    ],
    mmsHistories: {
      sdt_A: [{ date: '2026-09-23T10:00:00', notes: 'Duplicate of structured note' }, { date: '2026-09-16T10:00:00', notes: 'Use http://example.com and call 07123456789' }],
      sdt_B: [],
    },
  });
  assert.equal(students.length, 2);
  assert.deepEqual(students[0].notes.map((note) => note.date), ['2026-09-23', '2026-09-16']);
  assert.equal(students[0].notes[0].goal, 'Hands together at 70%');
  assert.match(students[0].notes[1].focus, /\[link removed\].*\[phone removed\]/u);
  assert.equal(students[1].notes.length, 0);
  assert.match(fallbackCoverHandoverSummary(students[1]), /No teaching notes found/u);
});

test('cover handover stops when an MMS event changed or has a different student', () => {
  const target = { eventId: 'evt_A', startAt: '2026-09-30T10:00:00', durationMinutes: 30, studentIds: ['sdt_A'] };
  const event = { ID: 'evt_A', StartDate: target.startAt, Duration: 30, OriginalTeacherID: 'tch_old', TeacherID: 'tch_cover', Attendances: [{ StudentID: 'sdt_A' }] };
  assert.doesNotThrow(() => validateCoverHandoverEvent({ event, target, absentTeacherId: 'tch_old', coverTeacherId: 'tch_cover' }));
  assert.throws(() => validateCoverHandoverEvent({ event: { ...event, Attendances: [{ StudentID: 'sdt_B' }] }, target, absentTeacherId: 'tch_old', coverTeacherId: 'tch_cover' }), /students/u);
  assert.throws(() => validateCoverHandoverEvent({ event: { ...event, StartDate: '2026-09-30T10:30:00' }, target, absentTeacherId: 'tch_old', coverTeacherId: 'tch_cover' }), /moved/u);
});

test('cover PDF is a valid, bounded document including students with no recent notes', async () => {
  const bytes = await createCoverHandoverPdf({
    coverDate: '2026-09-30', coverTutorName: 'Cover Tutor',
    students: [
      { studentName: 'Ada Example', lessonTime: '10:00', instrument: 'Piano', summary: 'Continue hands-together scales at 70%.', evidence: [{ date: '2026-09-23', source: 'Practice Chat' }] },
      { studentName: 'Ben Example', lessonTime: '11:00', instrument: 'Guitar', summary: 'No recent teaching notes found.', evidence: [] },
    ],
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.ok(bytes.length > 1000);
});

test('cover PDF paginates a larger group rather than clipping a student', async () => {
  const students = Array.from({ length: 12 }, (_, index) => ({
    studentName: `Student ${index + 1}`,
    lessonTime: `${`${9 + index}`.padStart(2, '0')}:00`,
    instrument: 'Piano',
    summary: 'Latest practice goal: keep a steady pulse through the first eight bars. Recent work: hands together at a comfortable tempo, then increase gradually.',
    evidence: [{ date: '2026-09-23', source: 'Practice Chat' }],
  }));
  const bytes = await createCoverHandoverPdf({ coverDate: '2026-09-30', coverTutorName: 'Cover Tutor', students });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
});
