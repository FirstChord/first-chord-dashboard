import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachPlanningProgress,
  buildEarlyStripeTimingReviewPlanningId,
  buildEarlyStripeTimingReviewPlanningItem,
  buildDateInputRange,
  flagNearbyPauses,
  normalisePauseFlag,
  buildFirstLessonCheckinPlanningId,
  buildFirstLessonCheckinPlanningItem,
  buildSchoolForwardReflections,
  buildSchoolForwardPlanningItem,
  buildPauseLessonDateSuggestions,
  buildTutorAbsencePlanningId,
  buildTutorAbsencePlanningItem,
  calculateFirstLessonCheckinDate,
  detectTutorAbsenceCapture,
  calculateFridayReviewDate,
  calculateMondayScheduleDate,
  calculateMonthEndDate,
  calculateNextMeetingDate,
  requiresEarlyStripeTimingReview,
  buildMondaySchedulePlanningItem,
  buildMonthEndExpensesPlanningItem,
  shouldRefreshMonthEndExpensesPlanningItem,
  MONTH_END_EXPENSES_PLANNING_ID,
  extractReflectionIntentions,
  buildReflectionIntentionDismissalNote,
  extractDismissedReflectionIntentions,
  isReflectionIntentionDismissed,
  normaliseReflectionIntentionKey,
  shouldRefreshMondaySchedulePlanningItem,
  shouldRefreshSchoolForwardPlanningItem,
  MONDAY_SCHEDULE_PLANNING_ID,
  buildPlanningDueSummary,
  buildPlanningSummary,
  buildStructuredPausePlanningDraft,
  derivePlanningMomentum,
  inferPlanningTargetDateFromText,
  isMeetingPlanningItem,
  labelPlanningArea,
  labelPlanningType,
  normalisePlanningArea,
  normalisePlanningItemType,
  normalisePlanningItem,
  normalisePlanningMode,
  normalisePlanningOwner,
  normalisePlanningProgressType,
  normalisePlanningStatus,
  parseLinkedStudentIds,
  planningModeForItemType,
  serializeLinkedStudentIds,
} from '../../lib/admin/planning-helpers.mjs';

const NOW = new Date('2026-06-03T12:00:00.000Z');

