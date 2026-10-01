/** Synthetic-only Jev classification and combined reply evaluation; no school data readers or writes. */
import { evaluateJev, validateJevRequest } from '../lib/admin/jev-provider.mjs';
import { CLASSIFICATION_QUESTIONS, classificationDecision, projectClassificationContext } from '../lib/admin/incoming-classification-helpers.mjs';
import { RESOLUTION_QUESTION, projectResolutionContext, resolutionDecision } from '../lib/admin/incoming-resolution-helpers.mjs';
import { classificationCases, classificationFixture } from '../tests/fixtures/incoming-classification-cases.mjs';
import { resolutionCases, resolutionFixture, fixtureNow } from '../tests/fixtures/incoming-resolution-cases.mjs';

const live = process.argv.includes('--live');
let correct = 0, falseNoAction = 0, falseAnswered = 0, calls = 0, resolutionCorrect = 0, unavailable = 0;
async function evaluate(input, name) {
  calls++;
  try { return await evaluateJev(input); }
  catch (error) { unavailable++; console.log(JSON.stringify({ case: name, outcome: 'unavailable', code: error.code || 'unknown' })); return null; }
}
for (const item of classificationCases) {
  const rows = classificationFixture(item);
  const context = projectClassificationContext(rows, rows[0].incomingId, { now: fixtureNow });
  if (context.guard) throw new Error(`Invalid fixture: ${item.name}`);
  const input = { state: context.state, questions: CLASSIFICATION_QUESTIONS };
  validateJevRequest(input);
  if (!live) continue;
  const result = await evaluate(input, item.name);
  if (!result) continue;
  const { classification: actual, guard } = classificationDecision(result.answers);
  const expected = Object.fromEntries(['category', 'intent', 'actionability'].map((key, index) => [key, item.expected[index]]));
  if (JSON.stringify(actual) === JSON.stringify(expected)) correct++;
  if (actual.actionability === 'no_action' && expected.actionability !== 'no_action') falseNoAction++;
  console.log(JSON.stringify({ case: item.name, expected, actual, guard, model: result.model }));
}
// Exercise the same four-question combined call used when a captured reply exists.
for (const item of resolutionCases) {
  const rows = [resolutionFixture(item)];
  const message = projectClassificationContext(rows, rows[0].incomingId, { now: fixtureNow });
  const replies = projectResolutionContext(rows, rows[0].incomingId, { now: fixtureNow });
  const input = { state: { ...message.state, ...replies.state }, questions: { ...CLASSIFICATION_QUESTIONS, resolution: RESOLUTION_QUESTION } };
  validateJevRequest(input);
  if (!live) continue;
  const result = await evaluate(input, `combined ${item.name}`);
  if (!result) continue;
  const actual = resolutionDecision(result.answers.resolution);
  if (actual === item.expected) resolutionCorrect++;
  if (actual === 'looks_answered' && item.expected !== 'looks_answered') falseAnswered++;
  console.log(JSON.stringify({ case: `combined ${item.name}`, expected: item.expected, actual, model: result.model }));
}
console.log(JSON.stringify(live ? { mode: 'synthetic_live', calls, classificationCases: classificationCases.length,
  correct, resolutionCases: resolutionCases.length, resolutionCorrect, falseNoAction, falseAnswered, unavailable,
  note: 'Small synthetic set; not a measure of real inbox accuracy.' }
  : { mode: 'offline_boundary', cases: classificationCases.length + resolutionCases.length, modelCalls: 0 }));
if (live && (correct < Math.ceil(classificationCases.length * 0.8) || resolutionCorrect < Math.ceil(resolutionCases.length * 0.8)
  || falseNoAction || falseAnswered)) process.exitCode = 1;
