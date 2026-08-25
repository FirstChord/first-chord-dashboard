import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_LESSON_CHECKIN_CHECKLIST,
  shortPreview,
  formatTargetDate,
  firstName,
  isStudentOwnContact,
  formatDateInput,
  addDaysToDateInput,
  parseReadablePlanningDate,
  extractPauseDatesFromPlanningItem,
  extractIncomingPlanningReply,
  buildPaymentPausePrefillUrl,
  buildPauseConfirmationMessage,
  isPausePlanningItem,
  isFirstLessonCheckinChecklistComplete,
  isFirstLessonCheckinPlanningItem,
  isTutorAbsenceCapturePlanningItem,
  requiresTutorAbsencePaymentTool,
  isDueNowPlanningItem,
  isOpenPlanningItem,
  getPlanningStory,
  getPlanningWhatToDo,
  dueChipLabel,
  hasPlanningLink,
  findStudentSuggestions,
  inferStudentFromText,
  truncateTitle,
  applySmartDefaults,
  buildPlanningRelationships,
  buildSearchText,
  workflowHref,
  buildTutorAbsenceWorkflowHref,
  studentHref,
  isSchoolNotePlanningItem,
  isTutorAbsenceNoticePlanningItem,
  extractTutorAbsenceNoticeMessage,
  isTutorAbsenceFinalConfirmationPlanningItem,
  extractTutorAbsenceFinalConfirmationMessage,
  hasPausePaymentConfirmation,
  buildSchoolNoteItem,
  isPauseCaptureText,
  isTutorAbsenceCaptureText,
  inferQuickCapture,
  buildQuickCaptureItem,
  filterPlanningItems,
  EMPTY_FORM,
} from '../../lib/admin/planning-client-helpers.mjs';

test('first-lesson check-in cards expose three required local checks', () => {
  assert.deepEqual(FIRST_LESSON_CHECKIN_CHECKLIST.map((step) => step.key), [
    'lesson_payment',
    'whatsapp_groups',
    'student_access',
  ]);
  assert.equal(isFirstLessonCheckinPlanningItem({ planningId: 'planning_first_lesson_checkin_sdt_123' }), true);
  assert.equal(isFirstLessonCheckinPlanningItem({ planningId: 'planning_early_stripe_timing_sdt_123' }), false);
  assert.equal(isFirstLessonCheckinChecklistComplete({}), false);
  assert.equal(isFirstLessonCheckinChecklistComplete({
    lesson_payment: true,
    whatsapp_groups: true,
    student_access: true,
  }), true);
});

test('incoming planning reply extraction keeps the reviewed multiline draft attached to the plan', () => {
  const reply = extractIncomingPlanningReply({
    notes: [
      'From WhatsApp incoming inbox (manual).',
      'Message: We are away in August.',
      'Suggested reply (send manually in WhatsApp):',
      'No worries at all, that’s noted.',
      'We’ll get those dates paused 🙂',
    ].join('\n'),
  });
  assert.equal(reply, 'No worries at all, that’s noted.\nWe’ll get those dates paused 🙂');
  assert.equal(extractIncomingPlanningReply({ notes: 'Ordinary planning notes' }), '');
});

test('tutor-absence early notice helpers recognise only versioned notice cards and extract their copy', () => {
  const item = {
    linkedWorkflowId: 'tutor-absence-notice',
    notes: 'Tutor absence early notice plan: v1.\nParent notice message:\nHello parent',
  };
  assert.equal(isTutorAbsenceNoticePlanningItem(item), true);
  assert.equal(extractTutorAbsenceNoticeMessage(item), 'Hello parent');
  assert.equal(isTutorAbsenceNoticePlanningItem({ linkedWorkflowId: 'tutor-absence-notice', notes: '' }), false);
});