test('buildDateInputRange expands an inclusive date range with a cap', () => {
  assert.deepEqual(
    buildDateInputRange('2026-07-01', '2026-07-04', { maxDays: 10 }),
    { dates: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'], tooLong: false },
  );
  assert.deepEqual(buildDateInputRange('2026-07-04', '2026-07-01'), { dates: [], tooLong: false });

  const capped = buildDateInputRange('2026-07-01', '2026-07-10', { maxDays: 3 });
  assert.deepEqual(capped.dates, ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.equal(capped.tooLong, true);
});

test('normalises planning defaults conservatively', () => {
  assert.equal(normalisePlanningItemType('Initiative'), 'initiative');
  assert.equal(normalisePlanningItemType('Learning_Note'), 'learning_note');
  assert.equal(normalisePlanningItemType('strategic_note'), 'strategic_note');
  assert.equal(normalisePlanningItemType('bad'), 'idea');
  assert.equal(normalisePlanningStatus('WAITING'), 'waiting');
  assert.equal(normalisePlanningStatus('unknown'), 'inbox');
  assert.equal(normalisePlanningArea('Finance'), 'finance');
  assert.equal(normalisePlanningArea('Learning'), 'learning');
  assert.equal(normalisePlanningArea('student_experience'), 'student_experience');
  assert.equal(normalisePlanningArea('random'), 'other');
  assert.equal(normalisePlanningOwner('Tom'), 'Tom');
  assert.equal(normalisePlanningOwner('Fennella'), 'Fennella');
  assert.equal(normalisePlanningOwner('Fenella'), 'Unassigned');
  assert.equal(normalisePlanningMode('ongoing'), 'ongoing');
  assert.equal(normalisePlanningMode('Task'), 'task');
  assert.equal(normalisePlanningMode(''), 'task');
  assert.equal(normalisePlanningMode('bad'), 'task');
  assert.equal(normalisePlanningProgressType('session_logged'), 'session_logged');
  assert.equal(normalisePlanningProgressType('bad'), 'note');
});

test('uses plain Project labels and responsibility-based area wording', () => {
  assert.equal(labelPlanningType('initiative'), 'Project');
  assert.equal(labelPlanningType('idea'), 'Note / idea');
  assert.equal(labelPlanningArea('teaching'), 'Teaching & curriculum');
  assert.equal(labelPlanningArea('student_experience'), 'Students & families');
  assert.equal(labelPlanningArea('other'), 'No area');
});

test('normalisePlanningItem defaults plan mode to task and keeps ongoing', () => {
  assert.equal(normalisePlanningItem({}).planMode, 'task');
  assert.equal(normalisePlanningItem({ planMode: 'ongoing' }).planMode, 'ongoing');
});

test('planning mode follows the visible item kind', () => {
  assert.equal(planningModeForItemType('initiative', 'task'), 'ongoing');
  assert.equal(planningModeForItemType('action', 'ongoing'), 'task');
  assert.equal(planningModeForItemType('idea', 'ongoing'), 'task');
  assert.equal(planningModeForItemType('learning_note', 'ongoing'), 'ongoing');
});

test('parses and serializes multi-student links from the single column', () => {
  // Strings (comma-separated), arrays, blanks, dupes, and whitespace all normalise.
  assert.deepEqual(parseLinkedStudentIds('sdt_a'), ['sdt_a']);
  assert.deepEqual(parseLinkedStudentIds(' sdt_a , sdt_b ,sdt_a'), ['sdt_a', 'sdt_b']);
  assert.deepEqual(parseLinkedStudentIds(['sdt_a', '', 'sdt_b', 'sdt_a']), ['sdt_a', 'sdt_b']);
  assert.deepEqual(parseLinkedStudentIds(''), []);
  assert.deepEqual(parseLinkedStudentIds(undefined), []);
  assert.equal(serializeLinkedStudentIds(['sdt_a', 'sdt_b']), 'sdt_a,sdt_b');
  assert.equal(serializeLinkedStudentIds('sdt_a, sdt_b'), 'sdt_a,sdt_b');
});

test('normalisePlanningItem exposes both primary id and full student list', () => {
  const item = normalisePlanningItem({ linkedStudentId: 'sdt_a,sdt_b' });
  assert.equal(item.linkedStudentId, 'sdt_a'); // primary stays a single id for pause/schedule
  assert.deepEqual(item.linkedStudentIds, ['sdt_a', 'sdt_b']);

  const fromArray = normalisePlanningItem({ linkedStudentIds: ['sdt_x', 'sdt_y'] });
  assert.equal(fromArray.linkedStudentId, 'sdt_x');
  assert.deepEqual(fromArray.linkedStudentIds, ['sdt_x', 'sdt_y']);
});

test('calculates Friday review and next meeting dates', () => {
  assert.equal(calculateFridayReviewDate(new Date('2026-06-12T10:00:00.000Z')), '2026-06-12');
  assert.equal(calculateFridayReviewDate(new Date('2026-06-12T10:00:00.000Z'), { skipToday: true }), '2026-06-19');
  assert.equal(calculateNextMeetingDate(new Date('2026-06-13T10:00:00.000Z')), '2026-06-15');
});

test('calculates the Monday scheduling date', () => {
  assert.equal(calculateMondayScheduleDate(new Date('2026-06-03T12:00:00.000Z')), '2026-06-08'); // Wed -> next Mon
  assert.equal(calculateMondayScheduleDate(new Date('2026-06-08T10:00:00.000Z')), '2026-06-08'); // Mon -> same Mon
  assert.equal(calculateMondayScheduleDate(new Date('2026-06-08T10:00:00.000Z'), { skipToday: true }), '2026-06-15'); // Mon -> next Mon
});

test('builds the Monday scheduling item dated to Monday', () => {
  const item = buildMondaySchedulePlanningItem({ now: new Date('2026-06-03T12:00:00.000Z') });
  assert.equal(item.planningId, MONDAY_SCHEDULE_PLANNING_ID);
  assert.equal(item.targetDate, '2026-06-08');
  assert.equal(item.area, 'workflow');
  assert.equal(item.status, 'waiting');
});

// Parking a recurring system prompt means "skip this occurrence", never "kill
// the prompt" — the Friday and Monday prompts both died silently in July 2026
// because a park was read as never-again. Strictly past (not <=): a prompt
// parked on its own day stays parked that day and re-arms from the next.
test('a parked recurring prompt re-arms once its date has passed — for all three prompts', () => {
  const cases = [
    ['school-forward', shouldRefreshSchoolForwardPlanningItem, 'planning_weekly_school_forward_review'],
    ['monday', shouldRefreshMondaySchedulePlanningItem, MONDAY_SCHEDULE_PLANNING_ID],
    ['month-end', shouldRefreshMonthEndExpensesPlanningItem, MONTH_END_EXPENSES_PLANNING_ID],
  ];
  for (const [label, shouldRefresh, planningId] of cases) {
    // Parked with a past date (the July 2026 live state) → must refresh.
    assert.equal(shouldRefresh({ planningId, targetDate: '2026-05-29', status: 'parked' }, NOW), true, `${label}: parked past`);
    // Parked today → respected today, no same-day resurrection.
    assert.equal(shouldRefresh({ planningId, targetDate: '2026-06-03', status: 'parked' }, NOW), false, `${label}: parked today`);
    // Parked with a future date → stays parked until that date passes.
    assert.equal(shouldRefresh({ planningId, targetDate: '2026-06-05', status: 'parked' }, NOW), false, `${label}: parked future`);
  }
});

test('refreshes the Monday item when missing or completed-and-past', () => {
  assert.equal(shouldRefreshMondaySchedulePlanningItem({}, NOW), true);
  assert.equal(shouldRefreshMondaySchedulePlanningItem(
    { planningId: MONDAY_SCHEDULE_PLANNING_ID, targetDate: '2026-06-08', status: 'waiting' }, NOW), false);
  assert.equal(shouldRefreshMondaySchedulePlanningItem(
    { planningId: MONDAY_SCHEDULE_PLANNING_ID, targetDate: '2026-06-01', status: 'done' }, NOW), true);
});

test('calculates the month-end reconciliation date', () => {
  assert.equal(calculateMonthEndDate(new Date('2026-06-03T12:00:00.000Z')), '2026-06-30'); // mid-month -> this month end
  assert.equal(calculateMonthEndDate(new Date('2026-06-30T10:00:00.000Z')), '2026-06-30'); // month-end day -> same day
  assert.equal(calculateMonthEndDate(new Date('2026-06-30T10:00:00.000Z'), { skipToday: true }), '2026-07-31'); // done on the day -> next month end
  assert.equal(calculateMonthEndDate(new Date('2026-02-10T12:00:00.000Z')), '2026-02-28'); // February, non-leap
});

test('builds the month-end expenses item dated to month end', () => {
  const item = buildMonthEndExpensesPlanningItem({ now: new Date('2026-06-03T12:00:00.000Z') });
  assert.equal(item.planningId, MONTH_END_EXPENSES_PLANNING_ID);
  assert.equal(item.targetDate, '2026-06-30');
  assert.equal(item.area, 'finance');
  assert.equal(item.itemType, 'action');
  assert.equal(item.status, 'waiting');
  assert.match(item.notes, /Expense_Log/);
  assert.match(item.notes, /missing/i);
});

test('refreshes the month-end item when missing or completed-and-past', () => {
  assert.equal(shouldRefreshMonthEndExpensesPlanningItem({}, NOW), true);
  assert.equal(shouldRefreshMonthEndExpensesPlanningItem(
    { planningId: MONTH_END_EXPENSES_PLANNING_ID, targetDate: '2026-06-30', status: 'waiting' }, NOW), false);
  assert.equal(shouldRefreshMonthEndExpensesPlanningItem(
    { planningId: MONTH_END_EXPENSES_PLANNING_ID, targetDate: '2026-06-30', status: 'done' }, NOW), false);
  assert.equal(shouldRefreshMonthEndExpensesPlanningItem(
    { planningId: MONTH_END_EXPENSES_PLANNING_ID, targetDate: '2026-05-31', status: 'done' }, NOW), true);
});

test('extracts next-improvement intentions from a reflection note', () => {
  const note = [
    'What moved forward:',
    '- New chairs',
    '',
    'Next improvement to make time for:',
    '',
    '- Develop the marketing campaign',
    'Recruit a piano teacher',
    '* Explore drum lessons',
  ].join('\n');
  assert.deepEqual(extractReflectionIntentions(note), [
    'Develop the marketing campaign',
    'Recruit a piano teacher',
    'Explore drum lessons',
  ]);
  assert.deepEqual(extractReflectionIntentions('No section here'), []);
});

test('stops extracting intentions at the next section heading', () => {
  const note = [
    'Next improvement to make time for:',
    '- First thing',
    'Another section:',
    '- Should be ignored',
  ].join('\n');
  assert.deepEqual(extractReflectionIntentions(note), ['First thing']);
});

test('tracks dismissed reflection intentions by stable key', () => {
  const intention = '  Explore launching drum lessons.  ';
  const note = buildReflectionIntentionDismissalNote(intention);
  assert.equal(note, 'Dismissed Friday reflection intention: Explore launching drum lessons.');
  assert.equal(normaliseReflectionIntentionKey('Explore   Launching Drum Lessons.'), 'explore launching drum lessons.');

  const mondayItem = {
    progress: [
      { progressNote: note },
      { progressNote: 'Scheduled from Friday reflection.' },
    ],
  };

  assert.deepEqual(
    [...extractDismissedReflectionIntentions(mondayItem)],
    ['explore launching drum lessons.'],
  );
  assert.equal(isReflectionIntentionDismissed(mondayItem, 'Explore launching drum lessons.'), true);
  assert.equal(isReflectionIntentionDismissed(mondayItem, 'Recruit a piano teacher'), false);
});

test('first-lesson check-in lands on the first Mon/Wed/Fri after the lesson', () => {
  // 2026-06-15 is a Monday; the surrounding days are known from the meeting-date test above.
  assert.equal(calculateFirstLessonCheckinDate('2026-06-15'), '2026-06-17'); // Mon -> Wed
  assert.equal(calculateFirstLessonCheckinDate('2026-06-16'), '2026-06-17'); // Tue -> Wed
  assert.equal(calculateFirstLessonCheckinDate('2026-06-17'), '2026-06-19'); // Wed -> Fri
  assert.equal(calculateFirstLessonCheckinDate('2026-06-19'), '2026-06-22'); // Fri -> next Mon
  assert.equal(calculateFirstLessonCheckinDate('2026-06-13'), '2026-06-15'); // Sat -> Mon
  assert.equal(calculateFirstLessonCheckinDate('2026-06-14'), '2026-06-15'); // Sun -> Mon
});

test('first-lesson check-in always falls within the week after the lesson on a check-in day', () => {
  const checkinWeekdays = new Set([1, 3, 5]); // Mon, Wed, Fri
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const lesson = new Date(2026, 5, 1 + dayOffset); // local dates across two weeks
    const lessonInput = `${lesson.getFullYear()}-${String(lesson.getMonth() + 1).padStart(2, '0')}-${String(lesson.getDate()).padStart(2, '0')}`;
    const checkin = new Date(`${calculateFirstLessonCheckinDate(lessonInput)}T12:00:00`);
    const diffDays = Math.round((checkin - new Date(`${lessonInput}T12:00:00`)) / 86400000);
    assert.ok(diffDays >= 1 && diffDays <= 6, `check-in ${diffDays} days after lesson ${lessonInput}`);
    assert.ok(checkinWeekdays.has(checkin.getDay()), `check-in for ${lessonInput} not on a check-in day`);
  }
});

test('buildFirstLessonCheckinPlanningItem is Unassigned, parent-area, and student-linked', () => {
  const item = buildFirstLessonCheckinPlanningItem({
    mmsId: 'sdt_abc123',
    studentName: 'Ada Lovelace',
    tutorName: 'Finn',
    lessonDate: '2026-06-15',
    lessonTime: '16:30',
  });
  assert.equal(item.owner, 'Unassigned');
  assert.equal(item.area, 'parent');
  assert.equal(item.status, 'active');
  assert.equal(item.itemType, 'action');
  assert.equal(item.linkedStudentId, 'sdt_abc123');
  assert.equal(item.linkedWorkflowId, 'onboarding');
  assert.equal(item.targetDate, '2026-06-17');
  assert.match(item.title, /Ada Lovelace/);
  assert.match(item.nextAction, /Finn & Tom/);
});

test('early Stripe timing review is required from seven days before lesson one', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  assert.equal(requiresEarlyStripeTimingReview('2026-06-09', { now }), false);
  assert.equal(requiresEarlyStripeTimingReview('2026-06-10', { now }), true);
  assert.equal(requiresEarlyStripeTimingReview('2026-06-20', { now }), true);
  assert.equal(requiresEarlyStripeTimingReview('', { now }), false);
  assert.equal(requiresEarlyStripeTimingReview('not-a-date', { now }), false);
});

