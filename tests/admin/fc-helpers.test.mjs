import test from 'node:test';
import assert from 'node:assert/strict';

import { generateFcStudentId } from '../../lib/admin/fc-id.mjs';
import {
  normaliseExperienceLevel,
  normaliseInstrument,
  normaliseTeachingInstrument,
  parseInstrumentList,
} from '../../lib/admin/fc-helpers.mjs';

test('normaliseInstrument maps common aliases into canonical labels', () => {
  assert.equal(normaliseInstrument('Keyboard lessons'), 'Piano');
  assert.equal(normaliseInstrument('Uke starter'), 'Ukulele');
  assert.equal(normaliseInstrument('Electric bass'), 'Bass');
  assert.equal(normaliseInstrument('Electric Guitar lessons'), 'Electric Guitar');
  assert.equal(normaliseInstrument('Voice and performance'), 'Singing');
  assert.equal(normaliseInstrument('Acoustic Guitar'), 'Guitar');
});

test('electric guitar keeps its song-shelf identity but uses the guitar tutor lane', () => {
  assert.equal(normaliseInstrument('Electric Guitar'), 'Electric Guitar');
  assert.equal(normaliseTeachingInstrument('Electric Guitar'), 'Guitar');
  assert.equal(normaliseTeachingInstrument('Acoustic Guitar'), 'Guitar');
});

test('normaliseExperienceLevel handles user-friendly onboarding language', () => {
  assert.equal(normaliseExperienceLevel('yes'), 'has some experience');
  assert.equal(normaliseExperienceLevel('3'), 'at an intermediate level');
  assert.equal(normaliseExperienceLevel('no'), 'a complete beginner');
  assert.equal(normaliseExperienceLevel('unexpected'), 'a complete beginner');
});

// Golden value shared with first-chord-brain test_fc_ids.py. Neither repo can
// import the other, so if this fails one of them changed the formula alone —
// which is exactly how 63 students came to carry two different FC student IDs.
test('generateFcStudentId matches the brain formula for the same MMS ID', () => {
  assert.equal(generateFcStudentId('sdt_WFQ7Js'), 'fc_std_fa157fc5');
  assert.equal(generateFcStudentId(' sdt_WFQ7Js '), 'fc_std_fa157fc5');
});

test('generateFcStudentId refuses to mint without an MMS student ID', () => {
  assert.throws(() => generateFcStudentId(''), /MMS student ID/u);
  assert.throws(() => generateFcStudentId('Tyler'), /MMS student ID/u);
  // The retired name/email call shape must fail loudly, not mint a second-formula ID.
  assert.throws(() => generateFcStudentId('Tyler', 'Beaton', 'tyler@example.com'), /MMS student ID/u);
});

test('parseInstrumentList keeps every instrument a sign-up note asks for', () => {
  // The bug this exists for: normaliseInstrument checks ukulele before guitar,
  // so the whole string collapses to Ukulele and the guitar tutor the waiting
  // list suggested is not offered at onboarding.
  assert.equal(normaliseInstrument('Guitar and Ukulele'), 'Ukulele');
  assert.deepEqual(parseInstrumentList('Guitar and Ukulele'), ['Guitar', 'Ukulele']);
  assert.deepEqual(parseInstrumentList('Piano / Guitar'), ['Piano', 'Guitar']);
  assert.deepEqual(parseInstrumentList('Voice, keyboard & bass'), ['Singing', 'Piano', 'Bass']);
  assert.deepEqual(parseInstrumentList('Guitar, guitar'), ['Guitar']);
  assert.deepEqual(parseInstrumentList(''), []);
});
