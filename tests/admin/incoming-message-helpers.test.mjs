import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePauseWindowsFromPlanning } from '../../lib/admin/pause-forecast.mjs';
import {
  applyIncomingClassificationReview,
  clusterIncomingMessages,
  applyIncomingMessageSnooze,
  applyIncomingMessageTextUpdate,
  applyIncomingPlanningDateOverrides,
  assessBridgeHealth,
  buildGroupSyncPlan,
  extractIncomingMessageDates,
  buildIncomingMessageId,
  buildIncomingMessageRecord,
  buildIncomingPlanningDraft,
  buildIncomingReplyTemplate,
  buildWhatsappShareUrl,
  buildTutorPhoneLookup,
  buildWhatsappGroupMapRecord,
  classifyIncomingMessage,
  decideAutoCaptureStatus,
  decideSyncedGroupStatus,
  deriveIncomingMessageResolutionType,
  detectInstrumentInName,
  groupIncomingMessages,
  isAutoArchivedMessage,
  isIncomingMessageSnoozed,
  isIncomingPlaceholderText,
  isOneTapConvertEligible,
  isSchoolStaffMessage,
  isWhatsappGroupChatId,
  matchGroupToStudent,
  matchTutorPhone,
  matchTutorSenderName,
  matchIncomingMessageToStudent,
  mergeIncomingCapture,
  labelIncomingResolutionType,
  normaliseIncomingMessagePayload,
  normalisePhone,
  resolveIncomingPlanningAction,
  resolveReviewedIncomingReply,
  selectReplyEvidenceTarget,
} from '../../lib/admin/incoming-message-helpers.mjs';
import { isPausePlanningItem } from '../../lib/admin/planning-client-helpers.mjs';

const students = [
  {
    mmsId: 'sdt_alex',
    fcStudentId: 'fc_alex',
    firstName: 'Alex',
    lastName: 'Chang',
    fullName: 'Alex Chang',
    parentFirstName: 'Mina',
    parentLastName: 'Chang',
    contactNumber: '07788 626616',
    tutor: 'Dean Louden',
    instrument: 'Guitar',
  },
  {
    mmsId: 'sdt_sam',
    fcStudentId: 'fc_sam',
    firstName: 'Sam',
    lastName: 'Reid',
    fullName: 'Sam Reid',
    parentFirstName: 'Laura',
    parentLastName: 'Reid',
    contactNumber: '07800 111222',
  },
];

test('normalisePhone makes UK mobile forms comparable', () => {
  assert.equal(normalisePhone('+44 7788 626616'), '07788626616');
  assert.equal(normalisePhone('447788626616'), '07788626616');
  assert.equal(normalisePhone('07788 626616'), '07788626616');
});

test('normaliseIncomingMessagePayload accepts bridge and manual field names', () => {
  const row = normaliseIncomingMessagePayload({
    source: 'whatsapp_starred',
    message_id: 'abc',
    message_text: 'Alex is away next week',
    sender_phone: '+44 7788 626616',
  }, { now: new Date('2026-06-30T10:00:00Z') });

  assert.equal(row.source, 'whatsapp_starred');
  assert.equal(row.externalMessageId, 'abc');
  assert.equal(row.messageText, 'Alex is away next week');
  assert.equal(row.senderPhone, '+44 7788 626616');
  assert.equal(row.capturedAt, '2026-06-30T10:00:00.000Z');
  assert.match(row.incomingId, /^incoming_/u);
});

test('incoming resolution types make handled, ignored, and planned messages distinct', () => {
  assert.equal(deriveIncomingMessageResolutionType({ status: 'converted' }), 'handled_no_plan');
  assert.equal(deriveIncomingMessageResolutionType({ status: 'converted', createdPlanningId: 'planning_123' }), 'planning_task');
  assert.equal(deriveIncomingMessageResolutionType({ status: 'ignored' }), 'ignored_no_action');
  assert.equal(deriveIncomingMessageResolutionType({ resolutionType: 'planning_task', status: 'ignored' }), 'planning_task');
  assert.equal(labelIncomingResolutionType('handled_no_plan'), 'Handled — no plan needed');
});

test('Later parks only open messages until a real future time', () => {
  const now = new Date('2026-08-04T16:00:00.000Z');
  const row = { incomingId: 'incoming_later', status: 'needs_review', reviewedBy: '' };
  const parked = applyIncomingMessageSnooze(row, {
    snoozedUntil: '2026-08-05T08:00:00.000Z',
    actorEmail: 'finn@example.com',
    now,
  });

  assert.equal(parked.status, 'needs_review');
  assert.equal(parked.snoozedUntil, '2026-08-05T08:00:00.000Z');
  assert.equal(parked.reviewedBy, 'finn@example.com');
  assert.equal(isIncomingMessageSnoozed(parked, { now }), true);
  assert.equal(isIncomingMessageSnoozed(parked, { now: new Date('2026-08-05T08:00:00.000Z') }), false);

  const returned = applyIncomingMessageSnooze(parked, {
    snoozedUntil: '',
    actorEmail: 'tom@example.com',
    now,
  });
  assert.equal(returned.snoozedUntil, '');
  assert.equal(returned.reviewedBy, 'tom@example.com');

  assert.throws(() => applyIncomingMessageSnooze(row, {
    snoozedUntil: '2026-08-04T15:59:00.000Z',
    now,
  }), /future/u);
  assert.throws(() => applyIncomingMessageSnooze({ ...row, status: 'converted' }, {
    snoozedUntil: '2026-08-05T08:00:00.000Z',
    now,
  }), /Only open/u);
});

test('classifyIncomingMessage detects absence/pause before general', () => {
  assert.equal(classifyIncomingMessage('Alex cannot make his lesson on Friday').category, 'one_off_absence');
  assert.equal(classifyIncomingMessage('Can we pause Sam for two weeks?').category, 'extended_absence');
  assert.equal(classifyIncomingMessage('We need to stop lessons after July').category, 'leaving');
  assert.equal(classifyIncomingMessage('The Stripe payment failed').category, 'payment');
});

test('a singular missed lesson stays one-off even when a return date is included', () => {
  const result = classifyIncomingMessage('[STUDENT_A] will miss his lesson on the 12th and will be back on the 19th.');
  assert.equal(result.category, 'one_off_absence');
  assert.equal(result.actionability, 'action_needed');
  assert.equal(result.confidence, 'high');
});