test('tutor-absence final confirmation helpers keep payment-exception copy separate from pause cards', () => {
  const item = {
    linkedWorkflowId: 'tutor-absence-final-confirmation',
    notes: 'Tutor absence final confirmation: v1.\nParent final confirmation message:\nPayment is already paused.',
  };
  assert.equal(isTutorAbsenceFinalConfirmationPlanningItem(item), true);
  assert.equal(extractTutorAbsenceFinalConfirmationMessage(item), 'Payment is already paused.');
});

test('filterPlanningItems routes every chip: done/parked veil, search, owners, types, momentum', () => {
  const items = [
    { planningId: 'a', title: 'Fix billing', status: 'active', owner: 'Fennella', itemType: 'action', momentum: 'moving' },
    { planningId: 'b', title: 'Showcase idea', status: 'inbox', owner: 'Unassigned', itemType: 'idea', momentum: 'stalled' },
    { planningId: 'c', title: 'Shipped thing', status: 'done', owner: 'Finn', itemType: 'action', momentum: '' },
    { planningId: 'd', title: 'Parked initiative', status: 'parked', owner: 'Finn', itemType: 'initiative', momentum: '' },
    { planningId: 'e', title: 'Due plan', status: 'active', owner: 'Finn', itemType: 'action', momentum: 'moving', targetDate: '2020-01-01' },
    { planningId: 'planning_weekly_school_forward_review', title: 'Friday review', status: 'active', owner: 'Finn', itemType: 'initiative', momentum: 'moving' },
  ];
  const ids = (opts) => filterPlanningItems(items, opts).map((item) => item.planningId);

  // Done/parked stay hidden unless showDone or their own chip is active.
  assert.deepEqual(ids({ filter: 'all' }), ['a', 'b', 'e', 'planning_weekly_school_forward_review']);
  assert.deepEqual(ids({ filter: 'all', showDone: true }), ['a', 'b', 'c', 'd', 'e', 'planning_weekly_school_forward_review']);
  assert.deepEqual(ids({ filter: 'done' }), ['c']);
  assert.deepEqual(ids({ filter: 'parked' }), ['d']);

  // Free-text search runs before chip routing, case-insensitively.
  assert.deepEqual(ids({ filter: 'all', query: '  ShowCase ' }), ['b']);

  // Owner chips only surface open items; a past target date is due now.
  assert.deepEqual(ids({ filter: 'owner_fennella' }), ['a']);
  assert.deepEqual(ids({ filter: 'unassigned' }), ['b']);
  assert.deepEqual(ids({ filter: 'due_now' }), ['e']);
  assert.deepEqual(ids({ filter: 'school_notes' }), ['b']);

  // Item-type chips, and unknown filters fall through to a momentum match.
  assert.deepEqual(ids({ filter: 'idea' }), ['b']);
  assert.deepEqual(ids({ filter: 'initiative' }), []); // weekly review is not a long-running Project
  assert.deepEqual(ids({ filter: 'stalled' }), ['b']);
  assert.deepEqual(ids({ filter: 'no-such-momentum' }), []);
  assert.deepEqual(filterPlanningItems(undefined, { filter: 'all' }), []);
});

test('shortPreview truncates with an ellipsis past the max', () => {
  assert.equal(shortPreview('short', 50), 'short');
  assert.equal(shortPreview('a'.repeat(10), 5), 'aaaa...');
  assert.equal(shortPreview('  trimmed  ', 50), 'trimmed');
});

test('formatTargetDate: blank → blank, invalid → input, valid → readable', () => {
  assert.equal(formatTargetDate(''), '');
  assert.equal(formatTargetDate('not-a-date'), 'not-a-date');
  const out = formatTargetDate('2026-07-06');
  assert.match(out, /Jul/);
  assert.match(out, /6/);
});

test('firstName takes the first whitespace-delimited token', () => {
  assert.equal(firstName('Ada Lovelace'), 'Ada');
  assert.equal(firstName('  '), '');
  assert.equal(firstName('Madonna'), 'Madonna');
});

