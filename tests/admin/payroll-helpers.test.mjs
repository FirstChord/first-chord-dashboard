import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTutorPay } from '../../lib/admin/cost-helpers.mjs';
import {
  attendanceQueryCoversPeriod,
  buildPayrollAttendanceQuery,
  buildPayrollPeriod,
  buildPayrollPreview,
  buildPayrollRunId,
  nextMonday,
  normalisePayrollRunRow,
  isPayrollWindowDue,
  isPayrollPeriodOpen,
  findBlockingReviewedRun,
  resolveTutorPayrollWindow,
  overlapsPaidRun,
  selectPayrollRosterRows,
} from '../../lib/admin/payroll-helpers.mjs';

function attendance(overrides = {}) {
  return {
    ID: overrides.attendanceId || `atn_${overrides.EventID || '1'}`,
    EventID: overrides.EventID || 'evt_1',
    TeacherID: overrides.TeacherID || 'tch_zMX5Jc', // Calum
    OriginalTeacherID: overrides.OriginalTeacherID || overrides.TeacherID || 'tch_zMX5Jc',
    AttendanceStatus: overrides.AttendanceStatus || 'Present',
    EventStartDate: overrides.EventStartDate || '2026-06-24T16:00:00',
    EventDuration: overrides.EventDuration ?? 30,
    StudentID: overrides.StudentID || 'sdt_1',
    Student: { ID: overrides.StudentID || 'sdt_1', Name: overrides.StudentName || 'Student One' },
    Teacher: { ID: overrides.TeacherID || 'tch_zMX5Jc', Name: overrides.TeacherName || 'Calum Steel' },
  };
}

test('retired tutors leave the live payroll queue after settlement, while open statements remain reachable', () => {
  const rows = [
    { tutorShortName: 'Eléna', tutor: 'Eléna Esposito', teacherId: 'tch_elena' },
    { tutorShortName: 'Patrick', tutor: 'Patrick Shand', teacherId: 'tch_patrick' },
    { tutorShortName: 'Calum', tutor: 'Calum Steel', teacherId: 'tch_calum' },
  ];
  const lifecycleRows = [
    { teacherId: 'tch_elena', status: 'retired' },
    { teacherId: 'tch_patrick', status: 'retired' },
  ];
  const savedRuns = [
    { teacher_id: 'tch_elena', tutor_short_name: 'Eléna', status: 'paid' },
    { teacher_id: 'tch_patrick', tutor_short_name: 'Patrick', status: 'reviewed' },
  ];
  assert.deepEqual(selectPayrollRosterRows(rows, lifecycleRows, savedRuns).map((row) => row.tutorShortName), ['Patrick', 'Calum']);
  assert.deepEqual(selectPayrollRosterRows(rows, lifecycleRows, [{ ...savedRuns[1], status: 'paid' }]).map((row) => row.tutorShortName), ['Calum']);
  assert.deepEqual(selectPayrollRosterRows(rows, [], savedRuns).map((row) => row.tutorShortName), ['Eléna', 'Patrick', 'Calum']);
});

test('nextMonday returns today when today is Monday and the next Monday otherwise', () => {
  assert.equal(nextMonday(new Date('2026-09-21T10:00:00Z')), '2026-09-21');
  assert.equal(nextMonday(new Date('2026-09-22T10:00:00Z')), '2026-09-28');
  assert.equal(nextMonday(new Date('2026-09-20T23:30:00Z')), '2026-09-21'); // Monday in London during BST
});

test('an inclusive payroll period stays open until the following London day', () => {
  assert.equal(isPayrollPeriodOpen('2026-09-27', new Date('2026-09-27T22:30:00Z')), true);
  assert.equal(isPayrollPeriodOpen('2026-09-27', new Date('2026-09-27T23:30:00Z')), false); // Monday in London
});

test('buildPayrollPeriod uses a Monday cycle date with Monday-Sunday weekly and biweekly windows', () => {
  assert.deepEqual(buildPayrollPeriod({ payDate: '2026-09-28', cadence: 'weekly' }), {
    payDate: '2026-09-28',
    periodStart: '2026-09-21',
    periodEnd: '2026-09-27',
    days: 7,
    cadence: 'weekly',
  });
  assert.equal(buildPayrollPeriod({ payDate: '2026-09-28', cadence: 'biweekly' }).periodStart, '2026-09-14');
});