test('classifyIncomingMessage treats summer last-lesson wording as a break, not leaving', () => {
  const result = classifyIncomingMessage('Yahya will be away for 1 week camp then going away for holiday so last lessons will be 15 of July');
  assert.equal(result.category, 'summer_break');
  assert.match(result.reasons.join(' '), /summer|holiday/u);
});

test('classification separates topic words from whether school action is actually needed', () => {
  const noActionCases = [
    'Hope you had a lovely summer',
    'We had a lovely summer holiday',
    'Summer is finally here',
    'The holiday photos are lovely',
    'The summer concert was brilliant',
    'How was your holiday?',
    'Away for the weekend but lessons are normal',
    'I paid for the music book yesterday',
    'Bank holiday is fine, no change to lessons',
    'I am worried about the exam but looking forward to it',
    'The new slot works, thanks',
    'Back to school and excited',
    'The payment went through, all sorted',
    'I was ill so only saw this now',
    'I cannot make the parent call but the lesson is fine',
    'Sorry for the slow reply, caught up with holidays',
  ];

  for (const message of noActionCases) {
    const result = classifyIncomingMessage(message);
    assert.equal(result.actionability, 'no_action', message);
    assert.equal(decideAutoCaptureStatus({
      suspectedCategory: result.category,
      classificationActionability: result.actionability,
      messageText: message,
    }), 'ignored', message);
  }

  const question = classifyIncomingMessage('What time is the showcase?');
  assert.equal(question.category, 'schedule');
  assert.equal(question.intent, 'question');
  assert.equal(question.actionability, 'reply_needed');

  const summerChange = classifyIncomingMessage('Alex will be away on holiday during July and August');
  assert.equal(summerChange.category, 'summer_break');
  assert.equal(summerChange.actionability, 'action_needed');

  const absenceWithPoliteClose = classifyIncomingMessage('Alex cannot make his lesson on Friday, see you next week');
  assert.equal(absenceWithPoliteClose.category, 'one_off_absence');
  assert.equal(absenceWithPoliteClose.actionability, 'action_needed');

  const concernWithPoliteClose = classifyIncomingMessage('I am worried Alex is struggling and look forward to talking');
  assert.equal(concernWithPoliteClose.category, 'concern');
  assert.equal(concernWithPoliteClose.actionability, 'reply_needed');

  const actionAfterGreeting = classifyIncomingMessage('Hope you had a lovely summer. Alex cannot make his lesson on Friday.');
  assert.equal(actionAfterGreeting.category, 'one_off_absence');
  assert.equal(actionAfterGreeting.actionability, 'action_needed');

  const actionAfterResolvedUpdate = classifyIncomingMessage('The old payment is all sorted, but can we move the lesson to Thursday?');
  assert.equal(actionAfterResolvedUpdate.actionability, 'action_needed');
});

test('matchIncomingMessageToStudent prefers phone matches', () => {
  const match = matchIncomingMessageToStudent({
    senderPhone: '+44 7788 626616',
    messageText: 'Away next Friday',
  }, students);

  assert.equal(match.matchedMmsId, 'sdt_alex');
  assert.equal(match.matchConfidence, 'high');
  assert.match(match.matchReasons, /phone/u);
});

test('matchIncomingMessageToStudent can match by full name and unique first name', () => {
  const full = matchIncomingMessageToStudent({ messageText: 'Alex Chang is away next week' }, students);
  assert.equal(full.matchedMmsId, 'sdt_alex');
  assert.equal(full.matchConfidence, 'high');

  const first = matchIncomingMessageToStudent({ messageText: 'Sam is sick today' }, students);
  assert.equal(first.matchedMmsId, 'sdt_sam');
  assert.equal(first.matchConfidence, 'low');
});

test('buildIncomingMessageRecord adds category, match, and raw payload', () => {
  const record = buildIncomingMessageRecord({
    source: 'manual_paste',
    messageText: 'Mina here, Alex Chang is on holiday next week',
  }, { students, now: new Date('2026-06-30T10:00:00Z') });

  assert.equal(record.suspectedCategory, 'extended_absence');
  assert.equal(record.matchedMmsId, 'sdt_alex');
  assert.equal(record.status, 'inbox');
  assert.equal(record.proposedCategory, 'extended_absence');
  assert.equal(record.classificationActionability, 'action_needed');
  assert.equal(record.classificationDecision, 'unreviewed');
  assert.equal(record.classificationVersion, '2');
  assert.match(record.matchReasons, /attendance|pause|lesson cover/u);
  assert.match(record.rawJson, /Alex Chang/u);
});

test('buildWhatsappGroupMapRecord stores only WhatsApp group chats', () => {
  assert.equal(isWhatsappGroupChatId('120363400087109552@g.us'), true);
  assert.equal(isWhatsappGroupChatId('19980372422675@lid'), false);

  const record = buildIncomingMessageRecord({
    source: 'whatsapp_starred',
    external_message_id: 'abc',
    chat_id: '120363400087109552@g.us',
    chat_name: 'Alex small group',
    sender_name: 'Mina',
    sender_phone: '+44 7788 626616',
    message_text: 'Alex is away next Friday',
    message_at: '2026-06-30T09:00:00Z',
  }, { students, now: new Date('2026-06-30T10:00:00Z') });

  const map = buildWhatsappGroupMapRecord(record);
  assert.equal(map.chatId, '120363400087109552@g.us');
  assert.equal(map.chatName, 'Alex small group');
  assert.equal(map.lastIncomingId, record.incomingId);
  assert.equal(map.matchedMmsId, 'sdt_alex');
  assert.equal(map.status, 'review');

  assert.equal(buildWhatsappGroupMapRecord({ ...record, chatId: '19980372422675@lid' }), null);
});

