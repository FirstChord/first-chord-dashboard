/** @fileoverview Shared server-only Jev transport: bounded typed decisions, strict validation, no tools, retry, or prompt logging. */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';
export const JEV_TIMEOUT_MS = 5000;
export const JEV_STATE_MAX_LENGTH = 8000;
const QUESTION_LIMIT = 8;

export class JevError extends Error {
  constructor(code, message = 'Jev assessment is unavailable') {
    super(message);
    this.name = 'JevError';
    this.code = code;
  }
}

export function isJevConfigured(env = process.env) {
  return Boolean(`${env.TYPESAFE_API_KEY || ''}`.trim());
}

function object(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function unit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function sameKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function description(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
}

export function validateJevRequest({ state, questions } = {}) {
  let serialised;
  try { serialised = JSON.stringify(state); } catch { throw new JevError('invalid_input'); }
  if ((!object(state) && typeof state !== 'string' && !(Array.isArray(state) && state.every(item => typeof item === 'string')))
    || !serialised || serialised.length > JEV_STATE_MAX_LENGTH
    || (typeof state === 'string' && !state.trim())) throw new JevError('invalid_input');
  const ids = object(questions) ? Object.keys(questions) : [];
  if (!ids.length || ids.length > QUESTION_LIMIT) throw new JevError('invalid_input');
  for (const id of ids) {
    const question = questions[id];
    if (!/^[a-z][a-z0-9_]{0,59}$/u.test(id) || !object(question)
      || !['choice', 'score', 'noul'].includes(question.type)
      || !description(question.instructions)
      || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key))) throw new JevError('invalid_input');
    if (question.type === 'choice') {
      const options = object(question.criteria) ? Object.keys(question.criteria) : [];
      if (options.length < 2 || options.length > 255
        || options.some(key => !/^[a-z][a-z0-9_]{0,59}$/u.test(key) || !description(question.criteria[key]))) throw new JevError('invalid_input');
    } else if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10
        || !question.criteria.every(description)) throw new JevError('invalid_input');
    } else if (question.criteria !== undefined && (!sameKeys(question.criteria, ['true', 'false'])
      || !Object.values(question.criteria).every(description))) throw new JevError('invalid_input');
  }
  return { state, questions };
}

export function validateJevResponse(data, questions) {
  const ids = Object.keys(questions);
  if (!object(data) || typeof data.model !== 'string' || !/^jev-[a-z0-9.-]{1,60}$/u.test(data.model)
    || !sameKeys(data.answers, ids)) throw new JevError('invalid_response');
  const answers = {};
  for (const id of ids) {
    const question = questions[id], answer = data.answers[id];
    if (!object(answer) || answer.type !== question.type) throw new JevError('invalid_response');
    if (question.type === 'noul') {
      if (!sameKeys(answer, ['type', 'noul']) || !unit(answer.noul)) throw new JevError('invalid_response');
      answers[id] = { type: 'noul', noul: answer.noul };
      continue;
    }
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
    if (!unit(answer.confidence) || !sameKeys(answer.probabilities, keys)
      || !Object.values(answer.probabilities).every(unit)
      || Math.abs(Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0) - 1) > 0.001) throw new JevError('invalid_response');
    if (question.type === 'choice') {
      if (!sameKeys(answer, ['type', 'choice', 'probabilities', 'confidence']) || !keys.includes(answer.choice)
        || keys.some(key => answer.probabilities[key] > answer.probabilities[answer.choice] + 0.000001)) throw new JevError('invalid_response');
      answers[id] = { type: 'choice', choice: answer.choice, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
    } else {
      if (!sameKeys(answer, ['type', 'score', 'legend', 'probabilities', 'confidence']) || !sameKeys(answer.legend, keys)
        || keys.some(key => answer.legend[key] !== question.criteria[Number(key)])
        || typeof answer.score !== 'number' || !Number.isFinite(answer.score)
        || Math.abs(answer.score - keys.reduce((sum, key) => sum + Number(key) * answer.probabilities[key], 0)) > 0.001) throw new JevError('invalid_response');
      answers[id] = { type: 'score', score: answer.score, probabilities: { ...answer.probabilities }, legend: { ...answer.legend }, confidence: answer.confidence };
    }
  }
  const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return { model: data.model, answers, usage: { inputTokens: tokens(data.usage?.input_tokens), outputTokens: tokens(data.usage?.output_tokens) } };
}

// Callers own feature consent, minimal projection and redaction. This shared
// transport has no data readers, user-facing route or authority to act.
export async function evaluateJev(input, { env = process.env, fetchImpl = fetch, nowImpl = Date.now } = {}) {
  const validated = validateJevRequest(input);
  if (!isJevConfigured(env)) throw new JevError('not_configured', 'Jev is not connected yet');
  const model = `${env.TYPESAFE_MODEL || ''}`.trim() || JEV_DEFAULT_MODEL;
  if (!/^jev-[a-z0-9.-]{1,60}$/u.test(model)) throw new JevError('invalid_input');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  const started = nowImpl();
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${String(env.TYPESAFE_API_KEY).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validated, model }),
    });
    if (!response?.ok) throw new JevError(response?.status === 429 || response?.status === 529 ? 'rate_limited' : 'provider_error');
    let data;
    try { data = await response.json(); } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new JevError('invalid_response');
    }
    const result = validateJevResponse(data, validated.questions);
    if (!['jev-latest', 'jev-preview'].includes(model) && result.model !== model) throw new JevError('model_mismatch');
    return { ...result, latencyMs: Math.max(0, nowImpl() - started) };
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError(error?.name === 'AbortError' ? 'timeout' : 'provider_unavailable');
  } finally { clearTimeout(timer); }
}
