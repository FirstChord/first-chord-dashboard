/** @fileoverview Pure, browser-safe normalisation of instrument and experience-level free text from sign-up notes. */

export function normaliseInstrument(raw) {
  const value = (raw || '').toLowerCase();
  if (value.includes('ukulele orchestra')) return 'Ukulele Orchestra';
  if (value.includes('piano') || value.includes('keyboard')) return 'Piano';
  if (value.includes('ukulele') || value.includes('uke')) return 'Ukulele';
  if (value.includes('singing') || value.includes('voice') || value.includes('vocal')) return 'Singing';
  if (value.includes('bass')) return 'Bass';
  if (value.includes('electric guitar')) return 'Electric Guitar';
  if (value.includes('guitar')) return 'Guitar';
  return raw || '';
}

// A sign-up note routinely names more than one instrument ("Guitar and Ukulele").
// normaliseInstrument collapses the whole string to whichever label it matches
// first, so the rest is silently dropped — which is how the waiting list could
// offer a guitar tutor while onboarding arrived set to Ukulele. Split first,
// normalise each part, and let the caller decide which one it means.
export function parseInstrumentList(raw) {
  const entries = `${raw || ''}`
    .split(/,|&|\/|\+|\band\b/iu)
    .map((entry) => normaliseInstrument(entry).trim())
    .filter(Boolean);
  return [...new Set(entries)];
}

// Electric guitar needs its own portal/song-catalogue label, but it does not
// require a separate tutor skill lane: tutors recorded as teaching guitar are
// eligible for both acoustic and electric students.
export function normaliseTeachingInstrument(raw) {
  const instrument = normaliseInstrument(raw);
  return instrument === 'Electric Guitar' ? 'Guitar' : instrument;
}

export function normaliseExperienceLevel(value) {
  const input = (value || '').toLowerCase().trim();
  if (['1', 'beginner', 'complete beginner', 'a complete beginner', 'no'].includes(input)) {
    return 'a complete beginner';
  }
  if (['2', 'some', 'some experience', 'has some experience', 'yes'].includes(input)) {
    return 'has some experience';
  }
  if (['3', 'intermediate', 'at an intermediate level'].includes(input)) {
    return 'at an intermediate level';
  }
  return 'a complete beginner';
}
