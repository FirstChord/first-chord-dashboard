/** @fileoverview Builds compact, deterministic learner summaries for waiting-list cards. */

const ASK_ON_CALL = 'Not provided — ask on call';

function clean(value = '') {
  return `${value || ''}`.trim();
}

function parseAge(value = '') {
  const ageText = clean(value);
  const match = ageText.match(/\b(\d{1,3})\b/u);
  return match ? Number(match[1]) : null;
}

function formatInstrumentPhrase(instruments = []) {
  const names = instruments.map(clean).filter(Boolean);
  if (!names.length) return 'instrument not yet clear';
  if (names.length === 1) return `wants to learn ${names[0]}`;
  return `wants to learn ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function formatMusic(parsedNote = {}) {
  const genres = clean(parsedNote.genres);
  const songs = clean(parsedNote.songs);

  if (genres && songs) return `${genres} · Wants to learn: ${songs}`;
  if (genres) return genres;
  if (songs) return `Wants to learn: ${songs}`;
  return ASK_ON_CALL;
}

function formatAvailability(student = {}) {
  const parsed = student.parsedNote || {};
  const rawParts = [parsed.preferredDays, parsed.preferredTimes].map(clean).filter(Boolean);
  if (rawParts.length) return rawParts.join(' · ');

  const dayText = Array.isArray(student.availabilityDays)
    ? student.availabilityDays.map(clean).filter(Boolean).join(', ')
    : '';
  const timeText = Array.isArray(student.availabilityTimes)
    ? student.availabilityTimes
      .map((value) => (value === 'evening' ? 'Evenings' : value === 'earlier' ? 'Earlier in the day' : clean(value)))
      .filter(Boolean)
      .join(' / ')
    : '';

  return [dayText, timeText].filter(Boolean).join(' · ') || ASK_ON_CALL;
}

export function formatWaitingDuration(ageInDays) {
  if (!Number.isFinite(ageInDays)) return 'Waiting time unknown';
  return `Waiting ${ageInDays} ${ageInDays === 1 ? 'day' : 'days'}`;
}

export function buildWaitingLearnerSummary(student = {}) {
  const ageText = clean(student.parsedNote?.age);
  const age = parseAge(ageText);
  const isAdult = age !== null ? age >= 18 : /\badult\b/iu.test(ageText);
  const learnerLabel = isAdult
    ? 'Adult learner'
    : age !== null
      ? `Age ${age}`
      : ageText
        ? `Age ${ageText}`
        : 'Age not provided';

  return {
    learnerLabel,
    instrumentPhrase: formatInstrumentPhrase(student.instruments),
    headline: `${learnerLabel} · ${formatInstrumentPhrase(student.instruments)}`,
    facts: [
      {
        key: 'experience',
        label: 'Experience',
        value: clean(student.parsedNote?.experience) || ASK_ON_CALL,
      },
      {
        key: 'music',
        label: 'Music they like',
        value: formatMusic(student.parsedNote),
      },
      {
        key: 'availability',
        label: 'Availability',
        value: formatAvailability(student),
      },
    ],
  };
}
