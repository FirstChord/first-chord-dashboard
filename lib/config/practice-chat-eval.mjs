// Who sees a Practice Chat rating prompt, and how often.
//
// The six-week evaluation has two tiers. The silent tier — timings, errors,
// abandonment, edit rate — runs for everyone from day one and changes nothing a
// tutor sees. This file governs the *only* visible part: the rating card.
//
// It starts as Finn alone. Tutors join later, by agreement, and widening the
// roster is a Railway variable edit rather than a release. Deliberately
// resolved here rather than in the PWA, for the reason practice-note-sync.js
// already states: "The server decides which tutors are enabled. Do not
// duplicate a rollout allow-list in this public app." The launch URL therefore
// carries an opaque yes/no and a sampling number — never the roster.
//
// NEXT_PUBLIC_ values are inlined at build time, so changing either variable
// needs a rebuild to take effect. On Railway, editing the variable triggers one.

// 1 = prompt on every eligible session. Used for the first two weeks, when the
// only person being asked is also the person shaking down the instrument and a
// thin sample would tell him nothing.
export const DEFAULT_PRACTICE_CHAT_EVAL_SAMPLE = 1;

// Cap. A number larger than this means someone typed a rate they did not mean,
// and a prompt nobody ever sees is worse than no prompt: it looks configured.
const MAX_SAMPLE = 50;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

/**
 * Tutors enabled for rating prompts, as canonical short names.
 *
 * Unset means **nobody** — the opposite of PRACTICE_NOTES_ENABLED_TUTORS, which
 * defaults to the whole roster. An evaluation prompt is an interruption a tutor
 * has agreed to, so forgetting to configure it must fail closed and silent, not
 * open and school-wide.
 */
export function getPracticeChatEvalTutors(env = process.env) {
  const configured = clean(env.NEXT_PUBLIC_PRACTICE_CHAT_EVAL_TUTORS);
  if (!configured) return [];
  return [...new Set(configured.split(',').map(clean).filter(Boolean))];
}

export function resolvePracticeChatEvalSample(value = '') {
  const requested = Number(clean(value));
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_SAMPLE) {
    return DEFAULT_PRACTICE_CHAT_EVAL_SAMPLE;
  }
  return requested;
}

/**
 * Deterministic 1-in-`sample` selection from a seed.
 *
 * Deterministic rather than random so the same session or student is always
 * either sampled or not: a re-render, a refresh or a reopened panel must not
 * roll the dice again and pop a prompt at a tutor who just dismissed one. It
 * also means the sampling can be reproduced from the exported data later.
 *
 * The PWA holds its own copy of this rule; the two are independent by design
 * (the roster never crosses the wire), so a change here is not automatically a
 * change there.
 */
export function shouldSample(seed = '', sample = DEFAULT_PRACTICE_CHAT_EVAL_SAMPLE) {
  if (!Number.isInteger(sample) || sample < 1) return false;
  if (sample === 1) return true;
  let hash = 0;
  const text = `${seed ?? ''}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % sample === 0;
}

/**
 * Whether this tutor should be prompted, and how often.
 *
 * Matching is case-insensitive on the short name; a tutor whose name does not
 * appear is simply not prompted. Nothing here reveals who else is on the list.
 */
export function resolvePracticeChatEvalPrompt({ tutor = '', env = process.env } = {}) {
  const enabled = getPracticeChatEvalTutors(env).map((name) => name.toLowerCase());
  const candidate = clean(tutor).toLowerCase();
  if (!candidate || !enabled.includes(candidate)) {
    return { prompt: false, sample: 0 };
  }
  return {
    prompt: true,
    sample: resolvePracticeChatEvalSample(env.NEXT_PUBLIC_PRACTICE_CHAT_EVAL_SAMPLE),
  };
}

/**
 * Add the evaluation context that Practice Chat cannot derive for itself.
 *
 * Keep the tutor-name-to-resolver-key mapping here so the executable contract
 * test exercises the same call production uses. A destructured wrong key does
 * not throw; it silently disables every prompt.
 */
export function appendPracticeChatEvaluationParams(
  params,
  { tutorName = '', priorNote = null, env = process.env } = {},
) {
  const { prompt, sample } = resolvePracticeChatEvalPrompt({ tutor: tutorName, env });
  if (prompt) {
    params.set('evalPrompt', '1');
    params.set('evalSample', `${sample}`);
  }
  if (priorNote?.exists) {
    params.set('priorNoteExists', '1');
    if (Number.isFinite(priorNote.ageDays)) {
      params.set('priorNoteAgeDays', `${priorNote.ageDays}`);
    }
  }
  if (priorNote?.historyOpened) {
    params.set('priorHistoryOpened', '1');
  }
  return params;
}
