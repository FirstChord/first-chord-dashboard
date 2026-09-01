import test from 'node:test';
import assert from 'node:assert/strict';

import {
  archivedDatesFromArchive,
  buildRosterMovement,
  countDatesInRange,
  departureDatesFromArchive,
  onboardedDatesFromWaitingState,
} from '../../lib/admin/roster-movement.mjs';

const NOW = new Date('2026-06-15T12:00:00Z');

test('buckets onboarded and left by month with net', () => {
  const r = buildRosterMovement({
    onboardedDates: ['2026-06-02', '2026-06-20', '2026-05-10'],
    leftDates: ['2026-06-05', '2026-04-01'],
    now: NOW,
    months: 6,
  });
  const jun = r.months.find((m) => m.month === '2026-06');
  const may = r.months.find((m) => m.month === '2026-05');
  assert.equal(jun.onboarded, 2);
  assert.equal(jun.left, 1);
  assert.equal(jun.net, 1);
  assert.equal(may.onboarded, 1);
  assert.equal(may.net, 1);
});

test('totals sum across the window; older-than-window dates are ignored', () => {
  const r = buildRosterMovement({
    onboardedDates: ['2026-06-02', '2025-01-01'], // 2025 is outside a 6-month window
    leftDates: ['2026-06-05'],
    now: NOW,
    months: 6,
  });
  assert.equal(r.totals.onboarded, 1);
  assert.equal(r.totals.left, 1);
  assert.equal(r.totals.net, 0);
});

test('window always has exactly `months` buckets, oldest→newest', () => {
  const r = buildRosterMovement({ now: NOW, months: 3 });
  assert.equal(r.months.length, 3);
  assert.deepEqual(r.months.map((m) => m.month), ['2026-04', '2026-05', '2026-06']);
});

test('onboardedDatesFromWaitingState picks onboarded rows, prefers updatedAt', () => {
  const dates = onboardedDatesFromWaitingState([
    { status: 'onboarded', updatedAt: '2026-06-02T10:00:00Z', dateStarted: '2026-05-01' },
    { status: 'contacted', updatedAt: '2026-06-03T10:00:00Z' },
    { status: 'onboarded', updatedAt: '', dateStarted: '2026-04-09' },
  ]);
  assert.deepEqual(dates, ['2026-06-02T10:00:00Z', '2026-04-09']);
});

test('countDatesInRange counts only dates within the window', () => {
  const dates = ['2026-06-20T10:00:00Z', '2026-06-26T10:00:00Z', '2026-06-10T10:00:00Z'];
  const count = countDatesInRange(dates, { fromISO: '2026-06-19T00:00:00Z', toISO: '2026-06-27T00:00:00Z' });
  assert.equal(count, 2); // 20th + 26th; 10th excluded
});

test('departureDatesFromArchive prefers the recorded departure month', () => {
  assert.deepEqual(departureDatesFromArchive([{
    date_left: '2026-02',
    archive_note: 'Legacy note says June 2026',
    archived_at: '2026-06-05T09:00:00Z',
  }]), ['2026-02-01']);
});

test('departureDatesFromArchive reads an explicit legacy note month case-insensitively', () => {
  assert.deepEqual(departureDatesFromArchive([
    { archive_note: 'Student inactive since march 2026', archived_at: '2026-06-05T09:00:00Z' },
    { archiveNote: 'Stopped Sept 2025', archivedAt: '2026-06-05T09:00:00Z' },
  ]), ['2026-03-01', '2025-09-01']);
});

test('departureDatesFromArchive falls back to archive time without inventing a month', () => {
  assert.deepEqual(departureDatesFromArchive([
    { date_left: 'not-a-month', archive_note: 'No departure timing recorded', archived_at: '2026-06-05T09:00:00Z' },
    { archived_at: '' },
  ]), ['2026-06-05T09:00:00Z']);
});

test('archivedDatesFromArchive preserves exact archive timestamps for snapshots', () => {
  assert.deepEqual(archivedDatesFromArchive([
    { date_left: '2026-02', archived_at: '2026-06-05T09:00:00Z' },
    { archived_at: '' },
  ]), ['2026-06-05T09:00:00Z']);
});
