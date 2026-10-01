import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the actual route body with injected auth/data/provider seams; no Next
// server, credentials, Sheets writes or network requests are available here.
const routeSource = (await readFile(new URL('../../app/api/admin/incoming-messages/resolution-proposals/route.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gmu, '').replace(/export async function /gu, 'async function ');
function harness({ session = { user: { isAdmin: true, email: 'synthetic-admin@example.test' } }, enabled = true, failure = false } = {}) {
  const calls = []; const logs = [];
  const factory = new Function('getServerSession', 'authOptions', 'isIncomingResolutionConfigured', 'getIncomingResolutionProposals', 'assessIncomingResolution', 'reviewIncomingResolution', 'Response', 'console', `${routeSource}\nreturn { GET, POST };`);
  const route = factory(async () => session, {}, () => enabled,
    async () => { calls.push('list'); return { byIncomingId: {} }; },
    async input => { calls.push(input); if (failure) throw new Error('private parent text synthetic-key'); return { incomingId: input.incomingId, proposal: { label: 'looks_answered', guard: '' } }; },
    async input => { calls.push(input); return { proposal: { label: input.label } }; }, Response,
    { info: value => logs.push(value), warn: value => logs.push(value) });
  const post = body => route.POST(new Request('http://localhost/api/admin/incoming-messages/resolution-proposals', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-firstchord-incoming-secret': 'irrelevant' }, body: JSON.stringify(body) }));
  return { route, post, calls, logs };
}
test('actual resolution route rejects non-admin sessions before data reads or assessments, including bridge secret headers', async () => {
  for (const session of [null, { user: {} }, { user: { isAdmin: false } }]) {
    const h = harness({ session });
    assert.equal((await h.route.GET()).status, 401);
    assert.equal((await h.post({ mode: 'assess', incomingId: 'fixture' })).status, 401);
    assert.deepEqual(h.calls, []);
  }
});
test('actual resolution route accepts IDs only, refuses browser prompts/context and applies no-store', async () => {
  const h = harness();
  for (const body of [null, [], { mode: 'assess', incomingId: 'fixture', state: 'private' }, { mode: 'assess', incomingId: 'fixture', prompt: 'do this' }, { mode: 'assess', incomingId: 'x'.repeat(201) }, { mode: 'feedback', proposalId: 'p', label: 'unclear', messageText: 'private' }]) {
    assert.equal((await h.post(body)).status, 400);
  }
  assert.deepEqual(h.calls, []);
  const response = await h.post({ mode: 'assess', incomingId: 'fixture' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(h.calls, [{ incomingId: 'fixture', actorEmail: 'synthetic-admin@example.test' }]);
});
test('actual route disables new calls with flag off but preserves read and feedback access', async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.post({ mode: 'assess', incomingId: 'fixture' })).status, 503);
  assert.deepEqual(h.calls, []);
  assert.equal((await h.route.GET()).status, 200);
  assert.equal((await h.post({ mode: 'feedback', proposalId: 'p', label: 'unclear' })).status, 200);
});
test('actual route enforces its per-admin pilot rate limit', async () => {
  const h = harness();
  for (let index = 0; index < 10; index++) assert.equal((await h.post({ mode: 'assess', incomingId: 'fixture' })).status, 200);
  assert.equal((await h.post({ mode: 'assess', incomingId: 'fixture' })).status, 429);
  assert.equal(h.calls.length, 10);
});
test('actual route never exposes private provider/internal error messages or bodies', async () => {
  const h = harness({ failure: true });
  const response = await h.post({ mode: 'assess', incomingId: 'fixture' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()) + h.logs.join(''), /private parent|synthetic-key/u);
});
test('reply decision rejects a resolution proposal before workflow/communication writes', async () => {
  const source = await readFile(new URL('../../lib/admin/incoming-reply-proposals.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function decideIncomingReplyProposal'))
    .replace('export async function ', 'async function ');
  const writes = [];
  const decide = new Function('getProposalRows', 'getIncomingMessageInboxRows', 'REPLY_LANE', 'deriveEffectiveProposalStatus', 'upsertProposalRow', 'applyProposalDecision', 'logCommunication', `${body}\nreturn decideIncomingReplyProposal;`)(
    async () => [{ proposalId: 'p', lane: 'incoming_resolution' }], async () => [], 'incoming_reply',
    () => { throw Error('must not reach status'); }, row => writes.push(row),
    () => { throw Error('must not decide'); }, row => writes.push(row));
  await assert.rejects(decide({ proposalId: 'p', decision: 'use' }), /not a reply suggestion/u);
  assert.deepEqual(writes, []);
});