test('buildWhatsappGroupMapRecord stores confirmed student and parent context', () => {
  const map = buildWhatsappGroupMapRecord({
    chatId: '120363400087109552@g.us',
    chatName: 'Alex small group',
    matchedMmsId: 'sdt_alex',
    matchedFcId: 'fc_alex',
    matchedStudentName: 'Alex Chang',
    parentName: 'Mina Chang',
    parentPhone: '07788 626616',
    tutorName: 'Dean Louden',
    instrument: 'Guitar',
    groupMapStatus: 'confirmed',
    confirmedBy: 'finn@example.com',
    confirmedAt: '2026-07-01T10:00:00.000Z',
  });

  assert.equal(map.matchedMmsId, 'sdt_alex');
  assert.equal(map.matchedFcId, 'fc_alex');
  assert.equal(map.parentName, 'Mina Chang');
  assert.equal(map.parentPhone, '07788 626616');
  assert.equal(map.tutorName, 'Dean Louden');
  assert.equal(map.instrument, 'Guitar');
  assert.equal(map.status, 'confirmed');
  assert.equal(map.confirmedBy, 'finn@example.com');
  assert.equal(map.confirmedAt, '2026-07-01T10:00:00.000Z');
});

test('confirmed WhatsApp group map beats weaker text/name guesses', () => {
  const match = matchIncomingMessageToStudent({
    chatId: '120363400087109552@g.us',
    senderName: 'Mariam',
    messageText: 'Aria is mentioned, but this group is actually for Sam',
  }, students, {
    groupMapRows: [{
      chatId: '120363400087109552@g.us',
      matchedMmsId: 'sdt_sam',
      matchedStudentName: 'Sam Reid',
      status: 'confirmed',
    }],
  });

  assert.equal(match.matchedMmsId, 'sdt_sam');
  assert.equal(match.matchConfidence, 'high');
  assert.match(match.matchReasons, /confirmed WhatsApp group/u);
});

test('buildIncomingReplyTemplate produces a per-category parent draft', () => {
  const absence = buildIncomingReplyTemplate({
    category: 'one_off_absence',
    senderName: 'Mina Chang',
    studentName: 'Alex Chang',
    startDate: '2026-07-10',
  });
  assert.equal(absence, 'No worries at all, that’s noted. We’ll get that date paused 🙂');
  // House style: parent drafts never use em-dashes.
  assert.doesNotMatch(absence, /—/u);

  const leaving = buildIncomingReplyTemplate({ category: 'leaving', senderName: 'Laura', studentName: 'Sam Reid' });
  assert.match(leaving, /sorry to see Sam go/u);

  // Unknown category still returns a safe acknowledgement.
  assert.match(buildIncomingReplyTemplate({ category: 'wat', senderName: 'Jo' }), /^Hi Jo/u);
});

test('buildIncomingPlanningDraft maps a reviewed message into a planning item', () => {
  const draft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'extended_absence',
      matchedMmsId: 'sdt_alex',
      matchedStudentName: 'Alex Chang',
      senderName: 'Mina Chang',
      senderPhone: '07788 626616',
      messageText: 'Alex is away for two weeks',
      source: 'whatsapp_starred',
    },
    student: { parentFirstName: 'Mina' },
    replyTemplate: 'Hi Mina! Thanks for letting us know.',
  });

  // Duration but no anchor date → stays a generic action, with the duration noted.
  assert.equal(draft.title, 'Extended absence: Alex Chang');
  assert.equal(draft.itemType, 'action');
  assert.equal(draft.status, 'inbox');
  assert.equal(draft.area, 'workflow');
  assert.deepEqual(draft.linkedStudentIds, ['sdt_alex']);
  assert.match(draft.notes, /Alex is away for two weeks/u);
  assert.match(draft.notes, /Suggested reply/u);
  assert.match(draft.notes, /Dates spotted in message: 2 week/u);
});

test('an extended absence with dates converts to a structured pause plan the forecast can read', () => {
  const draft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'extended_absence',
      matchedMmsId: 'sdt_alex',
      matchedStudentName: 'Alex Chang',
      senderName: 'Mina Chang',
      messageText: 'Alex will be away for holiday from the 24th of June till the 21st of July',
      messageAt: '2026-06-19T10:00:00.000Z',
      source: 'whatsapp_starred',
    },
    student: { parentFirstName: 'Mina' },
    replyTemplate: 'Hi Mina! Thanks for letting us know.',
    now: new Date('2026-06-19T10:00:00Z'),
  });

  assert.match(draft.title, /^Pause Alex Chang from/u);
  assert.equal(draft.area, 'admin');
  assert.deepEqual(draft.linkedStudentIds, ['sdt_alex']);
  assert.match(draft.notes, /First lesson to pause date: 2026-06-24/u);
  assert.match(draft.notes, /Returning from date: 2026-07-21/u);
  // The original message and reply still travel with the plan.
  assert.match(draft.notes, /Alex will be away for holiday/u);
  assert.match(draft.notes, /Suggested reply/u);

  // Round-trip: the pause forecast parses the window from this exact item.
  const { windows, unparsed } = parsePauseWindowsFromPlanning([{
    planningId: 'planning_incoming_1',
    title: draft.title,
    notes: draft.notes,
    status: draft.status,
    linkedStudentId: draft.linkedStudentIds.join(','),
  }]);
  assert.equal(unparsed.length, 0);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].mmsId, 'sdt_alex');
  assert.equal(windows[0].type, 'away');
  assert.equal(windows[0].start.toISOString().slice(0, 10), '2026-06-24');
  assert.equal(windows[0].end.toISOString().slice(0, 10), '2026-07-21');
});

test('a one-off absence with a date converts to a single-lesson pause plan', () => {
  const draft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'one_off_absence',
      matchedMmsId: 'sdt_alex',
      matchedStudentName: 'Alex Chang',
      senderName: 'Mina Chang',
      messageText: 'Alex cannot make his lesson next Friday',
      messageAt: '2026-06-29T08:00:00.000Z',
      source: 'whatsapp_starred',
    },
    now: new Date('2026-06-29T10:00:00Z'),
  });

  assert.match(draft.title, /^Pause Alex Chang lesson on/u);
  assert.match(draft.notes, /Lesson date: 2026-07-03/u);

  const { windows } = parsePauseWindowsFromPlanning([{
    planningId: 'planning_incoming_2',
    title: draft.title,
    notes: draft.notes,
    linkedStudentId: 'sdt_alex',
  }]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].type, 'single');
});

