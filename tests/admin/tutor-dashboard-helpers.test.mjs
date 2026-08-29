import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTutorTeacherIdMap,
  filterTutorStudentsBySearch,
  getTutorDashboardOptionNames,
  getTutorDashboardOptions,
  resolveTutorTeacherId,
  stripDuplicatePracticeGoals,
} from '../../lib/tutor-dashboard-helpers.mjs';
import { ADMIN_TUTORS } from '../../lib/admin/tutors-data.js';

const SAMPLE_TUTORS = {
  'Eléna': {
    fullName: 'Eléna Esposito',
    teacherId: 'tch_elena',
    instruments: ['piano'],
  },
  'Calum': {
    fullName: 'Calum Steel',
    teacherId: 'tch_calum',
    instruments: ['guitar'],
  },
};

test('canonical tutor identities keep unique MMS IDs and include registered arrivals', () => {
  const teacherIds = Object.values(ADMIN_TUTORS).map((tutor) => tutor.teacherId);

  assert.equal(new Set(teacherIds).size, teacherIds.length);
  assert.deepEqual(ADMIN_TUTORS.Matthew, {
    fullName: 'Matthew Leung',
    fcTutorId: 'fc_tut_c5f0ea5e',
    teacherId: 'tch_zLY8Jn',
    instruments: ['piano'],
  });
  assert.deepEqual(ADMIN_TUTORS.Hamish, {
    fullName: 'Hamish Roberts',
    fcTutorId: 'fc_tut_ec272a25',
    teacherId: 'tch_zLnnJw',
    instruments: ['guitar'],
  });

  const fcTutorIds = Object.values(ADMIN_TUTORS).map((tutor) => tutor.fcTutorId);
  assert.equal(new Set(fcTutorIds).size, fcTutorIds.length);
  assert.ok(fcTutorIds.every((fcTutorId) => /^fc_tut_[a-f0-9]{8}$/u.test(fcTutorId)));
});

test('getTutorDashboardOptions exposes stable short-name tutor options', () => {
  const options = getTutorDashboardOptions(SAMPLE_TUTORS);

  assert.deepEqual(options, [
    {
      shortName: 'Eléna',
      fullName: 'Eléna Esposito',
      teacherId: 'tch_elena',
      instruments: ['piano'],
    },
    {
      shortName: 'Calum',
      fullName: 'Calum Steel',
      teacherId: 'tch_calum',
      instruments: ['guitar'],
    },
  ]);
  assert.deepEqual(getTutorDashboardOptionNames(SAMPLE_TUTORS), ['Eléna', 'Calum']);
});

test('resolveTutorTeacherId handles short names, full names, lowercase, and accents', () => {
  const map = buildTutorTeacherIdMap(SAMPLE_TUTORS);

  assert.equal(map['Eléna'], 'tch_elena');
  assert.equal(map['Eléna Esposito'], 'tch_elena');
  assert.equal(resolveTutorTeacherId('Eléna', SAMPLE_TUTORS), 'tch_elena');
  assert.equal(resolveTutorTeacherId('Eléna Esposito', SAMPLE_TUTORS), 'tch_elena');
  assert.equal(resolveTutorTeacherId('elena', SAMPLE_TUTORS), 'tch_elena');
  assert.equal(resolveTutorTeacherId('calum steel', SAMPLE_TUTORS), 'tch_calum');
  assert.equal(resolveTutorTeacherId('Unknown', SAMPLE_TUTORS), '');
});

test('filterTutorStudentsBySearch matches names and instruments without mutating empty searches', () => {
  const students = [
    {
      name: 'Alex Chang',
      instrument: 'Guitar',
    },
    {
      name: 'Sian Malyin',
      instrument: 'Singing',
    },
  ];

  assert.equal(filterTutorStudentsBySearch(students, ''), students);
  assert.deepEqual(filterTutorStudentsBySearch(students, 'alex'), [students[0]]);
  assert.deepEqual(filterTutorStudentsBySearch(students, 'sing'), [students[1]]);
});

const NOTE_TEXT = `**What we did:**
Worked on the F chord changes.

**Progress & Challenges:**
Still buzzing on the high strings.

**Practice Goals:**
Practise the F chord change slowly at home.`;

test('stripDuplicatePracticeGoals removes the goals section when it matches the focus text', () => {
  const result = stripDuplicatePracticeGoals(NOTE_TEXT, 'Practise the F chord change slowly at home.');
  assert.doesNotMatch(result, /Practice Goals/u);
  assert.doesNotMatch(result, /slowly at home/u);
  assert.match(result, /What we did/u);
  assert.match(result, /Progress & Challenges/u);
});

test('stripDuplicatePracticeGoals ignores whitespace differences when matching', () => {
  const result = stripDuplicatePracticeGoals(NOTE_TEXT, '  Practise the F chord\nchange slowly at home. ');
  assert.doesNotMatch(result, /Practice Goals/u);
});

test('stripDuplicatePracticeGoals never removes a non-matching goals section', () => {
  const result = stripDuplicatePracticeGoals(NOTE_TEXT, 'Completely different goals text.');
  assert.equal(result, NOTE_TEXT);
});

test('stripDuplicatePracticeGoals leaves notes without a goals heading untouched', () => {
  const mmsNote = 'Plain MMS note with no section headings at all.';
  assert.equal(stripDuplicatePracticeGoals(mmsNote, 'anything'), mmsNote);
});

test('stripDuplicatePracticeGoals is a no-op without focus text', () => {
  assert.equal(stripDuplicatePracticeGoals(NOTE_TEXT, ''), NOTE_TEXT);
});

test('stripDuplicatePracticeGoals only removes the goals section when it is mid-note', () => {
  const reordered = `**Practice Goals:**\nDo the scales.\n\n**What we did:**\nScales and a new song.`;
  const result = stripDuplicatePracticeGoals(reordered, 'Do the scales.');
  assert.doesNotMatch(result, /Practice Goals/u);
  assert.match(result, /What we did/u);
  assert.match(result, /Scales and a new song/u);
});