test('early Stripe timing review is deterministic and due on the next planning day', () => {
  const item = buildEarlyStripeTimingReviewPlanningItem({
    mmsId: 'sdt_abc123',
    studentName: 'Ada Lovelace',
    lessonDate: '2026-06-20',
    now: new Date('2026-06-06T12:00:00.000Z'),
  });

  assert.equal(item.targetDate, '2026-06-08');
  assert.equal(item.area, 'finance');
  assert.equal(item.owner, 'Unassigned');
  assert.equal(item.linkedWorkflowId, 'onboarding');
  assert.equal(item.linkedStudentId, 'sdt_abc123');
  assert.match(item.nextAction, /before the first renewal/u);
  assert.equal(
    buildEarlyStripeTimingReviewPlanningId('sdt_abc123'),
    'planning_early_stripe_timing_sdt_abc123',
  );
});

test('first-lesson check-in planning id is deterministic per student', () => {
  assert.equal(buildFirstLessonCheckinPlanningId('sdt_abc123'), 'planning_first_lesson_checkin_sdt_abc123');
  assert.equal(
    buildFirstLessonCheckinPlanningId('sdt_abc123'),
    buildFirstLessonCheckinPlanningId('sdt_abc123'),
  );
  assert.notEqual(
    buildFirstLessonCheckinPlanningId('sdt_abc123'),
    buildFirstLessonCheckinPlanningId('sdt_xyz789'),
  );
});

