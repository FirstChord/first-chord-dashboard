import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTE_SECTION_CONTRACT } from '../fixtures/note-sections-contract.mjs';
import { parsePracticeNoteSections } from '../../lib/admin/practice-notes-helpers.mjs';

// The dashboard's half of the contract: the labels Practice Chat writes are the
// labels this side splits the parent email on. See the fixture for why.

test('a note written with the contracted labels splits into its three sections', () => {
  const sections = parsePracticeNoteSections(NOTE_SECTION_CONTRACT.sampleNote);
  for (const [key, value] of Object.entries(NOTE_SECTION_CONTRACT.sections)) {
    assert.equal(`${sections[key] || ''}`.trim(), value, key);
  }
});

test('each contracted label is recognised on its own', () => {
  const keys = ['whatWeDid', 'progressChallenges', 'practiceGoals'];
  NOTE_SECTION_CONTRACT.labels.forEach((label, index) => {
    const sections = parsePracticeNoteSections(`${label}\nBody text.`);
    assert.equal(`${sections[keys[index]] || ''}`.trim(), 'Body text.', label);
  });
});
