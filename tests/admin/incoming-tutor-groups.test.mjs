import test from 'node:test';
import { createRequire } from 'node:module';
const { titleLooksLikeFcGroup, confirmedGroupsRefreshMs } = createRequire(import.meta.url)('../../tools/whatsapp-incoming-bridge/group-discovery.js');
import assert from 'node:assert/strict';
import { matchWhatsappTutorGroup, isConfirmedCaptureGroup } from '../../lib/admin/incoming-tutor-group-helpers.mjs';
import {
  buildGroupSyncPlan, buildIncomingMessageRecord, buildWhatsappGroupMapRecord,
  buildIncomingReplyTemplate, buildIncomingPlanningDraft, applyIncomingMessageTextUpdate, clusterIncomingMessages,
} from '../../lib/admin/incoming-message-helpers.mjs';
import { createIncomingMessageCapturer } from '../../lib/admin/incoming-capture.mjs';
import { createWhatsappGroupReviewer } from '../../lib/admin/incoming-group-review.mjs';
import { buildReplyPolicyContext } from '../../lib/admin/incoming-reply-policy.mjs';
import { buildIncomingMessageSheetRow, buildWhatsappGroupMapSheetRow } from '../../lib/admin/sheets/incoming-messages.mjs';

const tutors = [{ shortName: 'Taylor', fullName: 'Taylor Example', instruments: ['piano'] }];
const students = [{ mmsId: 'student_1', fullName: 'Taylor Student', firstName: 'Taylor', contactNumber: '07700900111', instrument: 'piano' }];
const group = { chatId: '123@g.us', chatName: 'Taylor First Chord 🎹', groupType: 'tutor', matchedTutorId: 'Taylor', tutorName: 'Taylor Example', status: 'confirmed' };
const payload = { source: 'whatsapp_group_auto', chat_id: group.chatId, chat_name: group.chatName,
  external_message_id: 'message_1', sender_name: 'Taylor Example', sender_phone: '07700900111',
  message_at: '2026-09-10T12:00:00Z', message_text: 'I cannot teach on 2026-09-17, can we arrange cover?' };

function harness(groups = [group]) {
  const state = { groups: structuredClone(groups), inbox: [], writes: 0, groupWrites: 0 };
  const deps = {
    getOperationalAdminStudents: async () => students,
    getActiveTutorOptions: async () => tutors,
    getWhatsappGroupMapRows: async () => structuredClone(state.groups),
    getIncomingMessageInboxRows: async () => structuredClone(state.inbox),
    getTutorPhoneRows: async () => [{ tutorName: 'Taylor Example', phone: '07700900111' }],
    getStaffPhones: () => '07700900222',
    upsertIncomingMessageInboxRow: async row => {
      if (state.failWrite) throw new Error('Sheets unavailable');
      state.writes++;
      state.inbox = state.inbox.filter(r => r.incomingId !== row.incomingId).concat(row);
    },
    upsertWhatsappGroupMapRow: async row => {
      state.groupWrites++;
      state.groups = state.groups.filter(r => r.chatId !== row.chatId).concat(row);
    },
  };
  return { state, capture: createIncomingMessageCapturer(deps), review: createWhatsappGroupReviewer(deps) };
}

test('tutor title matching accepts case and instrument emojis with or without a surname', () => {
  for (const name of ['Taylor First Chord', 'taylor FIRST CHORD 🎹 🎶', 'Taylor Example First Chord 🎸']) {
    assert.equal(matchWhatsappTutorGroup(name, tutors)?.matchedTutorId, 'Taylor');
  }
  for (const name of ['First Chord brain 🧠', 'First Chord Tutors', 'Taylor Piano Lessons', 'Unknown First Chord']) {
    assert.equal(matchWhatsappTutorGroup(name, tutors), null);
  }
});

test('shared first names stay ambiguous and never choose the first roster entry', () => {
  const result = matchWhatsappTutorGroup('Taylor First Chord', [...tutors, { shortName: 'TaylorB', fullName: 'Taylor Other' }]);
  assert.equal(result.groupType, 'tutor');
  assert.equal(result.matchedTutorId, '');
  assert.equal(result.matchConfidence, 'none');
});

test('group discovery retains tutor groups without an instrument word and never matches them to a student', () => {
  const { records, summary } = buildGroupSyncPlan({
    groups: [
      { chatId: group.chatId, chatName: group.chatName, participantPhones: ['07700900111'] },
      { chatId: '456@g.us', chatName: 'Taylor Piano Lessons', lastActiveAt: '2026-09-01' },
      { chatId: '789@g.us', chatName: 'First Chord brain 🧠' },
      { chatId: 'old@g.us', chatName: group.chatName, lastActiveAt: '2020-01-01' },
      { chatId: 'direct@s.whatsapp.net', chatName: group.chatName },
    ], students, tutors, now: new Date('2026-09-10'),
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].matchedTutorId, 'Taylor');
  assert.equal(records[0].matchedMmsId, '');
  assert.equal(records[1].groupType, 'student');
  assert.equal(records[1].matchedMmsId, 'student_1');
  assert.equal(summary.skippedInactive, 1);
  assert.equal(summary.skippedNotGroup, 1);
});