test('buildSchoolForwardPlanningItem creates a weekly Friday prompt', () => {
  const item = buildSchoolForwardPlanningItem({
    now: new Date('2026-06-12T10:00:00.000Z'),
  });

  assert.equal(item.title, 'Friday: what moved the school forward?');
  assert.equal(item.status, 'waiting');
  assert.equal(item.area, 'workflow');
  assert.equal(item.targetDate, '2026-06-12');
  assert.match(item.outcome, /improving the school/u);
});

test('buildSchoolForwardReflections returns dated history from the Friday prompt', () => {
  const items = [{
    planningId: 'planning_weekly_school_forward_review',
    progress: [
      {
        progressId: 'old',
        progressNote: 'Defined the pause planning workflow.',
        createdAt: '2026-06-05T12:00:00.000Z',
      },
      {
        progressId: 'new',
        progressNote: 'Piloted Practice Chat with Finn, Tom, and Fennella.',
        createdAt: '2026-06-12T12:00:00.000Z',
      },
      {
        progressId: 'blank',
        progressNote: '',
        createdAt: '2026-06-13T12:00:00.000Z',
      },
    ],
  }];

  const reflections = buildSchoolForwardReflections(items);

  assert.equal(reflections.length, 2);
  assert.equal(reflections[0].progressId, 'new');
  assert.equal(reflections[1].progressId, 'old');
});