test('a converted pause draft is recognised as a pause item so the deep link opens the structured editor', () => {
  // The inbox "Open plan" deep link routes pause items to the structured pause
  // date editor via isPausePlanningItem. This locks that a pause conversion
  // actually produces something that predicate recognises.
  const pauseDraft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'extended_absence',
      matchedMmsId: 'sdt_alex',
      matchedStudentName: 'Alex Chang',
      messageText: 'Alex will be away from the 24th of June till the 21st of July',
      source: 'whatsapp_starred',
    },
    now: new Date('2026-06-19T10:00:00Z'),
  });
  assert.equal(isPausePlanningItem(pauseDraft), true);

  // A non-pause conversion (payment query) must NOT route to the pause editor.
  const paymentDraft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'payment',
      matchedMmsId: 'sdt_alex',
      matchedStudentName: 'Alex Chang',
      messageText: 'Can you check the invoice for this month?',
      source: 'whatsapp_starred',
    },
    now: new Date('2026-06-19T10:00:00Z'),
  });
  assert.equal(isPausePlanningItem(paymentDraft), false);
});

test('the structured pause path needs a matched student', () => {
  const draft = buildIncomingPlanningDraft({
    record: {
      suspectedCategory: 'extended_absence',
      senderName: 'Mina Chang',
      messageText: 'We are away from the 24th of June till the 21st of July',
      messageAt: '2026-06-19T10:00:00.000Z',
      source: 'whatsapp_starred',
    },
  });

  assert.match(draft.title, /^Extended absence/u);
  assert.match(draft.notes, /Dates spotted in message: from 2026-06-24 · back 2026-07-21/u);
});

test('buildIncomingReplyTemplate keeps pause replies short and general', () => {
  const dated = buildIncomingReplyTemplate({
    category: 'extended_absence',
    senderName: 'Mina Chang',
    studentName: 'Alex Chang',
    startDate: '2026-06-24',
    returnDate: '2026-07-21',
  });
  assert.equal(dated, 'No worries at all, that’s noted. We’ll get those dates paused 🙂');
  assert.doesNotMatch(dated, /Mina|Alex|June|July/u);

  const oneOff = buildIncomingReplyTemplate({
    category: 'one_off_absence',
    senderName: 'Mina',
    studentName: 'Alex',
    startDate: '2026-07-03',
  });
  assert.equal(oneOff, 'No worries at all, that’s noted. We’ll get that date paused 🙂');
  assert.doesNotMatch(oneOff, /Mina|Alex|July/u);

  // The parent's own message carries the detail even when extraction is incomplete.
  const undated = buildIncomingReplyTemplate({ category: 'extended_absence', senderName: 'Mina', studentName: 'Alex' });
  assert.equal(undated, 'No worries at all, that’s noted. We’ll get those dates paused 🙂');

  assert.equal(
    buildIncomingReplyTemplate({ category: 'summer_break', senderName: 'Mina', studentName: 'Alex' }),
    'No worries at all, that’s noted. We’ll get those dates paused 🙂',
  );
});

test('reviewed planning replies preserve an admin edit and reject empty or oversized text', () => {
  assert.equal(
    resolveReviewedIncomingReply(null, '  Deterministic fallback  '),
    'Deterministic fallback',
  );
  assert.equal(
    resolveReviewedIncomingReply('  My edited reply  ', 'Fallback'),
    'My edited reply',
  );
  assert.throws(() => resolveReviewedIncomingReply('', 'Fallback'), /required/u);
  assert.throws(() => resolveReviewedIncomingReply('x'.repeat(1_201), 'Fallback'), /1200/u);
});

test('buildWhatsappShareUrl safely prefills the reviewed reply without choosing a recipient', () => {
  assert.equal(
    buildWhatsappShareUrl('Hi Jo!\nAll sorted & noted 🙂'),
    'https://wa.me/?text=Hi%20Jo!%0AAll%20sorted%20%26%20noted%20%F0%9F%99%82',
  );
  assert.equal(buildWhatsappShareUrl(''), 'https://wa.me/');
});

