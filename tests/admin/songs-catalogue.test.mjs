import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SONGS_CATALOGUE, SONG_LEVELS, SONG_INSTRUMENTS } from '../../lib/config/songs-catalogue.mjs';
import {
  soundsliceUrlFor,
  songMatchesInstrument,
  getSongsForInstrument,
  syllabusLabelForSong,
  validateCatalogue,
  findNameLeaks,
} from '../../lib/songs/catalogue-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('catalogue passes validation', () => {
  assert.deepEqual(validateCatalogue(), []);
});

// Reviewed false positives: song titles that legitimately contain a word matching
// a student's first name. Add here ONLY after confirming the match is coincidental.
const NAME_LEAK_EXCEPTIONS = new Set([
  'fc_song_cat_and_mouse: contains "cat"', // RSL Classical Piano G1 exam piece title
  'fc_song_kiss_from_a_rose: contains "rose"', // Seal, RSL Acoustic Grade 6 exam piece
]);

test('catalogue contains no student first names (ships in the client bundle)', () => {
  const registrySource = fs.readFileSync(
    path.join(here, '../../lib/config/students-registry.js'),
    'utf8'
  );
  const firstNames = [...registrySource.matchAll(/firstName:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(firstNames.length > 100, 'registry first names should be extractable');
  const leaks = findNameLeaks(firstNames).filter((leak) => !NAME_LEAK_EXCEPTIONS.has(leak));
  assert.deepEqual(leaks, []);
});

test('soundslice URLs are derived from scorehash only', () => {
  assert.equal(
    soundsliceUrlFor({ soundslice: { scorehash: 'Yvmfc' } }),
    'https://www.soundslice.com/slices/Yvmfc/'
  );
  assert.equal(soundsliceUrlFor({}), null);
  assert.equal(soundsliceUrlFor(null), null);
});

test('syllabus filing tags become plain shelf labels', () => {
  assert.equal(syllabusLabelForSong({ tags: ['2026 syllabus'] }), 'RSL 2026 syllabus');
  assert.equal(syllabusLabelForSong({ tags: ['RSL 2018 book'] }), 'RSL 2018 book');
  assert.equal(syllabusLabelForSong({ tags: ['RSL legacy book'] }), 'RSL legacy book');
  assert.equal(syllabusLabelForSong({ tags: ['exam piece'] }), null);
  assert.equal(syllabusLabelForSong(null), null);
});

test('RSL Acoustic 2026 intake is complete for every populated Soundslice list', () => {
  const songs = Object.entries(SONGS_CATALOGUE)
    .filter(([songId]) => songId.startsWith('fc_song_ac26_'))
    .map(([, song]) => song);

  assert.equal(songs.length, 25);
  assert.ok(songs.every((song) => song.instruments.length === 1 && song.instruments[0] === 'Guitar'));
  assert.ok(songs.every((song) => song.contentType === 'song'));
  assert.ok(songs.every((song) => song.tags.includes('2026 syllabus')));

  const countsByList = Object.groupBy(songs, (song) => song.soundslice.sourceListId);
  assert.deepEqual(
    Object.fromEntries(Object.entries(countsByList).map(([listId, rows]) => [listId, rows.length])),
    { CZZG7: 9, '5ZZG7': 9, LZZG7: 4, '3JZG7': 2, '-BwG7': 1 }
  );

  const populatedLevels = new Set(songs.map((song) => song.level));
  const olderAcousticSongs = Object.entries(SONGS_CATALOGUE)
    .filter(([songId, song]) =>
      !songId.startsWith('fc_song_ac26_') &&
      song.contentType === 'song' &&
      song.instruments.length === 1 &&
      song.instruments[0] === 'Guitar' &&
      populatedLevels.has(song.level)
    )
    .map(([, song]) => song);
  assert.ok(
    olderAcousticSongs.every((song) =>
      song.tags.includes('RSL legacy book') || song.tags.includes('RSL 2018 book')
    ),
    'older acoustic songs sharing a shelf with 2026 pieces must identify their book'
  );
});

test('instrument matching handles combo instrument strings', () => {
  const guitarSong = { instruments: ['Guitar'] };
  assert.equal(songMatchesInstrument(guitarSong, 'Guitar'), true);
  assert.equal(songMatchesInstrument(guitarSong, 'Piano / Guitar'), true);
  assert.equal(songMatchesInstrument(guitarSong, 'guitar'), true);
  assert.equal(songMatchesInstrument(guitarSong, 'Piano'), false);
  assert.equal(songMatchesInstrument(guitarSong, ''), false);
  assert.equal(songMatchesInstrument(guitarSong, undefined), false);
});

test('getSongsForInstrument returns guitar songs sorted by level then title', () => {
  const songs = getSongsForInstrument('Guitar');
  assert.ok(songs.length >= 10, 'seed catalogue should have 10+ guitar songs');
  const levelIndexes = songs.map((s) => SONG_LEVELS.indexOf(s.level));
  for (let i = 1; i < levelIndexes.length; i += 1) {
    assert.ok(levelIndexes[i] >= levelIndexes[i - 1], 'levels must be in SONG_LEVELS order');
    if (levelIndexes[i] === levelIndexes[i - 1]) {
      assert.ok(
        songs[i].title.localeCompare(songs[i - 1].title) >= 0,
        'titles sorted within a level'
      );
    }
  }
  for (const song of songs) {
    assert.match(song.soundsliceUrl, /^https:\/\/www\.soundslice\.com\/slices\/[\w-]+\/$/);
    assert.ok(song.songId.startsWith('fc_song_'));
  }
});

test('a course series is shelved in course order, not alphabetically', () => {
  // John Thompson's books are taught in sequence: The Train is #1 and must lead,
  // even though alphabetically it would sit near the end.
  const book1 = getSongsForInstrument('Piano').filter((s) => s.level === 'Book 1');
  assert.ok(book1.length > 10, 'Book 1 should be seeded');
  assert.equal(book1[0].title, 'The Train');
  const orders = book1.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'shelf follows course order');
  assert.deepEqual(orders, Array.from({ length: orders.length }, (_, i) => i + 1), 'no gaps');
});

test('bass students get a shelf of their own, not the guitar one', () => {
  const bass = getSongsForInstrument('Bass');
  assert.ok(bass.length > 30, 'bass should be seeded from the RSL Bass grade lists');

  // The bug this guards: bass students used to see an empty Song panel because the
  // catalogue had no bass entries at all, while the shelf filters strictly on instrument.
  const guitar = new Set(getSongsForInstrument('Guitar').map((s) => s.songId));
  assert.ok(
    bass.every((song) => !guitar.has(song.songId)),
    'bass repertoire must not be guitar repertoire'
  );

  // A beginner needs a rung below Grade 1 to start on.
  assert.ok(bass.some((s) => s.level === 'Debut'), 'bass needs a Debut level');
  assert.ok(bass.some((s) => s.level === 'Grade 6'), 'bass runs up to Grade 6');
});

test('electric guitar is its own instrument, not a spelling of Guitar', () => {
  const electric = getSongsForInstrument('Electric Guitar');
  assert.ok(electric.length > 30, 'electric should be seeded from the RSL Electric lists');

  // 'Electric Guitar' matches no acoustic song — the shelf compares the whole string,
  // which is exactly why these students saw an empty panel before the repertoire landed.
  const acoustic = new Set(getSongsForInstrument('Guitar').map((s) => s.songId));
  assert.ok(electric.every((s) => !acoustic.has(s.songId)), 'electric is not acoustic');

  // Every instrument a student can hold must appear in SONG_INSTRUMENTS, or its owner
  // gets a silently empty shelf.
  assert.ok(SONG_INSTRUMENTS.includes('Electric Guitar'));
});

// Instruments a student can hold that deliberately have NO repertoire yet. Every one of
// these is a person opening the Song panel to an empty shelf, so the list must be an
// explicit, reviewed decision — never something that creeps in unnoticed. This test is
// the guard for the bug we shipped twice: bass, then electric guitar, both had students
// and no songs, and nothing anywhere said so.
const INSTRUMENTS_WITHOUT_REPERTOIRE = new Set([
  'Voice',
  'Singing',
  'Ukulele',
  'Ukulele Orchestra',
]);

test('no student holds an instrument the catalogue has never heard of', () => {
  const registrySource = fs.readFileSync(
    path.join(here, '../../lib/config/students-registry.js'),
    'utf8'
  );
  const held = new Set(
    [...registrySource.matchAll(/instrument:\s*'([^']*)'/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      // A combo ("Piano / Guitar") is satisfied by any one of its parts.
      .flatMap((value) => value.split('/').map((part) => part.trim()))
  );

  const unknown = [...held].filter(
    (instrument) =>
      !SONG_INSTRUMENTS.includes(instrument) && !INSTRUMENTS_WITHOUT_REPERTOIRE.has(instrument)
  );
  assert.deepEqual(
    unknown,
    [],
    'these students get an empty Song panel: either seed repertoire for the instrument, ' +
      'or add it to INSTRUMENTS_WITHOUT_REPERTOIRE to say so on purpose'
  );

  // And the converse: an instrument we seeded but nobody holds is dead weight worth knowing about.
  for (const instrument of SONG_INSTRUMENTS) {
    assert.ok(
      getSongsForInstrument(instrument).length > 0,
      `${instrument} is in SONG_INSTRUMENTS but has no songs`
    );
  }
});

test("artist 'RSL' is only used where RSL really is the artist", () => {
  // 'RSL' means two things: the needs-curation marker, AND the true artist of a
  // Rockschool Original (a piece written for the syllabus, which has no other artist).
  // Piano was ingested before that distinction existed, and 13 of its 26 markers turned
  // out to be plain wrong — Danny is Daniel Rosenfeld's, Arcadia is Lana Del Rey's.
  // These are the pieces verified against the official RSL syllabus pages as genuine
  // Originals. Anything else carrying 'RSL' has not been checked.
  const VERIFIED_RSL_ORIGINALS = new Set([
    // Piano (Rock School 2025)
    'Piano:Home To Philadelphia', 'Piano:Vanishing Footprints', 'Piano:Short Fuse',
    'Piano:Midnight Song', 'Piano:Step By Step', 'Piano:Circus Waltz', 'Piano:Ignite',
    'Piano:Le Noche En Havana', 'Piano:Cinnamon Roll', 'Piano:Elevator Shoes',
    'Piano:Get Going', 'Piano:Contemplation', 'Piano:Camden Square',
    // Bass
    'Bass:Noisy Neighbour', 'Bass:Do Balanco', 'Bass:Slam Dunk Funk',
    // Electric guitar
    'Electric Guitar:Route 66', 'Electric Guitar:Cashville', 'Electric Guitar:Helicopter',
    'Electric Guitar:Headline Act', "Electric Guitar:Just Don't Know", 'Electric Guitar:Overrated',
    // Acoustic guitar (RSL 2026 syllabus) — verified against the per-grade
    // rslawards.com product pages, which group Originals separately from covers.
    'Guitar:Route 66', 'Guitar:Runaway Road', 'Guitar:Pocket Change',
    'Guitar:Call Across the Mountain', 'Guitar:Ignite', 'Guitar:Toledo Sun',
  ]);

  const unverified = Object.values(SONGS_CATALOGUE)
    .filter((song) => song.artist === 'RSL' && song.contentType === 'song')
    .flatMap((song) => song.instruments.map((instrument) => `${instrument}:${song.title}`))
    .filter((key) => !VERIFIED_RSL_ORIGINALS.has(key));

  assert.deepEqual(
    unverified,
    [],
    "these songs claim RSL as their artist but nobody has confirmed they are Rockschool " +
      'Originals — verify against the official RSL syllabus page (it groups covers ' +
      'separately from Originals), then add them to VERIFIED_RSL_ORIGINALS'
  );

  // Technical exercises are RSL's own material and need no such check.
});

test('getSongsForInstrument returns [] for unseeded instruments', () => {
  assert.deepEqual(getSongsForInstrument('Ukulele Orchestra'), []);
  assert.deepEqual(getSongsForInstrument('Voice'), []);
  assert.deepEqual(getSongsForInstrument(undefined), []);
});

test('validateCatalogue catches bad entries', () => {
  const bad = {
    'not-an-fc-id': {
      title: '',
      artist: '',
      instruments: ['Theremin'],
      level: 'Grade 9',
      contentType: 'vibes',
      soundslice: {},
    },
    fc_song_dupe_a: { title: 'A', artist: 'B', instruments: ['Guitar'], level: 'Debut', contentType: 'song', soundslice: { scorehash: 'xxxxx' } },
    fc_song_dupe_b: { title: 'C', artist: 'D', instruments: ['Guitar'], level: 'Debut', contentType: 'song', soundslice: { scorehash: 'xxxxx' } },
  };
  const errors = validateCatalogue(bad);
  assert.ok(errors.some((e) => e.includes('bad id format')));
  assert.ok(errors.some((e) => e.includes('missing title')));
  assert.ok(errors.some((e) => e.includes('is not in series')));
  assert.ok(errors.some((e) => e.includes('unknown contentType')));
  assert.ok(errors.some((e) => e.includes('unknown instrument')));
  assert.ok(errors.some((e) => e.includes('missing soundslice.scorehash')));
  assert.ok(errors.some((e) => e.includes('duplicate scorehash')));
});

test('a level from another series is rejected', () => {
  // 'Book 1' is a real level, but it belongs to John Thompson — not to RSL.
  const errors = validateCatalogue({
    fc_song_wrong_series: {
      title: 'X',
      artist: 'Y',
      instruments: ['Piano'],
      level: 'Book 1',
      contentType: 'song',
      soundslice: { scorehash: 'aaaaa' },
    },
  });
  assert.ok(errors.some((e) => e.includes('"Book 1" is not in series "rsl"')));
  assert.deepEqual(
    validateCatalogue({
      fc_song_right_series: {
        title: 'X',
        artist: 'Y',
        series: 'john_thompson',
        instruments: ['Piano'],
        level: 'Book 1',
        contentType: 'song',
        soundslice: { scorehash: 'aaaaa' },
      },
    }),
    []
  );
});

test('findNameLeaks flags student names in titles and notes', () => {
  const catalogue = {
    fc_song_leaky: {
      title: 'Redemption Song (Annie)',
      tutorNote: '',
      studentNote: '',
    },
  };
  assert.deepEqual(findNameLeaks(['Annie', 'Jo'], catalogue), ['fc_song_leaky: contains "annie"']);
  assert.deepEqual(findNameLeaks(['Annie'], SONGS_CATALOGUE).length >= 0, true);
});