test('isMeetingPlanningItem includes decision, due, and school-forward work', () => {
  const now = new Date('2026-06-13T10:00:00.000Z');

  assert.equal(isMeetingPlanningItem({
    planningId: 'planning_weekly_school_forward_review',
    status: 'waiting',
  }, now), true);
  assert.equal(isMeetingPlanningItem({
    status: 'active',
    targetDate: '2026-06-15',
  }, now), true);
  assert.equal(isMeetingPlanningItem({
    status: 'waiting',
  }, now), true);
  assert.equal(isMeetingPlanningItem({
    status: 'active',
    owner: 'Finn',
    targetDate: '2026-06-30',
    nextAction: 'Review later',
    updatedAt: '2026-06-13T09:00:00.000Z',
  }, now), false);
});

test('infers target dates from operational capture notes', () => {
  assert.equal(
    inferPlanningTargetDateFromText('Pause Coban for Friday', new Date('2026-06-05T10:00:00.000Z')),
    '2026-06-08',
  );
  assert.equal(
    inferPlanningTargetDateFromText('Set up Anna McPhail Stripe 12th June', new Date('2026-06-05T10:00:00.000Z')),
    '2026-06-12',
  );
});

test('puts pause reminders on meeting days two to five days before the pause', () => {
  assert.equal(
    inferPlanningTargetDateFromText('Pause Eddie for Saturday 13th June', new Date('2026-06-05T10:00:00.000Z')),
    '2026-06-11',
  );
  assert.equal(
    inferPlanningTargetDateFromText('Pause Lyra March 12th', new Date('2026-02-05T10:00:00.000Z')),
    '2026-03-09',
  );
  assert.equal(
    inferPlanningTargetDateFromText('Pause Coban for Tuesday 9th June', new Date('2026-06-05T10:00:00.000Z')),
    '2026-06-05',
  );
});

test('buildStructuredPausePlanningDraft creates an unambiguous single lesson pause action', () => {
  const draft = buildStructuredPausePlanningDraft({
    studentName: 'Sam Reid',
    pauseType: 'single',
    lessonDate: '2026-06-13',
    now: NOW,
  });

  assert.equal(draft.isComplete, true);
  assert.equal(draft.title, 'Pause Sam Reid lesson on Sat, 13 Jun 2026');
  assert.equal(draft.targetDate, '2026-06-11');
  assert.match(draft.notes, /Pause type: single lesson/u);
  assert.match(draft.nextAction, /Run pause tool for this lesson/u);
});