test('reviewed plan dates replace parser guesses and are labelled as human-confirmed', () => {
  const record = {
    suspectedCategory: 'extended_absence',
    matchedMmsId: 'sdt_alex',
    matchedStudentName: 'Alex Chang',
    senderName: 'Mina Chang',
    messageText: 'We are away from the 24th of June till the 21st of July',
    messageAt: '2026-06-19T10:00:00.000Z',
  };
  const extraction = applyIncomingPlanningDateOverrides(extractIncomingMessageDates(record), {
    startDate: '2026-06-25',
    returnDate: '2026-07-22',
  });
  const draft = buildIncomingPlanningDraft({ record, extraction, now: new Date('2026-06-20T10:00:00.000Z') });

  assert.equal(extraction.reviewedOverride, true);
  assert.deepEqual(extraction.dates, ['2026-06-25', '2026-07-22']);
  assert.match(draft.notes, /Dates confirmed in the inbox plan preview: 2026-06-25, 2026-07-22\./u);
  assert.doesNotMatch(draft.notes, /check them against the parent's wording/u);

  const { windows } = parsePauseWindowsFromPlanning([{
    ...draft,
    planningId: 'planning_override',
    linkedStudentId: draft.linkedStudentIds.join(','),
  }]);
  assert.equal(windows[0].start.toISOString().slice(0, 10), '2026-06-25');
  assert.equal(windows[0].end.toISOString().slice(0, 10), '2026-07-22');
});

test('reviewed plan dates can clear a false parser guess and reject invalid API dates', () => {
  const extraction = applyIncomingPlanningDateOverrides({
    startDate: '2026-08-12',
    returnDate: '2026-08-19',
    dates: ['2026-08-12', '2026-08-19'],
  }, {
    startDate: '',
    returnDate: '',
  });
  assert.deepEqual(extraction.dates, []);
  assert.equal(extraction.startDate, '');
  assert.equal(extraction.returnDate, '');
  assert.throws(
    () => applyIncomingPlanningDateOverrides({}, { startDate: '2026-02-30' }),
    /not a valid date/u,
  );
});

test('extractIncomingMessageDates resolves relative dates against the message time', () => {
  const result = extractIncomingMessageDates({
    messageText: 'Sam is off sick today',
    messageAt: '2026-07-01T08:00:00.000Z',
    capturedAt: '2026-07-06T16:00:00.000Z',
  });
  assert.equal(result.startDate, '2026-07-01');
});

test('detectInstrumentInName spots FC instruments by whole token, not substring', () => {
  assert.equal(detectInstrumentInName('Alex Chang Guitar Mondays'), 'guitar');
  assert.equal(detectInstrumentInName('Sam Reid — Piano'), 'piano');
  assert.equal(detectInstrumentInName('Ukulele Orchestra 2026', ['Ukulele Orchestra']), 'ukulele');
  // No instrument token → not a First Chord group.
  assert.equal(detectInstrumentInName('Family holiday plans'), '');
  // "bass" as a token matches, but not inside another word like "embassy".
  assert.equal(detectInstrumentInName('British Embassy chat'), '');
});

test('matchGroupToStudent prefers a participant phone match over the title name', () => {
  const byPhone = matchGroupToStudent(
    { chatName: 'Guitar group', participantPhones: ['+44 7788 626616', '+44 7000 000000'] },
    students,
  );
  assert.equal(byPhone.matchedMmsId, 'sdt_alex');
  assert.equal(byPhone.matchConfidence, 'high');
  assert.match(byPhone.matchReasons, /number matches/u);

  const byName = matchGroupToStudent({ chatName: 'Sam Reid Piano', participantPhones: [] }, students);
  assert.equal(byName.matchedMmsId, 'sdt_sam');
});

test('matchGroupToStudent handles the real "{First} {Instrument} Lessons {emoji}" title', () => {
  // First name only + the student's instrument, no phone — the common case.
  const match = matchGroupToStudent({ chatName: 'Alex Guitar Lessons 🎸', participantPhones: [] }, students);
  assert.equal(match.matchedMmsId, 'sdt_alex');
  assert.equal(match.matchConfidence, 'high');
  assert.match(match.matchReasons, /first name and instrument/u);
});

test('buildGroupSyncPlan keeps active FC groups, drops non-FC and stale ones', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const plan = buildGroupSyncPlan({
    now,
    students,
    groups: [
      { chatId: '111@g.us', chatName: 'Alex Chang Guitar', participantPhones: ['+447788626616'], lastActiveAt: '2026-06-20T00:00:00Z' },
      { chatId: '222@g.us', chatName: 'Family chat', participantPhones: [], lastActiveAt: '2026-06-20T00:00:00Z' },
      { chatId: '333@g.us', chatName: 'Old Piano group', participantPhones: [], lastActiveAt: '2025-01-01T00:00:00Z' },
      { chatId: '444@g.us', chatName: 'Sam Reid Piano', participantPhones: [], lastActiveAt: '' },
      { chatId: '19980372422675@lid', chatName: 'Guitar not-a-group', participantPhones: [], lastActiveAt: '' },
    ],
  });

  assert.equal(plan.summary.kept, 2);
  assert.equal(plan.summary.skippedNoInstrument, 1);
  assert.equal(plan.summary.skippedInactive, 1);
  assert.equal(plan.summary.skippedNotGroup, 1);
  assert.deepEqual(plan.records.map((row) => row.chatId).sort(), ['111@g.us', '444@g.us']);

  const alex = plan.records.find((row) => row.chatId === '111@g.us');
  assert.equal(alex.matchedMmsId, 'sdt_alex');
  assert.equal(alex.instrument, 'guitar');
});

test('decideSyncedGroupStatus buckets matched vs unmatched without downgrading decisions', () => {
  assert.equal(decideSyncedGroupStatus('', true), 'review');
  assert.equal(decideSyncedGroupStatus('', false), 'unmatched');
  assert.equal(decideSyncedGroupStatus('unmatched', true), 'review'); // upgrade once matched
  assert.equal(decideSyncedGroupStatus('review', false), 'unmatched'); // re-bucket auto-review when no longer matched
  assert.equal(decideSyncedGroupStatus('confirmed', false), 'confirmed'); // keep human decision
  assert.equal(decideSyncedGroupStatus('ignored', true), 'ignored'); // keep human decision
});

test('shared sibling group matches by name in the message, flags ambiguous otherwise', () => {
  const groupMapRows = [{
    chatId: '120363400087109552@g.us',
    matchedMmsId: 'sdt_alex',
    matchedStudentName: 'Alex Chang',
    additionalMmsIds: 'sdt_sam',
    status: 'confirmed',
  }];

  const named = matchIncomingMessageToStudent(
    { chatId: '120363400087109552@g.us', messageText: 'Sam is off on Friday' },
    students,
    { groupMapRows },
  );
  assert.equal(named.matchedMmsId, 'sdt_sam');
  assert.equal(named.matchConfidence, 'high');

  const ambiguous = matchIncomingMessageToStudent(
    { chatId: '120363400087109552@g.us', messageText: 'We are away next week' },
    students,
    { groupMapRows },
  );
  assert.equal(ambiguous.matchedMmsId, '');
  assert.equal(ambiguous.matchConfidence, 'none');
  assert.match(ambiguous.matchReasons, /needs manual review/u);
});

test('buildWhatsappGroupMapRecord carries additional_mms_ids for sibling groups', () => {
  const record = buildWhatsappGroupMapRecord({
    chatId: '120363400087109552@g.us',
    additionalMmsIds: 'sdt_sam',
    groupMapStatus: 'confirmed',
  }, { chatId: '120363400087109552@g.us', matchedMmsId: 'sdt_alex', status: 'confirmed' });
  assert.equal(record.additionalMmsIds, 'sdt_sam');
  assert.equal(record.matchedMmsId, 'sdt_alex');
});

test('buildIncomingMessageId is stable across star replays when an external id exists', () => {
  const base = { source: 'whatsapp_starred', externalMessageId: '3A5D3041', chatId: '111@g.us' };
  const placeholderCapture = buildIncomingMessageId({
    ...base,
    messageText: '[Message content unavailable - star update arrived before cache]',
    messageAt: '2026-07-06T15:29:00.000Z',
  });
  const healedCapture = buildIncomingMessageId({
    ...base,
    messageText: 'Alex is away next Friday',
    messageAt: '2026-07-01T09:00:00.000Z',
  });
  assert.equal(placeholderCapture, healedCapture);

  // Same message id in a different chat is a different row.
  assert.notEqual(placeholderCapture, buildIncomingMessageId({ ...base, chatId: '222@g.us' }));

  // Manual pastes have no external id — text still distinguishes them.
  const pasteA = buildIncomingMessageId({ source: 'manual_paste', messageText: 'Alex is away' });
  const pasteB = buildIncomingMessageId({ source: 'manual_paste', messageText: 'Sam is away' });
  assert.notEqual(pasteA, pasteB);
});

