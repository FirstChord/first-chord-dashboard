import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TRANSCRIPTION_MODEL,
  isPracticeChatTranscriptionConfigured,
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  MAX_TRANSCRIPTION_PROMPT_CHARS,
  resolveTranscriptionModel,
  transcribePracticeChatAudio,
  validateTranscriptionInput,
} from '../../lib/admin/practice-chat-transcription.mjs';

const ENV = { PRACTICE_CHAT_OPENAI_API_KEY: 'sk-test-key' };
const audio = (bytes = 2048, type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array(bytes)], { type });

function fakeOpenAi({ status = 200, payload = { text: '  We worked on Let It Be.  ' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('unconfigured until the dedicated key is set', async () => {
  assert.equal(isPracticeChatTranscriptionConfigured({}), false);
  assert.equal(isPracticeChatTranscriptionConfigured({ PRACTICE_CHAT_OPENAI_API_KEY: '  ' }), false);
  // The admin AI pilot key is deliberately not a fallback.
  assert.equal(isPracticeChatTranscriptionConfigured({ ADMIN_AI_OPENAI_API_KEY: 'sk-other' }), false);
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: {}, fetchImpl: fakeOpenAi().fetchImpl }),
    { code: 'not_configured', status: 503 }
  );
});

test('only allow-listed models reach OpenAI', () => {
  assert.equal(resolveTranscriptionModel('gpt-4o-mini-transcribe-2025-12-15'), 'gpt-4o-mini-transcribe-2025-12-15');
  assert.equal(resolveTranscriptionModel('gpt-5.6-luna'), DEFAULT_TRANSCRIPTION_MODEL);
  assert.equal(resolveTranscriptionModel(''), DEFAULT_TRANSCRIPTION_MODEL);
  assert.equal(resolveTranscriptionModel(null), DEFAULT_TRANSCRIPTION_MODEL);
});

test('rejects missing, empty, oversized and non-audio uploads', () => {
  assert.throws(() => validateTranscriptionInput({}), { code: 'invalid_audio', status: 400 });
  assert.throws(() => validateTranscriptionInput({ file: 'not a blob' }), { code: 'invalid_audio' });
  assert.throws(() => validateTranscriptionInput({ file: audio(0) }), { code: 'invalid_audio' });
  assert.throws(() => validateTranscriptionInput({ file: audio(16, 'text/plain') }), { code: 'invalid_audio' });
  assert.throws(
    () => validateTranscriptionInput({ file: audio(MAX_TRANSCRIPTION_AUDIO_BYTES + 1) }),
    { code: 'too_large', status: 413 }
  );
});

test('trims and caps the prompt', () => {
  const { prompt } = validateTranscriptionInput({ file: audio(), prompt: `  ${'x'.repeat(5000)}  ` });
  assert.equal(prompt.length, MAX_TRANSCRIPTION_PROMPT_CHARS);
});

test('sends the audio server-side and returns only trimmed text', async () => {
  const { calls, fetchImpl } = fakeOpenAi();
  const result = await transcribePracticeChatAudio(
    { file: audio(), model: 'gpt-4o-mini-transcribe', prompt: 'Guitar. Let It Be.' },
    { env: ENV, fetchImpl }
  );

  assert.deepEqual(result, { text: 'We worked on Let It Be.', model: 'gpt-4o-mini-transcribe' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-key');
  const sent = calls[0].init.body;
  assert.equal(sent.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(sent.get('prompt'), 'Guitar. Let It Be.');
  assert.equal(sent.get('response_format'), 'json');
  assert.equal(sent.get('file').size, 2048);
});

test('omits an empty prompt rather than sending a blank one', async () => {
  const { calls, fetchImpl } = fakeOpenAi();
  await transcribePracticeChatAudio({ file: audio(), prompt: '   ' }, { env: ENV, fetchImpl });
  assert.equal(calls[0].init.body.has('prompt'), false);
});

test('out of credit gets its own friendly message', async () => {
  const { fetchImpl } = fakeOpenAi({ status: 429, payload: { error: { code: 'insufficient_quota' } } });
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: ENV, fetchImpl }),
    (error) => error.code === 'quota' && error.status === 503 && /credit/.test(error.message)
  );
});

test('a plain rate limit is distinguished from running out of credit', async () => {
  const { fetchImpl } = fakeOpenAi({ status: 429, payload: { error: { code: 'rate_limit_exceeded' } } });
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: ENV, fetchImpl }),
    { code: 'rate_limited', status: 503 }
  );
});

test('other provider failures surface as a bad gateway without leaking the response', async () => {
  const { fetchImpl } = fakeOpenAi({ status: 500, payload: { error: { message: 'internal detail' } } });
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: ENV, fetchImpl }),
    (error) => error.code === 'provider_error' && error.status === 502 && !/internal detail/.test(error.message)
  );
});

test('network failure and timeout are reported, not thrown raw', async () => {
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: ENV, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    { code: 'provider_unavailable', status: 502 }
  );
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(
    transcribePracticeChatAudio({ file: audio() }, { env: ENV, fetchImpl: async () => { throw abort; } }),
    { code: 'timeout', status: 504 }
  );
});
