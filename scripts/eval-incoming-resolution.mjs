/** Synthetic-only Jev evaluation. Offline mode checks the boundary, not model quality. */
import { evaluateJev } from '../lib/admin/jev-provider.mjs';
import { projectResolutionContext, RESOLUTION_QUESTION, resolutionDecision } from '../lib/admin/incoming-resolution-helpers.mjs';
import { resolutionCases, resolutionFixture, fixtureNow } from '../tests/fixtures/incoming-resolution-cases.mjs';

const live = process.argv.includes('--live');
if (live && !process.env.TYPESAFE_API_KEY) {
  console.error('Set TYPESAFE_API_KEY securely in the environment before a synthetic live evaluation.');
  process.exit(1);
}
let correct = 0, falseAnswered = 0, calls = 0;
for (const item of resolutionCases) {
  const row = resolutionFixture(item);
  const context = projectResolutionContext([row], row.incomingId, { now: fixtureNow });
  if (context.guard || JSON.stringify(context.state).length > 8000) throw new Error(`Invalid fixture boundary: ${item.name}`);
  if (!live) continue;
  const result = await evaluateJev({ state: context.state, questions: { resolution: RESOLUTION_QUESTION } });
  calls++;
  const actual = resolutionDecision(result.answers.resolution);
  if (actual === item.expected) correct++;
  if (actual === 'looks_answered' && item.expected !== 'looks_answered') falseAnswered++;
  console.log(JSON.stringify({ case: item.name, expected: item.expected, actual, model: result.model }));
}
console.log(JSON.stringify(live
  ? { mode: 'synthetic_live', cases: calls, correct, falseAnswered, note: 'Small synthetic set, not real inbox accuracy. Review failures before activating.' }
  : { mode: 'offline_boundary', cases: resolutionCases.length, modelCalls: 0, note: 'No classification accuracy measured. Run --live with a key to evaluate Jev.' }));
if (live && (falseAnswered > 0 || correct < Math.ceil(calls * 0.8))) process.exitCode = 1;
