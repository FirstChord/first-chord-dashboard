/** @fileoverview Server-side Practice Chat transcription: validates recorded lesson audio and calls OpenAI so the API key never reaches the browser. */
import { SUPPORTED_PRACTICE_CHAT_ASR_MODELS } from '../config/practice-chat-asr.mjs';

// Replaces the relay's `GET /api-key`, which handed the raw OpenAI key to any
// caller so the PWA could call OpenAI itself. Here the audio comes to the key
// instead: the browser only ever receives text.
//
// The shared Practice Chat secret in front of this route is coarse (it ships in
// the dashboard bundle), so the limits below are what bound a leaked secret: it
// can buy transcriptions of capped size, never the key itself.

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const REQUEST_TIMEOUT_MS = 60_000;

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
// OpenAI accepts 25MB. Opus speech is roughly a third of a megabyte a minute,
// so 10MB is far beyond any real answer while capping the cost of one request.
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 10 * 1024 * 1024;
// Whisper reads only the last ~224 tokens of a prompt; anything longer is waste.
export const MAX_TRANSCRIPTION_PROMPT_CHARS = 1000;

export class PracticeChatTranscriptionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'PracticeChatTranscriptionError';
    this.code = code;
    this.status = status;
  }
}

function clean(value = '') {
  return `${value || ''}`.trim();
}

export function isPracticeChatTranscriptionConfigured(env = process.env) {
  return Boolean(clean(env.PRACTICE_CHAT_OPENAI_API_KEY));
}

export function resolveTranscriptionModel(value = '') {
  const requested = clean(value);
  return SUPPORTED_PRACTICE_CHAT_ASR_MODELS.includes(requested) ? requested : DEFAULT_TRANSCRIPTION_MODEL;
}

/**
 * Check the multipart fields before anything is sent to OpenAI.
 * `file` is whatever FormData returned; only a non-empty audio Blob passes.
 */
export function validateTranscriptionInput({ file = null, model = '', prompt = '' } = {}) {
  const isBlob = file && typeof file === 'object' && typeof file.size === 'number' && typeof file.arrayBuffer === 'function';
  if (!isBlob || file.size === 0) {
    throw new PracticeChatTranscriptionError('invalid_audio', 'No recorded audio was received', 400);
  }
  if (file.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new PracticeChatTranscriptionError('too_large', 'The recording is too long to transcribe', 413);
  }
  if (!`${file.type || ''}`.toLowerCase().startsWith('audio/')) {
    throw new PracticeChatTranscriptionError('invalid_audio', 'The upload is not an audio recording', 400);
  }

  return {
    file,
    model: resolveTranscriptionModel(model),
    prompt: clean(prompt).slice(0, MAX_TRANSCRIPTION_PROMPT_CHARS),
  };
}

function classifyProviderFailure(status, payload = {}) {
  const code = clean(payload?.error?.code || payload?.error?.type);
  if (code === 'insufficient_quota') {
    return new PracticeChatTranscriptionError(
      'quota',
      'Transcription paused: the OpenAI credit needs topping up. Use “Type notes instead” for now.',
      503
    );
  }
  if (status === 429) {
    return new PracticeChatTranscriptionError('rate_limited', 'Transcription is busy. Try again in a moment.', 503);
  }
  return new PracticeChatTranscriptionError('provider_error', `Transcription failed (OpenAI ${status})`, 502);
}

/**
 * Send validated audio to OpenAI and return only the text.
 * The transcript is a child's speech: it is returned, never logged.
 */
export async function transcribePracticeChatAudio(input, { env = process.env, fetchImpl = fetch } = {}) {
  if (!isPracticeChatTranscriptionConfigured(env)) {
    throw new PracticeChatTranscriptionError('not_configured', 'Transcription is not configured', 503);
  }
  const { file, model, prompt } = validateTranscriptionInput(input);

  const body = new FormData();
  body.append('file', file, file.name || 'audio.webm');
  body.append('model', model);
  body.append('response_format', 'json');
  if (prompt) body.append('prompt', prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clean(env.PRACTICE_CHAT_OPENAI_API_KEY)}` },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new PracticeChatTranscriptionError('timeout', 'Transcription timed out. Try again.', 504);
    }
    throw new PracticeChatTranscriptionError('provider_unavailable', 'Transcription service is unreachable', 502);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw classifyProviderFailure(response.status, payload);
  }

  return { text: clean(payload.text), model };
}