test('buildPayrollPeriod supports a three-week window per tutor', () => {
  const p = buildPayrollPeriod({ payDate: '2026-07-01', cadence: 'three-weekly' });
  assert.equal(p.days, 21);
  assert.equal(p.periodStart, '2026-06-10');
  assert.equal(p.cadence, 'three-weekly');
});

test('a biweekly tutor becomes due only when a complete two-week window has accrued', () => {
  assert.equal(isPayrollWindowDue({ periodStart: '2026-09-09', periodEnd: '2026-09-15', cadence: 'biweekly' }), false);
  assert.equal(isPayrollWindowDue({ periodStart: '2026-09-02', periodEnd: '2026-09-15', cadence: 'biweekly' }), true);
  assert.equal(isPayrollWindowDue({ periodStart: '2026-09-09', periodEnd: '2026-09-15', cadence: 'biweekly', basis: 'override' }), true);
  assert.equal(isPayrollWindowDue({ periodStart: '2026-09-17', periodEnd: '2026-09-20', cadence: 'biweekly', cutover: true }), true);
});

test('cutover closes through Sunday, requires confirmation, and refuses to guess an unknown historical start', () => {
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly', invoice_cadence: 'biweekly' }]);
  const withHistory = buildPayrollPreview({
    payDate: '2026-09-21',
    tutorPay,
    savedRuns: [{ payroll_id: 'old', tutor_short_name: 'Calum', status: 'paid', period_start: '2026-09-07', period_end: '2026-09-16' }],
    attendanceRows: [attendance({ EventID: 'cutover', EventStartDate: '2026-09-17T16:00:00' })],
  }).rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(withHistory.periodStart, '2026-09-17');
  assert.equal(withHistory.periodEnd, '2026-09-20');
  assert.equal(withHistory.isCutover, true);
  assert.equal(withHistory.cadenceDue, true);
  assert.equal(withHistory.cutoverNeedsStart, false);
  assert.equal(withHistory.paymentRoute, 'confirmation');

  const withoutHistory = buildPayrollPreview({ payDate: '2026-09-21', tutorPay }).rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(withoutHistory.cutoverNeedsStart, true);

  const manuallyAnchored = buildPayrollPreview({
    payDate: '2026-09-21',
    tutorPay,
    overrides: { Calum: { start: '2026-09-14' } },
  }).rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(manuallyAnchored.cutoverNeedsStart, false);
  assert.equal(manuallyAnchored.periodStart, '2026-09-14');
});

test('an unresolved cutoff reserves its dates and blocks the next period without overlapping it', () => {
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]);
  const savedRuns = [
    { payroll_id: 'paid', tutor_short_name: 'Calum', status: 'paid', period_start: '2026-09-09', period_end: '2026-09-17' },
    { payroll_id: 'payroll_calum_2026-09-18_2026-09-20', tutor_short_name: 'Calum', status: 'reviewed', period_start: '2026-09-18', period_end: '2026-09-20', tutor_response: 'disputed' },
  ];
  const row = buildPayrollPreview({
    payDate: '2026-09-28',
    tutorPay,
    savedRuns,
    now: new Date('2026-09-22T12:00:00Z'),
  }).rows.find((entry) => entry.tutorShortName === 'Calum');
  assert.equal(row.periodStart, '2026-09-21');
  assert.equal(row.periodEnd, '2026-09-27');
  assert.equal(row.windowBasis, 'since_pending');
  assert.equal(row.priorRunPending.periodEnd, '2026-09-20');
  assert.equal(row.periodOpen, true);
  assert.equal(row.overlapsOutstanding, null);
});

test('a separately paid cutoff stays visible until the tutor responds, without becoming payable again', () => {
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]);
  const paid = {
    payroll_id: 'payroll_calum_2026-09-18_2026-09-20',
    pay_date: '2026-09-21',
    tutor_short_name: 'Calum',
    status: 'paid',
    paid_via: 'manual',
    paid_at: '2026-09-24',
    period_start: '2026-09-18',
    period_end: '2026-09-20',
    final_amount: '60',
  };
  const preview = (savedRuns) => buildPayrollPreview({ payDate: '2026-09-21', tutorPay, savedRuns })
    .rows.find((entry) => entry.tutorShortName === 'Calum');
  const awaiting = preview([paid]);
  assert.equal(awaiting.payrollId, paid.payroll_id);
  assert.equal(awaiting.status, 'paid');
  assert.equal(awaiting.owedAmount, 0);
  assert.equal(awaiting.overlapsPaid, null);
  assert.equal(awaiting.tutorResponse, '');
  assert.notEqual(preview([{ ...paid, tutor_response: 'confirmed' }]).payrollId, paid.payroll_id);
});

