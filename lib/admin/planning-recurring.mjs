/** @fileoverview Fresh-read, process-serialized seeding and display deduplication for fixed-ID recurring Planning cards. */

// Sheets has no unique constraint on planning_id. A page and its API reads can
// arrive together, each see a missing seed, and each append the same ID.
export function selectRecurringPlanningRows(rows = [], recurringIds = []) {
  const ids = new Set(recurringIds);
  const selected = new Map();
  for (const row of rows) {
    if (!ids.has(row.planningId)) continue;
    const previous = selected.get(row.planningId);
    if (!previous || `${row.updatedAt || row.createdAt || ''}` > `${previous.updatedAt || previous.createdAt || ''}`) {
      selected.set(row.planningId, row);
    }
  }

  const emitted = new Set();
  return rows.filter((row) => {
    if (!ids.has(row.planningId)) return true;
    if (emitted.has(row.planningId)) return false;
    emitted.add(row.planningId);
    return true;
  }).map((row) => ids.has(row.planningId) ? selected.get(row.planningId) : row);
}

export function createRecurringPlanningEnsurer({ getPlanningItemRows, upsertPlanningItemRow, definitions }) {
  const ids = definitions.map(({ planningId }) => planningId);
  let pending = Promise.resolve();

  async function ensure(itemRows = [], now = new Date()) {
    let rows = selectRecurringPlanningRows(itemRows, ids);
    if (!definitions.some(({ planningId, shouldRefresh }) =>
      shouldRefresh(rows.find((row) => row.planningId === planningId) || {}, now))) {
      return rows;
    }

    // A cached page read is suitable for display, never for deciding to append.
    rows = selectRecurringPlanningRows(await getPlanningItemRows({ force: true }), ids);
    for (const { planningId, shouldRefresh, build } of definitions) {
      const existing = rows.find((row) => row.planningId === planningId) || {};
      if (!shouldRefresh(existing, now)) continue;

      const next = build({
        now,
        existingItem: existing,
        skipToday: existing.status === 'done',
      });
      await upsertPlanningItemRow(next);
      rows = [...rows.filter((row) => row.planningId !== planningId), next];
    }
    return rows;
  }

  return (itemRows, now) => {
    // Serialize this process's page/API reads. A fresh Sheets read inside each
    // turn observes the previous append before another turn can seed the ID.
    const result = pending.then(() => ensure(itemRows, now));
    pending = result.catch(() => {});
    return result;
  };
}
