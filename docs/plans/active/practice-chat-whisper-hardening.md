---
status: active-plan
audience: [human, agent]
last_verified: 2026-10-06
---
# Practice Chat / Whisper Flow — Hardening Checklist

Status: **both halves live 2026-10-06; awaiting revocation of the old relay
key**. The browser-visible OpenAI key is a current confidentiality/cost
exposure until the old key is revoked. Created 2026-06-18; re-triaged
2026-07-20; redesigned 2026-10-06 (dashboard route instead of a relay route).

This is the execute-later checklist for securing the Practice Chat transcription ("Whisper") flow. Investigated 2026-06-18; agreed to defer the code changes so live tutor sessions aren't interrupted.

---

## Architecture (as found)

- **Client:** `github.com/FirstChord/practicechatpwa` — Firebase-hosted PWA, linked from the admin dashboard quick-link. Transcription code: `public/src/asr-client.js`.
- **Relay:** `github.com/FirstChord/enhanced-music-lesson-notes` — Railway service at `https://enhanced-music-lesson-notes-production.up.railway.app`. Holds `OPENAI_API_KEY`. Cloned **3×** locally under `~/Desktop/Tools:Games/FC Admin Tools/HW Notes 3 …` (all same `origin`; worth collapsing to one).
- **Transcription:** record (MediaRecorder, webm/opus) → on stop, batch call to OpenAI Whisper (`/v1/audio/transcriptions`, `whisper-1`). The relay also has legacy WebSocket/Realtime code that this PWA does **not** use.

## The problem

The PWA fetches the **raw `OPENAI_API_KEY` from the relay's `GET /api-key`** and calls OpenAI **directly from the browser** (`asr-client.js:148–164`). So the key is delivered to every client and is visible in browser network/devtools. The relay's origin checks are weak (allow no-origin and any `chrome-extension://`; `Origin` is spoofable), so the endpoint is effectively reachable by anyone who knows the URL.

**Impact:** anyone who can reach `/api-key` can extract the key and spend OpenAI credit. Confidentiality/cost risk, not an availability bug — current transcription works, which is why deferring is safe functionally.

---

## Do now — zero disruption (no code, no deploy)

- [x] In the **OpenAI dashboard**, set a **monthly usage limit** + **email alert threshold** (Finn, reported done 2026-10-06).

---

## Phase 1 — Close the key exposure (staged, zero-downtime)

**Design change (2026-10-06):** the server-side call lives in the **dashboard**
(`POST /api/practice-notes/transcribe`, `lib/admin/practice-chat-transcription.mjs`),
not in a new relay route. The dashboard already owns the Practice Chat
secret + origin gate (`lib/admin/practice-chat-auth.mjs`), tests, CI and the
deploy routine; the relay has none of these, and moving the call means the relay
can be retired instead of hardened. The key is a **new** dedicated
`PRACTICE_CHAT_OPENAI_API_KEY`, so "rotation" reduces to revoking the old one.

That shared secret is coarse (it ships in the dashboard bundle), so the route's
limits — 10MB audio, `audio/*` only, model allow-list, 1000-char prompt — are
what bound a leaked secret. It can buy capped transcriptions, never the key.

- [x] **Dashboard:** route + helper + 10 focused tests. Verified locally against
  a deliberately invalid key: no secret/foreign origin/wrong secret/non-audio
  rejected; valid request reached OpenAI (401 for the fake key); CORS preflight OK.
- [x] **PWA:** `asr-client.js` posts the blob to the dashboard; `getAPIKey()`,
  the relay URL and the browser-side OpenAI call are gone, pinned by
  `tests/asr-transcription.test.mjs`. Without dashboard context, recording
  refuses **before** the microphone opens; typed notes still work. Verified in
  Chrome with a fake microphone against the local route.
- [x] Finn: create a new budget-capped OpenAI project key; set
  `PRACTICE_CHAT_OPENAI_API_KEY` on the canonical admin Railway service.
- [x] Deploy dashboard (`0635dfa`, CI green). Live smoke: foreign origin → 403;
  authenticated 3s synthetic-speech clip → 200 with the exact sentence.
- [x] Deploy PWA (practice-chat `30896e5`, stamp `20261006-server-transcription`,
  cache `v31`). Live bundle verified to post to the dashboard route.
- [ ] Finn: record one real answer through the dashboard quick link.
- [ ] **Wait** a day (tutors on the old PWA keep working until they reload).
- [ ] **Revoke the old relay key in OpenAI.** This is what ends the exposure;
  `/api-key` then hands out a dead key.
- [ ] Retire the relay Railway service (`enhanced-music-lesson-notes`) and drop
  its runbook row.

## Phase 2 — Clear low-credit warnings (in code)

- [x] (Done in the dashboard route, 2026-10-06.) Detect OpenAI quota/billing failures (`insufficient_quota`, HTTP 429, billing messages) and return a distinct, friendly message — e.g. *"Transcription paused — OpenAI credit needs topping up"* — instead of a generic error.
- [ ] (Optional) fire an admin notification (email/log) when that specific error is seen, so a mid-lesson failure surfaces immediately.

## Phase 3 — Open-source fallback if OpenAI is down

- [ ] In the PWA, when the relay `/transcribe` call fails, fall back to **in-browser open-source Whisper via Transformers.js** (`@xenova/transformers`, `whisper-tiny`/`whisper-base`, WASM). It transcribes the *same recorded blob* — no key, works offline, keeps the record→transcribe UX. First load downloads a small model (cached thereafter).
- [ ] (Alternative, lighter/lower-quality: Vosk WASM.)
- [ ] Note: the local `~/whisper-models` can't back a Railway service — a deployed fallback must be browser-side.

---

## Verification (each phase)

- [ ] Record → transcribe end-to-end in the PWA returns correct text.
- [ ] Relay logs show transcription happening **server-side**; no key in any client network request.
- [ ] After Phase 1: `GET /api-key` returns 404; browser never receives the key.
- [ ] After rotation: new key works; old key rejected.

## Housekeeping (when convenient)

- [ ] Collapse the 3 local relay clones (`HW Notes 3 …`) down to one working copy.
- [ ] Remove the unused legacy WebSocket/Realtime code from the relay if it's confirmed dead.