test('a reviewed custom cutoff reopens on its own cycle instead of becoming an empty later preview', () => {
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]);
  const row = buildPayrollPreview({
    payDate: '2026-09-21',
    tutorPay,
    attendanceRows: [attendance({ EventID: 'cutoff', EventStartDate: '2026-09-18T16:00:00' })],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-09-18_2026-09-20',
      pay_date: '2026-09-21',
      tutor_short_name: 'Calum',
      status: 'reviewed',
      period_start: '2026-09-18',
      period_end: '2026-09-20',
      lesson_count: '1',
      teaching_minutes: '30',
      expected_amount: '12',
      final_amount: '12',
    }],
  }).rows.find((entry) => entry.tutorShortName === 'Calum');

  assert.equal(row.payrollId, 'payroll_calum_2026-09-18_2026-09-20');
  assert.equal(row.periodStart, '2026-09-18');
  assert.equal(row.periodEnd, '2026-09-20');
  assert.equal(row.windowBasis, 'override');
  assert.equal(row.windowEmpty, false);
  assert.equal(row.status, 'reviewed');
  assert.equal(row.priorRunPending, null);
});

test('findBlockingReviewedRun excludes the statement being corrected but finds another open statement', () => {
  const rows = [
    { payroll_id: 'old', tutor_short_name: 'Calum', status: 'reviewed', period_end: '2026-09-20' },
    { payroll_id: 'other', tutor_short_name: 'Kenny', status: 'reviewed', period_end: '2026-09-20' },
  ];
  assert.equal(findBlockingReviewedRun(rows, { tutorShortName: 'Calum', payrollId: 'old' }), null);
  assert.equal(findBlockingReviewedRun(rows, { tutorShortName: 'Calum', payrollId: 'new' }).payrollId, 'old');
});

test('a paid run shows £0 owed but keeps finalAmount as the record', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [attendance({ EventID: 'evt_1', EventStartDate: '2026-06-24T16:00:00', EventDuration: 30 })],
    savedRuns: [{ payroll_id: 'payroll_calum_2026-06-24_2026-06-30', status: 'paid', final_amount: '50', expected_amount: '12' }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.status, 'paid');
  assert.equal(calum.owedAmount, 0);
  assert.equal(calum.finalAmount, 50);
  assert.equal(preview.totals.outstandingAmount, 0);
});

test('review lessons split into past (needs recording) vs upcoming (self-resolving)', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01', // weekly window 2026-06-24 .. 2026-06-30
    now: new Date('2026-06-29T12:00:00Z'),
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_past', AttendanceStatus: 'Unrecorded', EventStartDate: '2026-06-24T16:00:00' }),
      attendance({ EventID: 'evt_future', AttendanceStatus: 'Unrecorded', EventStartDate: '2026-06-30T16:00:00' }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.reviewLessonCount, 2);
  assert.equal(calum.reviewPastCount, 1);
  assert.equal(calum.reviewUpcomingCount, 1);
  assert.equal(calum.reviewSlots.find((s) => s.eventId === 'evt_past').timing, 'past');
  assert.equal(calum.reviewSlots.find((s) => s.eventId === 'evt_future').timing, 'upcoming');
});

test('resolveTutorPayrollWindow anchors to since-last-paid, falls back, caps, and detects empty', () => {
  // since last paid: window starts the day after the last paid period end
  const sincePaid = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-06-23' });
  assert.equal(sincePaid.periodStart, '2026-06-24');
  assert.equal(sincePaid.periodEnd, '2026-06-30');
  assert.equal(sincePaid.basis, 'since_paid');

  // first run: cadence length back from the pay date
  const firstRun = resolveTutorPayrollWindow({ payDate: '2026-07-01', cadence: 'weekly' });
  assert.equal(firstRun.periodStart, '2026-06-24');
  assert.equal(firstRun.basis, 'first_run');

  // override beats everything
  const override = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-06-23', overrideStart: '2026-06-17' });
  assert.equal(override.periodStart, '2026-06-17');
  assert.equal(override.basis, 'override');

  // very old anchor → capped at maxLookbackDays
  const capped = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-01-01', maxLookbackDays: 35 });
  assert.equal(capped.periodStart, '2026-05-27');
  assert.equal(capped.capped, true);

  // already paid through the window end → empty (nothing to pay)
  const empty = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-06-30' });
  assert.equal(empty.empty, true);
});

