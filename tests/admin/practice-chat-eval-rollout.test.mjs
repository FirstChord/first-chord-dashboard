import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendPracticeChatEvaluationParams,
  getPracticeChatEvalTutors,
  resolvePracticeChatEvalPrompt,
  resolvePracticeChatEvalSample,
  shouldSample,
} from '../../lib/config/practice-chat-eval.mjs';

test('unset means nobody is prompted, not everybody', () => {
  // The opposite default to PRACTICE_NOTES_ENABLED_TUTORS, deliberately. A
  // rating prompt is an interruption a tutor agreed to, so a forgotten config
  // must fail closed rather than quietly asking the whole school.
  assert.deepEqual(getPracticeChatEvalTutors({}), []);
  assert.deepEqual(
    resolvePracticeChatEvalPrompt({ tutor: 'Finn', env: {} }),
    { prompt: false, sample: 0 },
  );
});

test('only listed tutors are prompted', () => {
  const env = { NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS: 'Finn, Dean' };
  assert.equal(resolvePracticeChatEvalPrompt({ tutor: 'Finn', env }).prompt, true);
  assert.equal(resolvePracticeChatEvalPrompt({ tutor: 'dean', env }).prompt, true, 'case-insensitive');
  assert.equal(resolvePracticeChatEvalPrompt({ tutor: 'Calum', env }).prompt, false);
  assert.equal(resolvePracticeChatEvalPrompt({ tutor: '', env }).prompt, false);
});

test('the roster never leaves the server', () => {
  // The PWA receives a yes/no and a number. If it ever received names, the
  // public app would be publishing who is in the trial.
  const env = { NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS: 'Finn,Dean,Calum' };
  const resolved = resolvePracticeChatEvalPrompt({ tutor: 'Finn', env });
  assert.deepEqual(Object.keys(resolved).sort(), ['prompt', 'sample']);
  assert.equal(JSON.stringify(resolved).includes('Dean'), false);
});

test('a nonsense sample rate falls back rather than silencing the prompt', () => {
  // A prompt nobody ever sees is worse than no prompt: it looks configured.
  for (const bogus of ['', '0', '-3', 'weekly', '999', '2.5']) {
    assert.equal(resolvePracticeChatEvalSample(bogus), 1, `sample "${bogus}"`);
  }
  assert.equal(resolvePracticeChatEvalSample('4'), 4);
});

test('sampling is deterministic, so a re-render cannot re-roll the dice', () => {
  const first = shouldSample('sdt_1:2026-08-10', 4);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(shouldSample('sdt_1:2026-08-10', 4), first);
  }
});

test('sample of 1 always prompts, and the rate is roughly honoured', () => {
  assert.equal(shouldSample('anything', 1), true);

  const seeds = Array.from({ length: 400 }, (_, i) => `sdt_${i}:2026-08-10`);
  const picked = seeds.filter((seed) => shouldSample(seed, 4)).length;
  // Not an exact quarter — a hash is not a shuffle — but it must be in the
  // right neighbourhood, or the configured rate means nothing.
  assert.ok(picked > 60 && picked < 140, `expected roughly 100 of 400, got ${picked}`);
});

test('the production launch helper turns an enabled tutor into prompt parameters', () => {
  const params = appendPracticeChatEvaluationParams(new URLSearchParams(), {
    tutorName: 'Finn',
    priorNote: { exists: true, ageDays: 8, historyOpened: true },
    env: {
      NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS: 'Finn',
      NEXT_PUBLIC_PRACTICE_CHAT_EVAL_SAMPLE: '4',
    },
  });

  assert.deepEqual(Object.fromEntries(params), {
    evalPrompt: '1',
    evalSample: '4',
    priorNoteExists: '1',
    priorNoteAgeDays: '8',
    priorHistoryOpened: '1',
  });
});

test('the production launch helper omits prompt parameters for a tutor outside the roster', () => {
  const params = appendPracticeChatEvaluationParams(new URLSearchParams(), {
    tutorName: 'Calum',
    env: { NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS: 'Finn' },
  });

  assert.equal(params.has('evalPrompt'), false);
  assert.equal(params.has('evalSample'), false);
});