test('admin tutor confirmation stores roster identity, audit and clears incompatible family links', async () => {
  const { review, state } = harness([{ ...group, status: 'review', matchedMmsId: 'student_1', additionalMmsIds: 'student_2', parentPhone: '07700900333' }]);
  const result = await review({ chatId: group.chatId, groupType: 'tutor', matchedTutorId: 'Taylor', actorEmail: 'admin@example.test' });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.confirmedBy, 'admin@example.test');
  assert.ok(result.confirmedAt);
  for (const field of ['matchedMmsId','matchedFcId','matchedStudentName','additionalMmsIds','parentName','parentPhone']) assert.equal(result[field], '');
  assert.equal(result.tutorName, 'Taylor Example');
  assert.equal(state.groupWrites, 1);
});

test('invalid tutor, unknown group and non-group confirmation fail before writes', async () => {
  const { review, state } = harness();
  for (const args of [
    { chatId: group.chatId, groupType: 'tutor', matchedTutorId: 'Unknown' },
    { chatId: 'missing@g.us', groupType: 'tutor', matchedTutorId: 'Taylor' },
    { chatId: 'direct@s.whatsapp.net', groupType: 'tutor', matchedTutorId: 'Taylor' },
  ]) await assert.rejects(review(args));
  assert.equal(state.groupWrites, 0);
});

test('re-review stops capture and student confirmation intentionally replaces a tutor link', async () => {
  const { review } = harness();
  const pending = await review({ chatId: group.chatId, status: 'review' });
  assert.equal(pending.groupType, 'tutor');
  assert.equal(isConfirmedCaptureGroup(pending), false);
  const studentGroup = await review({ chatId: group.chatId, groupType: 'student', matchedMmsId: 'student_1' });
  assert.equal(studentGroup.groupType, 'student');
  assert.equal(studentGroup.matchedTutorId, '');
  assert.equal(studentGroup.matchedMmsId, 'student_1');
  assert.equal(studentGroup.tutorName, '');
});

test('metadata refresh retains confirmed tutor type, tutor identity and human decision', () => {
  const refreshed = buildWhatsappGroupMapRecord({ chatId: group.chatId, chatName: 'Renamed group' }, group);
  assert.equal(refreshed.groupType, 'tutor');
  assert.equal(refreshed.matchedTutorId, 'Taylor');
  assert.equal(refreshed.status, 'confirmed');
  assert.equal(buildWhatsappGroupMapRecord({ chatId: 'legacy@g.us' }).groupType, 'student');
});

test('tutor messages are captured once, retain tutor context, and cannot acquire an incidental student match', async () => {
  const { capture, state } = harness();
  const result = await capture(payload);
  assert.equal(result.groupType, 'tutor');
  assert.equal(result.matchedTutorId, 'Taylor');
  assert.equal(result.matchedTutorName, 'Taylor Example');
  assert.equal(result.matchedMmsId, '');
  assert.ok(['inbox', 'needs_review'].includes(result.status));
  await capture(payload);
  assert.equal(state.writes, 1);
  assert.equal(state.groups[0].groupType, 'tutor');
  assert.equal(state.groups[0].matchedTutorId, 'Taylor');
});

test('LID-addressed tutor messages still arrive when no phone number is available', async () => {
  const { capture } = harness();
  const result = await capture({ ...payload, sender_phone: '', sender_name: 'Taylor' });
  assert.equal(result.groupType, 'tutor');
  assert.equal(result.matchedTutorName, 'Taylor Example');
});

test('own-account and configured admin replies are evidence, never duplicate inbound tutor cards', async () => {
  const { capture, state } = harness();
  await capture(payload);
  const own = await capture({ ...payload, external_message_id: 'own_reply', from_me: true, sender_name: 'Admin', sender_phone: '', message_at: '2026-09-10T12:01:00Z' });
  assert.equal(own.replyEvidence, true);
  assert.equal(state.inbox.length, 1);
  assert.equal(state.inbox[0].schoolRepliedBy, 'Admin');
  const staff = await capture({ ...payload, external_message_id: 'staff_reply', sender_name: 'Other Admin', sender_phone: '07700900222' });
  assert.equal(staff.replyEvidence, true);
  assert.equal(state.inbox.length, 1);
});

test('a tutor reply in a legacy student group keeps its existing school-side behaviour', async () => {
  const { capture, state } = harness([{ ...group, groupType: undefined, matchedMmsId: 'student_1', matchedTutorId: '' }]);
  const result = await capture(payload);
  assert.equal(result.replyEvidence, true);
  assert.equal(state.inbox.length, 0);
});

for (const status of ['review', 'ignored', 'unmatched']) {
  test(status + ' tutor groups are not captured', async () => {
    const { capture, state } = harness([{ ...group, status }]);
    assert.equal((await capture(payload)).skipped, 'not_confirmed_group');
    assert.equal(state.writes, 0);
  });
}

