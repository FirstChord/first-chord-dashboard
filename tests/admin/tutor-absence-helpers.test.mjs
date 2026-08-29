import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTutorAbsenceResolutionReady,
  buildTutorAbsenceCancellationMessageGroups,
  buildTutorAbsenceEarlyNoticePlanningBundle,
  buildTutorAbsenceFinalConfirmationPlanningItems,
  compareTutorAbsenceLessonSnapshots,
  buildCoverAskMessage,
  buildCoverTutorOptions,
  buildTutorAbsenceMessage,
  buildTutorAbsencePausePlanningBundle,
  buildTutorAbsencePausePlanningItems,
  formatTutorAbsenceDate,
  isTutorAbsencePaymentHandled,
  expandTutorAbsenceEvent,
  normaliseTutorAbsenceEvent,
  scopeTutorAbsenceLessonSnapshots,
  selectObsoleteTutorAbsenceFinalConfirmationPlanningIds,
  selectRedundantTutorAbsencePauseCards,
  summariseTutorAbsenceState,
  shouldSyncGeneratedTutorAbsencePlanningItem,
} from '../../lib/admin/tutor-absence-helpers.mjs';

test('generated tutor-absence sync only refreshes still-active cards', () => {
  const generated = {
    planningId: 'planning_tutor_absence_pause_tutor_absence_chloe_2026_07_04_sdt_1_evt_1',
    title: 'Pause Ada lesson on Sat, 4 Jul 2026',
    status: 'active',
    targetDate: '2026-07-02',
  };

  assert.equal(shouldSyncGeneratedTutorAbsencePlanningItem({ existing: {}, next: generated }), true);
  assert.equal(shouldSyncGeneratedTutorAbsencePlanningItem({ existing: generated, next: generated }), false);
  assert.equal(shouldSyncGeneratedTutorAbsencePlanningItem({
    existing: { ...generated, status: 'active', targetDate: '2026-07-03' },
    next: generated,
  }), true);

  for (const status of ['done', 'parked', 'waiting', 'inbox']) {
    assert.equal(shouldSyncGeneratedTutorAbsencePlanningItem({
      existing: { ...generated, status },
      next: generated,
    }), false, `${status} cards must not be re-opened by a later absence sync`);
  }
});

test('obsolete active message-only cards are selected for replacement without touching terminal history', () => {
  const base = {
    linkedWorkflowId: 'tutor-absence-final-confirmation',
    notes: 'Tutor absence ID: tutor_absence:Chloe:2026-08-04.',
  };
  const selected = selectObsoleteTutorAbsenceFinalConfirmationPlanningIds({
    planningItems: [
      { ...base, planningId: 'active_old', status: 'active' },
      { ...base, planningId: 'active_current', status: 'active' },
      { ...base, planningId: 'done_old', status: 'done' },
      { ...base, planningId: 'parked_old', status: 'parked' },
      {
        ...base,
        planningId: 'other_absence',
        status: 'active',
        notes: 'Tutor absence ID: tutor_absence:Chloe:2026-08-11.',
      },
    ],
    absenceIds: ['tutor_absence:Chloe:2026-08-04'],
    currentPlanningIds: ['active_current'],
  });

  assert.deepEqual(selected, ['active_old']);
});

test('normaliseTutorAbsenceEvent preserves MMS wall-clock lesson time', () => {
  const studentByMmsId = new Map([
    ['sdt_1', {
      fullName: 'Ada Neocleous',
      parentFirstName: 'Parent',
      parentLastName: 'Ada',
      instrument: 'Piano',
      email: 'parent@example.com',
      contactNumber: '07123456789',
      paymentMode: 'stripe',
      paymentExpectation: 'stripe_active_expected',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    }],
  ]);

  const lesson = normaliseTutorAbsenceEvent({
    ID: 'evt_1',
    StudentID: 'sdt_1',
    StartDate: '2026-06-04T18:30:00',
    Duration: 30,
  }, studentByMmsId);

  assert.equal(lesson.lessonTime, '18:30');
  assert.equal(lesson.studentName, 'Ada Neocleous');
  assert.equal(lesson.parentName, 'Parent Ada');
  assert.equal(lesson.paymentMode, 'stripe');
  assert.equal(lesson.paymentExpectation, 'stripe_active_expected');
  assert.equal(lesson.stripeCustomerId, 'cus_123');
  assert.equal(lesson.stripeSubscriptionId, 'sub_123');
});

