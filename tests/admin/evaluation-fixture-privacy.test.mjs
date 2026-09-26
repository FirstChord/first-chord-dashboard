import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INCOMING_MESSAGE_ACTIONABILITY,
  INCOMING_MESSAGE_CATEGORIES,
  INCOMING_MESSAGE_STATUSES,
} from '../../lib/admin/incoming-message-helpers.mjs';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/incoming-eval-set.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const allCases = [...fixture.messages, ...fixture.actionabilityCases, ...fixture.proposalCases];

const PROHIBITED_KEYS = new Set([
  'sentAt',
  'messageAt',
  'capturedAt',
  'senderName',
  'senderPhone',
  'chatId',
  'externalMessageId',
  'mmsId',
  'rawJson',
]);

test('incoming evaluation fixture declares synthetic independent provenance', () => {
  assert.equal(fixture.schemaVersion, 4);
  assert.equal(fixture.dataOrigin, 'synthetic_independent_cases');
  assert.match(fixture.description, /synthetic, independent/iu);
  assert.doesNotMatch(fixture.description, /real family|anonymised|chat export/iu);
});

test('incoming evaluation fixture has broad independent category coverage', () => {
  const counts = new Map();
  const ids = new Set();

  for (const message of fixture.messages) {
    assert.ok(!ids.has(message.id), `duplicate case id ${message.id}`);
    ids.add(message.id);
    counts.set(message.label, (counts.get(message.label) || 0) + 1);
  }

  assert.ok(fixture.messages.length >= 45);
  for (const category of INCOMING_MESSAGE_CATEGORIES) {
    assert.ok((counts.get(category) || 0) >= 4, `${category} has fewer than four cases`);
  }
  assert.ok(fixture.proposalCases.length >= 6);
  assert.ok(fixture.actionabilityCases.length >= 18);
  for (const entry of fixture.actionabilityCases) {
    assert.ok(
      INCOMING_MESSAGE_ACTIONABILITY.includes(entry.expectedActionability),
      `${entry.id} has an invalid actionability expectation`,
    );
    assert.ok(INCOMING_MESSAGE_STATUSES.includes(entry.expectedStatus), `${entry.id} has no valid capture expectation`);
    if (entry.expectedCategory) assert.ok(INCOMING_MESSAGE_CATEGORIES.includes(entry.expectedCategory), entry.id);
  }
  assert.ok(fixture.proposalCases.some((entry) => /ignore previous instructions/iu.test(entry.text)));
  assert.ok(fixture.messages.some((entry) => /rechargeable/iu.test(entry.text)));
  assert.ok(fixture.messages.some((entry) => /I will/iu.test(entry.text)));
});

test('incoming evaluation cases contain no source identifiers or obvious personal data', () => {
  for (const entry of allCases) {
    assert.ok(entry.id, 'every evaluation case needs a synthetic id');
    assert.ok(`${entry.text || ''}`.length <= 320, `${entry.id} contains unnecessarily long text`);

    for (const key of Object.keys(entry)) {
      assert.ok(!PROHIBITED_KEYS.has(key), `${entry.id} contains prohibited source field ${key}`);
    }

    const serialised = JSON.stringify(entry);
    assert.doesNotMatch(serialised, /https?:\/\//iu, `${entry.id} contains a URL`);
    assert.doesNotMatch(serialised, /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu, `${entry.id} contains an email`);
    assert.doesNotMatch(serialised, /(?:\+?44\s?7|\b07)\d(?:[\s-]?\d){8}\b/u, `${entry.id} contains a UK phone number`);
    assert.doesNotMatch(serialised, /\b(?:cus|sub|sdt)_[A-Za-z0-9]+\b/u, `${entry.id} contains a provider identifier`);
    assert.doesNotMatch(serialised, /\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}/u, `${entry.id} contains an exported chat timestamp`);

    const identityTokens = `${entry.text || ''}`.match(/\[[A-Z_]+\]/gu) || [];
    for (const token of identityTokens) {
      assert.match(token, /^\[(?:STUDENT|PARENT|TUTOR)_[A-Z]\]$/u, `${entry.id} contains an unapproved identity token ${token}`);
    }
  }
});

test('ambiguity cases require explicit abstention metadata', () => {
  for (const entry of fixture.proposalCases) {
    assert.equal(typeof entry.expected?.mustAbstain, 'boolean', `${entry.id} has no abstention expectation`);
    assert.ok(Array.isArray(entry.expected?.ambiguityFlags), `${entry.id} has no ambiguity flag list`);
    if (entry.expected.mustAbstain) {
      assert.ok(entry.expected.ambiguityFlags.length > 0, `${entry.id} abstains without a reason`);
    }
  }
});
