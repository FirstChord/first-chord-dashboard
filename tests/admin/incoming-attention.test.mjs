import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncomingClassificationService, isIncomingAutoCheckConfigured } from '../../lib/admin/incoming-classification-service.mjs';
import { createIncomingClassificationHandlers } from '../../lib/admin/incoming-classification-route.mjs';
import { createIncomingAutoCheckPostHandler } from '../../lib/admin/incoming-auto-check-route.mjs';
import { isProbablyNothing, automaticCheckTargets } from '../../lib/admin/incoming-attention-helpers.mjs';
import { CLASSIFICATION_QUESTIONS, projectClassificationContext, applyReviewedClassification } from '../../lib/admin/incoming-classification-helpers.mjs';
import { resolutionQueueHash } from '../../lib/admin/incoming-resolution-helpers.mjs';
import { classificationFixture, classificationCases } from '../fixtures/incoming-classification-cases.mjs';
import { fixtureNow } from '../fixtures/incoming-resolution-cases.mjs';
import { validateJevRequest } from '../../lib/admin/jev-provider.mjs';

const env = { TYPESAFE_API_KEY: 'synthetic', ADMIN_AI_INBOX_CLASSIFICATION_ENABLED: 'true',
  ADMIN_AI_INBOX_AUTO_CHECK_ENABLED: 'true', ADMIN_AI_INBOX_RESOLUTION_ENABLED: 'true' };
const quiet = { category: 'general', intent: 'acknowledgement', actionability: 'no_action' };
function makeRows(count = 1) {
  return Array.from({ length: count }, (_, i) => ({ ...classificationFixture(classificationCases[10])[0],
    incomingId: `synthetic_${i}`, chatId: `synthetic_chat_${i}` }));
}
function answers(details = quiet) {
  return Object.fromEntries(Object.entries(CLASSIFICATION_QUESTIONS).map(([key, question]) => [key, {
    type: 'choice', choice: details[key], confidence: 0.99,
    probabilities: Object.fromEntries(Object.keys(question.criteria).map(choice => [choice, choice === details[key] ? 1 : 0])),
  }]));
}
function harness({ rows = makeRows(), evaluate, proposals = [], flags = { ...env } } = {}) {
  const data = { rows: structuredClone(rows), proposals: structuredClone(proposals), calls: [], saves: 0, patches: 0, now: fixtureNow };
  const service = createIncomingClassificationService({ env: flags, now: () => data.now, uuid: () => `synthetic_${data.saves}`,
    readInbox: async () => structuredClone(data.rows), readProposals: async () => structuredClone(data.proposals),
    readStudents: async () => [], saveProposal: async row => { data.saves++;
      data.proposals = [...data.proposals.filter(p => p.proposalId !== row.proposalId), structuredClone(row)]; },
    patchClassification: async options => { data.patches++;
      const context = projectClassificationContext(data.rows, options.incomingId, { now: data.now });
      const updated = applyReviewedClassification(context.cluster.entries, options.classification, options);
      data.rows = data.rows.map(row => updated.find(item => item.incomingId === row.incomingId) || row); return updated; },
    evaluate: async input => { data.calls.push(input); validateJevRequest(input);
      return evaluate ? evaluate(input, data) : { model: 'jev-1.13.0', answers: answers() }; },
  });
  return { service, data, flags };
}
const visible = (row, changes = {}) => ({ queueHash: resolutionQueueHash([row]), createdAt: fixtureNow.toISOString(),
  status: 'proposed', guard: '', classification: quiet, ...changes });

test('only a fresh, complete no-action burst moves to Probably nothing; every uncertainty stays in attention', () => {
  const row = makeRows()[0];
  assert.equal(isProbablyNothing(visible(row), [row], { now: fixtureNow }), true);
  for (const changes of [{ guard: 'low_confidence' }, { guard: 'automatic_pending' }, { guard: 'automatic_failed' },
    { status: 'rejected' }, { queueHash: 'old' }, { createdAt: '2026-09-29T12:00:00Z' },
    { classification: { ...quiet, actionability: 'reply_needed' } }, { classification: { ...quiet, intent: 'unclear' } },
    { applied: { ...quiet, actionability: 'action_needed' } }]) {
    assert.equal(isProbablyNothing(visible(row, changes), [row], { now: fixtureNow }), false, JSON.stringify(changes));
  }
  for (const changes of [{ createdPlanningId: 'plan' }, { classificationDecision: 'corrected', classificationActionability: 'action_needed' },
    { snoozedUntil: '2026-10-02T12:00:00Z' }, { status: 'converted' }]) {
    const changed = { ...row, ...changes };
    assert.equal(isProbablyNothing(visible(changed), [changed], { now: fixtureNow }), false);
  }
  const child = { ...row, incomingId: 'new', messageAt: '2026-10-01T10:01:00Z', messageText: 'Please refund the duplicate charge.' };
  assert.equal(isProbablyNothing(visible(row), [row, child], { now: fixtureNow }), false);
  // Newer inbound boundaries count even when somebody has since cleared them.
  assert.equal(isProbablyNothing(visible(row), [row], { now: fixtureNow,
    rows: [row, { ...child, status: 'ignored', messageAt: '2026-10-01T11:00:00Z' }] }), false);
});