test('overlapsPaidRun flags windows that re-include an already-paid period', () => {
  const paid = [{ periodStart: '2026-06-17', periodEnd: '2026-06-23' }];
  assert.ok(overlapsPaidRun({ periodStart: '2026-06-17', periodEnd: '2026-06-30' }, paid));
  assert.equal(overlapsPaidRun({ periodStart: '2026-06-24', periodEnd: '2026-06-30' }, paid), null);
});

test('buildPayrollPreview anchors a tutor to since-last-paid from their paid runs', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [attendance({ EventID: 'evt_1', EventStartDate: '2026-06-24T16:00:00', EventDuration: 30 })],
    savedRuns: [{ payroll_id: 'payroll_calum_2026-06-10_2026-06-16', tutor_short_name: 'Calum', status: 'paid', period_start: '2026-06-10', period_end: '2026-06-16', final_amount: '24' }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.periodStart, '2026-06-17'); // day after last paid
  assert.equal(calum.windowBasis, 'since_paid');
  assert.equal(calum.lessonCount, 1);
});

test('buildPayrollRunId is stable by tutor and period', () => {
  assert.equal(
    buildPayrollRunId({ tutorKey: 'Calum Steel', periodStart: '2026-06-24', periodEnd: '2026-06-30' }),
    'payroll_calum_steel_2026-06-24_2026-06-30',
  );
});

test('buildPayrollPreview dedupes a 60-minute group and applies one £2 uplift', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_group', StudentID: 'a', StudentName: 'A', EventDuration: 60 }),
      attendance({ EventID: 'evt_group', StudentID: 'b', StudentName: 'B', EventDuration: 60 }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.lessonCount, 1);
  assert.equal(calum.expectedAmount, 26);
  assert.equal(calum.payableSlots[0].studentCount, 2);
});

test('buildPayrollPreview flags unrecorded lessons for review instead of paying them', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    attendanceRows: [
      attendance({ EventID: 'evt_present', AttendanceStatus: 'Present' }),
      attendance({ EventID: 'evt_unrecorded', AttendanceStatus: 'Unrecorded', EventStartDate: '2026-06-25T16:00:00' }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.lessonCount, 1);
  assert.equal(calum.reviewLessonCount, 1);
  assert.equal(calum.expectedAmount, 12);
});

test('AbsentNoMakeup is payable (invoiced); AbsentNotice is excluded (£0); only Unrecorded needs review', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_makeup', AttendanceStatus: 'AbsentNoMakeup', EventStartDate: '2026-06-24T16:00:00' }),
      attendance({ EventID: 'evt_notice', AttendanceStatus: 'AbsentNotice', EventStartDate: '2026-06-25T16:00:00' }),
      attendance({ EventID: 'evt_unrec', AttendanceStatus: 'Unrecorded', EventStartDate: '2026-06-26T16:00:00' }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  // AbsentNoMakeup → payable, paid
  assert.equal(calum.lessonCount, 1);
  assert.equal(calum.expectedAmount, 12);
  // AbsentNotice → excluded, not in review
  assert.equal(calum.excludedLessonCount, 1);
  // only the genuinely unrecorded lesson needs review
  assert.equal(calum.reviewLessonCount, 1);
  // the payable absence is flagged as a paid-absence slot
  assert.equal(calum.payableSlots[0].isPaidAbsence, true);
});

test('a mixed group with AbsentNotice + Unrecorded still needs review', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_grp', StudentID: 'a', StudentName: 'A', AttendanceStatus: 'AbsentNotice' }),
      attendance({ EventID: 'evt_grp', StudentID: 'b', StudentName: 'B', AttendanceStatus: 'Unrecorded' }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.reviewLessonCount, 1);
  assert.equal(calum.lessonCount, 0);
});

