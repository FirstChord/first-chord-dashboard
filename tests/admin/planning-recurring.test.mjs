import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecurringPlanningEnsurer, selectRecurringPlanningRows } from '../../lib/admin/planning-recurring.mjs';
import {
  NEWSLETTER_MAILCHIMP_PLANNING_ID,
  buildNewsletterMailchimpPlanningItem,
  shouldRefreshNewsletterMailchimpPlanningItem,
} from '../../lib/admin/planning-helpers.mjs';

const NOW = new Date('2026-09-28T10:00:00.000Z');
const definitions = [{
  planningId: NEWSLETTER_MAILCHIMP_PLANNING_ID,
  shouldRefresh: shouldRefreshNewsletterMailchimpPlanningItem,
  build: buildNewsletterMailchimpPlanningItem,
}];

function harness(initial = []) {
  let stored = structuredClone(initial);
  let writes = 0;
  let forcedReads = 0;
  const ensure = createRecurringPlanningEnsurer({
    definitions,
    getPlanningItemRows: async ({ force }) => {
      assert.equal(force, true);
      forcedReads += 1;
      return structuredClone(stored);
    },
    upsertPlanningItemRow: async (row) => {
      writes += 1;
      const index = stored.findIndex((entry) => entry.planningId === row.planningId);
      if (index < 0) stored.push(structuredClone(row));
      else stored[index] = structuredClone(row);
    },
  });
  return { ensure, rows: () => structuredClone(stored), writes: () => writes, forcedReads: () => forcedReads };
}

test('concurrent page reads seed the Mailchimp reminder only once', async () => {
  const h = harness();
  const [first, second, third, fourth] = await Promise.all([
    h.ensure([], NOW), h.ensure([], NOW), h.ensure([], NOW), h.ensure([], NOW),
  ]);
  assert.equal(h.writes(), 1);
  assert.equal(h.rows().length, 1);
  assert.equal(h.forcedReads(), 4);
  for (const result of [first, second, third, fourth]) {
    assert.deepEqual(result.map((row) => row.planningId), [NEWSLETTER_MAILCHIMP_PLANNING_ID]);
  }
});

test('stale missing snapshot rechecks Sheets before appending', async () => {
  const existing = buildNewsletterMailchimpPlanningItem({ now: NOW });
  const h = harness([existing]);
  const result = await h.ensure([], NOW);
  assert.equal(h.writes(), 0);
  assert.equal(h.forcedReads(), 1);
  assert.deepEqual(result, [existing]);
});

test('same-ID duplicate rows display as one and the most recent human edit wins', async () => {
  const original = buildNewsletterMailchimpPlanningItem({ now: NOW });
  const reviewed = { ...original, status: 'parked', updatedAt: '2026-09-28T12:00:00.000Z', lastUpdatedBy: 'Finn' };
  const h = harness([original, reviewed]);
  const result = await h.ensure(h.rows(), NOW);
  assert.deepEqual(result, [reviewed]);
  assert.equal(h.writes(), 0);
  assert.equal(h.forcedReads(), 0);
  assert.equal(h.rows().length, 2, 'read-time dedupe must not mutate historical rows');

  const unrelated = { planningId: 'another', title: 'Independent work' };
  assert.deepEqual(selectRecurringPlanningRows([original, unrelated, reviewed], [NEWSLETTER_MAILCHIMP_PLANNING_ID]), [reviewed, unrelated]);
});

test('failed seed does not poison a retry', async () => {
  let attempts = 0;
  const ensure = createRecurringPlanningEnsurer({
    definitions,
    getPlanningItemRows: async () => [],
    upsertPlanningItemRow: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Sheets unavailable');
    },
  });
  await assert.rejects(ensure([], NOW), /Sheets unavailable/);
  await assert.doesNotReject(ensure([], NOW));
  assert.equal(attempts, 2);
});
