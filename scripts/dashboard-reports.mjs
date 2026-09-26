/**
 * Read-only view of the dashboard's "Report a glitch" queue, so an agent can
 * triage what admins reported without a browser session.
 *
 * Reads Planning_Items straight through getSheetValues. It deliberately avoids
 * getPlanningItemRows, which can repair sheet headers: this command never writes.
 *
 *   npm run reports            open reports, oldest first
 *   npm run reports -- --all   include done and parked reports
 *   npm run reports -- --json  machine-readable output
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSheetValues, mapRowsToObjects, PLANNING_ITEMS_SHEET } from '../lib/admin/sheets/core.mjs';
import { DASHBOARD_FEEDBACK_WORKFLOW_ID, readDashboardFeedbackReport } from '../lib/admin/dashboard-feedback.mjs';
import { isSettledPlanningStatus } from '../lib/admin/planning-helpers.mjs';
import { loadLocalEnv } from './script-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

await loadLocalEnv(repoRoot);

const rows = mapRowsToObjects(await getSheetValues(PLANNING_ITEMS_SHEET, { force: true }));
if (!rows.length) {
  console.error('No Planning_Items rows read. Check GOOGLE_SPREADSHEET_ID and ~/token_musiclessons.json.');
  process.exit(1);
}

const reports = rows
  .filter((row) => row.linked_workflow_id === DASHBOARD_FEEDBACK_WORKFLOW_ID)
  .map((row) => readDashboardFeedbackReport({
    planningId: row.planning_id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    owner: row.owner,
    nextAction: row.next_action,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }))
  .filter((report) => args.has('--all') || !isSettledPlanningStatus(report.status))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

if (args.has('--json')) {
  console.log(JSON.stringify(reports, null, 2));
} else if (!reports.length) {
  console.log(args.has('--all') ? 'No dashboard reports.' : 'No open dashboard reports.');
} else {
  for (const report of reports) {
    console.log(`\n${report.planningId}  ${report.createdAt.slice(0, 16).replace('T', ' ')}  ${report.status}  ${report.type || 'unknown type'}  ${report.pagePath}`);
    console.log(`  ${report.message.replace(/\n/gu, '\n  ')}`);
    if (report.nextAction) console.log(`  Next: ${report.nextAction}`);
  }
  console.log(`\n${reports.length} ${args.has('--all') ? '' : 'open '}report${reports.length === 1 ? '' : 's'}.`);
}