test('isIncomingPlaceholderText spots bridge placeholder bodies only', () => {
  assert.equal(isIncomingPlaceholderText('[Message content unavailable - star update arrived before cache]'), true);
  assert.equal(isIncomingPlaceholderText('[Media or unsupported message]'), true);
  assert.equal(isIncomingPlaceholderText('Alex is away next Friday'), false);
  assert.equal(isIncomingPlaceholderText(''), false);
});

test('placeholder captures land as needs_review with a paste hint', () => {
  const record = buildIncomingMessageRecord({
    source: 'whatsapp_starred',
    external_message_id: '3A5D3041',
    chat_id: '111@g.us',
    message_text: '[Message content unavailable - star update arrived before cache]',
  }, { students });

  assert.equal(record.status, 'needs_review');
  assert.equal(record.suspectedCategory, 'general');
  assert.match(record.matchReasons, /paste the original message/iu);
});

test('mergeIncomingCapture skips replays and heals placeholders without losing review state', () => {
  const fresh = buildIncomingMessageRecord({
    source: 'whatsapp_starred',
    external_message_id: '3A5D3041',
    chat_id: '111@g.us',
    message_text: 'Alex Chang is on holiday for two weeks',
  }, { students });

  // New capture inserts.
  assert.equal(mergeIncomingCapture(null, fresh).action, 'insert');

  // Replay over a row that already has text is a no-op.
  const stored = { ...fresh, status: 'converted', reviewNote: 'handled' };
  const replay = mergeIncomingCapture(stored, fresh);
  assert.equal(replay.action, 'skip');
  assert.equal(replay.record, stored);

  // Replay with recovered text heals a placeholder but keeps human decisions.
  const placeholderRow = {
    ...fresh,
    messageText: '[Message content unavailable - star update arrived before cache]',
    suspectedCategory: 'general',
    status: 'converted',
    reviewNote: 'chased on WhatsApp',
    createdPlanningId: 'planning_incoming_1',
    capturedAt: '2026-07-06T15:29:00.000Z',
  };
  const healed = mergeIncomingCapture(placeholderRow, fresh);
  assert.equal(healed.action, 'heal');
  assert.equal(healed.record.messageText, 'Alex Chang is on holiday for two weeks');
  assert.equal(healed.record.suspectedCategory, 'extended_absence');
  assert.equal(healed.record.status, 'converted');
  assert.equal(healed.record.reviewNote, 'chased on WhatsApp');
  assert.equal(healed.record.createdPlanningId, 'planning_incoming_1');
  assert.equal(healed.record.capturedAt, '2026-07-06T15:29:00.000Z');
  assert.match(healed.record.matchReasons, /healed an earlier placeholder/u);

  // A second placeholder replay never overwrites the placeholder row.
  const placeholderReplay = mergeIncomingCapture(placeholderRow, { ...placeholderRow });
  assert.equal(placeholderReplay.action, 'skip');
});

test('applyIncomingMessageTextUpdate re-classifies pasted text and reopens the row', () => {
  const row = {
    incomingId: 'incoming_1',
    chatId: '111@g.us',
    messageText: '[Message content unavailable - star update arrived before cache]',
    suspectedCategory: 'general',
    status: 'needs_review',
  };

  const next = applyIncomingMessageTextUpdate(row, {
    messageText: 'Alex Chang is on holiday for two weeks',
    students,
    actorEmail: 'finn@example.com',
    now: new Date('2026-07-06T17:00:00Z'),
  });

  assert.equal(next.messageText, 'Alex Chang is on holiday for two weeks');
  assert.equal(next.suspectedCategory, 'extended_absence');
  assert.equal(next.matchedMmsId, 'sdt_alex');
  assert.equal(next.status, 'inbox');
  assert.equal(next.reviewedBy, 'finn@example.com');
  assert.match(next.matchReasons, /reviewer supplied the message text/u);

  // Archived rows keep their archive decision.
  assert.equal(applyIncomingMessageTextUpdate({ ...row, status: 'ignored' }, {
    messageText: 'noise',
    students,
  }).status, 'ignored');

  assert.throws(() => applyIncomingMessageTextUpdate(row, { messageText: '   ', students }), /required/u);
});

test('isSchoolStaffMessage spots our own account and staff personal numbers', () => {
  // Bridge marks our own account's messages.
  assert.equal(isSchoolStaffMessage({ from_me: true }), true);
  assert.equal(isSchoolStaffMessage({ fromMe: 'true' }), true);

  // Tom messages from his own number — matched against INCOMING_STAFF_PHONES
  // in any UK format.
  const staff = '+44 7900 111222, 07811 333444';
  assert.equal(isSchoolStaffMessage({ sender_phone: '+447900111222' }, staff), true);
  assert.equal(isSchoolStaffMessage({ senderPhone: '07900 111222' }, staff), true);
  assert.equal(isSchoolStaffMessage({ senderPhone: '07811333444' }, staff), true);

  // Parents are not staff.
  assert.equal(isSchoolStaffMessage({ senderPhone: '07788 626616' }, staff), false);
  assert.equal(isSchoolStaffMessage({ senderPhone: '07788 626616' }, ''), false);
  assert.equal(isSchoolStaffMessage({}, staff), false);
});

test('matchTutorPhone recognises a tutor by their number so their reply is not a new parent row', () => {
  // Tolerant read of the human-maintained Tutor_Phones sheet: name + phone
  // columns, blanks ignored, UK format differences normalised.
  const lookup = buildTutorPhoneLookup([
    { tutorName: 'Kenny', phone: '+44 7900 555111' },
    { tutorName: 'Calum', phone: '07900555222' },
    { tutorName: '', phone: '07900555333' }, // no name — ignored
    { tutorName: 'Blank', phone: '' }, // no phone — ignored
  ]);

  // Any UK format of a known tutor number resolves to the tutor's name.
  assert.equal(matchTutorPhone({ senderPhone: '07900 555111' }, lookup), 'Kenny');
  assert.equal(matchTutorPhone({ sender_phone: '+447900555222' }, lookup), 'Calum');

  // A parent number (not a tutor) and a nameless/phoneless row do not match.
  assert.equal(matchTutorPhone({ senderPhone: '07788 626616' }, lookup), '');
  assert.equal(matchTutorPhone({ senderPhone: '07900555333' }, lookup), '');
  assert.equal(matchTutorPhone({}, lookup), '');
  assert.equal(matchTutorPhone({ senderPhone: '07900 555111' }, new Map()), '');
});

