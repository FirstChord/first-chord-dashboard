import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWaitingLearnerSummary,
  formatWaitingDuration,
} from '../../lib/admin/waiting-card-helpers.mjs';

test('buildWaitingLearnerSummary makes an adult learner glanceable without inference or AI', () => {
  assert.deepEqual(buildWaitingLearnerSummary({
    instruments: ['Piano'],
    parsedNote: {
      age: '34',
      experience: 'Played to Grade 3 as a child',
      genres: 'Jazz and film music',
      songs: 'Merry-Go-Round of Life',
      preferredDays: 'Tuesday or Thursday',
      preferredTimes: 'Evenings',
    },
  }), {
    learnerLabel: 'Adult learner',
    instrumentPhrase: 'wants to learn Piano',
    headline: 'Adult learner · wants to learn Piano',
    facts: [
      { key: 'experience', label: 'Experience', value: 'Played to Grade 3 as a child' },
      { key: 'music', label: 'Music they like', value: 'Jazz and film music · Wants to learn: Merry-Go-Round of Life' },
      { key: 'availability', label: 'Availability', value: 'Tuesday or Thursday · Evenings' },
    ],
  });
});

test('buildWaitingLearnerSummary keeps a child age explicit and turns missing answers into call prompts', () => {
  assert.deepEqual(buildWaitingLearnerSummary({
    instruments: ['Guitar'],
    parsedNote: { age: '13', experience: 'School lessons' },
    availabilityDays: ['Friday', 'Saturday'],
    availabilityTimes: ['earlier'],
  }), {
    learnerLabel: 'Age 13',
    instrumentPhrase: 'wants to learn Guitar',
    headline: 'Age 13 · wants to learn Guitar',
    facts: [
      { key: 'experience', label: 'Experience', value: 'School lessons' },
      { key: 'music', label: 'Music they like', value: 'Not provided — ask on call' },
      { key: 'availability', label: 'Availability', value: 'Friday, Saturday · Earlier in the day' },
    ],
  });
});

test('buildWaitingLearnerSummary preserves uncertainty when age and instrument are unavailable', () => {
  const summary = buildWaitingLearnerSummary({ parsedNote: { age: 'Adult' } });

  assert.equal(summary.headline, 'Adult learner · instrument not yet clear');
  assert.equal(summary.facts[0].value, 'Not provided — ask on call');
  assert.equal(summary.facts[1].value, 'Not provided — ask on call');
  assert.equal(summary.facts[2].value, 'Not provided — ask on call');
});

test('formatWaitingDuration uses calm singular, plural and unknown labels', () => {
  assert.equal(formatWaitingDuration(1), 'Waiting 1 day');
  assert.equal(formatWaitingDuration(12), 'Waiting 12 days');
  assert.equal(formatWaitingDuration(null), 'Waiting time unknown');
});
