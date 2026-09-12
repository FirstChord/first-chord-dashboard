/** @fileoverview Per-tab row-count readings taken during the backup run so the move-off-Sheets decision rests on a number. */
// Sheet census: a per-tab row-count reading taken during the fortnightly
// backup run so "when should a lane move off Sheets?" is answered by a number
// rather than a hunch. See docs/architecture/data/storage-boundary.md for the boundary
// this measures. This module only reads backup manifests and computes deltas;
// it never writes to Sheets.

// Machine-generated, event-heavy or concurrency-sensitive lanes flagged by the
// audit as the eventual/soon migration candidates. These are the tabs whose
// growth actually decides the migration trigger, so the census watches them
// explicitly. Human-paced config/workflow tabs are deliberately not here.
export const CENSUS_WATCH_TABS = [
  'Incoming_Message_Inbox',
  'Event_Log',
  'Issue_Queue',
  'Practice_Notes_Log',
  'Payroll_Runs',
  'WhatsApp_Group_Map',
  // Song telemetry: append-only, machine-written, and unbounded by design — one
  // row per status change and one per recorded outcome, for every student. Both
  // were created after this list and so were counted but never ranked, which
  // meant the migration trigger in storage-boundary.md could not fire for them.
  // Tiny today (tens of rows); the point is to notice if that changes.
  'Song_Status_Log',
  'Song_Outcomes',
  // Practice Chat evaluation telemetry: three writes per lesson attempt, from
  // every tutor, for six weeks. Watched from creation rather than after the
  // fact — that omission is exactly what hid the two lanes above.
  'Practice_Chat_Sessions',
  // Watched from creation, not after the fact — that omission is what hid the
  // two song lanes above. Human-paced and small by design (~15-25 rows a month),
  // so the point is to notice if it ever stops being either.
  'Newsletter_Items',
];

function manifestRowCounts(manifest) {
  const counts = new Map();
  for (const tab of manifest?.tabs || []) {
    if (!tab?.tabName) {
      continue;
    }

    counts.set(tab.tabName, Number.isFinite(tab.rowCount) ? tab.rowCount : 0);
  }

  return counts;
}

// Build a census from the just-written backup manifest and (optionally) the
// previous run's manifest. Deltas are null when there is no prior reading so
// the first census is honest about not knowing growth yet.
export function buildSheetCensus({
  currentManifest,
  previousManifest = null,
  watchTabs = CENSUS_WATCH_TABS,
  takenAt = new Date().toISOString(),
} = {}) {
  const currentCounts = manifestRowCounts(currentManifest);
  const previousCounts = previousManifest ? manifestRowCounts(previousManifest) : null;
  const watchSet = new Set(watchTabs);

  const tabs = [];
  for (const [tabName, rowCount] of currentCounts) {
    const previousRowCount = previousCounts?.has(tabName) ? previousCounts.get(tabName) : null;
    const delta = previousRowCount == null ? null : rowCount - previousRowCount;

    tabs.push({
      tabName,
      rowCount,
      previousRowCount,
      delta,
      watched: watchSet.has(tabName),
    });
  }

  tabs.sort((a, b) => a.tabName.localeCompare(b.tabName));

  const totalRows = tabs.reduce((sum, tab) => sum + tab.rowCount, 0);
  const previousTotalRows = previousCounts
    ? [...previousCounts.values()].reduce((sum, value) => sum + value, 0)
    : null;

  const fastestGrowing = tabs
    .filter((tab) => tab.watched && Number.isFinite(tab.delta) && tab.delta > 0)
    .sort((a, b) => b.delta - a.delta);

  return {
    takenAt,
    previousTakenAt: previousManifest?.completedAt || null,
    totalRows,
    previousTotalRows,
    totalDelta: previousTotalRows == null ? null : totalRows - previousTotalRows,
    tabs,
    fastestGrowing,
  };
}

// One-line summary for the console + the backup progress note. Keeps the
// watched growth visible where the fortnightly backup is already read.
export function formatCensusSummary(census = {}) {
  const totalRows = census.totalRows ?? 0;
  const parts = [`Sheet census: ${totalRows} rows across ${census.tabs?.length || 0} tabs`];

  if (Number.isFinite(census.totalDelta)) {
    const sign = census.totalDelta >= 0 ? '+' : '';
    parts.push(`(${sign}${census.totalDelta} since last backup)`);
  }

  const growing = (census.fastestGrowing || []).slice(0, 3);
  if (growing.length > 0) {
    const detail = growing.map((tab) => `${tab.tabName} +${tab.delta}`).join(', ');
    parts.push(`Watched growth: ${detail}.`);
  } else if (census.previousTotalRows != null) {
    parts.push('Watched growth: none.');
  }

  return parts.join(' ');
}