test('buildStructuredPausePlanningDraft treats return date as first date back for away periods', () => {
  const draft = buildStructuredPausePlanningDraft({
    studentName: 'Léo TERHZAZ',
    pauseType: 'range',
    firstPauseDate: '2026-06-25',
    returnDate: '2026-08-13',
    extraNote: 'Summer holiday.',
    now: NOW,
  });

  assert.equal(draft.isComplete, true);
  assert.equal(draft.title, 'Pause Léo TERHZAZ from Thu, 25 Jun 2026; returning Thu, 13 Aug 2026');
  assert.equal(draft.targetDate, '2026-06-22');
  assert.match(draft.notes, /Returning from: Thu, 13 Aug 2026/u);
  assert.match(draft.notes, /not the last lesson to pause/u);
  assert.match(draft.notes, /Summer holiday/u);
});

test('buildStructuredPausePlanningDraft reports missing range fields', () => {
  const draft = buildStructuredPausePlanningDraft({
    pauseType: 'range',
    firstPauseDate: '2026-06-25',
  });

  assert.equal(draft.isComplete, false);
  assert.deepEqual(draft.missingFields, ['returning from date']);
});

test('buildPauseLessonDateSuggestions repeats cached lesson dates weekly', () => {
  const suggestions = buildPauseLessonDateSuggestions({
    status: 'found',
    nextLessonAt: '2026-06-07T18:30:00',
    usualTime: '18:30',
    teacherName: 'Fennella McCallum',
  }, {
    now: new Date('2026-06-03T12:00:00.000Z'),
    count: 3,
  });

  assert.deepEqual(suggestions.map((entry) => entry.date), [
    '2026-06-07',
    '2026-06-14',
    '2026-06-21',
  ]);
  assert.match(suggestions[0].lessonLabel, /18:30 with Fennella McCallum/u);
});

test('buildPauseLessonDateSuggestions rolls stale cached next lesson forward', () => {
  const suggestions = buildPauseLessonDateSuggestions({
    status: 'found',
    nextLessonAt: '2026-05-18T16:30:00',
    usualTime: '16:30',
  }, {
    now: new Date('2026-06-03T12:00:00.000Z'),
    count: 2,
  });

  assert.deepEqual(suggestions.map((entry) => entry.date), [
    '2026-06-08',
    '2026-06-15',
  ]);
});

test('buildPauseLessonDateSuggestions can pivot from a selected first missed lesson', () => {
  const suggestions = buildPauseLessonDateSuggestions({
    status: 'found',
    nextLessonAt: '2026-06-07T18:30:00',
    usualTime: '18:30',
  }, {
    now: new Date('2026-06-03T12:00:00.000Z'),
    count: 4,
    startDate: '2026-06-21',
  });

  assert.deepEqual(suggestions.map((entry) => entry.date), [
    '2026-06-21',
    '2026-06-28',
    '2026-07-05',
    '2026-07-12',
  ]);
});

test('summarises planning items due today and overdue', () => {
  const summary = buildPlanningDueSummary([
    {
      planningId: 'planning_1',
      title: 'Pause Coban',
      status: 'active',
      targetDate: '2026-06-05',
    },
    {
      planningId: 'planning_2',
      title: 'Message Elena students',
      status: 'inbox',
      targetDate: '2026-06-04',
    },
    {
      planningId: 'planning_3',
      title: 'Done task',
      status: 'done',
      targetDate: '2026-06-05',
    },
    {
      planningId: 'planning_4',
      title: 'Future task',
      status: 'active',
      targetDate: '2026-06-08',
    },
  ], new Date('2026-06-05T10:00:00.000Z'));

  assert.equal(summary.today, '2026-06-05');
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueNow, 2);
  assert.deepEqual(summary.dueNowTitles, ['Message Elena students', 'Pause Coban']);
});

test('marks an active undated Action with no workflow cue clearly', () => {
  const momentum = derivePlanningMomentum({
    planningId: 'planning_1',
    itemType: 'action',
    status: 'active',
    nextAction: '',
    updatedAt: '2026-06-03T10:00:00.000Z',
  }, [], NOW);

  assert.equal(momentum, 'no_next_action');
});

test('uses recent progress to show movement', () => {
  const momentum = derivePlanningMomentum({
    planningId: 'planning_1',
    itemType: 'initiative',
    status: 'active',
    nextAction: 'Pilot with five families',
    updatedAt: '2026-05-01T10:00:00.000Z',
  }, [{
    planningId: 'planning_1',
    createdAt: '2026-06-01T10:00:00.000Z',
    progressNote: 'Drafted pilot checklist',
  }], NOW);

  assert.equal(momentum, 'moving');
});

