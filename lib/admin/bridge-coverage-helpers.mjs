/** @fileoverview Turns gaps between WhatsApp bridge heartbeats into a durable record of when the inbox was not capturing. */

// The bridge heartbeats every 30 minutes by default. A process restart can skip
// one — it restarted 26 times in the five days to 2026-09-16 without any of them
// mattering — so the threshold is three intervals. Below that is noise; above it
// the bridge was genuinely not listening, and anything a parent sent in the
// window was never captured and never will be, because WhatsApp history older
// than the catch-up window is not replayed.
export const BRIDGE_COVERAGE_GAP_MS = 90 * 60 * 1000;

// Enough to cover a fortnight of ordinary operation without the status row
// growing without bound. Old gaps stop being actionable long before this.
export const BRIDGE_COVERAGE_GAP_LIMIT = 20;

function toMs(value) {
  const ms = new Date(`${value || ''}`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseBridgeCoverageGaps(rawJson = '') {
  const raw = `${rawJson || ''}`.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const gaps = Array.isArray(parsed) ? parsed : parsed?.coverageGaps;
    return Array.isArray(gaps)
      ? gaps.filter((gap) => gap && gap.from && gap.to)
      : [];
  } catch {
    // A status row is diagnostics, not truth. Unreadable JSON must not take the
    // inbox down with it.
    return [];
  }
}

export function serialiseBridgeCoverageGaps(gaps = []) {
  return gaps.length ? JSON.stringify({ coverageGaps: gaps }) : '';
}

// The window between the last heartbeat we saw and this one. `from` is the last
// moment the bridge is known to have been listening, so the gap is the period
// nobody can vouch for — deliberately not "when it crashed", which we cannot
// know from here.
export function detectBridgeCoverageGap({
  previousHeartbeatAt = '',
  now = new Date(),
  thresholdMs = BRIDGE_COVERAGE_GAP_MS,
} = {}) {
  const from = toMs(previousHeartbeatAt);
  const to = now instanceof Date ? now.getTime() : toMs(now);
  if (from === null || to === null || to <= from) return null;
  const durationMs = to - from;
  if (durationMs < thresholdMs) return null;

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    minutes: Math.round(durationMs / 60000),
  };
}

export function appendBridgeCoverageGap(gaps = [], gap = null, { limit = BRIDGE_COVERAGE_GAP_LIMIT } = {}) {
  if (!gap) return gaps;
  // Same window twice means the same outage recorded twice — a retried heartbeat
  // post, not a second failure.
  const withoutDuplicate = gaps.filter((entry) => !(entry.from === gap.from && entry.to === gap.to));
  return [...withoutDuplicate, gap].slice(-limit);
}

function formatWindow(iso) {
  const date = new Date(`${iso || ''}`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Written to be read the morning after, when the bridge is back up and every
// live indicator looks fine. It has to say what was lost, not what is wrong now.
export function describeBridgeCoverageGap(gap = null) {
  if (!gap) return '';
  const hours = gap.minutes / 60;
  const length = hours >= 1
    ? `${hours % 1 === 0 ? hours : hours.toFixed(1)} hours`
    : `${gap.minutes} minutes`;
  return `Not capturing for ${length}, ${formatWindow(gap.from)} to ${formatWindow(gap.to)} — any WhatsApp message sent in that window is not in this inbox.`;
}

export function selectRecentBridgeCoverageGaps(gaps = [], { now = new Date(), withinHours = 72 } = {}) {
  const cutoff = (now instanceof Date ? now.getTime() : Date.now()) - withinHours * 60 * 60 * 1000;
  return gaps
    .filter((gap) => {
      const to = toMs(gap.to);
      return to !== null && to >= cutoff;
    })
    .sort((a, b) => `${b.to}`.localeCompare(`${a.to}`));
}