test('isStudentOwnContact treats no-parent / parent==student as the student being their own contact', () => {
  assert.equal(isStudentOwnContact({ fullName: 'Sian Malyin' }), true); // no parent
  assert.equal(isStudentOwnContact({ fullName: 'Sian Malyin', parentFirstName: 'Sian', parentLastName: 'Malyin' }), true);
  assert.equal(isStudentOwnContact({ fullName: 'Craig Mcaulay', parentFirstName: 'Craig', parentLastName: 'Mcauley' }), true); // one-character contact typo
  assert.equal(isStudentOwnContact({ fullName: 'Ada Smith', parentFirstName: 'Rachel', parentLastName: 'Smith' }), false);
  assert.equal(isStudentOwnContact({ fullName: 'Ada Smith', parentFirstName: 'Ada', parentLastName: 'Jones' }), false); // same first name, actual parent
});

test('date input helpers round-trip and shift correctly', () => {
  assert.equal(formatDateInput(new Date(2026, 6, 4)), '2026-07-04');
  assert.equal(addDaysToDateInput('2026-07-04', 3), '2026-07-07');
  assert.equal(addDaysToDateInput('2026-07-04', -2), '2026-07-02');
  assert.equal(addDaysToDateInput('not-a-date', 3), 'not-a-date');
});

test('parseReadablePlanningDate reads "Mon, 6 Jul 2026" → ISO', () => {
  assert.equal(parseReadablePlanningDate('Mon, 6 Jul 2026'), '2026-07-06');
  assert.equal(parseReadablePlanningDate('Sat 12 Sept 2026'), '2026-09-12');
  assert.equal(parseReadablePlanningDate('garbage'), '');
});

test('extractPauseDatesFromPlanningItem reads structured, single, and range notes', () => {
  assert.deepEqual(
    extractPauseDatesFromPlanningItem({ notes: 'First lesson to pause date: 2026-07-06\nReturning from date: 2026-07-20' }),
    { startDate: '2026-07-06', endDate: '2026-07-20' },
  );
  // single structured date → start === end
  assert.deepEqual(
    extractPauseDatesFromPlanningItem({ notes: 'Lesson date: 2026-07-06' }),
    { startDate: '2026-07-06', endDate: '2026-07-06' },
  );
  assert.deepEqual(extractPauseDatesFromPlanningItem({ notes: 'no dates here' }), { startDate: '', endDate: '' });
});

test('buildPaymentPausePrefillUrl returns empty without a student/dates, and a populated URL otherwise', () => {
  assert.equal(buildPaymentPausePrefillUrl({ item: {}, student: null }), '');
  assert.equal(buildPaymentPausePrefillUrl({ item: { notes: 'Lesson date: 2026-07-06' }, student: { fullName: 'Ada' } }), ''); // no mmsId
  const url = buildPaymentPausePrefillUrl({
    item: { planningId: 'p1', notes: 'First lesson to pause date: 2026-07-06\nReturning from date: 2026-07-20', targetDate: '2026-07-01' },
    student: { mmsId: 'sdt_1', fullName: 'Ada Smith', email: 'a@example.com', tutor: 'Kenny' },
  });
  assert.match(url, /payment-pause-pwa/);
  assert.match(url, /mmsId=sdt_1/);
  assert.match(url, /source=dashboard-planning/);

  const tutorAbsenceUrl = buildPaymentPausePrefillUrl({
    item: {
      planningId: 'p2',
      linkedWorkflowId: 'tutor-absence',
      notes: 'Lesson date: 2026-08-04\nTutor absence: Chloe Mak.',
      targetDate: '2026-07-30',
    },
    student: { mmsId: 'sdt_1', fullName: 'Ada Smith' },
  });
  assert.equal(new URL(tutorAbsenceUrl).searchParams.get('reason'), 'Teacher Holiday');
});