test('automatic checking requires its separate opt-in and never processes filtered, Later or linked rows', async () => {
  const rows = [{ ...makeRows()[0], status: 'ignored' }, { ...makeRows(2)[1], snoozedUntil: '2026-10-02T12:00:00Z' },
    { ...makeRows(3)[2], createdPlanningId: 'plan' }];
  const h = harness({ rows });
  assert.equal((await h.service.autoCheck()).processed, 0); assert.equal(h.data.calls.length, 0); assert.equal(h.data.saves, 0);
  h.flags.ADMIN_AI_INBOX_AUTO_CHECK_ENABLED = 'false';
  assert.equal(isIncomingAutoCheckConfigured(h.flags), false);
  assert.equal((await h.service.autoCheck()).disabled, true);
  assert.equal((await h.service.list()).available, true);
});

test('oversized and incomplete open text gets guarded uncertainty without a provider call', async () => {
  for (const text of ['x'.repeat(600), '[Media or unsupported message]']) {
    const rows = [{ ...makeRows()[0], messageText: text }];
    const h = harness({ rows });
    assert.equal((await h.service.autoCheck()).processed, 1);
    assert.equal(h.data.calls.length, 0);
    const proposal = (await h.service.list()).byIncomingId[rows[0].incomingId];
    assert.ok(proposal.guard);
    assert.equal(isProbablyNothing(proposal, rows, { now: fixtureNow }), false);
  }
});

test('backfill runs in batches of three, reuses fresh suggestions, makes no resolution call and leaves all rows unchanged', async () => {
  const { service, data } = harness({ rows: makeRows(4) });
  const original = structuredClone(data.rows);
  assert.deepEqual(await service.autoCheck(), { processed: 3, failed: 0, remaining: 1, limited: false });
  assert.equal((await service.autoCheck()).processed, 1);
  assert.equal((await service.autoCheck()).processed, 0);
  assert.equal(data.calls.length, 4); assert.equal(data.patches, 0); assert.deepEqual(data.rows, original);
  assert.equal(data.proposals.length, 4);
  for (const input of data.calls) assert.deepEqual(Object.keys(input.questions), ['category', 'intent', 'actionability']);
  for (const proposal of data.proposals) {
    assert.equal(proposal.lane, 'incoming_classification'); assert.equal(proposal.createdBy, 'automatic_inbox_check');
    assert.equal(JSON.stringify(proposal).includes(original[0].messageText), false);
  }
});

test('quiet window uses capture time, protects incoming bursts and revisits changed evidence', async () => {
  const { service, data } = harness();
  data.rows[0].capturedAt = '2026-10-01T11:59:00Z';
  assert.equal((await service.autoCheck()).processed, 0); assert.equal(data.calls.length, 0);
  data.now = new Date('2026-10-01T12:05:00Z');
  assert.equal((await service.autoCheck()).processed, 1);
  data.rows[0].messageText += ' Please change our lesson time.';
  assert.equal((await service.autoCheck()).processed, 1);
});

test('a durable pending marker blocks another process and a local lock blocks overlapping runs', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const h = harness({ evaluate: async () => { await wait; return { model: 'jev-1.13.0', answers: answers() }; } });
  const running = h.service.autoCheck();
  while (!h.data.calls.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.service.autoCheck()).busy, true);
  const other = harness({ proposals: h.data.proposals });
  assert.equal((await other.service.autoCheck()).processed, 0);
  release(); await running;
  assert.equal(h.data.calls.length, 1);
});

