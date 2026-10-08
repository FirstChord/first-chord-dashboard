---
status: active-plan
audience: [human, agent]
last_verified: 2026-10-08
---
# Practice Chat: Children's Voice Data

Practice Chat records the end-of-lesson reflection (about two minutes, often
with the student speaking) and sends the audio to OpenAI for transcription.
This plan makes that defensible to parents and to other schools. Finn agreed
the order on 2026-10-08.

## Already true

- Only the reflection is recorded, never the lesson; the microphone is on only
  between Start and Stop.
- First Chord stores no audio: browser to dashboard route
  (`POST /api/practice-notes/transcribe`) to OpenAI, no copy kept, transcript not
  logged.
- What is stored is the tutor-reviewed note, not the raw transcript (raw
  transcript capture is built but held; see the diarisation audit).
- OpenAI does not train on API data by default. Default retention: up to 30
  days for abuse monitoring.
- The send-time wording check flags possible safeguarding disclosures.

## Checklist

1. [ ] **Execute OpenAI's Data Processing Addendum** (Finn, minutes).
   platform.openai.com with the account that owns the API keys → Settings →
   Organization → General (note the Organization ID) → open
   openai.com/policies/data-processing-addendum → **Execute Data Processing
   Agreement** → legal entity name, signatory, contact email. Keep the
   countersigned PDF.
2. [ ] **Request Zero Data Retention** (Finn). Not a setting: OpenAI sales
   approves it per organisation, and may decline at our size. Once approved,
   Settings → Organization → Data controls → Data Retention appears. Draft
   request below.
3. [ ] **Privacy notice wording** for parents (Claude drafts, Finn publishes).
4. [ ] **DPIA** (Claude drafts from the code, Finn reviews and signs). The ICO
   expects one for children's data with new technology, and another school
   will ask for it.
5. [ ] **European data residency**, once ZDR is approved (OpenAI requires it
   first): a new EU project in the OpenAI dashboard, then swap
   `PRACTICE_CHAT_OPENAI_API_KEY`. Simpler UK transfer position and a cleaner
   sentence for parents; with ZDR on, the practical gain is smaller. The 10%
   residency uplift applies only to models released on or after 2026-03-05,
   so not to `whisper-1` or `gpt-4o-mini-transcribe-2025-12-15`.

## Before building voice detection

Telling voices apart **by matching stored voice samples** creates biometric
data used to identify people: special category under UK GDPR, needing explicit
consent in most cases (the ICO made HMRC delete voiceprints held without it).
Separating speakers without identifying them ("Speaker A / B", the tutor says
which is which) avoids that. Decide before the feature is built.

## Draft: ZDR request

Send via OpenAI's contact-sales form.

> **Subject: Zero Data Retention request: audio transcriptions, UK music
> school (children's data)**
>
> Hello,
>
> We're First Chord, a music school in the UK. We use the OpenAI API
> (organisation ID: **[org ID]**) for one purpose only: transcribing short
> end-of-lesson spoken reflections with `/v1/audio/transcriptions`
> (`whisper-1` / `gpt-4o-mini-transcribe`), roughly **600 recordings a month,
> about two minutes each**. Some of the speakers are children.
>
> We'd like to request **Zero Data Retention** for this organisation, or for a
> dedicated project, so that no audio is retained for abuse monitoring. If ZDR
> isn't available to us, we'd like to ask about **Modified Abuse Monitoring**
> instead. We're also interested in **European data residency** for the same
> project once retention controls are in place.
>
> We've executed (or are executing) your Data Processing Addendum. Happy to
> provide anything else you need.
>
> Kind regards,
> Finn, First Chord

Sources: [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data),
[OpenAI EU data residency](https://openai.com/index/introducing-data-residency-in-europe/),
[OpenAI DPA](https://openai.com/policies/data-processing-addendum/),
[ICO on DPIAs and children](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/2-data-protection-impact-assessments/).
