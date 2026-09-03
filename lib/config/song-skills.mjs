// What a song teaches, as opposed to what a song is.
//
// The catalogue already carried this. Sixty-eight distinct tags across two
// hundred and thirty songs, and roughly two thirds of them describe a skill
// rather than a category — strumming, legato, syncopation, note reading,
// hands together. Nobody had separated the teaching vocabulary from the filing
// vocabulary, so none of it could be used.
//
// This file does that separation, and it does it as a *mapping* rather than as
// a migration. No catalogue entry has to change: skills are derived from the
// tags a song already has. A song can still declare `skills` explicitly when
// the tags are wrong or missing, and that always wins.
//
// Why it matters beyond tidiness: a song is a vehicle, but the thing that
// transfers between songs is the skill. "This student has met syncopation four
// times and struggled each time" is unanswerable while the unit of knowledge is
// the song. Every difficulty-rating or sequencing idea downstream needs this
// layer to exist first.

// Broad areas, so a card can group skills instead of listing fifteen chips.
export const SKILL_AREAS = {
  technique: 'Technique',
  rhythm: 'Rhythm',
  harmony: 'Harmony',
  reading: 'Reading',
  expression: 'Expression',
};

export const SONG_SKILLS = {
  // --- technique ---
  open_chords: { label: 'Open chords', area: 'technique' },
  barre_chords: { label: 'Barre chords', area: 'technique' },
  chord_changes: { label: 'Chord changes', area: 'technique' },
  strumming: { label: 'Strumming', area: 'technique' },
  fingerpicking: { label: 'Fingerpicking', area: 'technique' },
  arpeggios: { label: 'Arpeggios', area: 'technique' },
  muting: { label: 'Muting', area: 'technique' },
  single_notes: { label: 'Single-note playing', area: 'technique' },
  scales: { label: 'Scales', area: 'technique' },
  hand_position: { label: 'Hand position', area: 'technique' },
  hands_together: { label: 'Hands together', area: 'technique' },
  hands_separately: { label: 'One hand alone', area: 'technique' },
  position_shifts: { label: 'Position shifts', area: 'technique' },
  capo: { label: 'Capo', area: 'technique' },
  evenness: { label: 'Evenness', area: 'technique' },
  // Bass and electric guitar, added 2026-08-08 when those two shelves were
  // tagged. Deliberately *not* added: palm muting (it is `muting`) and chord
  // stabs (it is `staccato` applied to chords). A skill earns its own id when a
  // tutor would work on it separately, not whenever the vocabulary differs.
  power_chords: { label: 'Power chords', area: 'technique' },
  downpicking: { label: 'Downpicking', area: 'technique' },
  slides: { label: 'Slides', area: 'technique' },
  bends: { label: 'String bends', area: 'technique' },
  vibrato: { label: 'Vibrato', area: 'technique' },
  double_stops: { label: 'Double stops', area: 'technique' },
  octaves: { label: 'Octaves', area: 'technique' },
  ghost_notes: { label: 'Ghost notes', area: 'technique' },
  stamina: { label: 'Stamina', area: 'technique' },

  // --- rhythm ---
  steady_pulse: { label: 'Steady pulse', area: 'rhythm' },
  syncopation: { label: 'Syncopation', area: 'rhythm' },
  swing_feel: { label: 'Swing feel', area: 'rhythm' },
  groove: { label: 'Groove', area: 'rhythm' },
  compound_time: { label: 'Compound time', area: 'rhythm' },
  waltz_time: { label: 'Waltz time', area: 'rhythm' },
  eighth_notes: { label: 'Eighth notes', area: 'rhythm' },
  sixteenth_notes: { label: 'Sixteenth notes', area: 'rhythm' },
  odd_metre: { label: 'Odd metre', area: 'rhythm' },
  accents: { label: 'Accents', area: 'rhythm' },
  rests_and_space: { label: 'Rests and space', area: 'rhythm' },

  // --- harmony ---
  minor_tonality: { label: 'Minor tonality', area: 'harmony' },
  chord_progressions: { label: 'Chord progressions', area: 'harmony' },
  chord_melody: { label: 'Chord melody', area: 'harmony' },
  root_and_fifth: { label: 'Roots and fifths', area: 'harmony' },
  walking_lines: { label: 'Walking lines', area: 'harmony' },
  triads: { label: 'Triads', area: 'harmony' },

  // --- reading ---
  note_reading: { label: 'Note reading', area: 'reading' },
  bass_clef: { label: 'Bass clef', area: 'reading' },
  intervals: { label: 'Intervals', area: 'reading' },
  playing_by_ear: { label: 'Playing by ear', area: 'reading' },
  sight_reading: { label: 'Sight reading', area: 'reading' },

  // --- expression ---
  dynamics: { label: 'Dynamics', area: 'expression' },
  phrasing: { label: 'Phrasing', area: 'expression' },
  legato: { label: 'Legato', area: 'expression' },
  staccato: { label: 'Staccato', area: 'expression' },
  tone: { label: 'Tone', area: 'expression' },
  improvisation: { label: 'Improvisation', area: 'expression' },
};