test('matchTutorSenderName recognises the group tutor by push name, never a bare first name', () => {
  // LID-addressed groups can hide the sender's number entirely — the push name
  // against this group's own tutor is the fallback (real 2026-07-08 case: Dean's
  // replies landing as parent inbox rows).
  assert.equal(matchTutorSenderName('Dean Louden', 'Dean Louden'), 'Dean Louden');
  assert.equal(matchTutorSenderName('dean louden', 'Dean Louden'), 'Dean Louden');
  assert.equal(matchTutorSenderName('Eléna Esposito', 'Elena Esposito'), 'Elena Esposito');
  // Prefix match: a longer push name still resolves to the group tutor.
  assert.equal(matchTutorSenderName('Dean Louden Music', 'Dean Louden'), 'Dean Louden');

  // Single-word names never match — a parent whose push name is just the
  // tutor's first name must land in the inbox, not be silently absorbed.
  assert.equal(matchTutorSenderName('Dean', 'Dean Louden'), '');
  assert.equal(matchTutorSenderName('Tom', 'Tom Walters'), '');

  // Different people, partial-word overlaps, and missing data do not match.
  assert.equal(matchTutorSenderName('Dean L', 'Dean Louden'), '');
  assert.equal(matchTutorSenderName('Rose Drew', 'Dean Louden'), '');
  assert.equal(matchTutorSenderName('', 'Dean Louden'), '');
  assert.equal(matchTutorSenderName('Dean Louden', ''), '');
});

test('reply evidence attaches only to the nearest preceding open message', () => {
  const target = selectReplyEvidenceTarget([
    { incomingId: 'old', chatId: 'group', status: 'inbox', messageAt: '2026-07-01T09:00:00Z' },
    { incomingId: 'latest', chatId: 'group', status: 'needs_review', messageAt: '2026-07-01T10:00:00Z' },
    { incomingId: 'future', chatId: 'group', status: 'inbox', messageAt: '2026-07-01T12:00:00Z' },
    { incomingId: 'other', chatId: 'other', status: 'inbox', messageAt: '2026-07-01T10:30:00Z' },
  ], { chatId: 'group', repliedAt: '2026-07-01T11:00:00Z' });

  assert.equal(target.incomingId, 'latest');
});

test('decideAutoCaptureStatus archives no-signal chatter and keeps work open', () => {
  assert.equal(decideAutoCaptureStatus({ suspectedCategory: 'general', messageText: 'Thanks! See you then' }), 'ignored');
  assert.equal(decideAutoCaptureStatus({ suspectedCategory: 'one_off_absence', messageText: 'Alex is off sick today' }), 'inbox');
  // General wording but a concrete date → keep it open for a human look.
  assert.equal(decideAutoCaptureStatus({
    suspectedCategory: 'general',
    messageText: 'Just to note the 24th of June',
    messageAt: '2026-06-19T10:00:00.000Z',
  }), 'inbox');
  assert.equal(decideAutoCaptureStatus({ classificationActionability: 'uncertain' }), 'needs_review');
  assert.equal(decideAutoCaptureStatus({ classificationActionability: 'reply_needed' }), 'inbox');
});

test('human classification review preserves the proposal and distinguishes acceptance from correction', () => {
  const proposed = {
    suspectedCategory: 'summer_break',
    proposedCategory: 'summer_break',
    proposedIntent: 'notification',
    proposedActionability: 'action_needed',
    classificationActionability: 'action_needed',
  };

  const accepted = applyIncomingClassificationReview(proposed, {});
  assert.equal(accepted.classificationDecision, 'accepted');

  const corrected = applyIncomingClassificationReview(proposed, {
    category: 'general',
    actionability: 'no_action',
  });
  assert.equal(corrected.proposedCategory, 'summer_break');
  assert.equal(corrected.proposedActionability, 'action_needed');
  assert.equal(corrected.suspectedCategory, 'general');
  assert.equal(corrected.classificationActionability, 'no_action');
  assert.equal(corrected.classificationDecision, 'corrected');
});

test('isAutoArchivedMessage separates rule-archived rows from human decisions', () => {
  const autoArchived = { source: 'whatsapp_group_auto', status: 'ignored', reviewedBy: '' };
  assert.equal(isAutoArchivedMessage(autoArchived), true);
  // A human ignore stamps reviewedBy — that's a decision, not the rule.
  assert.equal(isAutoArchivedMessage({ ...autoArchived, reviewedBy: 'finn@example.com' }), false);
  // Starred/manual rows are never rule-archived.
  assert.equal(isAutoArchivedMessage({ ...autoArchived, source: 'whatsapp_starred' }), false);
  assert.equal(isAutoArchivedMessage({ ...autoArchived, status: 'inbox' }), false);
});

test('assessBridgeHealth tells down, capturing-nothing, and quiet apart', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  const healthy = {
    lastHeartbeatAt: '2026-07-07T11:45:00Z',
    confirmedGroups: 170,
  };

  const ok = assessBridgeHealth(healthy, { now, lastAutoCaptureAt: '2026-07-07T09:00:00Z' });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.problems.length, 0);

  // Stale heartbeat → the bridge is down/unlinked.
  const down = assessBridgeHealth({ ...healthy, lastHeartbeatAt: '2026-07-07T02:00:00Z' }, { now });
  assert.equal(down.state, 'warn');
  assert.match(down.problems.join(' '), /No heartbeat for 10h/u);

  // Fresh heartbeat but empty group list — the 2026-07-06 rollout failure.
  const empty = assessBridgeHealth({ ...healthy, confirmedGroups: 0 }, { now });
  assert.equal(empty.state, 'warn');
  assert.match(empty.problems.join(' '), /empty confirmed-group list/u);

  // Healthy bridge, but no captured message for days.
  const quiet = assessBridgeHealth(healthy, { now, lastAutoCaptureAt: '2026-07-03T09:00:00Z' });
  assert.equal(quiet.state, 'warn');
  assert.match(quiet.problems.join(' '), /No group message captured for 4 days/u);

  // No heartbeat row yet (pre-heartbeat bridge): quiet unless captures are stale.
  assert.equal(assessBridgeHealth(null, { now }).state, 'none');
  assert.equal(assessBridgeHealth(null, { now, lastAutoCaptureAt: '2026-07-01T09:00:00Z' }).state, 'warn');
});