test('missing tutor identity and unknown group types cannot enter the capture allow-list', async () => {
  for (const row of [{ ...group, matchedTutorId: '' }, { ...group, groupType: 'unknown' }]) {
    assert.equal(isConfirmedCaptureGroup(row), false);
    assert.equal((await harness([row]).capture(payload)).skipped, 'not_confirmed_group');
  }
});

test('capture does not claim success or update group metadata on a failed inbox write', async () => {
  const { capture, state } = harness();
  state.failWrite = true;
  await assert.rejects(capture(payload), /Sheets unavailable/);
  assert.equal(state.groupWrites, 0);
});

test('message editing preserves tutor context without auto-matching a student', () => {
  const row = buildIncomingMessageRecord(payload, { students, groupMapRows: [group] });
  const edited = applyIncomingMessageTextUpdate(row, { messageText: 'Taylor Student needs to discuss next week', students, groupMapRows: [group] });
  assert.equal(edited.groupType, 'tutor');
  assert.equal(edited.matchedTutorId, 'Taylor');
  assert.equal(edited.matchedMmsId, '');
});

test('tutor replies and Planning remain general reviewed work, never a parent payment promise or structured pause', () => {
  const row = { ...buildIncomingMessageRecord(payload, { students, groupMapRows: [group] }),
    suspectedCategory: 'one_off_absence', matchedMmsId: 'student_1', matchedStudentName: 'Taylor Student' };
  const reply = buildIncomingReplyTemplate({ groupType: 'tutor', category: row.suspectedCategory });
  assert.doesNotMatch(reply, /paus|payment|child/iu);
  const draft = buildIncomingPlanningDraft({ record: row, replyTemplate: reply });
  assert.equal(draft.isPause, false);
  assert.equal(draft.linkedTutorId, 'Taylor');
  assert.equal(draft.area, 'tutor');
  const policy = buildReplyPolicyContext({ record: row });
  assert.equal(policy.neutralFallback, true);
  assert.deepEqual(policy.allowedFacts, []);
});

test('tutor identity is stored in both Sheets lanes and retained on ordinary updates', () => {
  const row = buildIncomingMessageRecord(payload, { students, groupMapRows: [group] });
  const stored = buildIncomingMessageSheetRow({ ...row, status: 'converted' });
  assert.equal(stored.group_type, 'tutor');
  assert.equal(stored.matched_tutor_id, 'Taylor');
  assert.equal(stored.matched_tutor_name, 'Taylor Example');
  const mapped = buildWhatsappGroupMapSheetRow(group);
  assert.equal(mapped.group_type, 'tutor');
  assert.equal(mapped.matched_tutor_id, 'Taylor');
});

test('bursts do not merge across different captured tutor identities', () => {
  const row = buildIncomingMessageRecord(payload, { students, groupMapRows: [group] });
  const clusters = clusterIncomingMessages([row, { ...row, incomingId: 'different', matchedTutorId: 'Other' }]);
  assert.equal(clusters.length, 2);
});

test('a new ambiguous tutor proposal clears an older automatic tutor guess', () => {
  const row = buildWhatsappGroupMapRecord({
    chatId: group.chatId, groupType: 'tutor', matchedTutorId: '', tutorName: '',
  }, { ...group, status: 'review' });
  assert.equal(row.matchedTutorId, '');
  assert.equal(row.tutorName, '');
});

test('roster failure blocks tutor confirmation but still allows disabling capture', async () => {
  let writes = 0;
  const review = createWhatsappGroupReviewer({
    getOperationalAdminStudents: async () => students,
    getWhatsappGroupMapRows: async () => [group],
    getActiveTutorOptions: async () => { throw new Error('Roster unavailable'); },
    upsertWhatsappGroupMapRow: async () => { writes++; },
  });
  await assert.rejects(review({ chatId: group.chatId, groupType: 'tutor', matchedTutorId: 'Taylor' }), /Roster unavailable/);
  assert.equal(writes, 0);
  await review({ chatId: group.chatId, status: 'ignored' });
  assert.equal(writes, 1);
});

test('bridge pre-filter and dashboard discovery both admit tutor titles without an instrument word', () => {
  const groups = [
    {chatId: group.chatId, chatName: 'Taylor First Chord 🎹'},
    {chatId: 'another@g.us', chatName: 'Taylor Example First Chord'},
    {chatId: 'personal@g.us', chatName: 'Weekend friends'},
  ];
  const sent = groups.filter(g => titleLooksLikeFcGroup(g.chatName));
  assert.equal(sent.length, 2);
  assert.equal(buildGroupSyncPlan({groups: sent, students, tutors}).records.length, 2);
  assert.equal(titleLooksLikeFcGroup('Jamie Piano Lessons 🎹'), true);
  assert.equal(titleLooksLikeFcGroup('First Chord brain 🧠'), false);
});

test('confirmed-group refresh defaults to ten minutes and tolerates invalid configuration', () => {
  for (const value of [undefined, '', 'bad', 'Infinity', '-1', '100']) {
    assert.equal(confirmedGroupsRefreshMs(value), 600000);
  }
  assert.equal(confirmedGroupsRefreshMs('21600000'), 21600000);
});
