import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendBridgeCoverageGap,
  BRIDGE_COVERAGE_GAP_LIMIT,
  describeBridgeCoverageGap,
  detectBridgeCoverageGap,
  parseBridgeCoverageGaps,
  selectRecentBridgeCoverageGaps,
  serialiseBridgeCoverageGaps,
} from '../../lib/admin/bridge-coverage-helpers.mjs';

const NOW = new Date('2026-09-16T12:00:00.000Z');

test('a short heartbeat gap is not an outage', () => {
  // The bridge restarted 26 times in five days without any of them mattering;
  // a skipped heartbeat is noise, not a window where messages were lost.
  assert.equal(detectBridgeCoverageGap({
    previousHeartbeatAt: '2026-09-16T11:31:00.000Z',
    now: NOW,
  }), null);
  assert.equal(detectBridgeCoverageGap({
    previousHeartbeatAt: '2026-09-16T10:35:00.000Z', // 85 minutes, just under
    now: NOW,
  }), null);
});

test('a real outage is recorded as the window nobody can vouch for', () => {
  // The real one: Friday 11 September, 20:18 to 22:53.
  const gap = detectBridgeCoverageGap({
    previousHeartbeatAt: '2026-09-11T20:18:00.000Z',
    now: new Date('2026-09-11T22:53:00.000Z'),
  });

  assert.deepEqual(gap, {
    from: '2026-09-11T20:18:00.000Z',
    to: '2026-09-11T22:53:00.000Z',
    minutes: 155,
  });
});

test('missing or nonsensical heartbeats never invent an outage', () => {
  assert.equal(detectBridgeCoverageGap({ previousHeartbeatAt: '', now: NOW }), null);
  assert.equal(detectBridgeCoverageGap({ previousHeartbeatAt: 'not a date', now: NOW }), null);
  // A clock that went backwards is not five hours of lost messages.
  assert.equal(detectBridgeCoverageGap({
    previousHeartbeatAt: '2026-09-16T17:00:00.000Z',
    now: NOW,
  }), null);
});

test('the same outage recorded twice stays one entry', () => {
  // A retried heartbeat post is not a second failure.
  const gap = { from: '2026-09-11T20:18:00.000Z', to: '2026-09-11T22:53:00.000Z', minutes: 155 };
  const once = appendBridgeCoverageGap([], gap);
  const twice = appendBridgeCoverageGap(once, { ...gap });

  assert.equal(twice.length, 1);
  assert.deepEqual(twice, [gap]);
});

test('the kept list is bounded, dropping the oldest', () => {
  let gaps = [];
  for (let index = 0; index < BRIDGE_COVERAGE_GAP_LIMIT + 5; index += 1) {
    gaps = appendBridgeCoverageGap(gaps, {
      from: `2026-09-01T00:${String(index).padStart(2, '0')}:00.000Z`,
      to: `2026-09-01T02:${String(index).padStart(2, '0')}:00.000Z`,
      minutes: 120,
    });
  }

  assert.equal(gaps.length, BRIDGE_COVERAGE_GAP_LIMIT);
  assert.equal(gaps[0].from, '2026-09-01T00:05:00.000Z');
});

test('gaps survive a round trip through the status row', () => {
  const gaps = [{ from: '2026-09-11T20:18:00.000Z', to: '2026-09-11T22:53:00.000Z', minutes: 155 }];
  assert.deepEqual(parseBridgeCoverageGaps(serialiseBridgeCoverageGaps(gaps)), gaps);
  assert.equal(serialiseBridgeCoverageGaps([]), '');
});

test('an unreadable status row does not take the inbox down with it', () => {
  // Diagnostics, not truth.
  assert.deepEqual(parseBridgeCoverageGaps('{not json'), []);
  assert.deepEqual(parseBridgeCoverageGaps(''), []);
  assert.deepEqual(parseBridgeCoverageGaps('{"coverageGaps":"nope"}'), []);
  assert.deepEqual(parseBridgeCoverageGaps('[{"from":"a"}]'), []);
});

test('a bare array of gaps is still readable', () => {
  const gaps = [{ from: '2026-09-11T20:18:00.000Z', to: '2026-09-11T22:53:00.000Z', minutes: 155 }];
  assert.deepEqual(parseBridgeCoverageGaps(JSON.stringify(gaps)), gaps);
});

test('the line says what was lost, not what is wrong now', () => {
  // Read the morning after, when the bridge is back and every live indicator
  // looks fine.
  const line = describeBridgeCoverageGap({
    from: '2026-09-11T20:18:00.000Z',
    to: '2026-09-11T22:53:00.000Z',
    minutes: 155,
  });

  assert.match(line, /^Not capturing for 2\.6 hours, /u);
  assert.match(line, /any WhatsApp message sent in that window is not in this inbox\.$/u);
  assert.equal(describeBridgeCoverageGap(null), '');
});

test('a sub-hour outage reads in minutes', () => {
  // Only reachable with a lowered threshold — the default is 90 minutes — but
  // the threshold is a parameter, so the wording has to hold below an hour.
  assert.match(
    describeBridgeCoverageGap({ from: '2026-09-11T20:18:00.000Z', to: '2026-09-11T21:03:00.000Z', minutes: 45 }),
    /^Not capturing for 45 minutes, /u,
  );
  // And a whole number of hours does not read as "2.0 hours".
  assert.match(
    describeBridgeCoverageGap({ from: '2026-09-11T20:00:00.000Z', to: '2026-09-11T22:00:00.000Z', minutes: 120 }),
    /^Not capturing for 2 hours, /u,
  );
});

test('only recent gaps surface, newest first', () => {
  const gaps = [
    { from: '2026-09-01T00:00:00.000Z', to: '2026-09-01T03:00:00.000Z', minutes: 180 },
    { from: '2026-09-15T20:00:00.000Z', to: '2026-09-15T23:00:00.000Z', minutes: 180 },
    { from: '2026-09-16T02:00:00.000Z', to: '2026-09-16T05:00:00.000Z', minutes: 180 },
  ];
  const recent = selectRecentBridgeCoverageGaps(gaps, { now: NOW, withinHours: 72 });

  assert.deepEqual(recent.map((gap) => gap.to), [
    '2026-09-16T05:00:00.000Z',
    '2026-09-15T23:00:00.000Z',
  ]);
});