test('one-tap convert needs a high-confidence match and a specific category', () => {
  const eligible = {
    matchedMmsId: 'sdt_alex',
    matchConfidence: 'high',
    suspectedCategory: 'extended_absence',
    classificationActionability: 'action_needed',
    classificationConfidence: 'high',
    messageText: 'Alex is away for two weeks',
    status: 'inbox',
  };
  assert.equal(isOneTapConvertEligible(eligible), true);
  assert.equal(isOneTapConvertEligible({ ...eligible, status: 'needs_review' }), true);

  // Weak signals keep the full review panel as the only path.
  assert.equal(isOneTapConvertEligible({ ...eligible, matchConfidence: 'medium' }), false);
  assert.equal(isOneTapConvertEligible({ ...eligible, matchedMmsId: '' }), false);
  assert.equal(isOneTapConvertEligible({ ...eligible, suspectedCategory: 'general' }), false);
  assert.equal(isOneTapConvertEligible({ ...eligible, suspectedCategory: 'absence_pause' }), false);
  assert.equal(isOneTapConvertEligible({
    ...eligible,
    messageText: '[Message content unavailable - star update arrived before cache]',
  }), false);
  assert.equal(isOneTapConvertEligible({ ...eligible, status: 'converted' }), false);
});

test('planning remains visible when a message needs review before conversion', () => {
  const eligible = {
    matchedMmsId: 'sdt_alex',
    matchConfidence: 'high',
    suspectedCategory: 'extended_absence',
    classificationActionability: 'action_needed',
    classificationConfidence: 'high',
    messageText: 'Alex is away for two weeks',
    status: 'inbox',
  };

  assert.equal(resolveIncomingPlanningAction(eligible), 'convert');
  assert.equal(resolveIncomingPlanningAction({ ...eligible, classificationConfidence: 'low' }), 'review');
  assert.equal(resolveIncomingPlanningAction({ ...eligible, classificationActionability: 'uncertain' }), 'review');
  assert.equal(resolveIncomingPlanningAction({ ...eligible, matchedMmsId: '' }), 'review');
  assert.equal(resolveIncomingPlanningAction({ ...eligible, createdPlanningId: 'planning_123', status: 'converted' }), 'open_plan');
  assert.equal(resolveIncomingPlanningAction({ ...eligible, status: 'ignored' }), 'none');
  assert.equal(resolveIncomingPlanningAction({
    ...eligible,
    messageText: '[Message content unavailable - star update arrived before cache]',
  }), 'none');
});

test('groupIncomingMessages sorts newest first and normalises status/category', () => {
  const grouped = groupIncomingMessages([
    { incomingId: 'old', capturedAt: '2026-06-01T10:00:00Z', status: 'weird', suspectedCategory: 'wat' },
    { incomingId: 'new', capturedAt: '2026-06-30T10:00:00Z', status: 'converted', suspectedCategory: 'payment' },
  ]);

  assert.deepEqual(grouped.map((row) => row.incomingId), ['new', 'old']);
  assert.equal(grouped[1].status, 'inbox');
  assert.equal(grouped[1].suspectedCategory, 'general');
});

function burstRow(overrides = {}) {
  return {
    incomingId: 'incoming_x',
    chatId: '44700111@g.us',
    senderPhone: '07700900111',
    senderName: 'Jo Smith',
    matchedMmsId: 'mms_1',
    messageText: 'Hello there',
    classificationActionability: 'reply_needed',
    ...overrides,
  };
}

test('clusterIncomingMessages stacks one sender rapid-fire run into a single card', () => {
  // The view hands the helper a newest-first list.
  const clusters = clusterIncomingMessages([
    burstRow({ incomingId: 'c', messageText: 'Thanks!', messageAt: '2026-08-20T09:04:00Z', classificationActionability: 'no_action' }),
    burstRow({ incomingId: 'b', messageText: 'Amy cannot make Thursday sorry', messageAt: '2026-08-20T09:02:00Z', classificationActionability: 'action_needed' }),
    burstRow({ incomingId: 'a', messageText: 'Hi Finn', messageAt: '2026-08-20T09:01:00Z', classificationActionability: 'no_action' }),
  ]);

  assert.equal(clusters.length, 1);
  // Oldest first inside the stack: the order they were written in.
  assert.deepEqual(clusters[0].entries.map((row) => row.incomingId), ['a', 'b', 'c']);
  // The lead is the message carrying the signal, not the first or the last.
  assert.equal(clusters[0].lead.incomingId, 'b');
});

test('clusterIncomingMessages keeps separate sends, senders, and students apart', () => {
  const clusters = clusterIncomingMessages([
    burstRow({ incomingId: 'later_same_day', messageAt: '2026-08-20T15:00:00Z' }),
    burstRow({ incomingId: 'other_sender', senderPhone: '07700900222', senderName: 'Sam Ray', messageAt: '2026-08-20T09:03:00Z' }),
    burstRow({ incomingId: 'sibling_student', matchedMmsId: 'mms_2', messageAt: '2026-08-20T09:02:00Z' }),
    burstRow({ incomingId: 'first', messageAt: '2026-08-20T09:01:00Z' }),
  ]);

  assert.deepEqual(
    clusters.map((cluster) => cluster.entries.map((row) => row.incomingId)),
    [['later_same_day'], ['other_sender'], ['sibling_student'], ['first']],
  );
});

test('clusterIncomingMessages only merges adjacent messages and never a placeholder lead', () => {
  const clusters = clusterIncomingMessages([
    burstRow({ incomingId: 'b', messageText: '[Message content unavailable - star update arrived before cache]', messageAt: '2026-08-20T09:02:00Z', classificationActionability: 'action_needed' }),
    burstRow({ incomingId: 'a', messageText: 'Can we move Amy to 5pm?', messageAt: '2026-08-20T09:01:00Z', classificationActionability: 'reply_needed' }),
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].lead.incomingId, 'a');
});

test('clusterIncomingMessages leaves a message with no chat or sender identity on its own', () => {
  const clusters = clusterIncomingMessages([
    burstRow({ incomingId: 'anon_b', chatId: '', chatName: '', senderPhone: '', senderName: '', messageAt: '2026-08-20T09:02:00Z' }),
    burstRow({ incomingId: 'anon_a', chatId: '', chatName: '', senderPhone: '', senderName: '', messageAt: '2026-08-20T09:01:00Z' }),
  ]);

  assert.equal(clusters.length, 2);
});
