import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJev, validateJevRequest, validateJevResponse, JEV_ENDPOINT } from '../../lib/admin/jev-provider.mjs';
import { RESOLUTION_QUESTION } from '../../lib/admin/incoming-resolution-helpers.mjs';
const input = { state: { request: 'Synthetic question' }, questions: { resolution: RESOLUTION_QUESTION } };
const answer = { type: 'choice', choice: 'looks_answered', confidence: 0.9,
  probabilities: { looks_answered: 0.9, school_action_remaining: 0.04, waiting_for_parent: 0.03, unclear: 0.03 } };
const response = () => ({ model: 'jev-1.13.0', answers: { resolution: structuredClone(answer) }, usage: { input_tokens: 100, output_tokens: 10 } });

test('Jev sends one typed, bounded request with server credentials and no tools', async () => {
  let calls = 0;
  const result = await evaluateJev(input, { env: { TYPESAFE_API_KEY: 'synthetic-key' }, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, JEV_ENDPOINT);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['model', 'questions', 'state']);
    return { ok: true, json: async () => response() };
  } });
  assert.equal(calls, 1);
  assert.equal(result.answers.resolution.choice, 'looks_answered');
  assert.equal(result.usage.inputTokens, 100);
});
test('Jev refuses absent credentials, oversized context and malformed criteria before fetch', async () => {
  await assert.rejects(evaluateJev(input, { env: {} }), { code: 'not_configured' });
  assert.throws(() => validateJevRequest({ ...input, state: 'x'.repeat(8001) }), { code: 'invalid_input' });
  assert.throws(() => validateJevRequest({ state: {}, questions: { q: { type: 'choice', instructions: 'Pick', criteria: { a: 'one' } } } }), { code: 'invalid_input' });
});
test('Jev rejects invalid distributions, extra answer fields, unknown labels and model drift', async () => {
  for (const mutate of [
    data => { data.answers.resolution.probabilities.unclear = 0.4; },
    data => { data.answers.resolution.confidence = 2; },
    data => { data.answers.resolution.choice = 'send_whatsapp'; },
    data => { data.answers.resolution.text = 'unsafe'; },
    data => { data.answers.extra = answer; },
    data => { data.answers.resolution.probabilities.looks_answered = NaN; },
  ]) {
    const data = response(); mutate(data);
    assert.throws(() => validateJevResponse(data, input.questions), { code: 'invalid_response' });
  }
  await assert.rejects(evaluateJev(input, { env: { TYPESAFE_API_KEY: 'synthetic-key' }, fetchImpl: async () => ({ ok: true, json: async () => ({ ...response(), model: 'jev-1.14.0' }) }) }), { code: 'model_mismatch' });
});
test('Jev failures discard raw response bodies and never retry', async () => {
  for (const [status, code] of [[401, 'provider_error'], [429, 'rate_limited'], [529, 'rate_limited']]) {
    let calls = 0;
    await assert.rejects(evaluateJev(input, { env: { TYPESAFE_API_KEY: 'synthetic-key' }, fetchImpl: async () => {
      calls++; return { ok: false, status, json: async () => { throw new Error('private body must not be read'); } };
    } }), error => error.code === code && !error.message.includes('private'));
    assert.equal(calls, 1);
  }
});
test('shared typed provider validates score and noul without inventing confidence', () => {
  const questions = { score: { type: 'score', instructions: 'Score', criteria: ['Low', 'High'] }, bool: { type: 'noul', instructions: 'Assess' } };
  const result = validateJevResponse({ model: 'jev-1.13.0', answers: {
    score: { type: 'score', score: 0.8, legend: { 0: 'Low', 1: 'High' }, probabilities: { 0: 0.2, 1: 0.8 }, confidence: 0.8 },
    bool: { type: 'noul', noul: 0.75 },
  } }, questions);
  assert.deepEqual(result.answers.bool, { type: 'noul', noul: 0.75 });
});
test('Jev timeout aborts the request and yields a controlled error', async () => {
  await assert.rejects(evaluateJev(input, { env: { TYPESAFE_API_KEY: 'synthetic-key' }, fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) }), { code: 'timeout' });
});
