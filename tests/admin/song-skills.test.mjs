import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSkillCoverage,
  skillIdsForSong,
  cardSkillLabelsForSong,
  skillLabelsForSong,
  skillsForSong,
} from '../../lib/songs/skills-helpers.mjs';
import { SONGS_CATALOGUE } from '../../lib/config/songs-catalogue.mjs';
import {
  NON_SKILL_TAGS,
  SKILL_AREAS,
  SONG_SKILLS,
  TAG_SKILLS,
} from '../../lib/config/song-skills.mjs';

test('skills come from the tags a song already has', () => {
  assert.deepEqual(
    skillIdsForSong({ tags: ['open chords', 'strumming'] }).sort(),
    ['open_chords', 'strumming'],
  );
});

test('one tag may imply more than one skill', () => {
  assert.deepEqual(
    skillIdsForSong({ tags: ['muted strumming'] }).sort(),
    ['muting', 'strumming'],
  );
});

test('filing tags contribute no skills', () => {
  assert.deepEqual(skillIdsForSong({ tags: ['exam piece', '2025 syllabus', 'classical'] }), []);
});

test('an explicit skills list overrides the tags', () => {
  assert.deepEqual(
    skillIdsForSong({ tags: ['strumming'], skills: ['syncopation'] }),
    ['syncopation'],
  );
});

test('an unknown skill id is dropped rather than invented', () => {
  assert.deepEqual(skillIdsForSong({ skills: ['syncopation', 'not_a_real_skill'] }), ['syncopation']);
});

test('a scale entry teaches scales without needing a tag', () => {
  assert.deepEqual(skillIdsForSong({ contentType: 'scale', tags: ['technical'] }), ['scales']);
});

test('an exercise gets no skill guessed for it', () => {
  // `exercise` covers riffs, chords and technique alike, so there is nothing
  // safe to infer. This is the guard against manufacturing confident data.
  assert.deepEqual(skillIdsForSong({ contentType: 'exercise', tags: ['technical'] }), []);
});

test('duplicate tags collapse to one skill', () => {
  assert.deepEqual(skillIdsForSong({ tags: ['arpeggios', 'arpeggio', 'broken chords'] }), ['arpeggios']);
});

test('a song with nothing to say returns nothing rather than an empty group', () => {
  assert.deepEqual(skillsForSong({ tags: [] }), []);
  assert.deepEqual(skillLabelsForSong({}), []);
});

test('skills group by area in the declared order', () => {
  const groups = skillsForSong({ tags: ['dynamics', 'strumming', 'syncopation'] });
  assert.deepEqual(groups.map((group) => group.area), ['technique', 'rhythm', 'expression']);
  assert.deepEqual(groups[0].skills, [{ id: 'strumming', label: 'Strumming' }]);
});

test('labels come back sorted so cards read consistently', () => {
  assert.deepEqual(
    skillLabelsForSong({ tags: ['strumming', 'dynamics', 'capo'] }),
    ['Capo', 'Dynamics', 'Strumming'],
  );
});

// --- vocabulary integrity ------------------------------------------------

test('every skill belongs to a declared area', () => {
  for (const [id, skill] of Object.entries(SONG_SKILLS)) {
    assert.ok(SKILL_AREAS[skill.area], `${id} has unknown area "${skill.area}"`);
    assert.ok(skill.label, `${id} has no label`);
  }
});

test('every tag mapping points at a real skill', () => {
  for (const [tag, ids] of Object.entries(TAG_SKILLS)) {
    for (const id of ids) {
      assert.ok(SONG_SKILLS[id], `tag "${tag}" maps to unknown skill "${id}"`);
    }
  }
});

test('no tag is both a skill and filing', () => {
  for (const tag of Object.keys(TAG_SKILLS)) {
    assert.equal(NON_SKILL_TAGS.has(tag), false, `"${tag}" is classified twice`);
  }
});

test('every catalogue tag is classified as either a skill or filing', () => {
  // The point of the split is that "not yet classified" is visible. If this
  // fails, a new tag arrived with the last batch of songs and needs a home in
  // song-skills.mjs — see `node scripts/song-skills-report.mjs`.
  const { unclassifiedTags } = buildSkillCoverage();
  assert.deepEqual(
    unclassifiedTags.map((entry) => entry.tag),
    [],
    'unclassified catalogue tags found',
  );
});

test('the real catalogue produces skills for a meaningful share of songs', () => {
  const coverage = buildSkillCoverage(SONGS_CATALOGUE);
  assert.equal(coverage.total, Object.keys(SONGS_CATALOGUE).length);
  assert.ok(
    coverage.withSkills >= 120,
    `expected at least 120 songs with skills, got ${coverage.withSkills}`,
  );
});

// Instruments whose songs carry no skill tags yet, so every card is blank for
// the tutors who teach them. Tagging happened instrument by instrument and
// these were never done. Not a design decision — a backlog, written down so it
// stays loud. **Remove an instrument from this set as soon as it is tagged;**
// the test below fails either way, whether a listed instrument is still empty
// when it should not be or has quietly been fixed without updating this.
//
// Emptied 2026-08-08: Bass (93%) and Electric Guitar (90%) were tagged from
// their own tutor notes. The set stays because the next bulk-seeded shelf will
// arrive in exactly the same state — the pipeline emits `tags: []` for every
// song it ingests, so an untagged shelf is the default, not an accident.
const INSTRUMENTS_WITHOUT_SKILLS = new Set([]);

test('no instrument silently shows a blank skill layer to its tutors', () => {
  // A healthy total hides an empty shelf: this shipped at 41% overall with bass
  // and electric guitar at zero, so the tutors who teach them saw nothing on
  // any card. A tutor looks at one instrument, so that is the unit coverage has
  // to be judged in — never the catalogue-wide average.
  const { byInstrument } = buildSkillCoverage(SONGS_CATALOGUE);
  assert.ok(byInstrument.length >= 3, 'expected several instruments');

  for (const row of byInstrument) {
    if (row.total < 20) continue; // too small a shelf to conclude anything
    if (INSTRUMENTS_WITHOUT_SKILLS.has(row.instrument)) {
      assert.equal(
        row.withSkills,
        0,
        `${row.instrument} now has skills — remove it from INSTRUMENTS_WITHOUT_SKILLS`,
      );
      continue;
    }
    assert.ok(
      row.withSkills > 0,
      `${row.instrument} has ${row.total} songs and no skills at all, so its tutors see a blank `
      + 'card every time. Tag some of them (node scripts/song-skills-report.mjs) or add it to '
      + 'INSTRUMENTS_WITHOUT_SKILLS with a reason.',
    );
  }
});

test('cards show the rarest skills first and at most three of them', () => {
  const catalogue = {
    a: { tags: ['strumming', 'dynamics'] },
    b: { tags: ['strumming', 'dynamics'] },
    c: { tags: ['strumming', 'syncopation'] },
  };
  const song = { tags: ['strumming', 'dynamics', 'syncopation', 'swing feel'] };
  assert.deepEqual(
    cardSkillLabelsForSong(song, { catalogue }),
    ['Swing feel', 'Syncopation', 'Dynamics'],
  );
});