test('marks stale active initiatives as stalled', () => {
  const momentum = derivePlanningMomentum({
    planningId: 'planning_1',
    itemType: 'initiative',
    status: 'active',
    nextAction: 'Review with Tom',
    updatedAt: '2026-05-10T10:00:00.000Z',
  }, [], NOW);

  assert.equal(momentum, 'stalled');
});

test('attaches progress rows and builds summary counts', () => {
  const items = attachPlanningProgress([
    {
      planningId: 'planning_1',
      title: 'Parent Understanding Workflow',
      itemType: 'initiative',
      status: 'active',
      owner: 'Finn',
      area: 'parent',
      nextAction: 'Pilot with five families',
      updatedAt: '2026-05-10T10:00:00.000Z',
    },
    {
      planningId: 'planning_2',
      title: 'Sunday piano groups',
      itemType: 'idea',
      status: 'inbox',
      owner: 'Unassigned',
      area: 'other',
      updatedAt: '2026-06-02T10:00:00.000Z',
    },
    {
      planningId: 'planning_3',
      title: 'Customer experience audiobook notes',
      itemType: 'learning_note',
      status: 'active',
      owner: 'Tom',
      area: 'learning',
      updatedAt: '2026-06-02T10:00:00.000Z',
    },
    {
      planningId: 'planning_4',
      title: 'Back to school growth idea',
      itemType: 'strategic_note',
      status: 'parked',
      owner: 'Finn',
      area: 'growth',
      updatedAt: '2026-06-02T10:00:00.000Z',
    },
  ], [
    {
      progressId: 'progress_1',
      planningId: 'planning_1',
      progressNote: 'Built V1 workflow page',
      progressType: 'note',
      createdAt: '2026-06-02T10:00:00.000Z',
    },
    {
      progressId: 'progress_2',
      planningId: 'planning_1',
      progressNote: 'First lesson loop v1: whatsapp_groups=true',
      progressType: 'workflow_step',
      createdAt: '2026-06-03T10:00:00.000Z',
    },
  ], NOW);
  const summary = buildPlanningSummary(items);

  assert.equal(items[0].latestProgress.progressNote, 'Built V1 workflow page');
  assert.equal(items[0].momentum, 'moving');
  assert.equal(items[1].momentum, 'inbox');
  assert.equal(summary.total, 4);
  assert.equal(summary.open, 3);
  assert.equal(summary.inbox, 1);
  assert.equal(summary.initiatives, 1);
  assert.equal(summary.activeInitiatives, 1);
  assert.equal(summary.schoolNotes, 3);
  assert.equal(summary.activeSchoolNotes, 2);
  assert.equal(summary.learningNotes, 1);
  assert.equal(summary.strategicNotes, 1);
  assert.equal(summary.moving, 2);
  assert.equal(summary.needsAttention, 0);
});

const TUTOR_OPTIONS = [
  { shortName: 'Robbie', fullName: 'Robbie Tranter', teacherId: 'tch_zV9hJ2' },
  { shortName: 'Tom', fullName: 'Tom Smith', teacherId: 'tch_tom' },
  { shortName: 'Eléna', fullName: 'Eléna García', teacherId: 'tch_elena' },
];

test('detectTutorAbsenceCapture recognises "pause tutor robbie"', () => {
  const result = detectTutorAbsenceCapture('pause tutor robbie', TUTOR_OPTIONS);
  assert.equal(result.isTutorAbsence, true);
  assert.equal(result.tutor?.shortName, 'Robbie');
});

test('detectTutorAbsenceCapture recognises name + absence shorthand "robbie off friday"', () => {
  const result = detectTutorAbsenceCapture('robbie off friday', TUTOR_OPTIONS);
  assert.equal(result.isTutorAbsence, true);
  assert.equal(result.tutor?.shortName, 'Robbie');
});

test('detectTutorAbsenceCapture ignores a student pause like "pause coban for friday"', () => {
  const result = detectTutorAbsenceCapture('pause coban for friday', TUTOR_OPTIONS);
  assert.equal(result.isTutorAbsence, false);
  assert.equal(result.tutor, null);
});

test('detectTutorAbsenceCapture matches accented tutor names', () => {
  const result = detectTutorAbsenceCapture('elena off monday', TUTOR_OPTIONS);
  assert.equal(result.isTutorAbsence, true);
  assert.equal(result.tutor?.shortName, 'Eléna');
});

test('detectTutorAbsenceCapture flags intent but no tutor for generic "tutor off friday"', () => {
  const result = detectTutorAbsenceCapture('tutor off friday', TUTOR_OPTIONS);
  assert.equal(result.isTutorAbsence, true);
  assert.equal(result.tutor, null);
});

