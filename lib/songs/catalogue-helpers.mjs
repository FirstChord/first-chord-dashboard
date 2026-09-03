/** @fileoverview Song catalogue lookups and the only place a Soundslice URL is ever derived. */
// Song catalogue helpers. The ONLY place Soundslice URLs are derived —
// nothing else may build or store a Soundslice URL from a song.
import {
  SONGS_CATALOGUE,
  SONG_INSTRUMENTS,
  SONG_LEVELS,
  SONG_CONTENT_TYPES,
  SONG_SERIES,
  DEFAULT_SONG_SERIES,
} from '../config/songs-catalogue.mjs';

// Entries omitting `series` belong to the default series (RSL).
export function seriesOf(song) {
  return song?.series || DEFAULT_SONG_SERIES;
}

export function seriesById(seriesId) {
  return SONG_SERIES.find((series) => series.id === seriesId) || null;
}

// The series that actually have songs for this instrument, in declared order —
// this is what the panel renders as tabs.
export function seriesForSongs(songs = []) {
  return SONG_SERIES.filter((series) => songs.some((song) => seriesOf(song) === series.id));
}

// A series' levels, restricted to those that actually have songs.
export function levelsForSeries(seriesId, songs = []) {
  const series = seriesById(seriesId);
  if (!series) return [];
  return series.levels.filter((level) =>
    songs.some((song) => seriesOf(song) === seriesId && song.level === level)
  );
}

export function soundsliceUrlFor(song) {
  const scorehash = song?.soundslice?.scorehash;
  return scorehash ? `https://www.soundslice.com/slices/${scorehash}/` : null;
}

// Plain shelf text for the acoustic RSL books that share a grade. These remain
// filing tags rather than skills, but tutors still need to see which book a
// piece came from. The UI deliberately renders this as text, not a badge.
export function syllabusLabelForSong(song) {
  const tags = Array.isArray(song?.tags) ? song.tags : [];
  if (tags.includes('2026 syllabus')) return 'RSL 2026 syllabus';
  if (tags.includes('RSL 2018 book')) return 'RSL 2018 book';
  if (tags.includes('RSL legacy book')) return 'RSL legacy book';
  return null;
}

// Matches a student's instrument string ('Guitar', 'Piano / Guitar', ...) against
// a song's instruments. Combo strings match if any part matches.
export function songMatchesInstrument(song, studentInstrument) {
  if (!studentInstrument) return false;
  const parts = `${studentInstrument}`.toLowerCase().split('/').map((p) => p.trim());
  return (song.instruments || []).some((songInstrument) =>
    parts.includes(songInstrument.toLowerCase())
  );
}

// Course position, for series that are taught in a fixed order (John Thompson's
// books). Songs without one sort after those with one, alphabetically — which is
// what the RSL grades want, since a grade's pieces have no prescribed order.
function orderOf(song) {
  return Number.isFinite(song.order) ? song.order : Infinity;
}

// Catalogue songs for one student's instrument, sorted by level, then course
// order where the series has one, then title.
// Returns [] for unknown/unseeded instruments so the panel can hide entirely.
export function getSongsForInstrument(studentInstrument, catalogue = SONGS_CATALOGUE) {
  return Object.entries(catalogue)
    .filter(([, song]) => songMatchesInstrument(song, studentInstrument))
    .map(([songId, song]) => ({ songId, ...song, soundsliceUrl: soundsliceUrlFor(song) }))
    .sort(
      (a, b) =>
        SONG_LEVELS.indexOf(a.level) - SONG_LEVELS.indexOf(b.level) ||
        orderOf(a) - orderOf(b) ||
        a.title.localeCompare(b.title)
    );
}

export function validateCatalogue(catalogue = SONGS_CATALOGUE) {
  const errors = [];
  const seenScorehashes = new Set();

  for (const [songId, song] of Object.entries(catalogue)) {
    const where = `${songId}`;
    if (!/^fc_song_[a-z0-9_]+$/.test(songId)) errors.push(`${where}: bad id format`);
    if (!song.title) errors.push(`${where}: missing title`);
    if (!song.artist) errors.push(`${where}: missing artist`);
    const series = seriesById(seriesOf(song));
    if (!series) {
      errors.push(`${where}: unknown series "${song.series}"`);
    } else if (!series.levels.includes(song.level)) {
      errors.push(`${where}: level "${song.level}" is not in series "${series.id}"`);
    }
    if (!SONG_CONTENT_TYPES.includes(song.contentType)) {
      errors.push(`${where}: unknown contentType "${song.contentType}"`);
    }
    if (!Array.isArray(song.instruments) || song.instruments.length === 0) {
      errors.push(`${where}: instruments must be a non-empty array`);
    } else {
      for (const instrument of song.instruments) {
        if (!SONG_INSTRUMENTS.includes(instrument)) {
          errors.push(`${where}: unknown instrument "${instrument}"`);
        }
      }
    }
    const scorehash = song.soundslice?.scorehash;
    if (!scorehash) {
      errors.push(`${where}: missing soundslice.scorehash`);
    } else if (seenScorehashes.has(scorehash)) {
      errors.push(`${where}: duplicate scorehash "${scorehash}"`);
    } else {
      seenScorehashes.add(scorehash);
    }
  }
  return errors;
}

// The catalogue ships in the client bundle, so student names must never appear.
export function findNameLeaks(firstNames, catalogue = SONGS_CATALOGUE) {
  const leaks = [];
  const names = firstNames.map((n) => `${n}`.toLowerCase()).filter((n) => n.length >= 3);
  for (const [songId, song] of Object.entries(catalogue)) {
    const text = `${song.title} ${song.tutorNote || ''} ${song.studentNote || ''}`.toLowerCase();
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`).test(text)) leaks.push(`${songId}: contains "${name}"`);
    }
  }
  return leaks;
}
