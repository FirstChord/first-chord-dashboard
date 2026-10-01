import test from 'node:test';
import assert from 'node:assert/strict';
import { projectResolutionContext, resolutionDecision, currentResolutionSuggestion } from '../../lib/admin/incoming-resolution-helpers.mjs';
import { createIncomingResolutionService, isIncomingResolutionConfigured } from '../../lib/admin/incoming-resolution-service.mjs';
import { fixtureNow, resolutionFixture, resolutionCases } from '../fixtures/incoming-resolution-cases.mjs';
const env = { TYPESAFE_API_KEY: 'synthetic-key', ADMIN_AI_INBOX_RESOLUTION_ENABLED: 'true' };
function harness({ rows = [resolutionFixture()], evaluate } = {}) {
  const data = { rows: structuredClone(rows), proposals: [], calls: 0, saves: 0, reads: [] };
  const service = createIncomingResolutionService({ env, now: () => fixtureNow, uuid: () => `fixture-${data.saves}`,
    readInbox: async options => { data.reads.push(options); return structuredClone(data.rows); },
    readProposals: async () => structuredClone(data.proposals), readStudents: async () => [],
    saveProposal: async row => { data.saves++; data.proposals = [...data.proposals.filter(p => p.proposalId !== row.proposalId), row]; },
    evaluate: async input => {
      data.calls++;
      if (evaluate) return evaluate(input, data);
      return { model: 'jev-1.13.0', answers: { resolution: { choice: 'looks_answered', confidence: 0.95,
        probabilities: { looks_answered: 0.95, school_action_remaining: 0.02, waiting_for_parent: 0.02, unclear: 0.01 } } }, usage: { inputTokens: 10, outputTokens: 2 } };
    },
  });
  return { service, data };
}
test('pilot requires flag and key together', () => {
  assert.equal(isIncomingResolutionConfigured(env), true);
  assert.equal(isIncomingResolutionConfigured({ TYPESAFE_API_KEY: 'key' }), false);
  assert.equal(isIncomingResolutionConfigured({ ADMIN_AI_INBOX_RESOLUTION_ENABLED: 'true' }), false);
});
test('projection redacts known names, contacts, URLs and identifiers; sends only bounded chronological text', () => {
  const row = resolutionFixture();
  row.messageText = 'Sample Student and Sample Parent contact x@example.com +44 7700 900123 https://example.com tch_synthetic fml_synthetic';
  const context = projectResolutionContext([row], row.incomingId, { now: fixtureNow });
  assert.equal(context.guard, '');
  const wire = JSON.stringify(context.state);
  for (const secret of ['Sample', '@', '7700', 'http', 'tch_', 'fml_', 'synthetic_chat', 'incoming_synthetic', 'Tom']) assert.equal(wire.includes(secret), false, secret);
  assert.equal(context.state.schoolReplies[0].association, 'quoted');
});
test('incomplete, stale, overlong and Planning-linked evidence abstains without provider calls', async () => {
  const variants = [
    row => { row.createdPlanningId = 'plan_synthetic'; },
    row => { row.schoolReplyEvidence = []; },
    row => { row.schoolReplyEvidence[0].truncated = true; },
    row => { row.messageText = 'x'.repeat(601); },
    row => { row.messageAt = '2026-10-01T11:00:00Z'; },
    row => { row.chatId = ''; },
  ];
  for (const change of variants) {
    const row = resolutionFixture(); change(row);
    const { service, data } = harness({ rows: [row] });
    const result = await service.assess({ incomingId: row.incomingId });
    assert.equal(result.proposal.label, 'unclear');
    assert.equal(data.calls, 0);
    assert.ok(result.proposal.guard);
  }
});
test('even archived newer chat messages block a looks-answered judgment', async () => {
  const row = resolutionFixture();
  const newer = { ...row, incomingId: 'newer', messageAt: '2026-10-01T11:00:00Z', capturedAt: '2026-10-01T11:00:00Z', status: 'ignored', messageText: 'Actually another question', schoolReplyEvidence: [] };
  const { service, data } = harness({ rows: [row, newer] });
  assert.equal((await service.assess({ incomingId: row.incomingId })).proposal.guard, 'newer_message');
  assert.equal(data.calls, 0);
});
test('assessment persists metadata only, reads fresh twice, never changes original rows; GET makes no calls or saves', async () => {
  const { service, data } = harness();
  const original = structuredClone(data.rows);
  const result = await service.assess({ incomingId: original[0].incomingId, actorEmail: 'synthetic-admin@example.test' });
  assert.equal(result.proposal.label, 'looks_answered');
  assert.equal(data.calls, 1);
  assert.deepEqual(data.rows, original);
  assert.deepEqual(data.reads, [{ force: true }, { force: true }]);
  assert.equal(data.proposals[0].evidenceJson.includes(original[0].messageText), false);
  assert.equal(data.proposals[0].evidenceJson.includes(original[0].schoolReplyEvidence[0].text), false);
  assert.ok((await service.list()).byIncomingId[original[0].incomingId]);
  assert.equal(data.calls, 1); assert.equal(data.saves, 1);
});
test('mid-call reply change rejects result without storing it', async () => {
  const { service, data } = harness({ evaluate: async (input, data) => {
    data.rows[0].schoolReplyEvidence[0].text = 'Actually I will check tomorrow';
    return { model: 'jev-1.13.0', answers: { resolution: { choice: 'looks_answered', confidence: 0.99, probabilities: { looks_answered: 0.99 } } } };
  } });
  await assert.rejects(service.assess({ incomingId: 'incoming_synthetic' }), /conversation changed/);
  assert.equal(data.saves, 0);
});
test('source changes, expiry and status changes invalidate suggestions and feedback', async () => {
  for (const mutate of [
    row => { row.messageText += ' and another thing'; }, row => { row.createdPlanningId = 'plan_x'; },
    row => { row.reviewedAt = '2026-10-01T12:01:00Z'; }, row => { row.status = 'ignored'; },
    row => { row.schoolReplyEvidence[0].text = 'changed reply'; },
  ]) {
    const { service, data } = harness();
    const result = await service.assess({ incomingId: 'incoming_synthetic' });
    mutate(data.rows[0]);
    assert.deepEqual((await service.list()).byIncomingId, {});
    await assert.rejects(service.feedback({ proposalId: result.proposal.proposalId, label: 'looks_answered' }));
    assert.equal(data.saves, 1);
  }
  const { service, data } = harness();
  await service.assess({ incomingId: 'incoming_synthetic' });
  data.proposals[0].createdAt = '2026-09-29T10:00:00Z';
  assert.deepEqual((await service.list()).byIncomingId, {});
});
test('human corrections are distinct from inbox review and cannot cross lanes', async () => {
  const { service, data } = harness();
  const result = await service.assess({ incomingId: 'incoming_synthetic' });
  const corrected = await service.feedback({ proposalId: result.proposal.proposalId, label: 'school_action_remaining' });
  assert.equal(corrected.proposal.feedback, 'school_action_remaining');
  assert.equal(corrected.proposal.decided, true);
  assert.equal(data.rows[0].status, 'inbox');
  assert.equal(data.proposals[0].status, 'rejected');
  await assert.rejects(service.feedback({ proposalId: result.proposal.proposalId, label: 'looks_answered' }));
  data.proposals.push({ ...data.proposals[0], proposalId: 'reply', lane: 'incoming_reply', status: 'proposed' });
  await assert.rejects(service.feedback({ proposalId: 'reply', label: 'looks_answered' }));
});
test('low probability or confidence yields unclear rather than false certainty', () => {
  assert.equal(resolutionDecision({ choice: 'looks_answered', confidence: 0.99, probabilities: { looks_answered: 0.6 } }), 'unclear');
  assert.equal(resolutionDecision({ choice: 'looks_answered', confidence: 0.7, probabilities: { looks_answered: 0.99 } }), 'unclear');
});
test('client discards an old cue for changed bursts and a new separate inbound message', async () => {
  const { service, data } = harness();
  const result = await service.assess({ incomingId: 'incoming_synthetic' });
  const context = projectResolutionContext(data.rows, 'incoming_synthetic', { now: fixtureNow });
  assert.ok(currentResolutionSuggestion(result.proposal, context.cluster.entries, fixtureNow));
  assert.equal(currentResolutionSuggestion(result.proposal, [{ ...context.cluster.entries[0], messageText: 'changed' }], fixtureNow), null);
  const newer = { ...data.rows[0], incomingId: 'newer', messageAt: '2026-10-01T11:00:00Z' };
  assert.equal(currentResolutionSuggestion(result.proposal, context.cluster.entries, fixtureNow, [...data.rows, newer]), null);
});
test('all synthetic evaluation fixtures fit the bounded projection; this does not measure model accuracy', () => {
  for (const item of resolutionCases) {
    const row = resolutionFixture(item);
    const context = projectResolutionContext([row], row.incomingId, { now: fixtureNow });
    assert.equal(context.guard, '', item.name);
    assert.ok(JSON.stringify(context.state).length < 8000);
  }
});