test('buildCoverTutorOptions only suggests tutors with matching instruments', () => {
  const options = buildCoverTutorOptions({
    absentTutor: { teacherId: 'tch_dean' },
    lessons: [
      { instrument: 'Guitar' },
      { instrument: 'Bass' },
    ],
    tutors: [
      { shortName: 'Dean', fullName: 'Dean Louden', teacherId: 'tch_dean', instruments: ['guitar', 'bass'] },
      { shortName: 'Tom', fullName: 'Tom Walters', teacherId: 'tch_tom', instruments: ['guitar', 'bass'] },
      { shortName: 'Chloe', fullName: 'Chloe Mak', teacherId: 'tch_chloe', instruments: ['singing', 'piano'] },
    ],
  });

  assert.deepEqual(options.map((tutor) => tutor.shortName), ['Tom']);
  assert.deepEqual(options[0].matchedInstruments, ['guitar', 'bass']);
});

test('buildCoverAskMessage addresses the candidate with the day and lesson span', () => {
  const message = buildCoverAskMessage({
    candidateName: 'Dean Louden',
    absentTutorName: 'Kim Grant',
    absenceDate: '2026-06-04',
    lessons: [
      { lessonTime: '17:00', instrument: 'Guitar' },
      { lessonTime: '16:00', instrument: 'guitar' },
      { lessonTime: '16:30', instrument: 'piano' },
    ],
  });

  assert.match(message, /^Hi Dean!/);
  assert.match(message, /Kim is off on Thursday 4th June/);
  assert.match(message, /3 lessons · 16:00–17:00 · guitar, piano/);
  assert.doesNotMatch(message, /Dean Louden/);
});

test('buildTutorAbsenceMessage creates cancellation and cover parent copy', () => {
  const lesson = {
    parentName: 'Rachel Slocombe',
    studentName: 'Tabitha Slocombe',
    lessonTime: '16:30',
  };

  assert.match(formatTutorAbsenceDate('2026-06-04'), /Thursday 4th June/);
  assert.match(buildTutorAbsenceMessage({
    lesson,
    tutorName: 'Dean Louden',
    absenceDate: '2026-06-04',
    decision: 'cancel_day',
  }), /won’t be going ahead/);
  const coverMessage = buildTutorAbsenceMessage({
    lesson,
    tutorName: 'Dean Louden',
    absenceDate: '2026-06-04',
    decision: 'cover',
    coverTutorName: 'Tom Walters',
  });
  assert.match(coverMessage, /covered by Tom/);
  assert.match(coverMessage, /Tom is up to speed/);
  assert.doesNotMatch(coverMessage, /Tom Walters/);
  assert.doesNotMatch(coverMessage, /16:30/);
});

test('summariseTutorAbsenceState counts parent messages left', () => {
  const summary = summariseTutorAbsenceState({
    lessons: [{ eventId: 'evt_1' }, { eventId: 'evt_2' }],
    messageState: { evt_1: { messaged: true } },
  });

  assert.equal(summary.totalLessons, 2);
  assert.equal(summary.messagedCount, 1);
  assert.equal(summary.remainingMessages, 1);
  assert.equal(summary.allMessaged, false);
  assert.equal(summary.canResolve, false);
});

