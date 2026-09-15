import test from 'node:test';
import assert from 'node:assert/strict';

import { noteMarkupToHtml } from '../lib/notes-markup.mjs';
import { NOTE_MARKUP_CONTRACT } from './fixtures/note-markup-contract.mjs';

// This repository renders a tutor's note for the parent's email and the student
// portal. Practice Chat renders the same note, with its own implementation, so
// the tutor can check it before approving. Nobody sees both — so a change here
// that Practice Chat does not match means the tutor approves one thing and the
// parent receives another, with nothing to notice it.
//
// The fixture is mirrored in both repositories and each side tests only its own
// renderer, so this runs on both CIs without either needing the other checked
// out. Changing the note format is then an edit somebody has to make twice, on
// purpose, instead of a silent divergence.
function escapeHtml(value = '') {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test('every note in the shared contract renders as the contract says', () => {
  for (const { name, input, html } of NOTE_MARKUP_CONTRACT) {
    assert.equal(
      noteMarkupToHtml(input, { escape: escapeHtml, join: '' }),
      html,
      `"${name}" no longer matches the shared note-markup contract. If this change is deliberate, update tests/fixtures/note-markup-contract.mjs in BOTH repositories; otherwise the parent's email has drifted from what the tutor approved.`,
    );
  }
});

test('the contract still covers the shapes a real note is made of', () => {
  // A contract that quietly loses its cases stops protecting anything, so the
  // shapes themselves are asserted rather than just the count.
  const inputs = NOTE_MARKUP_CONTRACT.map((entry) => entry.input).join('\n');
  assert.match(inputs, /\*\*[^*]+:\*\*/u, 'no whole-line heading case');
  assert.match(inputs, /^- /mu, 'no bullet case');
  assert.match(inputs, /\[What we did\]/u, 'no bracket heading case');
  assert.match(inputs, /&/u, 'no HTML-escaping case');
  assert.ok(NOTE_MARKUP_CONTRACT.some((entry) => entry.input === ''), 'no empty-note case');
  assert.ok(NOTE_MARKUP_CONTRACT.length >= 15, 'the contract has shrunk');
});