test('resolveTutorPayrollWindow lets an overrideEnd pull the window end earlier, never later', () => {
  // invoice closed Sunday: end pulled back from Tue 30 Jun to Sun 28 Jun
  const earlier = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-06-23', overrideEnd: '2026-06-28' });
  assert.equal(earlier.periodEnd, '2026-06-28');
  assert.equal(earlier.endCustom, true);
  // an end later than the default is ignored (those lessons belong to the next run)
  const later = resolveTutorPayrollWindow({ payDate: '2026-07-01', lastPaidThrough: '2026-06-23', overrideEnd: '2026-07-05' });
  assert.equal(later.periodEnd, '2026-06-30');
  assert.equal(later.endCustom, false);
});

test('buildPayrollPreview applies a per-tutor window end override and excludes later lessons', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_in', EventStartDate: '2026-06-26T16:00:00' }),
      attendance({ EventID: 'evt_out', EventStartDate: '2026-06-30T16:00:00' }),
    ],
    overrides: { Calum: { end: '2026-06-28' } },
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.periodEnd, '2026-06-28');
  assert.equal(calum.windowEndCustom, true);
  assert.equal(calum.lessonCount, 1); // the 30 Jun lesson falls outside the window
});

test('buildPayrollPreview uses biweekly cadence per tutor', () => {
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly', invoice_cadence: 'biweekly' }]);
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay,
    attendanceRows: [
      attendance({ EventID: 'evt_old', EventStartDate: '2026-06-18T16:00:00' }),
      attendance({ EventID: 'evt_new', EventStartDate: '2026-06-25T16:00:00' }),
    ],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.periodStart, '2026-06-17');
  assert.equal(calum.periodEnd, '2026-06-30');
  assert.equal(calum.lessonCount, 2);
  assert.equal(calum.expectedAmount, 24);
  assert.equal(calum.cadenceDue, true);
});

test('a biweekly tutor is visibly not due one week after the last paid window', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly', invoice_cadence: 'biweekly' }]),
    attendanceRows: [attendance({ EventID: 'evt_new', EventStartDate: '2026-06-25T16:00:00' })],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-10_2026-06-23',
      tutor_short_name: 'Calum',
      status: 'paid',
      period_start: '2026-06-10',
      period_end: '2026-06-23',
    }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.periodStart, '2026-06-24');
  assert.equal(calum.periodEnd, '2026-06-30');
  assert.equal(calum.cadenceDue, false);
  assert.equal(calum.nextCadencePayDate, '2026-07-08');
});

test('buildPayrollPreview overlays saved reviewed/paid state', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    attendanceRows: [attendance()],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-24_2026-06-30',
      status: 'paid',
      adjustment_amount: '3',
      final_amount: '15',
      invoice_status: 'received',
      paid_at: '2026-07-01T12:00:00Z',
    }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.status, 'paid');
  assert.equal(calum.adjustmentAmount, 3);
  assert.equal(calum.finalAmount, 15);
  assert.equal(calum.invoiceStatus, 'received');
});

test('a reviewed run exposes corrected MMS attendance without silently replacing the frozen amount', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [
      attendance({ EventID: 'evt_1', EventDuration: 30 }),
      attendance({ EventID: 'evt_2', EventStartDate: '2026-06-25T16:00:00', EventDuration: 30 }),
    ],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-24_2026-06-30',
      status: 'reviewed',
      lesson_count: '1',
      teaching_minutes: '30',
      expected_amount: '12',
      final_amount: '12',
    }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(calum.attendanceChanged, true);
  assert.equal(calum.expectedAmount, 24);
  assert.equal(calum.recalculatedFinalAmount, 24);
  assert.equal(calum.finalAmount, 12, 'the reviewed amount remains frozen until the admin saves it');
});

test('matching reviewed attendance and paid historical runs are not marked as changed', () => {
  const base = {
    payDate: '2026-07-01',
    tutorPay: parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]),
    attendanceRows: [attendance({ EventDuration: 30 })],
  };
  const matching = buildPayrollPreview({
    ...base,
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-24_2026-06-30',
      status: 'reviewed',
      lesson_count: '1',
      teaching_minutes: '30',
      expected_amount: '12',
      final_amount: '12',
    }],
  }).rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(matching.attendanceChanged, false);

  const paid = buildPayrollPreview({
    ...base,
    attendanceRows: [],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-24_2026-06-30',
      status: 'paid',
      lesson_count: '1',
      teaching_minutes: '30',
      expected_amount: '12',
      final_amount: '12',
    }],
  }).rows.find((row) => row.tutorShortName === 'Calum');
  assert.equal(paid.attendanceChanged, false);
});