test('summariseTutorAbsenceState requires cover confirmation, briefing and calendar alignment', () => {
  const lessons = [{ eventId: 'evt_1' }, { eventId: 'evt_2' }];

  const incomplete = summariseTutorAbsenceState({
    lessons,
    decision: 'cover',
    coverTutorName: 'Chloe Mak',
    messageState: {
      evt_1: { messaged: true },
      evt_2: { messaged: true },
      __workflow: { coverTutorConfirmed: true },
    },
  });

  assert.equal(incomplete.allMessaged, true);
  assert.equal(incomplete.coverReady, false);
  assert.equal(incomplete.canResolve, false);

  const complete = summariseTutorAbsenceState({
    lessons,
    decision: 'cover',
    coverTutorName: 'Chloe Mak',
    messageState: {
      evt_1: { messaged: true },
      evt_2: { messaged: true },
      __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true },
    },
  });

  assert.equal(complete.coverReady, false);
  assert.equal(complete.canResolve, false);
  assert.match(complete.resolutionHint, /MMS\/calendar/);

  const calendarComplete = summariseTutorAbsenceState({
    lessons,
    decision: 'cover',
    coverTutorName: 'Chloe Mak',
    messageState: {
      evt_1: { messaged: true },
      evt_2: { messaged: true },
      __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true, calendarUpdated: true },
    },
  });

  assert.equal(calendarComplete.coverReady, true);
  assert.equal(calendarComplete.canResolve, true);
  assert.equal(calendarComplete.resolutionHint, '');
});

test('the write-path resolution guard rejects cover until the calendar check is recorded', () => {
  const lessons = [{ eventId: 'evt_1' }];
  const base = {
    status: 'resolved',
    lessons,
    decision: 'cover',
    coverTutorName: 'Chloe Mak',
    messageState: {
      evt_1: { messaged: true },
      __workflow: { coverTutorConfirmed: true, coverTutorBriefed: true },
    },
  };

  assert.throws(
    () => assertTutorAbsenceResolutionReady(base),
    (error) => error.code === 'TUTOR_ABSENCE_NOT_READY' && /MMS\/calendar/.test(error.message),
  );
  assert.doesNotThrow(() => assertTutorAbsenceResolutionReady({
    ...base,
    messageState: {
      ...base.messageState,
      __workflow: { ...base.messageState.__workflow, calendarUpdated: true },
    },
  }));
});

test('summariseTutorAbsenceState requires payment handling for cancelled lessons', () => {
  const lessons = [{ eventId: 'evt_1' }, { eventId: 'evt_2' }];

  assert.equal(isTutorAbsencePaymentHandled(lessons[0], { pauseToolRan: true }), false);
  assert.equal(isTutorAbsencePaymentHandled(lessons[0], { pauseSkipped: true }), true);
  assert.equal(isTutorAbsencePaymentHandled({ paymentExpectation: 'stripe_paused_expected' }, {}), false);

  const incomplete = summariseTutorAbsenceState({
    lessons,
    decision: 'cancel_day',
    messageState: {
      evt_1: { messaged: true, pauseToolRan: true, paymentExpectationAligned: true },
      evt_2: { messaged: true },
    },
  });

  assert.equal(incomplete.allMessaged, true);
  assert.equal(incomplete.paymentHandledCount, 1);
  assert.equal(incomplete.remainingPaymentActions, 1);
  assert.equal(incomplete.paymentComplete, false);
  assert.equal(incomplete.canResolve, false);

  const complete = summariseTutorAbsenceState({
    lessons,
    decision: 'cancel_day',
    messageState: {
      evt_1: { messaged: true, pauseToolRan: true, paymentExpectationAligned: true },
      evt_2: { messaged: true, pauseSkipped: true, pauseSkipReason: 'Manual payer' },
    },
  });

  assert.equal(complete.paymentHandledCount, 2);
  assert.equal(complete.remainingPaymentActions, 0);
  assert.equal(complete.paymentComplete, true);
  assert.equal(complete.canResolve, true);
});

