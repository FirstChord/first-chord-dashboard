// Which transcription model Practice Chat should use, school-wide.
//
// Set NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL on Railway to run a trial; clear it
// to go back to the default. Deliberately a config value rather than a tutor-
// facing control: the useful comparison is "a week on this model" against "a
// week on that one", not a per-lesson choice someone has to remember while a
// student waits.
//
// This is the only allow-list. The launcher checks the configured value here
// before putting it in the Practice Chat URL, and the transcription route
// (lib/admin/practice-chat-transcription.mjs) checks it again and falls back to
// whisper-1. Practice Chat forwards whatever it is given and records the model
// the route reports, so adding a model here is the only edit a trial needs.
// gpt-4o-transcribe-diarize is deliberately absent: it needs diarized_json and
// a chunking_strategy and takes no prompt, a different feature, not a swap.

// Empty means "let the PWA use its own default" (whisper-1), so no parameter
// is sent at all.
export const DEFAULT_PRACTICE_CHAT_ASR_MODEL = '';

export const SUPPORTED_PRACTICE_CHAT_ASR_MODELS = [
  'whisper-1',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  // The December snapshot: fewest reported hallucinations, tuned for short
  // utterances and background noise, half the per-minute cost of whisper-1.
  'gpt-4o-mini-transcribe-2025-12-15',
];

/**
 * Resolve the configured model to a value safe to put in the Practice Chat URL.
 * Returns '' when unset or unrecognised, which means "send no parameter".
 */
export function resolvePracticeChatAsrModel(value = '') {
  const requested = `${value || ''}`.trim();
  if (!requested) return DEFAULT_PRACTICE_CHAT_ASR_MODEL;

  if (!SUPPORTED_PRACTICE_CHAT_ASR_MODELS.includes(requested)) {
    console.warn(
      `NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL is set to "${requested}", which is not a supported `
      + `transcription model. Practice Chat will use its default. Supported: `
      + SUPPORTED_PRACTICE_CHAT_ASR_MODELS.join(', ')
    );
    return DEFAULT_PRACTICE_CHAT_ASR_MODEL;
  }

  return requested;
}