test('provider failure keeps attention, records bounded cooldown, retries after an hour without retry storms', async () => {
  const h = harness({ evaluate: async () => { throw new Error('private response'); } });
  assert.equal((await h.service.autoCheck()).failed, 1);
  const proposal = (await h.service.list()).byIncomingId[h.data.rows[0].incomingId];
  assert.equal(proposal.guard, 'automatic_failed');
  assert.equal(isProbablyNothing(proposal, h.data.rows, { now: fixtureNow }), false);
  assert.equal((await h.service.autoCheck()).processed, 0); assert.equal(h.data.calls.length, 1);
  h.data.now = new Date('2026-10-01T13:01:00Z');
  assert.equal((await h.service.autoCheck()).failed, 1); assert.equal(h.data.calls.length, 2);
  assert.equal(JSON.stringify(h.data.proposals).includes('private response'), false);
});

test('per-minute and persisted daily bounds limit automatic attempts', async () => {
  const h = harness({ rows: makeRows(12) });
  for (let i = 0; i < 5; i++) await h.service.autoCheck();
  assert.equal(h.data.calls.length, 10);
  h.data.now = new Date('2026-10-01T12:02:00Z');
  assert.equal((await h.service.autoCheck()).processed, 2);
  const proposals = Array.from({ length: 100 }, (_, i) => ({ proposalId: `synthetic_budget_${i}`, lane: 'incoming_classification',
    createdAt: fixtureNow.toISOString(), evidenceJson: JSON.stringify({ automatic: true, sourceHash: 'unrelated' }) }));
  const capped = harness({ proposals });
  assert.equal((await capped.service.autoCheck()).limited, true); assert.equal(capped.data.calls.length, 0);
});

test('human rejection remains in attention and is not overwritten by automatic daily rechecks', async () => {
  const h = harness(); await h.service.autoCheck();
  const proposal = h.data.proposals[0];
  await h.service.review({ proposalId: proposal.proposalId, mode: 'discard' });
  h.data.now = new Date('2026-10-03T12:00:00Z');
  assert.equal((await h.service.autoCheck()).processed, 0); assert.equal(h.data.calls.length, 1);
  h.data.rows[0].messageText = 'A different new message';
  assert.equal(automaticCheckTargets({ ...h.data, now: h.data.now }).targets.length, 1);
});

test('changes and human rejection during an automatic call cannot install a no-action cue', async () => {
  for (const change of [data => { data.rows[0].messageText += ' Please cancel the lesson.'; },
    data => { data.proposals[0].status = 'rejected'; }]) {
    const h = harness({ evaluate: async (_input, data) => { change(data); return { model: 'jev-1.13.0', answers: answers() }; } });
    assert.equal((await h.service.autoCheck()).failed, 1);
    assert.notEqual(h.data.proposals[0].proposalBody, JSON.stringify(quiet));
    assert.equal(h.data.patches, 0);
  }
});

test('admin automatic POST rejects non-admins and extra input authority, GET never triggers checks', async () => {
  let admin = false, calls = 0, reads = 0;
  const handlers = createIncomingClassificationHandlers({ session: async () => ({ user: { isAdmin: admin } }),
    configured: () => true, list: async () => ({ byIncomingId: {} }),
    readActiveInbox: async () => { reads++; return { inbox: makeRows(), lastAutoCaptureAt: 'synthetic-time' }; },
    autoCheck: async () => { calls++; return { processed: 1 }; } });
  const request = body => new Request('https://synthetic.test', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await handlers.POST(request({ mode: 'auto' }))).status, 401); assert.equal(calls, 0); assert.equal(reads, 0);
  admin = true; await handlers.GET(); assert.equal(calls, 0);
  assert.equal((await handlers.POST(request({ mode: 'auto', incomingIds: ['secret'], classification: quiet }))).status, 400);
  const response = await handlers.POST(request({ mode: 'auto' }));
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(reads, 1);
  const body = await response.json(); assert.equal(body.inbox.length, 1); assert.equal(body.lastAutoCaptureAt, 'synthetic-time');
});

test('background cron fails closed before reads and returns only safe counts', async () => {
  let key = '', calls = 0;
  const post = createIncomingAutoCheckPostHandler({ secret: () => key, autoCheck: async () => { calls++; return { processed: 3, failed: 0 }; } });
  const request = supplied => new Request('https://synthetic.test', { method: 'POST', headers: { 'x-firstchord-schedule-secret': supplied } });
  assert.equal((await post(request('wrong'))).status, 503); key = 'synthetic-private-key';
  assert.equal((await post(request('wrong'))).status, 401); assert.equal(calls, 0);
  const response = await post(request(key)); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, processed: 3, failed: 0 }); assert.equal(calls, 1);
});