test('buildTutorAbsencePausePlanningItems creates finance-visible structured pause plans', () => {
  const plans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:Dean:2026-06-26',
    tutorName: 'Dean Louden',
    tutorShortName: 'Dean',
    absenceDate: '2026-06-26',
    lessons: [{
      eventId: 'evt_1',
      studentMmsId: 'sdt_1',
      studentName: 'Ada Neocleous',
      lessonDate: '2026-06-26',
      paymentExpectation: 'stripe_active_expected',
    }],
    now: new Date('2026-06-20T10:00:00.000Z'),
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].planningId, 'planning_tutor_absence_pause_tutor_absence_dean_2026_06_26_sdt_1_evt_1');
  assert.equal(plans[0].item.status, 'active');
  assert.equal(plans[0].item.linkedStudentId, 'sdt_1');
  assert.equal(plans[0].item.linkedWorkflowId, 'tutor-absence');
  assert.equal(plans[0].item.isPause, true);
  assert.match(plans[0].item.title, /Pause Ada Neocleous lesson/u);
  assert.match(plans[0].item.notes, /Pause type: single lesson/u);
  assert.match(plans[0].item.notes, /Lesson date: 2026-06-26/u);
  assert.match(plans[0].item.notes, /Tutor absence ID: tutor_absence:Dean:2026-06-26/u);
});

test('buildTutorAbsencePausePlanningItems keeps undated paused expectations actionable, skips explicit not-needed lessons, and marks aligned ones done', () => {
  const plans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:Dean:2026-06-26',
    tutorName: 'Dean Louden',
    tutorShortName: 'Dean',
    absenceDate: '2026-06-26',
    lessons: [
      {
        eventId: 'evt_active',
        studentMmsId: 'sdt_active',
        studentName: 'Active Student',
        lessonDate: '2026-06-26',
        paymentExpectation: 'stripe_active_expected',
      },
      {
        eventId: 'evt_aligned',
        studentMmsId: 'sdt_aligned',
        studentName: 'Aligned Student',
        lessonDate: '2026-06-26',
        paymentExpectation: 'stripe_active_expected',
      },
      {
        eventId: 'evt_paused',
        studentMmsId: 'sdt_paused',
        studentName: 'Paused Student',
        lessonDate: '2026-06-26',
        paymentExpectation: 'stripe_paused_expected',
      },
      {
        eventId: 'evt_manual',
        studentMmsId: 'sdt_manual',
        studentName: 'Manual Student',
        lessonDate: '2026-06-26',
        paymentExpectation: 'stripe_active_expected',
      },
    ],
    messageState: {
      evt_aligned: { paymentExpectationAligned: true },
      evt_manual: { pauseSkipped: true },
    },
    requiresDatedPaymentTool: true,
    now: new Date('2026-06-20T10:00:00.000Z'),
  });

  assert.deepEqual(plans.map((plan) => plan.item.linkedStudentId), ['sdt_active', 'sdt_aligned', 'sdt_paused']);
  assert.deepEqual(plans.map((plan) => plan.item.status), ['active', 'done', 'active']);
  assert.ok(plans.every((plan) => plan.item.isPause === true));

  const legacyPlans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:Dean:2026-06-26',
    lessons: [{
      eventId: 'evt_paused',
      studentMmsId: 'sdt_paused',
      studentName: 'Paused Student',
      lessonDate: '2026-06-26',
      paymentExpectation: 'stripe_paused_expected',
    }],
  });
  assert.equal(legacyPlans.length, 0, 'pre-v1 records are not silently backfilled');
});

test('buildTutorAbsenceEarlyNoticePlanningBundle creates an additive notice plan without pause semantics', () => {
  const bundle = buildTutorAbsenceEarlyNoticePlanningBundle({
    rows: [
      {
        absenceId: 'tutor_absence:Chloe:2026-08-04',
        tutorShortName: 'Chloe',
        tutorName: 'Chloe Mak',
        absenceDate: '2026-08-04',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_1',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          parentName: 'Rachel Neocleous',
          lessonDate: '2026-08-04',
        }],
        messageState: {},
      },
    ],
  });

  assert.equal(bundle.plans.length, 1);
  const plan = bundle.plans[0];
  assert.equal(plan.item.linkedWorkflowId, 'tutor-absence-notice');
  assert.equal(plan.item.isPause, false);
  assert.equal(plan.item.targetDate, '2026-07-21');
  assert.match(plan.item.notes, /Tutor absence early notice plan: v1/u);
  assert.match(plan.item.notes, /confirm the payment adjustment closer to the time/u);
  assert.doesNotMatch(plan.item.notes, /payment pause already handled/u);
});

