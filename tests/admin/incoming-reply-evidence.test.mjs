import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectSchoolReplyTarget, appendSchoolReply, normaliseSchoolReplies,
  serialiseSchoolReplies, getClusterReplyReceipt, collectSchoolReplies,
} from '../../lib/admin/incoming-reply-evidence-helpers.mjs';
import { buildIncomingMessageSheetRow, buildIncomingReplySheetUpdates } from '../../lib/admin/sheets/incoming-messages.mjs';
import { INCOMING_MESSAGE_INBOX_HEADERS } from '../../lib/admin/sheets/core.mjs';

const row = { incomingId: 'request', externalMessageId: 'parent-1', chatId: 'lesson', status: 'inbox', messageAt: '2026-10-01T09:00:00Z' };
const reply = { externalMessageId: 'reply-1', repliedAt: '2026-10-01T09:01:00Z', repliedBy: 'Tom', role: 'admin', association: 'nearest', text: 'I will check and get back to you.' };
const options = { chatId: 'lesson', repliedAt: reply.repliedAt };

test('quotes target a specific request rather than the latest request, including reply threads', () => {
  const older = { ...row, incomingId: 'older', externalMessageId: 'parent-0', messageAt: '2026-10-01T08:00:00Z' };
  assert.equal(selectSchoolReplyTarget([older, row], { ...options, repliedToExternalMessageId: 'parent-0' }), older);
  const threaded = appendSchoolReply(older, reply);
  assert.equal(selectSchoolReplyTarget([threaded, row], { ...options, repliedToExternalMessageId: reply.externalMessageId }), threaded);
  for (const quoted of ['unknown', 'another-chat']) {
    assert.equal(selectSchoolReplyTarget([row, { ...older, chatId: 'other', externalMessageId: 'another-chat' }], { ...options, repliedToExternalMessageId: quoted }), null);
  }
});

test('unquoted replies stop at closed chatter and never walk backward through stamped requests', () => {
  const replied = appendSchoolReply(row, reply);
  assert.equal(selectSchoolReplyTarget([replied], options), replied);
  const acknowledgement = { ...row, incomingId: 'thanks', status: 'ignored', messageAt: '2026-10-01T09:00:30Z' };
  assert.equal(selectSchoolReplyTarget([row, acknowledgement], options), null);
  assert.equal(selectSchoolReplyTarget([{ ...row, status: 'converted' }], { ...options, repliedToExternalMessageId: row.externalMessageId }), null);
});

test('unknown times, future inbound rows and week-old unquoted context cannot acquire a receipt', () => {
  assert.equal(selectSchoolReplyTarget([{ ...row, messageAt: 'bad' }], options), null);
  assert.equal(selectSchoolReplyTarget([row], { ...options, repliedAt: 'bad' }), null);
  assert.equal(selectSchoolReplyTarget([row], { ...options, repliedAt: '2026-10-01T08:00:00Z' }), null);
  const later = { ...options, repliedAt: '2026-10-09T09:00:00Z' };
  assert.equal(selectSchoolReplyTarget([row], later), null);
  assert.equal(selectSchoolReplyTarget([row], { ...later, repliedToExternalMessageId: row.externalMessageId }), row);
});

test('reply storage is bounded, contains no extra transcript or phone fields, and tolerates missing legacy columns', () => {
  const value = Array.from({ length: 10 }, (_, index) => ({ ...reply,
    externalMessageId: `reply-${index}`, repliedAt: `2026-10-01T09:${String(index).padStart(2, '0')}:00Z`,
    text: 'x'.repeat(2000), senderPhone: 'private', quotedMessage: { text: 'private quoted transcript' },
  }));
  const stored = buildIncomingMessageSheetRow({ ...row, schoolReplyEvidence: value });
  const restored = normaliseSchoolReplies(stored.school_reply_evidence_json);
  assert.equal(restored.length, 4);
  assert.equal(restored[0].externalMessageId, 'reply-6');
  assert.equal(restored[0].text.length, 1200);
  assert.equal(restored[0].truncated, true);
  assert.doesNotMatch(stored.school_reply_evidence_json, /private|senderPhone|quotedMessage/);
  for (const missing of [undefined, '', '{invalid', '{}']) assert.deepEqual(normaliseSchoolReplies(missing), []);
  assert.equal(serialiseSchoolReplies(undefined), '');
});

test('out-of-order replies preserve newest receipts and never alter reviewed work', () => {
  const original = { ...row, status: 'needs_review', snoozedUntil: '2026-10-03', reviewNote: 'Keep this visible', createdPlanningId: 'plan-1' };
  const newer = { ...reply, externalMessageId: 'newer', repliedAt: '2026-10-01T09:05:00Z', repliedBy: 'Finn' };
  const updated = appendSchoolReply(appendSchoolReply(original, newer), reply);
  assert.equal(updated.schoolRepliedBy, 'Finn');
  assert.equal(updated.schoolRepliedAt, '2026-10-01T09:05:00.000Z');
  for (const field of ['status', 'snoozedUntil', 'reviewNote', 'createdPlanningId']) assert.equal(updated[field], original[field]);
  assert.equal(appendSchoolReply({ ...updated, schoolRepliedAt: '2026-10-01T09:10:00Z', schoolRepliedBy: 'Tutor' }, reply).schoolRepliedBy, 'Tutor');
});

test('burst cues include receipts on a non-lead child but exclude replies before newer arrivals', () => {
  const stamped = appendSchoolReply(row, reply);
  const child = { ...row, incomingId: 'child', messageAt: '2026-10-01T09:00:30Z' };
  assert.equal(getClusterReplyReceipt([child, stamped]).repliedBy, 'Tom');
  assert.deepEqual(collectSchoolReplies([stamped, stamped]), normaliseSchoolReplies([reply]));
  assert.equal(getClusterReplyReceipt([stamped, { ...child, messageAt: '2026-10-01T09:02:00Z' }]), null);
  assert.equal(getClusterReplyReceipt([{ ...row, schoolRepliedAt: reply.repliedAt, schoolRepliedBy: 'Finn' }]).repliedBy, 'Finn');
});

test('school capture patches only reply cells and cannot reopen concurrent human reviews', () => {
  const headers = INCOMING_MESSAGE_INBOX_HEADERS;
  const stamped = appendSchoolReply(row, reply);
  const valuesFor = (record) => headers.map(header => buildIncomingMessageSheetRow(record)[header] || '');
  const updates = buildIncomingReplySheetUpdates({ headers, values: [headers, valuesFor(row)], row: stamped });
  assert.equal(updates.length, 3);
  assert.deepEqual(updates.map(update => update.values[0][0]), [stamped.schoolRepliedAt, stamped.schoolRepliedBy, serialiseSchoolReplies(stamped.schoolReplyEvidence)]);
  assert.ok(updates.every(update => !update.range.includes(':')));
  for (const record of [{ ...row, status: 'converted' }, { ...row, chatId: 'other' }, { ...row, incomingId: 'other' }]) {
    assert.deepEqual(buildIncomingReplySheetUpdates({ headers, values: [headers, valuesFor(record)], row: stamped }), []);
  }
});
