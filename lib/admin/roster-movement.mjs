/** @fileoverview Pure monthly growth and churn counts from waiting-list onboardings and recorded departures. */
// Simple growth/churn logging: count students onboarded vs left, by month.
// Pure. Onboarded dates come from Waiting_List_State (status 'onboarded'); departure
// months come from Students_Archive. Both only capture movements recorded THROUGH the
// dashboard flows — a student added/removed outside them won't be counted.

const MONTH_NUMBERS = new Map([
  ['jan', '01'], ['january', '01'],
  ['feb', '02'], ['february', '02'],
  ['mar', '03'], ['march', '03'],
  ['apr', '04'], ['april', '04'],
  ['may', '05'],
  ['jun', '06'], ['june', '06'],
  ['jul', '07'], ['july', '07'],
  ['aug', '08'], ['august', '08'],
  ['sep', '09'], ['sept', '09'], ['september', '09'],
  ['oct', '10'], ['october', '10'],
  ['nov', '11'], ['november', '11'],
  ['dec', '12'], ['december', '12'],
]);

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseMonthDate(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) return null;
  const monthOnly = raw.match(/^(\d{4})-(\d{2})$/);
  const normalized = monthOnly ? `${raw}-01` : raw;
  const d = new Date(normalized.length <= 10 ? `${normalized}T00:00:00Z` : normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRecordedMonth(value) {
  const match = `${value || ''}`.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  const month = Number.parseInt(match[2], 10);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}-01` : '';
}

function departureMonthFromNote(value) {
  const match = `${value || ''}`.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{4})\b/i);
  if (!match) return '';
  return `${match[2]}-${MONTH_NUMBERS.get(match[1].toLowerCase())}-01`;
}

export function buildRosterMovement({ onboardedDates = [], leftDates = [], now = new Date(), months = 6 } = {}) {
  const buckets = new Map();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(monthKey(d), { month: monthKey(d), onboarded: 0, left: 0, net: 0 });
  }

  const tally = (dates, field) => {
    for (const value of dates) {
      const d = parseMonthDate(value);
      if (!d) continue;
      const key = monthKey(d);
      if (buckets.has(key)) buckets.get(key)[field] += 1;
    }
  };
  tally(onboardedDates, 'onboarded');
  tally(leftDates, 'left');

  const rows = [...buckets.values()];
  for (const r of rows) r.net = r.onboarded - r.left;

  const totals = rows.reduce(
    (acc, r) => ({ onboarded: acc.onboarded + r.onboarded, left: acc.left + r.left, net: acc.net + r.net }),
    { onboarded: 0, left: 0, net: 0 },
  );

  return { months: rows, totals };
}

// Count dated movements within a window [fromISO, toISO] — for per-period snapshot rows.
export function countDatesInRange(dates = [], { fromISO, toISO } = {}) {
  const from = fromISO ? new Date(fromISO).getTime() : -Infinity;
  const to = toISO ? new Date(toISO).getTime() : Infinity;
  let count = 0;
  for (const value of dates) {
    const d = parseMonthDate(value);
    if (d && d.getTime() >= from && d.getTime() <= to) count += 1;
  }
  return count;
}

// Adapter helpers: pull the dated movement signals from the two source tabs.
export function onboardedDatesFromWaitingState(waitingStateRows = []) {
  return waitingStateRows
    .filter((row) => `${row.status || ''}`.trim() === 'onboarded')
    .map((row) => row.updatedAt || row.dateStarted || '')
    .filter(Boolean);
}

// Historical roster movement uses when the student actually left. New archive
// rows carry date_left; legacy notes often name the month explicitly. Only rows
// without either signal fall back to the archive action date.
export function departureDatesFromArchive(archiveRows = []) {
  return archiveRows.map((row) => (
    normalizeRecordedMonth(row.date_left || row.dateLeft)
    || departureMonthFromNote(row.archive_note || row.archiveNote)
    || row.archived_at
    || row.archivedAt
    || ''
  )).filter(Boolean);
}

// Exact archive action timestamps remain useful for trailing weekly/monthly
// snapshot activity. They must not be replaced with month-level departure dates.
export function archivedDatesFromArchive(archiveRows = []) {
  return archiveRows.map((row) => row.archived_at || row.archivedAt || '').filter(Boolean);
}