test('buildPauseConfirmationMessage addresses adults directly and parents in third person', () => {
  const item = { notes: 'First lesson to pause date: 2026-07-06\nReturning from date: 2026-07-20' };
  const adult = buildPauseConfirmationMessage({ item, student: { fullName: 'Sian Malyin', tutor: 'Kenny Bates' } });
  assert.match(adult, /paused your payment/);
  assert.match(adult, /will next see you on/);

  const adultWithContactTypo = buildPauseConfirmationMessage({
    item: { notes: 'Lesson date: 2026-07-13' },
    student: { fullName: 'Craig Mcaulay', parentFirstName: 'Craig', parentLastName: 'Mcauley' },
  });
  assert.match(adultWithContactTypo, /paused payment for your lesson/);
  assert.doesNotMatch(adultWithContactTypo, /Craig's lesson/);

  const parent = buildPauseConfirmationMessage({ item, student: { fullName: 'Ada Smith', parentFirstName: 'Rachel', parentLastName: 'Smith', tutor: 'Kenny Bates' } });
  assert.match(parent, /Hi Rachel/);
  assert.match(parent, /paused payment for Ada/);
});

test('isPausePlanningItem / isOpenPlanningItem / isDueNowPlanningItem classify items', () => {
  assert.equal(isPausePlanningItem({ title: 'Pause Ada' }), true);
  assert.equal(isPausePlanningItem({ title: 'Email parent' }), false);
  // Explicit is_pause flag overrides the wording (the panel's Structured pause /
  // General toggle): a flagged-general card with "pause" in the title is not a
  // pause, and a flagged-pause card without the word is.
  assert.equal(isPausePlanningItem({ title: 'Pause Ada', isPause: 'false' }), false);
  assert.equal(isPausePlanningItem({ title: 'Away weeks for Ada', isPause: 'true' }), true);
  assert.equal(isPausePlanningItem({ title: 'Pause Ada', isPause: '' }), true); // unset = infer
  assert.equal(requiresTutorAbsencePaymentTool({
    title: 'Pause Ada',
    linkedWorkflowId: 'tutor-absence',
  }), true);
  assert.equal(requiresTutorAbsencePaymentTool({
    title: 'Pause Ada',
    linkedWorkflowId: 'holidays',
  }), false);
  assert.equal(isOpenPlanningItem({ status: 'active' }), true);
  assert.equal(isOpenPlanningItem({ status: 'done' }), false);
  const now = new Date('2026-07-10T12:00:00Z');
  assert.equal(isDueNowPlanningItem({ status: 'active', targetDate: '2026-07-10' }, now), true);
  assert.equal(isDueNowPlanningItem({ status: 'active', targetDate: '2026-07-20' }, now), false); // future
  assert.equal(isDueNowPlanningItem({ status: 'done', targetDate: '2026-07-01' }, now), false); // done
});

test('cancelled tutor-absence parent handoff does not become a student pause card', () => {
  const item = {
    planningId: 'planning_tutor_absence_example_2026-07-20',
    title: 'Tutor absence: Example Tutor — 20 Jul 2026',
    notes: [
      'Tutor absence date: 2026-07-20',
      'Tutor: Example',
      'Tutor absence decision: cancel_day',
    ].join('\n'),
    nextAction: 'Waiting for linked pause cards to complete; this absence closes automatically.',
    linkedWorkflowId: 'tutor-absence',
    linkedTutorId: 'Example',
    linkedStudentId: '',
    status: 'waiting',
  };

  assert.equal(isTutorAbsenceCapturePlanningItem(item), true);
  assert.equal(isPausePlanningItem(item), false);
  assert.equal(getPlanningStory(item, []), item.title);
  assert.equal(requiresTutorAbsencePaymentTool(item), false);
});

test('getPlanningStory frames pause cards and falls back to the title', () => {
  const opts = [{ mmsId: 'sdt_1', fullName: 'Ada Smith' }];
  const range = getPlanningStory({ linkedStudentId: 'sdt_1', notes: 'Pause — First lesson to pause date: 2026-07-06\nReturning from date: 2026-07-20' }, opts);
  assert.match(range, /Pause Ada Smith from/);
  assert.equal(getPlanningStory({ title: 'Order new chairs' }), 'Order new chairs');
  assert.equal(getPlanningStory({ title: '' }), 'This needs a look today.');
});

test('getPlanningWhatToDo prefers nextAction, then pause/tutor-absence framing', () => {
  assert.equal(getPlanningWhatToDo({ nextAction: 'Call the parent' }), 'Call the parent');
  assert.equal(getPlanningWhatToDo({ itemType: 'action', title: 'Call the parent', nextAction: 'Call the parent' }), '');
  assert.match(getPlanningWhatToDo({ itemType: 'initiative' }), /open Actions/);
  assert.match(getPlanningWhatToDo({ title: 'Pause Ada' }), /pause the payment/);
  assert.match(getPlanningWhatToDo({ linkedWorkflowId: 'tutor-absence' }), /tutor-absence workflow/);
});

test('dueChipLabel: today, overdue, future, and no-date', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  assert.equal(dueChipLabel('2026-07-10', now), 'Today');
  assert.equal(dueChipLabel('2026-07-09', now), 'Overdue 1 day');
  assert.equal(dueChipLabel('2026-07-07', now), 'Overdue 3 days');
  assert.equal(dueChipLabel('', now), 'No date');
  assert.match(dueChipLabel('2026-07-20', now), /Jul/); // future → formatted date
});

