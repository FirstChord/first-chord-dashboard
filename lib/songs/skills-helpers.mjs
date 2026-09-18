/** @fileoverview Derives a song's skills from catalogue tags and builds skill coverage; read-only over the hand-edited catalogue. */
import { SONGS_CATALOGUE } from '../config/songs-catalogue.mjs';
import {
  NON_SKILL_TAGS,
  SKILL_AREAS,
  SONG_SKILLS,
  TAG_SKILLS,
} from '../config/song-skills.mjs';

// Reading the skill layer. Derivation only — nothing here writes, and the
// catalogue stays the single hand-edited source.

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

/**
 * The skill ids a song teaches.
 *
 * An explicit `skills` list on the catalogue entry always wins; otherwise the
 * song's existing tags are mapped. That ordering is what lets two hundred and
 * thirty songs gain skills without editing any of them, while still allowing a
 * per-song correction when the tags are wrong.
 *
 * Unknown skill ids are dropped rather than invented, so a typo in the
 * catalogue shows up as a missing skill and never as a new one.
 */
export function skillIdsForSong(song = {}) {
  const explicit = Array.isArray(song?.skills) ? song.skills : null;
  const source = explicit
    ? explicit.map(clean)
    : [
      ...(Array.isArray(song?.tags) ? song.tags : [])
        .flatMap((tag) => TAG_SKILLS[clean(tag).toLowerCase()] || TAG_SKILLS[clean(tag)] || []),
      // Structural, not inferred: a catalogue entry whose contentType is
      // `scale` teaches scales by definition. Twenty-nine of these carry only
      // the filing tag "technical" and would otherwise show nothing.
      // Deliberately the ONLY rule of its kind — `exercise` covers riffs,
      // chords and technique alike, and guessing a skill from a title or a
      // tutor note would manufacture confident wrong data at catalogue scale.
      ...(clean(song?.contentType) === 'scale' ? ['scales'] : []),
    ];

  const seen = new Set();
  for (const id of source) {
    if (SONG_SKILLS[id]) seen.add(id);
  }
  return [...seen];
}

/**
 * The same skills as display objects, grouped for a card: `[{ area, label,
 * skills: [{ id, label }] }]`. Areas keep the order declared in SKILL_AREAS so
 * technique reads before expression on every card.
 */
export function skillsForSong(song = {}) {
  const ids = skillIdsForSong(song);
  if (!ids.length) return [];

  const byArea = new Map();
  for (const id of ids) {
    const skill = SONG_SKILLS[id];
    if (!byArea.has(skill.area)) byArea.set(skill.area, []);
    byArea.get(skill.area).push({ id, label: skill.label });
  }

  return Object.entries(SKILL_AREAS)
    .filter(([area]) => byArea.has(area))
    .map(([area, label]) => ({
      area,
      label,
      skills: byArea.get(area).sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/**
 * Flat labels, for anywhere a card only has room for one line.
 */
export function skillLabelsForSong(song = {}) {
  return skillIdsForSong(song)
    .map((id) => SONG_SKILLS[id].label)
    .sort((a, b) => a.localeCompare(b));
}

// How many songs teach each skill, counted once over the catalogue.
function countSongsPerSkill(catalogue) {
  const counts = new Map();
  for (const song of Object.values(catalogue)) {
    for (const id of skillIdsForSong(song)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

let catalogueSkillCounts = null;

/**
 * The few skills worth a chip on a song card, rarest first.
 *
 * Alphabetical cards led with whatever sorted first, and the skills most songs
 * share (steady pulse, dynamics, strumming, open chords — each on thirty-odd
 * songs) filled every card without telling one song from another. Ranking by
 * how few songs teach a skill puts what is distinctive about *this* song first;
 * the full list stays available through `skillLabelsForSong`.
 */
export function cardSkillLabelsForSong(song = {}, { limit = 3, catalogue = null } = {}) {
  const counts = catalogue
    ? countSongsPerSkill(catalogue)
    : (catalogueSkillCounts ??= countSongsPerSkill(SONGS_CATALOGUE));
  return skillIdsForSong(song)
    .map((id) => ({ label: SONG_SKILLS[id].label, count: counts.get(id) || 0 }))
    .sort((a, b) => a.count - b.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ label }) => label);
}

/**
 * Where the skill layer is thin, so the gaps can be filled deliberately rather
 * than discovered by a tutor seeing an empty card. Reports songs with no
 * skills, tags nobody has classified either way, and skills no song teaches.
 */
export function buildSkillCoverage(catalogue = SONGS_CATALOGUE) {
  const entries = Object.entries(catalogue);
  const songsWithoutSkills = [];
  const unclassifiedTags = new Map();
  const skillUse = new Map(Object.keys(SONG_SKILLS).map((id) => [id, 0]));

  for (const [songId, song] of entries) {
    const ids = skillIdsForSong(song);
    if (!ids.length) {
      songsWithoutSkills.push({ songId, title: clean(song?.title), tags: song?.tags || [] });
    }
    for (const id of ids) skillUse.set(id, skillUse.get(id) + 1);

    for (const rawTag of (Array.isArray(song?.tags) ? song.tags : [])) {
      const tag = clean(rawTag);
      const known = TAG_SKILLS[tag.toLowerCase()] || TAG_SKILLS[tag] || NON_SKILL_TAGS.has(tag);
      if (!known) unclassifiedTags.set(tag, (unclassifiedTags.get(tag) || 0) + 1);
    }
  }

  // Per instrument, because a healthy total can hide an empty shelf. Tagging
  // was done instrument by instrument, so the first version of this report
  // showed 41% overall while bass and electric guitar were at zero — every
  // card blank for the tutors who teach them.
  const byInstrument = new Map();
  for (const [, song] of entries) {
    const hasSkills = skillIdsForSong(song).length > 0;
    for (const instrument of (Array.isArray(song?.instruments) ? song.instruments : ['unknown'])) {
      if (!byInstrument.has(instrument)) byInstrument.set(instrument, { instrument, total: 0, withSkills: 0 });
      const entry = byInstrument.get(instrument);
      entry.total += 1;
      if (hasSkills) entry.withSkills += 1;
    }
  }

  return {
    total: entries.length,
    withSkills: entries.length - songsWithoutSkills.length,
    byInstrument: [...byInstrument.values()].sort((a, b) => b.total - a.total),
    songsWithoutSkills,
    unclassifiedTags: [...unclassifiedTags.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    unusedSkills: [...skillUse.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id),
    skillUse: [...skillUse.entries()]
      .map(([id, count]) => ({ id, label: SONG_SKILLS[id].label, area: SONG_SKILLS[id].area, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