// Existing catalogue tag -> the skills it implies. A tag may imply more than
// one ("muted strumming" is both), which is why every value is a list.
export const TAG_SKILLS = {
  'open chords': ['open_chords'],
  'barre chords': ['barre_chords'],
  'chord changes': ['chord_changes'],
  chords: ['chord_changes'],
  'jazz chords': ['chord_changes', 'chord_progressions'],
  'minor chords': ['minor_tonality', 'chord_changes'],
  'classic progression': ['chord_progressions'],
  'chord melody': ['chord_melody'],
  strumming: ['strumming'],
  'muted strumming': ['strumming', 'muting'],
  muting: ['muting'],
  fingerpicking: ['fingerpicking'],
  'travis picking': ['fingerpicking'],
  'picking pattern': ['fingerpicking'],
  arpeggios: ['arpeggios'],
  arpeggio: ['arpeggios'],
  'broken chords': ['arpeggios'],
  'single notes': ['single_notes'],
  'riff-based': ['single_notes'],
  scales: ['scales'],
  'five-finger position': ['hand_position'],
  // `left hand` / `right hand` used to map here, which was wrong: they say
  // *which hand plays*, not where it sits. They are also ambiguous between
  // "one hand alone" (The Seabees: "Right hand only") and "this hand carries
  // the melody" (The Trombone Player: "Left-hand melody ... bring it out over
  // the right"), so no single mapping is right for both. They are filing tags
  // now, and the pieces that really are one-hand carry `hands separately`.
  'hands separately': ['hands_separately'],
  'hand position shifts': ['position_shifts'],
  leaps: ['position_shifts'],
  'hands together': ['hands_together'],
  'hands alternating': ['hands_together'],
  capo: ['capo'],
  evenness: ['evenness'],
  'repeated notes': ['evenness'],

  rhythm: ['steady_pulse'],
  'steady pulse': ['steady_pulse'],
  'steady rhythm': ['steady_pulse'],
  syncopation: ['syncopation'],
  'swing feel': ['swing_feel'],
  shuffle: ['swing_feel'],
  groove: ['groove'],
  'funk groove': ['groove'],
  'reggae feel': ['groove'],
  'compound time': ['compound_time'],
  'theory: 6/8 time': ['compound_time'],
  'waltz time': ['waltz_time'],
  'theory: eighth notes': ['eighth_notes'],

  'note reading': ['note_reading'],
  'bass clef': ['bass_clef'],
  intervals: ['intervals'],
  'by ear': ['playing_by_ear'],
  imitation: ['playing_by_ear'],

  dynamics: ['dynamics'],
  phrasing: ['phrasing'],
  'blues phrasing': ['phrasing'],
  legato: ['legato'],
  staccato: ['staccato'],
  tone: ['tone'],

  // Added with the bass / electric guitar tagging pass (2026-08-08).
  'power chords': ['power_chords'],
  'palm muting': ['muting'],
  downpicking: ['downpicking'],
  slides: ['slides'],
  bends: ['bends'],
  vibrato: ['vibrato'],
  'double stops': ['double_stops'],
  'chord stabs': ['staccato', 'chord_changes'],
  octaves: ['octaves'],
  'ghost notes': ['ghost_notes'],
  stamina: ['stamina'],
  'position shifts': ['position_shifts'],
  'eighth notes': ['eighth_notes'],
  'sixteenth notes': ['sixteenth_notes'],
  'odd metre': ['odd_metre'],
  accents: ['accents'],
  'rests and space': ['rests_and_space'],
  'root and fifth': ['root_and_fifth'],
  'walking line': ['walking_lines'],
  'minor key': ['minor_tonality'],
  triads: ['triads'],
  'sight reading': ['sight_reading', 'note_reading'],
  improvisation: ['improvisation'],
};

// Tags that are filing, not teaching: what a song *is*, where it came from, or
// what it sounds like. Kept explicit so the coverage report can tell "this tag
// is deliberately not a skill" apart from "nobody has classified this yet".
export const NON_SKILL_TAGS = new Set([
  'technical',
  'technique',
  // Which hand plays — a fact about the piece, not a skill. Kept rather than
  // deleted so the information survives; see the note in TAG_SKILLS.
  'left hand',
  'right hand',
  'exam piece',
  '2025 syllabus',
  '2026 syllabus',
  'RSL 2018 book',
  'RSL legacy book',
  'classical',
  'pop',
  'rock',
  'blues',
  'ballad',
  'singalong',
  'storytelling song',
  'solo',
]);
