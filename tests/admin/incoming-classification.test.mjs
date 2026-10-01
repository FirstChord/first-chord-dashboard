import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncomingClassificationService, isIncomingClassificationConfigured } from '../../lib/admin/incoming-classification-service.mjs';
import { createIncomingClassificationHandlers } from '../../lib/admin/incoming-classification-route.mjs';
import { CLASSIFICATION_QUESTIONS, CLASSIFICATION_FALLBACK, projectClassificationContext, classificationDecision,
  applyReviewedClassification, currentClassificationSuggestion } from '../../lib/admin/incoming-classification-helpers.mjs';
import { resolutionQueueHash } from '../../lib/admin/incoming-resolution-helpers.mjs';
import { validateJevRequest } from '../../lib/admin/jev-provider.mjs';
import { buildIncomingClassificationSheetUpdates, buildIncomingMessageSheetRow, mapIncomingMessageInboxValues } from '../../lib/admin/sheets/incoming-messages.mjs';
import { INCOMING_MESSAGE_INBOX_HEADERS } from '../../lib/admin/sheets/core.mjs';
import { classificationCases, classificationFixture } from '../fixtures/incoming-classification-cases.mjs';
import { fixtureNow, resolutionFixture } from '../fixtures/incoming-resolution-cases.mjs';

const env = { TYPESAFE_API_KEY: 'synthetic-key', ADMIN_AI_INBOX_CLASSIFICATION_ENABLED: 'true', ADMIN_AI_INBOX_RESOLUTION_ENABLED: 'true' };
const chosen = { category: 'leaving', intent: 'request', actionability: 'action_needed' };
function answers(questions) {
  return Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'choice', choice: chosen[key] || 'looks_answered', confidence: 0.99,
    probabilities: Object.fromEntries(Object.keys(questions[key].criteria).map(option => [option, option === (chosen[key] || 'looks_answered') ? 1 : 0])) }]));
}
function harness({ rows = classificationFixture(), evaluate, flagEnv = env, patch, failSave } = {}) {
  const data = { rows: structuredClone(rows), proposals: [], calls: [], saves: 0, patches: 0, reads: [] };
  const service = createIncomingClassificationService({ env: flagEnv, now: () => fixtureNow, uuid: () => `fixture-${data.saves}`,
    readInbox: async options => { data.reads.push(options); return structuredClone(data.rows); },
    readProposals: async () => structuredClone(data.proposals), readStudents: async () => [],
    saveProposal: async row => { if (failSave?.(row, data)) throw new Error('Synthetic save failure');
      data.saves++; data.proposals = [...data.proposals.filter(p => p.proposalId !== row.proposalId), row]; },
    evaluate: async input => { data.calls.push(input); validateJevRequest(input);
      return evaluate ? evaluate(input, data) : { model: 'jev-1.13.0', answers: answers(input.questions) }; },
    patchClassification: async options => { data.patches++;
      if (patch) return patch(options, data);
      const context = projectClassificationContext(data.rows, options.incomingId, { now: fixtureNow });
      assert.equal(context.queueHash, options.expectedQueueHash);
      const updated = applyReviewedClassification(context.cluster.entries, options.classification, options);
      data.rows = data.rows.map(row => updated.find(item => item.incomingId === row.incomingId) || row);
      return updated;
    },
  });
  return { service, data };
}