test('schedule snapshot comparison fails loud for changed lessons', () => {
  const expected = [{ eventId: 'evt_1', studentMmsId: 'sdt_1', lessonDate: '2026-08-04', lessonTime: '16:00' }];
  assert.equal(compareTutorAbsenceLessonSnapshots({ expectedLessons: expected, liveLessons: expected }).ready, true);
  assert.equal(compareTutorAbsenceLessonSnapshots({ expectedLessons: expected, liveLessons: [] }).reason, 'schedule_changed');
});

// A group booking used to stop the whole day here. Lessons are now expanded to
// one entry per student before comparison, so both households are compared on
// their own signature and a sibling pair is ordinary work, not an exception.
test('a multi-student event no longer blocks the schedule comparison', () => {
  const siblings = [
    { eventId: 'evt_1', studentMmsId: 'sdt_a', lessonDate: '2026-08-04', lessonTime: '16:00', studentCount: 2 },
    { eventId: 'evt_1', studentMmsId: 'sdt_b', lessonDate: '2026-08-04', lessonTime: '16:00', studentCount: 2 },
  ];
  assert.equal(compareTutorAbsenceLessonSnapshots({ expectedLessons: siblings, liveLessons: siblings }).ready, true);
  assert.equal(compareTutorAbsenceLessonSnapshots({
    expectedLessons: siblings,
    liveLessons: [siblings[0]],
  }).reason, 'schedule_changed', 'losing one sibling is still a real change');
});

test('student-scoped schedule review ignores another household changing on the same tutor absence date', () => {
  const expectedLessons = [
    { eventId: 'evt_ayla', studentMmsId: 'sdt_ayla', lessonDate: '2026-07-25', lessonTime: '15:00' },
    { eventId: 'evt_evan', studentMmsId: 'sdt_evan', lessonDate: '2026-07-25', lessonTime: '15:30' },
  ];
  const liveLessons = [
    expectedLessons[0],
    { ...expectedLessons[1], lessonTime: '13:00' },
  ];

  const aylaLessons = scopeTutorAbsenceLessonSnapshots({
    expectedLessons,
    liveLessons,
    studentMmsId: 'sdt_ayla',
  });
  const evanLessons = scopeTutorAbsenceLessonSnapshots({
    expectedLessons,
    liveLessons,
    studentMmsId: 'sdt_evan',
  });

  assert.equal(compareTutorAbsenceLessonSnapshots(aylaLessons).ready, true);
  assert.equal(compareTutorAbsenceLessonSnapshots(evanLessons).reason, 'schedule_changed');
});

test('only an explicit payment-not-needed decision gets a message-only final confirmation card', () => {
  const alreadyPausedPlans = buildTutorAbsenceFinalConfirmationPlanningItems({
    rows: [{
      absenceId: 'tutor_absence:Chloe:2026-08-04',
      tutorShortName: 'Chloe',
      tutorName: 'Chloe Mak',
      absenceDate: '2026-08-04',
      decision: 'cancel_day',
      affectedLessons: [{
        eventId: 'evt_1',
        studentMmsId: 'sdt_ada',
        studentName: 'Ada Neocleous',
        parentName: 'Rachel Neocleous',
        lessonDate: '2026-08-04',
        paymentExpectation: 'stripe_paused_expected',
      }],
      messageState: {},
    }],
  });

  assert.equal(alreadyPausedPlans.length, 0);

  const plans = buildTutorAbsenceFinalConfirmationPlanningItems({
    rows: [{
      absenceId: 'tutor_absence:Chloe:2026-08-04',
      tutorShortName: 'Chloe',
      tutorName: 'Chloe Mak',
      absenceDate: '2026-08-04',
      decision: 'cancel_day',
      affectedLessons: [{
        eventId: 'evt_1',
        studentMmsId: 'sdt_ada',
        studentName: 'Ada Neocleous',
        parentName: 'Rachel Neocleous',
        lessonDate: '2026-08-04',
        paymentExpectation: 'stripe_paused_expected',
      }],
      messageState: {
        evt_1: {
          pauseSkipped: true,
          pauseSkipReason: 'Manual payer; no Stripe adjustment required',
        },
      },
    }],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].item.linkedWorkflowId, 'tutor-absence-final-confirmation');
  assert.equal(plans[0].item.isPause, false);
  assert.match(plans[0].item.notes, /Payment action not needed: Manual payer/u);
  assert.doesNotMatch(plans[0].item.notes, /Payment already paused before this absence/u);
});