test('hasPlanningLink is true when any link field is set', () => {
  assert.equal(hasPlanningLink({ linkedStudentId: 'sdt_1' }), true);
  assert.equal(hasPlanningLink({ linkedWorkflowId: 'tutor-absence' }), true);
  assert.equal(hasPlanningLink({}), false);
});

test('truncateTitle takes the first line, strips bullets, and caps length', () => {
  assert.equal(truncateTitle('- First line\nSecond line'), 'First line');
  assert.equal(truncateTitle('x'.repeat(100), 10), 'xxxxxxxxx...');
});

test('applySmartDefaults activates dated Actions and Projects but leaves undated Actions in Inbox', () => {
  assert.deepEqual(
    applySmartDefaults({ itemType: 'action', status: 'inbox', planMode: 'ongoing' }),
    { itemType: 'action', status: 'inbox', planMode: 'task' },
  );
  assert.deepEqual(
    applySmartDefaults({ itemType: 'action', status: 'inbox', planMode: 'ongoing', targetDate: '2026-08-18' }),
    { itemType: 'action', status: 'active', planMode: 'task', targetDate: '2026-08-18' },
  );
  assert.deepEqual(
    applySmartDefaults({ itemType: 'initiative', status: 'inbox', planMode: 'task' }),
    { itemType: 'initiative', status: 'active', planMode: 'ongoing' },
  );
  assert.equal(applySmartDefaults({ itemType: 'idea', status: 'inbox' }).status, 'inbox'); // notes/ideas stay
});