test('message checks require the key and opt-in flag; loading makes no model calls or writes', async () => {
  assert.equal(isIncomingClassificationConfigured(env), true);
  for (const flagEnv of [{ TYPESAFE_API_KEY: 'key' }, { ADMIN_AI_INBOX_CLASSIFICATION_ENABLED: 'true' }]) {
    assert.equal(isIncomingClassificationConfigured(flagEnv), false);
    const { service, data } = harness({ flagEnv });
    assert.equal((await service.list()).available, false);
    await assert.rejects(service.assess({ incomingId: 'incoming_synthetic_0' }));
    assert.equal(data.calls.length, 0); assert.equal(data.saves, 0);
  }
});
test('whole-burst classification and reply resolution share one call and store separate metadata-only proposals', async () => {
  const { service, data } = harness({ rows: [resolutionFixture()] });
  const original = structuredClone(data.rows);
  const result = await service.assess({ incomingId: original[0].incomingId });
  assert.deepEqual(result.proposal.classification, chosen);
  assert.equal(result.resolutionProposal.label, 'looks_answered');
  assert.equal(data.calls.length, 1); assert.equal(Object.keys(data.calls[0].questions).length, 4);
  assert.deepEqual(data.reads, [{ force: true }, { force: true }]);
  assert.deepEqual(data.rows, original);
  assert.deepEqual(data.proposals.map(row => row.lane), ['incoming_classification', 'incoming_resolution']);
  for (const proposal of data.proposals) assert.equal(JSON.stringify(proposal).includes(original[0].messageText), false);
  assert.ok((await service.list()).byIncomingId[original[0].incomingId]);
  assert.equal(data.calls.length, 1); assert.equal(data.saves, 2);
});
test('classification can proceed without replies or with legacy/Planning receipt guard, never inventing answered', async () => {
  for (const mode of ['none', 'legacy', 'planning', 'truncated']) {
    const row = resolutionFixture();
    if (mode === 'none' || mode === 'legacy') row.schoolReplyEvidence = [];
    if (mode === 'none') row.schoolRepliedAt = '';
    if (mode === 'planning') row.createdPlanningId = 'plan_synthetic';
    if (mode === 'truncated') row.schoolReplyEvidence[0].truncated = true;
    const { service, data } = harness({ rows: [row] });
    const result = await service.assess({ incomingId: row.incomingId });
    assert.equal(Object.keys(data.calls[0].questions).length, 3);
    assert.equal(result.resolutionProposal?.label || null, mode === 'none' ? null : 'unclear');
  }
});
test('redaction excludes known names, contacts, URLs, chat/student ids and even roster metadata', () => {
  const row = classificationFixture()[0];
  row.messageText = 'Sample Student and Sample Parent, email x@example.com, +44 7700 900123 https://example.com tch_synthetic fml_synthetic';
  const context = projectClassificationContext([row], row.incomingId, { now: fixtureNow });
  const wire = JSON.stringify(context.state);
  for (const value of ['Sample', '@', '7700', 'http', 'tch_', 'fml_', 'synthetic_chat', 'sdt_synthetic', 'incoming_synthetic']) assert.equal(wire.includes(value), false, value);
  assert.deepEqual(Object.keys(context.state), ['originalRequest', 'groupType']);
});
test('incomplete, overlong, expanding redaction and large bursts abstain; low-confidence no_action falls back to review', async () => {
  for (const rows of [
    [{ ...classificationFixture()[0], messageText: '[Media or unsupported message]' }],
    [{ ...classificationFixture()[0], messageAt: 'bad', capturedAt: '' }],
    [{ ...classificationFixture()[0], messageText: 'x'.repeat(600) }],
    [{ ...classificationFixture()[0], matchedStudentName: 'Amy', messageText: 'Amy '.repeat(100) }],
    classificationFixture({ messages: Array(5).fill('A short message') }),
  ]) {
    const { service, data } = harness({ rows });
    const result = await service.assess({ incomingId: rows[0].incomingId });
    assert.ok(result.proposal.guard); assert.deepEqual(result.proposal.classification, CLASSIFICATION_FALLBACK);
    assert.equal(data.calls.length, 0);
  }
  const value = answers(CLASSIFICATION_QUESTIONS);
  value.actionability = { choice: 'no_action', confidence: 0.99, probabilities: { no_action: 0.8 } };
  assert.deepEqual(classificationDecision(value).classification, { ...chosen, actionability: 'uncertain' });
});
test('a changed or newly appended burst during evaluation is rejected before either proposal is saved', async () => {
  for (const change of [data => { data.rows[0].messageText += ' new request'; }, data => { data.rows.push({ ...data.rows[0], incomingId: 'new', messageAt: '2026-10-01T10:01:00Z', capturedAt: '2026-10-01T10:01:00Z' }); }]) {
    const { service, data } = harness({ evaluate: async (input, state) => { change(state); return { model: 'jev-1.13.0', answers: answers(input.questions) }; } });
    await assert.rejects(service.assess({ incomingId: data.rows[0].incomingId }), /conversation changed/);
    assert.equal(data.saves, 0);
  }
});
test('human edits apply to the full burst, preserve workflow and reply receipts, retain model hypothesis, work after kill switch', async () => {
  const flagEnv = { ...env };
  const { service, data } = harness({ flagEnv, rows: classificationFixture(classificationCases[12]) });
  data.rows[0].schoolRepliedAt = '2026-10-01T10:05:00Z';
  data.rows[0].createdPlanningId = 'plan_synthetic';
  const result = await service.assess({ incomingId: data.rows[1].incomingId });
  flagEnv.ADMIN_AI_INBOX_CLASSIFICATION_ENABLED = 'false';
  const classification = { category: 'payment', intent: 'request', actionability: 'action_needed' };
  const applied = await service.review({ proposalId: result.proposal.proposalId, mode: 'apply', classification, actorEmail: 'synthetic-admin@example.test' });
  assert.equal(applied.updatedMessages.length, 2);
  assert.ok((await service.list()).byIncomingId[result.incomingId]);
  for (const row of data.rows) {
    assert.equal(row.status, 'inbox'); assert.equal(row.suspectedCategory, 'payment');
    assert.equal(row.proposedCategory, 'general'); assert.equal(row.classificationIntent, 'request');
  }
  assert.equal(data.rows[0].createdPlanningId, 'plan_synthetic');
  assert.equal(data.rows[0].schoolRepliedAt, '2026-10-01T10:05:00Z');
  const stored = data.proposals.find(row => row.proposalId === result.proposal.proposalId);
  assert.equal(stored.proposalBody, JSON.stringify(chosen));
  assert.equal(stored.appliedBody, JSON.stringify(classification));
  assert.equal(data.patches, 1);
  await assert.rejects(service.review({ proposalId: result.proposal.proposalId, mode: 'apply', classification }));
});
test('stale/expired/cross-lane suggestions cannot write details; discard changes only the proposal', async () => {
  for (const mutate of [data => { data.rows[0].status = 'ignored'; }, data => { data.rows[0].classificationIntent = 'social'; },
    data => { data.proposals[0].createdAt = '2026-09-29T10:00:00Z'; }, data => { data.proposals[0].lane = 'incoming_reply'; }]) {
    const { service, data } = harness(); const result = await service.assess({ incomingId: data.rows[0].incomingId });
    mutate(data);
    await assert.rejects(service.review({ proposalId: result.proposal.proposalId, mode: 'apply', classification: chosen }));
    assert.equal(data.patches, 0);
  }
  const { service, data } = harness(); const result = await service.assess({ incomingId: data.rows[0].incomingId });
  await service.review({ proposalId: result.proposal.proposalId, mode: 'discard' });
  assert.equal(data.proposals[0].status, 'rejected'); assert.equal(data.patches, 0);
});
test('review storage failure reports applied details truthfully and invalidates the original suggestion', async () => {
  const { service, data } = harness({ failSave: row => row.status === 'approved' });
  const result = await service.assess({ incomingId: data.rows[0].incomingId });
  const applied = await service.review({ proposalId: result.proposal.proposalId, mode: 'apply', classification: chosen });
  assert.equal(applied.proposal, null); assert.ok(applied.warning); assert.equal(applied.updatedMessages[0].suspectedCategory, 'leaving');
  assert.deepEqual((await service.list()).byIncomingId, {});
});
test('provider and detail-writer failures save no false approval; resolution storage failure preserves classification', async () => {
  const unavailable = harness({ evaluate: async () => { throw new Error('Synthetic provider failure'); } });
  await assert.rejects(unavailable.service.assess({ incomingId: unavailable.data.rows[0].incomingId }));
  assert.equal(unavailable.data.saves, 0); assert.equal(unavailable.data.patches, 0);
  const partial = harness({ rows: [resolutionFixture()], failSave: row => row.lane === 'incoming_resolution' });
  const checked = await partial.service.assess({ incomingId: partial.data.rows[0].incomingId });
  assert.ok(checked.proposal); assert.equal(checked.resolutionProposal, null); assert.ok(checked.warning);
  const failed = harness({ patch: async () => { throw new Error('Synthetic writer failure'); } });
  const result = await failed.service.assess({ incomingId: failed.data.rows[0].incomingId });
  await assert.rejects(failed.service.review({ proposalId: result.proposal.proposalId, mode: 'apply', classification: chosen }));
  assert.equal(failed.data.proposals[0].status, 'proposed'); assert.equal(failed.data.rows[0].suspectedCategory, 'general');
});
test('fresh Sheets patch checks burst membership and patches only approved classification/reviewer cells', () => {
  const headers = INCOMING_MESSAGE_INBOX_HEADERS;
  const rows = classificationFixture(classificationCases[12]); rows[0].schoolRepliedAt = '2026-10-01T10:05:00Z';
  const values = [headers, ...rows.map(row => { const mapped = buildIncomingMessageSheetRow(row); return headers.map(header => mapped[header] || ''); })];
  const context = projectClassificationContext(mapIncomingMessageInboxValues(values), rows[0].incomingId, { now: fixtureNow });
  const options = { headers, values, incomingId: rows[0].incomingId, expectedQueueHash: context.queueHash, classification: chosen, now: fixtureNow };
  const result = buildIncomingClassificationSheetUpdates(options);
  assert.equal(result.updatedMessages.length, 2); assert.equal(result.data.length, 18);
  const protectedFields = ['status', 'created_planning_id', 'school_replied_at', 'school_reply_evidence_json', 'message_text', 'matched_mms_id'];
  for (const field of protectedFields) {
    const col = headers.indexOf(field) + 1;
    const letter = col <= 26 ? String.fromCharCode(64 + col) : `A${String.fromCharCode(64 + col - 26)}`;
    assert.equal(result.data.some(item => item.range.split('!')[1].match(/^[A-Z]+/u)[0] === letter), false, field);
  }
  values[1][headers.indexOf('school_replied_at')] = '2026-10-01T10:06:00Z';
  assert.throws(() => buildIncomingClassificationSheetUpdates(options), /message changed/);
  assert.equal(currentClassificationSuggestion({ queueHash: context.queueHash, createdAt: fixtureNow.toISOString() }, context.cluster.entries, fixtureNow)?.queueHash, resolutionQueueHash(context.cluster.entries));
});
test('actual HTTP handler denies non-admins, rejects extra authority, bounds calls, sanitizes failures and allows review after disable', async () => {
  let user = { isAdmin: false, email: 'synthetic-admin@example.test' }, enabled = true, calls = 0, reviews = 0;
  const handlers = createIncomingClassificationHandlers({ session: async () => ({ user }), configured: () => enabled,
    list: async () => ({ byIncomingId: {} }), assess: async () => { calls++; throw new Error('sensitive provider body'); },
    review: async value => { reviews++; assert.equal(value.actorEmail, user.email); return {}; }, now: () => fixtureNow.getTime() });
  const request = body => new Request('http://synthetic.test', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await handlers.GET()).status, 401);
  assert.equal((await handlers.POST(request({ mode: 'assess', incomingId: 'a' }))).status, 401);
  user.isAdmin = true;
  assert.equal((await handlers.POST(request({ mode: 'assess', incomingId: 'a', actorEmail: 'attacker' }))).status, 400);
  for (let index = 0; index < 10; index++) {
    const response = await handlers.POST(request({ mode: 'assess', incomingId: 'a' }));
    assert.equal(response.status, 503); assert.equal((await response.text()).includes('sensitive'), false);
  }
  assert.equal((await handlers.POST(request({ mode: 'assess', incomingId: 'a' }))).status, 429);
  assert.equal(calls, 10); enabled = false;
  assert.equal((await handlers.POST(request({ mode: 'apply', proposalId: 'a', classification: chosen }))).status, 200);
  assert.equal(reviews, 1);
});
test('all synthetic fixtures have bounded three-question contracts; this test does not measure Jev accuracy', () => {
  for (const item of classificationCases) {
    const rows = classificationFixture(item); const context = projectClassificationContext(rows, rows[0].incomingId, { now: fixtureNow });
    assert.equal(context.guard, '', item.name); validateJevRequest({ state: context.state, questions: CLASSIFICATION_QUESTIONS });
  }
});