test('buildTutorAbsencePausePlanningBundle groups repeated cancelled lessons into an away period', () => {
  const bundle = buildTutorAbsencePausePlanningBundle({
    rows: [
      {
        absenceId: 'tutor_absence:Tom:2026-07-03',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-03',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_1',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-03',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
      {
        absenceId: 'tutor_absence:Tom:2026-07-10',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-10',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_2',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-10',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
      {
        absenceId: 'tutor_absence:Tom:2026-07-17',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-17',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_3',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-17',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
    ],
    now: new Date('2026-06-25T10:00:00.000Z'),
  });

  assert.equal(bundle.plans.length, 1);
  assert.equal(
    bundle.plans[0].planningId,
    'planning_tutor_absence_pause_period_tom_sdt_ada_2026_07_03_2026_07_17',
  );
  assert.match(bundle.plans[0].item.title, /Pause Ada Neocleous from Fri, 3 Jul 2026; returning Fri, 24 Jul 2026/u);
  assert.match(bundle.plans[0].item.notes, /Pause type: away period/u);
  assert.match(bundle.plans[0].item.notes, /First lesson to pause date: 2026-07-03/u);
  assert.match(bundle.plans[0].item.notes, /Returning from date: 2026-07-24/u);
  assert.match(bundle.plans[0].item.notes, /Tutor absence missed lesson dates: 2026-07-03, 2026-07-10, 2026-07-17/u);
  assert.deepEqual(bundle.supersededPlanningIds, [
    'planning_tutor_absence_pause_tutor_absence_tom_2026_07_03_sdt_ada_evt_1',
    'planning_tutor_absence_pause_tutor_absence_tom_2026_07_10_sdt_ada_evt_2',
    'planning_tutor_absence_pause_tutor_absence_tom_2026_07_17_sdt_ada_evt_3',
  ]);
});

test('buildTutorAbsencePausePlanningBundle keeps separate absence blocks apart', () => {
  const bundle = buildTutorAbsencePausePlanningBundle({
    rows: [
      {
        absenceId: 'tutor_absence:Tom:2026-07-03',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-03',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_july',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-03',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
      {
        absenceId: 'tutor_absence:Tom:2026-09-04',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-09-04',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_september',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-09-04',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
    ],
    now: new Date('2026-06-25T10:00:00.000Z'),
  });

  assert.equal(bundle.plans.length, 2);
  assert.deepEqual(bundle.plans.map((plan) => plan.item.notes.match(/Pause type: ([^.]+)/u)?.[1]), [
    'single lesson',
    'single lesson',
  ]);
});

test('buildTutorAbsencePausePlanningBundle does not turn fortnightly-looking gaps into a continuous away period', () => {
  const bundle = buildTutorAbsencePausePlanningBundle({
    rows: [
      {
        absenceId: 'tutor_absence:Tom:2026-07-03',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-03',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_first',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-03',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
      {
        absenceId: 'tutor_absence:Tom:2026-07-17',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-17',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_second',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          lessonDate: '2026-07-17',
          paymentExpectation: 'stripe_active_expected',
        }],
        messageState: {},
      },
    ],
    now: new Date('2026-06-25T10:00:00.000Z'),
  });

  assert.equal(bundle.plans.length, 2);
  assert.deepEqual(bundle.plans.map((plan) => plan.item.notes.match(/Pause type: ([^.]+)/u)?.[1]), [
    'single lesson',
    'single lesson',
  ]);
});

test('buildTutorAbsenceCancellationMessageGroups creates one parent message for repeated cancelled dates', () => {
  const groups = buildTutorAbsenceCancellationMessageGroups({
    tutorShortName: 'Tom',
    rows: [
      {
        absenceId: 'tutor_absence:Tom:2026-07-03',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-03',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_1',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          parentName: 'Rachel Neocleous',
          lessonDate: '2026-07-03',
        }],
        messageState: {},
      },
      {
        absenceId: 'tutor_absence:Tom:2026-07-10',
        tutorShortName: 'Tom',
        tutorName: 'Tom Walters',
        absenceDate: '2026-07-10',
        decision: 'cancel_day',
        affectedLessons: [{
          eventId: 'evt_2',
          studentMmsId: 'sdt_ada',
          studentName: 'Ada Neocleous',
          parentName: 'Rachel Neocleous',
          lessonDate: '2026-07-10',
        }],
        messageState: { evt_2: { messaged: true } },
      },
    ],
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupKey, 'tutor_absence_cancel_message_tom_sdt_ada_2026_07_03_2026_07_10');
  assert.deepEqual(groups[0].missedDates, ['2026-07-03', '2026-07-10']);
  assert.equal(groups[0].messagedCount, 1);
  assert.equal(groups[0].allMessaged, false);
  assert.match(groups[0].message, /Hi Rachel/u);
  assert.match(groups[0].message, /Tom is away/u);
  assert.match(groups[0].message, /Friday 3rd July and Friday 10th July/u);
});

test('selectRedundantTutorAbsencePauseCards parks only open absence-pause cards for covered students of the tutor', () => {
  const planningItems = [
    // covered student's open absence-pause card for this tutor → redundant
    { planningId: 'planning_tutor_absence_pause_period_Stef_sdt_alice_2026-07-06_2026-07-20', linkedWorkflowId: 'tutor-absence', linkedTutorId: 'Stef', linkedStudentId: 'sdt_alice', status: 'active' },
    // same student, but already parked → ignore
    { planningId: 'planning_tutor_absence_pause_old', linkedWorkflowId: 'tutor-absence', linkedTutorId: 'Stef', linkedStudentId: 'sdt_alice', status: 'parked' },
    // a different (net-new, not covered) student → ignore
    { planningId: 'planning_tutor_absence_pause_b', linkedWorkflowId: 'tutor-absence', linkedTutorId: 'Stef', linkedStudentId: 'sdt_bob', status: 'active' },
    // different tutor → ignore
    { planningId: 'planning_tutor_absence_pause_c', linkedWorkflowId: 'tutor-absence', linkedTutorId: 'Calum', linkedStudentId: 'sdt_alice', status: 'active' },
    // not a tutor-absence pause card → ignore
    { planningId: 'planning_pause_manual_x', linkedWorkflowId: 'pause', linkedStudentId: 'sdt_alice', status: 'active' },
  ];

  const result = selectRedundantTutorAbsencePauseCards({
    planningItems,
    coveredStudentMmsIds: ['sdt_alice'],
    tutorShortName: 'Stef',
  });

  assert.deepEqual(result, [
    { studentMmsId: 'sdt_alice', planningIds: ['planning_tutor_absence_pause_period_Stef_sdt_alice_2026-07-06_2026-07-20'] },
  ]);
});

// --- group bookings ------------------------------------------------------
// One MMS event can hold a sibling pair or a whole class (the ukulele group).
// Collapsing that to the first student silently dropped every other household,
// which is why a day-wide "manual household check" block used to exist. These
// pin the two rules that replaced it: reach every student, and only raise a
// payment card where there is a subscription to pause.

const GROUP_EVENT = {
  ID: 'evt_group',
  StartDate: '2026-08-07T15:00:00',
  Duration: 30,
  Students: [{ ID: 'sdt_a', FullName: 'Ada Sibling' }, { ID: 'sdt_b', FullName: 'Bea Sibling' }],
};

test('a multi-student event expands to one lesson per student', () => {
  const students = new Map([
    ['sdt_a', { mmsId: 'sdt_a', fullName: 'Ada Sibling', paymentMode: 'stripe' }],
    ['sdt_b', { mmsId: 'sdt_b', fullName: 'Bea Sibling', paymentMode: 'stripe' }],
  ]);
  const lessons = expandTutorAbsenceEvent(GROUP_EVENT, students);

  assert.equal(lessons.length, 2, 'both households must be reachable');
  assert.deepEqual(lessons.map((lesson) => lesson.studentMmsId), ['sdt_a', 'sdt_b']);
  assert.deepEqual(lessons.map((lesson) => lesson.studentName), ['Ada Sibling', 'Bea Sibling']);
  assert.ok(lessons.every((lesson) => lesson.eventId === 'evt_group'));
  assert.ok(lessons.every((lesson) => lesson.studentCount === 2), 'the group is still visible as a group');
});

test('normaliseTutorAbsenceEvent still returns the first student for event-level callers', () => {
  const students = new Map([['sdt_a', { mmsId: 'sdt_a', fullName: 'Ada Sibling' }]]);
  assert.equal(normaliseTutorAbsenceEvent(GROUP_EVENT, students).studentMmsId, 'sdt_a');
});

test('each sibling on Stripe gets their own pause card from one group event', () => {
  const plans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:finn:2026-08-07',
    tutorShortName: 'Finn',
    absenceDate: '2026-08-07',
    lessons: [
      { eventId: 'evt_group', studentMmsId: 'sdt_a', studentName: 'Ada Sibling', lessonDate: '2026-08-07', studentCount: 2, paymentMode: 'stripe' },
      { eventId: 'evt_group', studentMmsId: 'sdt_b', studentName: 'Bea Sibling', lessonDate: '2026-08-07', studentCount: 2, paymentMode: 'stripe' },
    ],
    now: new Date('2026-08-01T09:00:00Z'),
  });

  assert.equal(plans.length, 2, 'one card per sibling, not one per event');
  assert.equal(new Set(plans.map((plan) => plan.planningId)).size, 2, 'cards must not collide');
});

test('manual payers are reached but never get a payment pause card', () => {
  const plans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:finn:2026-08-07',
    tutorShortName: 'Finn',
    absenceDate: '2026-08-07',
    lessons: [
      { eventId: 'evt_uke', studentMmsId: 'sdt_u1', studentName: 'Uke One', lessonDate: '2026-08-07', studentCount: 3, paymentMode: 'manual' },
      { eventId: 'evt_uke', studentMmsId: 'sdt_u2', studentName: 'Uke Two', lessonDate: '2026-08-07', studentCount: 3, paymentMode: 'manual' },
      { eventId: 'evt_solo', studentMmsId: 'sdt_s', studentName: 'Solo Stripe', lessonDate: '2026-08-07', paymentMode: 'stripe' },
    ],
    now: new Date('2026-08-01T09:00:00Z'),
  });

  assert.deepEqual(
    plans.map((plan) => plan.item.linkedStudentId),
    ['sdt_s'],
    'a manual payer has no subscription to pause, so no card is raised',
  );
});

test('an unknown payment mode still raises a card rather than being assumed manual', () => {
  const plans = buildTutorAbsencePausePlanningItems({
    absenceId: 'tutor_absence:finn:2026-08-07',
    tutorShortName: 'Finn',
    absenceDate: '2026-08-07',
    lessons: [
      { eventId: 'evt_x', studentMmsId: 'sdt_x', studentName: 'Unknown Mode', lessonDate: '2026-08-07' },
    ],
    now: new Date('2026-08-01T09:00:00Z'),
  });

  assert.equal(plans.length, 1, 'missing data must not silently drop a household');
});