test('buildPlanningRelationships links only action cards to Project parents', () => {
  const project = { planningId: 'project_1', itemType: 'initiative', title: 'Build curriculum' };
  const olderDone = {
    planningId: 'action_old',
    itemType: 'action',
    parentPlanningId: 'project_1',
    title: 'Draft outline',
    status: 'done',
    updatedAt: '2026-08-10T12:00:00Z',
  };
  const current = {
    planningId: 'action_current',
    itemType: 'action',
    parentPlanningId: 'project_1',
    title: 'Ask tutors for feedback',
    status: 'active',
    updatedAt: '2026-08-12T12:00:00Z',
  };
  const secondOpen = {
    planningId: 'action_second',
    itemType: 'action',
    parentPlanningId: 'project_1',
    title: 'Price the printed handbook',
    status: 'active',
    updatedAt: '2026-08-11T12:00:00Z',
  };
  const unrelatedNote = { planningId: 'note_1', itemType: 'idea', parentPlanningId: 'project_1' };
  const weeklyReview = { planningId: 'planning_weekly_school_forward_review', itemType: 'initiative' };
  const reflectionAction = { planningId: 'reflection_action', itemType: 'action', parentPlanningId: weeklyReview.planningId };
  const relationships = buildPlanningRelationships([olderDone, unrelatedNote, project, secondOpen, current, weeklyReview, reflectionAction]);

  assert.equal(relationships.itemsById.get('project_1'), project);
  assert.deepEqual(
    relationships.actionsByProjectId.get('project_1').map((item) => item.planningId),
    ['action_current', 'action_second', 'action_old'],
  );
  assert.equal(relationships.actionsByProjectId.has(weeklyReview.planningId), false);
});

const STUDENTS = [
  { mmsId: 'sdt_theo', fullName: 'Theodore Brown', tutor: 'Kenny', instrument: 'Guitar' },
  { mmsId: 'sdt_ada', fullName: 'Ada Lovelace', tutor: 'Calum', instrument: 'Piano' },
];

test('findStudentSuggestions ranks prefix/substring matches', () => {
  const out = findStudentSuggestions(STUDENTS, 'theo');
  assert.equal(out[0].mmsId, 'sdt_theo');
  assert.deepEqual(findStudentSuggestions(STUDENTS, ''), []);
});

test('inferStudentFromText avoids the stop-word trap and resolves real names', () => {
  // "the" must NOT latch onto Theodore (the stop-word guard)
  assert.equal(inferStudentFromText(STUDENTS, 'pause the lesson next week'), null);
  // a real first name resolves
  assert.equal(inferStudentFromText(STUDENTS, 'Ada is away on holiday')?.mmsId, 'sdt_ada');
});

test('workflowHref maps known workflows and returns empty for unknown', () => {
  assert.equal(workflowHref('tutor-absence'), '/admin/workflows/tutor-absence');
  assert.equal(workflowHref('waiting'), '/admin/waiting');
  assert.equal(workflowHref('nope'), '');
});

test('buildTutorAbsenceWorkflowHref prefills tutor+date from notes, falls back to base', () => {
  const href = buildTutorAbsenceWorkflowHref({ notes: 'Tutor: Stef\nTutor absence date: 2026-07-06' });
  assert.match(href, /tutor=Stef/);
  assert.match(href, /date=2026-07-06/);
  assert.equal(buildTutorAbsenceWorkflowHref({ notes: 'no tutor/date' }), '/admin/workflows/tutor-absence');
});

test('studentHref builds a student path or empty', () => {
  assert.equal(studentHref('sdt_1'), '/admin/students/sdt_1');
  assert.equal(studentHref(''), '');
});

test('isSchoolNotePlanningItem / hasPausePaymentConfirmation classify by type/progress', () => {
  assert.equal(isSchoolNotePlanningItem({ itemType: 'learning_note' }), true);
  assert.equal(isSchoolNotePlanningItem({ itemType: 'idea' }), true);
  assert.equal(isSchoolNotePlanningItem({ itemType: 'action' }), false);
  assert.equal(hasPausePaymentConfirmation({ progress: [{ progressNote: 'Payment pause confirmation message sent.' }] }), true);
  assert.equal(hasPausePaymentConfirmation({ progress: [{ progressNote: 'something else' }] }), false);
});

test('buildSchoolNoteItem maps the school-thinking form into one Inbox Idea shape', () => {
  const item = buildSchoolNoteItem({ title: 'Marketing idea', noteKind: 'strategic_note', mainNote: 'do a campaign', keyIdeas: 'posters' });
  assert.equal(item.itemType, 'idea');
  assert.equal(item.status, 'inbox');
  assert.equal(item.linkedWorkflowId, 'school-notes');
  assert.match(item.notes, /Main note \/ transcript summary:\ndo a campaign/);
  assert.match(item.notes, /Key ideas:\nposters/);
  assert.equal(buildSchoolNoteItem({ noteKind: 'bogus' }).itemType, 'idea');
});