test('normalisePayrollRunRow parses sheet rows', () => {
  const row = normalisePayrollRunRow({
    payroll_id: 'p1',
    pay_date: '2026-07-01',
    expected_amount: '£12',
    status: 'Paid',
  });
  assert.equal(row.payrollId, 'p1');
  assert.equal(row.expectedAmount, 12);
  assert.equal(row.status, 'paid');
});

// The payroll page and the tutor statement must ask MMS the same question, or
// the statement pays its own cold fetch for data the page already holds. That
// reuse is only safe because buildPayrollPreview does its own filtering — these
// pin both halves of that claim.
test('buildPayrollAttendanceQuery covers the run it was derived from', () => {
  const payDate = '2026-07-29';
  const query = buildPayrollAttendanceQuery(payDate);

  assert.equal(query.startDate, '2026-06-24', '35-day look-back');
  assert.equal(query.endDate, '2026-07-28', 'inclusive period end for the pay date');
  assert.ok(query.teacherIds.length > 1, 'the page-shaped query spans every tutor');

  const period = buildPayrollPeriod({ payDate, cadence: 'weekly' });
  assert.equal(attendanceQueryCoversPeriod(query, period), true);
  // A window reaching back further than the fetch must be refused, not silently
  // served short — that is the shape of the bug that underpaid every run in June.
  assert.equal(
    attendanceQueryCoversPeriod(query, { periodStart: '2026-05-01', periodEnd: '2026-07-28' }),
    false,
  );
  assert.equal(
    attendanceQueryCoversPeriod(query, { periodStart: '2026-06-24', periodEnd: '2026-08-30' }),
    false,
  );
  assert.equal(attendanceQueryCoversPeriod(query, { periodStart: '', periodEnd: '' }), false);
});

test('a superset of attendance rows produces the identical payroll row', () => {
  const payDate = '2026-07-01';
  const period = buildPayrollPeriod({ payDate, cadence: 'weekly' });
  const tutorPay = parseTutorPay([{ tutor: 'Calum', hourly_rate: '24', pay_model: 'hourly' }]);

  const wanted = [
    attendance({ EventID: 'evt_1', EventStartDate: `${period.periodStart}T16:00:00` }),
    attendance({ EventID: 'evt_2', EventStartDate: `${period.periodEnd}T16:00:00` }),
  ];
  // Exactly what a page-shaped fetch drags in that a narrow one would not:
  // another tutor, and dates on both sides of this window.
  const noise = [
    attendance({ EventID: 'evt_3', TeacherID: 'tch_zplpJw', EventStartDate: `${period.periodEnd}T17:00:00` }),
    attendance({ EventID: 'evt_4', EventStartDate: '2026-06-10T16:00:00' }),
    attendance({ EventID: 'evt_5', EventStartDate: '2026-07-01T16:00:00' }),
  ];

  const pick = (rows) => buildPayrollPreview({ payDate, tutorPay, attendanceRows: rows })
    .rows.find((row) => row.tutorShortName === 'Calum');
  const narrow = pick(wanted);
  const broad = pick([...wanted, ...noise]);

  assert.ok(narrow, 'expected a row for Calum');
  assert.equal(narrow.lessonCount, 2, 'the narrow fetch is the baseline');
  assert.equal(broad.payrollId, narrow.payrollId);
  assert.equal(broad.lessonCount, narrow.lessonCount);
  assert.equal(broad.teachingMinutes, narrow.teachingMinutes);
  assert.equal(broad.expectedAmount, narrow.expectedAmount);
  assert.deepEqual(
    broad.payableSlots.map((slot) => slot.startAt),
    narrow.payableSlots.map((slot) => slot.startAt),
  );
});

// `limit` is part of the attendance cache key, so the page size must have
// exactly one home (PAYROLL_ATTENDANCE_PAGE_SIZE in lib/admin/mms.js). A copy
// here would split the cache the moment the two drifted — which is precisely the
// bug this shared query was introduced to fix.
test('buildPayrollAttendanceQuery carries no page size of its own', () => {
  const query = buildPayrollAttendanceQuery('2026-07-29');
  assert.equal('limit' in query, false, 'page size belongs to lib/admin/mms.js, not here');
  assert.deepEqual(
    Object.keys(query).sort(),
    ['endDate', 'startDate', 'teacherIds'],
  );
});