test('assessment covers a whole burst when the reply is on a non-lead child', async () => {
  const lead = resolutionFixture();
  lead.messageText = 'Could you confirm what time the weekly piano lesson starts?';
  lead.schoolReplyEvidence = []; lead.schoolRepliedAt = ''; lead.schoolRepliedBy = '';
  const child = { ...resolutionFixture(), incomingId: 'incoming_child', messageText: 'On Thursday please',
    capturedAt: '2026-10-01T10:01:00Z', messageAt: '2026-10-01T10:01:00Z' };
  const { service } = harness({ rows: [child, lead], evaluate: async input => {
    assert.deepEqual(input.state.originalRequest.map(row => row.text), [lead.messageText, child.messageText]);
    assert.equal(input.state.schoolReplies.length, 1);
    return { model: 'jev-1.13.0', answers: { resolution: { choice: 'looks_answered', confidence: 0.95,
      probabilities: { looks_answered: 0.95, school_action_remaining: 0.02, waiting_for_parent: 0.02, unclear: 0.01 } } } };
  } });
  const result = await service.assess({ incomingId: lead.incomingId });
  assert.equal(result.proposal.label, 'looks_answered');
  assert.ok((await service.list()).byIncomingId[result.incomingId]);
});

test('redaction expansion cannot silently truncate the evidence used for classification', () => {
  const row = resolutionFixture();
  row.matchedStudentName = 'Amy';
  row.messageText = 'Amy '.repeat(100).trim();
  assert.ok(row.messageText.length < 600);
  const context = projectResolutionContext([row], row.incomingId, { now: fixtureNow });
  assert.equal(context.guard, 'long_text');
  assert.equal(context.state, null);
});