test('buildSearchText flattens item fields to a lowercase haystack', () => {
  const text = buildSearchText({ title: 'Pause ADA', notes: 'Holiday', owner: 'Tom', linkedStudentIds: ['sdt_1'] });
  assert.match(text, /pause ada/);
  assert.match(text, /holiday/);
  assert.match(text, /tom/);
});

test('isPauseCaptureText detects pause wording', () => {
  assert.equal(isPauseCaptureText('pause Ada next week'), true);
  assert.equal(isPauseCaptureText('paused for holiday'), true);
  assert.equal(isPauseCaptureText('email the parent'), false);
});

test('inferQuickCapture maps keywords to area/type defaults', () => {
  assert.equal(inferQuickCapture('pause Ada for holiday').area, 'admin');
  assert.equal(inferQuickCapture('stripe refund needed').area, 'finance');
  assert.equal(inferQuickCapture('showcase poster').area, 'growth');
  assert.equal(inferQuickCapture('maybe revisit this idea').itemType, 'idea');
  assert.equal(inferQuickCapture('plain note').itemType, 'action'); // default
});

test('isTutorAbsenceCaptureText recognises a tutor-off phrasing', () => {
  assert.equal(isTutorAbsenceCaptureText('Kenny off Friday'), true);
  assert.equal(isTutorAbsenceCaptureText('order new chairs'), false);
});

test('buildQuickCaptureItem builds an item from a raw note (title truncated, action gets nextAction)', () => {
  const item = buildQuickCaptureItem('stripe refund for a parent', {}, []);
  assert.equal(item.area, 'finance');
  assert.equal(item.notes, 'stripe refund for a parent');
  assert.match(item.title, /stripe refund/);
  // an inferred action gets its nextAction defaulted to the title
  assert.equal(item.itemType, 'action');
  assert.equal(item.nextAction, item.title);
  assert.equal(item.status, 'inbox'); // ordinary brain capture still lands in Inbox
  const project = buildQuickCaptureItem('beginner guitar curriculum', {
    itemType: 'initiative',
    outcome: 'A reviewed twelve-week pathway exists.',
  }, []);
  assert.equal(project.status, 'active');
  assert.equal(project.planMode, 'ongoing');
  assert.equal(project.nextAction, '');
  const datedAction = buildQuickCaptureItem('Call Rachel on 18 August', { targetDate: '2026-08-18' }, []);
  assert.equal(datedAction.status, 'active');
  const idea = buildQuickCaptureItem('Idea for Friday', { itemType: 'idea', targetDate: '2026-08-21' }, []);
  assert.equal(idea.status, 'inbox');
  assert.equal(idea.targetDate, '');
  // overrides win and control fields (e.g. studentSelectionSource) are stripped
  const withOverride = buildQuickCaptureItem('note', {
    title: 'Custom',
    studentSelectionSource: 'manual',
    structuredCapture: 'pause',
    pauseType: 'range',
    tutorAbsenceDates: ['2026-08-10'],
  }, []);
  assert.equal(withOverride.title, 'Custom');
  assert.equal('studentSelectionSource' in withOverride, false);
  assert.equal('structuredCapture' in withOverride, false);
  assert.equal('pauseType' in withOverride, false);
  assert.equal('tutorAbsenceDates' in withOverride, false);
});

test('EMPTY_FORM is a complete blank planning form', () => {
  assert.equal(EMPTY_FORM.itemType, 'idea');
  assert.equal(EMPTY_FORM.status, 'inbox');
  assert.deepEqual(EMPTY_FORM.linkedStudentIds, []);
});
