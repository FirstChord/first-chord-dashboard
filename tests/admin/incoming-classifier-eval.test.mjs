import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { extractDatesFromMessage } from '../../lib/admin/incoming-date-helpers.mjs';
import { buildIncomingMessageRecord, classifyIncomingMessage, decideAutoCaptureStatus } from '../../lib/admin/incoming-message-helpers.mjs';
import { createIncomingMessageCapturer } from '../../lib/admin/incoming-capture.mjs';
import {
  scoreIncomingActionability,
  scoreIncomingClassifier,
  scoreIncomingCaptureOutcomes,
  scoreIncomingDateExtraction,
  scoreIncomingProposalAbstention,
} from '../../lib/admin/incoming-eval-helpers.mjs';

// Accuracy floors against independent synthetic operational cases. If a rule
// change drops below these, run
// `node scripts/eval-incoming-classifier.mjs` to see exactly which messages
// broke. The one accepted exact miss is an extended/summer wording nuance;
// it stays inside the absence family and must never become auto-archived noise.

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/incoming-eval-set.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { messages, actionabilityCases, proposalCases } = fixture;

test('incoming classifier holds its accuracy floors on the synthetic eval set', () => {
  const report = scoreIncomingClassifier(messages, classifyIncomingMessage);

  assert.equal(fixture.schemaVersion, 4);
  assert.equal(fixture.dataOrigin, 'synthetic_independent_cases');
  assert.ok(report.total >= 45, `eval fixture shrank to ${report.total} messages`);
  assert.ok(
    report.exactAccuracy >= 0.95,
    `exact accuracy ${(report.exactAccuracy * 100).toFixed(1)}% fell below 95% — misses: ${report.misses.map((m) => `#${m.id}`).join(', ')}`,
  );
  assert.ok(
    report.familyAccuracy >= 0.98,
    `family accuracy ${(report.familyAccuracy * 100).toFixed(1)}% fell below 98%`,
  );
});

test('capture scoring uses the complete new-record shape and keeps known chatter quiet', () => {
  const report = scoreIncomingCaptureOutcomes(actionabilityCases, testCase => {
    const record = buildIncomingMessageRecord({
      source: 'whatsapp_group_auto', messageText: testCase.text,
      messageAt: '2030-06-19T10:00:00Z',
    });
    return { ...record, status: decideAutoCaptureStatus(record) };
  });
  assert.equal(report.exactAccuracy, 1, JSON.stringify(report.misses));
  assert.equal(report.harmfulAutoArchives, 0);
  assert.equal(report.unnecessaryReviews, 0);
});

test('real auto-capture persists the labelled outcomes and replay leaves human decisions intact', async () => {
  const rows = new Map();
  let writes = 0;
  const capture = createIncomingMessageCapturer({
    getOperationalAdminStudents: async () => [],
    getWhatsappGroupMapRows: async () => [{ chatId: 'synthetic@g.us', status: 'confirmed', groupType: 'student' }],
    getIncomingMessageInboxRows: async () => [...rows.values()],
    getTutorPhoneRows: async () => [],
    upsertIncomingMessageInboxRow: async row => { rows.set(row.incomingId, row); writes += 1; },
    upsertWhatsappGroupMapRow: async row => { assert.equal(row.status, 'confirmed'); },
  });
  for (const testCase of actionabilityCases) {
    const payload = {
      source: 'whatsapp_group_auto', chat_id: 'synthetic@g.us',
      external_message_id: testCase.id, message_text: testCase.text,
      message_at: '2030-06-19T10:00:00Z',
    };
    const record = await capture(payload);
    assert.equal(record.status, testCase.expectedStatus, testCase.id);
    assert.equal(record.classificationActionability, testCase.expectedActionability, testCase.id);
    if (testCase.expectedCategory) assert.equal(record.suspectedCategory, testCase.expectedCategory, testCase.id);
    assert.deepEqual(rows.get(record.incomingId), record);
    const reviewed = { ...record, status: 'ignored', classificationDecision: 'corrected', reviewedBy: 'admin@example.test' };
    rows.set(record.incomingId, reviewed);
    assert.deepEqual(await capture(payload), reviewed, `replay overwrote review: ${testCase.id}`);
  }
  assert.equal(writes, actionabilityCases.length);
});

test('capture scoring separates missed work from unnecessary review and topic accuracy', () => {
  const cases = [
    { id: 'reply', expectedStatus: 'inbox' },
    { id: 'unknown', expectedStatus: 'needs_review' },
    { id: 'thanks', expectedStatus: 'ignored' },
  ];
  const statuses = { reply: 'inbox', unknown: 'ignored', thanks: 'needs_review' };
  const report = scoreIncomingCaptureOutcomes(cases, entry => ({ status: statuses[entry.id] }));
  assert.equal(report.exactCorrect, 1);
  assert.equal(report.harmfulAutoArchives, 1);
  assert.equal(report.unnecessaryReviews, 1);
});

test('incoming actionability stays calibrated independently from topic words', () => {
  const report = scoreIncomingActionability(actionabilityCases, classifyIncomingMessage);

  assert.ok(report.total >= 18, `actionability fixture shrank to ${report.total} messages`);
  assert.ok(
    report.exactAccuracy >= 0.95,
    `actionability accuracy ${(report.exactAccuracy * 100).toFixed(1)}% fell below 95% — misses: ${report.misses.map((entry) => `#${entry.id}`).join(', ')}`,
  );
  assert.equal(report.harmfulAutoArchives, 0, 'a message needing attention would be auto-archived');
});

test('incoming date extraction stays exact on the synthetic dated cases', () => {
  const report = scoreIncomingDateExtraction(messages, extractDatesFromMessage);
  assert.ok(report.total >= 20, `dated eval fixture shrank to ${report.total} messages`);
  assert.equal(report.exactAccuracy, 1, `date misses: ${report.misses.map((entry) => entry.id).join(', ')}`);
});

test('proposal abstention scoring counts missing safety flags as misses', () => {
  const perfect = scoreIncomingProposalAbstention(proposalCases, (testCase) => testCase.expected);
  assert.equal(perfect.abstentionAccuracy, 1);
  assert.equal(perfect.ambiguityFlagsAccuracy, 1);

  const unsafe = scoreIncomingProposalAbstention(proposalCases, () => ({ mustAbstain: false, ambiguityFlags: [] }));
  assert.ok(unsafe.abstentionAccuracy < 1);
  assert.ok(unsafe.ambiguityFlagsAccuracy < 1);
});

test('classifier never crashes on odd input', () => {
  assert.equal(classifyIncomingMessage('').category, 'general');
  assert.equal(classifyIncomingMessage(null).category, 'general');
  assert.equal(classifyIncomingMessage('🎸🎹🎤').category, 'general');
});
