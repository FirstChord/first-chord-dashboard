import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmIncomingPauseAcknowledgement, validateIncomingPauseAcknowledgement,
  incomingPauseDraftKey, buildIncomingPauseBrowserDraft, restoreIncomingPauseBrowserDraft } from '../../lib/admin/incoming-pause-sequence-helpers.mjs';

const now = new Date('2026-10-06T10:00:00Z');
const reply = 'No worries at all, thanks for letting us know.';
const openedAt = '2026-10-06T09:59:00.000Z';
const context = { source: {incomingId: 'synthetic-a', chatId: 'synthetic-chat'},
  snapshots: [{incomingId: 'synthetic-a', status: 'inbox', messageText: 'Alex is away.', matchedMmsId: 'student-a'}] };
const options = {linkedStudentIds: ['student-a'], studentSelectionSource: 'manual', pauseType: 'single', pauseLessonDate: '2026-10-15'};

test('copying alone never satisfies the human acknowledgement gate', () => {
  for (const confirmation of [null, true, {}, {mode: 'copied', openedAt}, {mode: 'sent', reply, confirmedAt: now.toISOString()}]) {
    assert.throws(() => validateIncomingPauseAcknowledgement(confirmation, {now}));
  }
  assert.throws(() => confirmIncomingPauseAcknowledgement({mode: 'sent', reply: '', openedAt, now}));
  assert.throws(() => confirmIncomingPauseAcknowledgement({mode: 'sent', reply: 'x'.repeat(1201), openedAt, now}));
  assert.throws(() => confirmIncomingPauseAcknowledgement({mode: 'sent', reply, openedAt: '2026-10-07T10:00:00Z', now}));
  assert.throws(() => validateIncomingPauseAcknowledgement({mode: 'already_acknowledged', confirmedAt: 'bad'}, {now}));
});

test('sent and already acknowledged are distinct explicit decisions, never provider proof', () => {
  const sent = confirmIncomingPauseAcknowledgement({mode: 'sent', reply, openedAt, now});
  assert.deepEqual(sent, {mode: 'sent', reply, openedAt, confirmedAt: now.toISOString()});
  const already = confirmIncomingPauseAcknowledgement({mode: 'already_acknowledged', reply, now});
  assert.deepEqual(already, {mode: 'already_acknowledged', reply: '', openedAt: '', confirmedAt: now.toISOString()});
  assert.equal(already.delivered, undefined);
  assert.equal(already.planningId, undefined);
});

test('the same tab can restore acknowledgement and dates without repeating a send or saving a plan', () => {
  const confirmation = confirmIncomingPauseAcknowledgement({mode: 'sent', reply, openedAt, now});
  const stored = buildIncomingPauseBrowserDraft(context, {acknowledgement: reply, confirmation, openedAt, options}, now);
  const restored = restoreIncomingPauseBrowserDraft(context, JSON.parse(JSON.stringify(stored)), now);
  assert.deepEqual(restored, {acknowledgement: reply, confirmation, openedAt, options});
  assert.doesNotMatch(JSON.stringify(stored), /Alex is away/u);
  assert.notEqual(incomingPauseDraftKey(context), incomingPauseDraftKey({source: {incomingId: 'synthetic-b'}}));
  const copied = buildIncomingPauseBrowserDraft(context, {acknowledgement: reply, openedAt, options}, now);
  assert.equal(restoreIncomingPauseBrowserDraft(context, copied, now).confirmation, null);
  assert.equal(restoreIncomingPauseBrowserDraft(context, copied, now).openedAt, openedAt);
});

test('changed source, mismatched reply, corrupt or expired drafts cannot unlock planning', () => {
  const confirmation = confirmIncomingPauseAcknowledgement({mode: 'sent', reply, openedAt, now});
  const stored = buildIncomingPauseBrowserDraft(context, {acknowledgement: reply, confirmation, options}, now);
  for (const field of ['messageText', 'status', 'matchedMmsId', 'reviewedAt', 'createdPlanningId']) {
    const changed = {...context, snapshots: [{...context.snapshots[0], [field]: 'changed'}]};
    assert.equal(restoreIncomingPauseBrowserDraft(changed, stored, now), null);
  }
  for (const malformed of [null, {}, {...stored, version: 2}, {...stored, options: []}, {...stored, acknowledgement: 'edited'},
    {...stored, updatedAt: 'bad'}, {...stored, confirmation: {mode: 'copied'}}, {...stored, updatedAt: '2026-09-01T10:00:00Z'}]) {
    assert.equal(restoreIncomingPauseBrowserDraft(context, malformed, now), null);
  }
  const future = {...stored, updatedAt: '2026-10-07T10:00:00Z'};
  assert.equal(restoreIncomingPauseBrowserDraft(context, future, now), null);
});