test('buildTutorAbsencePlanningId is deterministic and keyed on tutor + date', () => {
  assert.equal(buildTutorAbsencePlanningId('Robbie', '2026-06-19'), 'planning_tutor_absence_robbie_2026-06-19');
  assert.equal(
    buildTutorAbsencePlanningId('Robbie', '2026-06-19'),
    buildTutorAbsencePlanningId('robbie', '2026-06-19'),
  );
});

test('buildTutorAbsencePlanningItem snapshots students and targets a meeting day before the absence', () => {
  const item = buildTutorAbsencePlanningItem({
    tutor: { shortName: 'Robbie', fullName: 'Robbie Tranter' },
    absenceDate: '2026-06-19', // Friday
    lessons: [
      { studentName: 'Charlie Mcdougall', lessonTime: '16:00' },
      { studentName: 'Ailsa Hoebe', lessonTime: '16:30' },
    ],
  });
  assert.equal(item.area, 'tutor');
  assert.equal(item.owner, 'Unassigned');
  assert.equal(item.linkedWorkflowId, 'tutor-absence');
  assert.equal(item.linkedTutorId, 'Robbie');
  assert.equal(item.linkedStudentId, '');
  assert.equal(item.isPause, false);
  assert.equal(item.targetDate, '2026-06-18'); // Thursday before the Friday absence
  assert.match(item.title, /Robbie Tranter/);
  assert.match(item.notes, /Charlie Mcdougall, Ailsa Hoebe/);
  assert.match(item.notes, /Tutor absence date: 2026-06-19/);
  assert.match(item.notes, /tutor=Robbie&date=2026-06-19/);
  assert.match(item.nextAction, /message 2 parents/);
});

test('buildTutorAbsencePlanningItem opts a newly captured absence into the early-notice timing without changing the legacy default', () => {
  const item = buildTutorAbsencePlanningItem({
    tutor: { shortName: 'Chloe', fullName: 'Chloe Mak' },
    absenceDate: '2026-08-04', // Tuesday
    lessons: [{ studentName: 'Ada Neocleous' }],
    enableEarlyNotice: true,
  });

  assert.equal(item.targetDate, '2026-07-20'); // Monday on/before the 14-day target
  assert.match(item.notes, /Tutor absence notice planning: v1/u);
  assert.match(item.nextAction, /initial parent notice/u);
});

test('buildTutorAbsencePlanningItem notes a missing MMS lesson list', () => {
  const item = buildTutorAbsencePlanningItem({
    tutor: { shortName: 'Robbie', fullName: 'Robbie Tranter' },
    absenceDate: '2026-06-15', // Monday
    lessons: [],
  });
  assert.match(item.notes, /No MMS lessons found/);
  assert.equal(item.targetDate, '2026-06-12'); // previous Friday
  assert.match(item.nextAction, /message 0 parents/);
});

test('flagNearbyPauses flags same-student pauses that sit next to each other', () => {
  // Emeline: a tutor-absence date (4 Jul) running into her own pause (11 Jul–1 Aug).
  const flags = flagNearbyPauses([
    { planningId: 'p_absence', studentId: 'sdt_em', start: '2026-07-04', end: '2026-07-04' },
    { planningId: 'p_own', studentId: 'sdt_em', start: '2026-07-11', end: '2026-08-01' },
    // A different student's lone pause — no neighbour, no flag.
    { planningId: 'p_solo', studentId: 'sdt_other', start: '2026-07-04', end: '2026-07-04' },
  ]);
  assert.deepEqual(flags.get('p_absence'), { otherStart: '2026-07-11', otherEnd: '2026-08-01' });
  assert.deepEqual(flags.get('p_own'), { otherStart: '2026-07-04', otherEnd: '2026-07-04' });
  assert.equal(flags.has('p_solo'), false);
});

test('flagNearbyPauses does not flag pauses that are far apart', () => {
  const flags = flagNearbyPauses([
    { planningId: 'a', studentId: 'sdt_em', start: '2026-07-04', end: '2026-07-04' },
    { planningId: 'b', studentId: 'sdt_em', start: '2026-09-01', end: '2026-09-15' },
  ]);
  assert.equal(flags.size, 0);
});

test('normalisePauseFlag constrains to true / false / empty', () => {
  assert.equal(normalisePauseFlag('true'), 'true');
  assert.equal(normalisePauseFlag('TRUE'), 'true');
  assert.equal(normalisePauseFlag('false'), 'false');
  assert.equal(normalisePauseFlag(''), '');
  assert.equal(normalisePauseFlag(undefined), '');
  assert.equal(normalisePauseFlag('yes'), ''); // junk falls back to unset (infer)
});
