/** @fileoverview Practice Chat transcription proxy: receives recorded audio from the PWA and returns text, keeping the OpenAI key server-side. */
import { authenticatePracticeChatRequest, corsHeaders } from '@/lib/admin/practice-chat-auth.mjs';
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  PracticeChatTranscriptionError,
  transcribePracticeChatAudio,
} from '@/lib/admin/practice-chat-transcription.mjs';

// Multipart overhead on top of the audio itself (boundaries, model, prompt).
const MAX_REQUEST_BYTES = MAX_TRANSCRIPTION_AUDIO_BYTES + 64 * 1024;

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin') || ''),
  });
}

export async function POST(request) {
  const headers = corsHeaders(request.headers.get('origin') || '');
  const auth = authenticatePracticeChatRequest(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers });
  }

  // Refuse an oversized upload before buffering it.
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: 'The recording is too long to transcribe' }, { status: 413, headers });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a multipart audio upload' }, { status: 400, headers });
  }

  try {
    const result = await transcribePracticeChatAudio({
      file: form.get('file'),
      model: form.get('model'),
      prompt: form.get('prompt'),
    });
    return Response.json({ text: result.text, model: result.model }, { headers });
  } catch (error) {
    if (error instanceof PracticeChatTranscriptionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    }
    console.error('Practice Chat transcription failed:', error?.message || error);
    return Response.json({ error: 'Transcription failed' }, { status: 500, headers });
  }
}
