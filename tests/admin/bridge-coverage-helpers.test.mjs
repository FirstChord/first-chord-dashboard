import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendBridgeCoverageGap,
  BRIDGE_COVERAGE_GAP_LIMIT,
  describeBridgeCoverageGap,
  detectBridgeCoverageGap,
  parseBridgeCoverageGaps,
  selectRecentBridgeCoverageGaps,
  selectUnrecoveredBridgeCoverageGaps,
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

test('the line says when and how long, and then stops', () => {
  // It only appears for a hole the replay could not fill, so it does not need a
  // heading or advice about what to do — the reader is looking at the inbox.
  const line = describeBridgeCoverageGap({
    from: '2026-09-12T18:00:00.000Z',
    to: '2026-09-15T09:00:00.000Z',
    minutes: 3780,
  });

  assert.match(line, /\(63 hours\) not captured\.$/u);
  assert.ok(line.split('\n').length === 1, 'the gap line must be one line');
  assert.equal(describeBridgeCoverageGap(null), '');
});

test('durations read naturally at every scale', () => {
  const at = (minutes) => describeBridgeCoverageGap({
    from: '2026-09-11T20:00:00.000Z',
    to: '2026-09-11T22:00:00.000Z',
    minutes,
  });
  assert.match(at(45), /\(45 minutes\) not captured\.$/u);
  // A whole number of hours must not read as "2.0 hours".
  assert.match(at(120), /\(2 hours\) not captured\.$/u);
  assert.match(at(155), /\(2\.6 hours\) not captured\.$/u);
});

test('a gap the replay already backfilled is never shown', () => {
  // The bridge replays the last 24h on every reconnect, and a reconnect is what
  // ends a gap. Announcing a filled hole would make the banner permanent
  // furniture, because the bridge crash-loops most days.
  const twoHourLoop = { from: '2026-09-16T11:01:00.000Z', to: '2026-09-16T13:01:00.000Z', minutes: 120 };
  const now = new Date('2026-09-16T14:00:00.000Z');

  assert.deepEqual(selectUnrecoveredBridgeCoverageGaps([twoHourLoop], { now }), []);
  // Still recorded — this filters the display, not the evidence.
  assert.equal(selectRecentBridgeCoverageGaps([twoHourLoop], { now }).length, 1);
});

test('a gap longer than the replay window is shown, because part of it is gone', () => {
  const longWeekend = { from: '2026-09-12T18:00:00.000Z', to: '2026-09-15T09:00:00.000Z', minutes: 3780 };
  const now = new Date('2026-09-15T12:00:00.000Z');

  assert.deepEqual(selectUnrecoveredBridgeCoverageGaps([longWeekend], { now }), [longWeekend]);
  // The boundary belongs to the recoverable side.
  const exactly24h = { from: '2026-09-14T09:00:00.000Z', to: '2026-09-15T09:00:00.000Z', minutes: 1440 };
  assert.deepEqual(selectUnrecoveredBridgeCoverageGaps([exactly24h], { now }), []);
  const justOver = { ...exactly24h, minutes: 1441 };
  assert.equal(selectUnrecoveredBridgeCoverageGaps([justOver], { now }).length, 1);
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
