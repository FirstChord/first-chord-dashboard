/** @fileoverview Single registry of which Sheets tabs the local backup covers, and the written reason for each tab it deliberately skips. */
// The single home for which Sheets tabs the local backup covers.
// Contract (test-enforced in tests/admin/state-tab-contracts.test.mjs):
// every tab registered in buildManagedStateSheetDefinitions must appear either
// in BACKUP_TABS or in NON_BACKED_UP_TABS with a written reason. This exists
// because tab creation and backup coverage used to live in unrelated files and
// five non-rebuildable tabs (Cover_Bank_State + the Song_* lane) drifted out
// of the backup unnoticed until the 2026-07-19 restore drill.

export const BACKUP_TABS = [
  'Students',
  'Issue_Queue',
  'Event_Log',
  'Waiting_List_State',
  'Showcase_Task_State',
  'Holiday_Workflow_State',
  'Schedule_Context',
  'Parent_Understanding_State',
  'Tutor_Absence_State',
  'Cover_Bank_State',
  'Tutor_Lifecycle',
  'Planning_Items',
  'Planning_Progress_Log',
  'Practice_Notes_Log',
  // Not rebuildable from anything: each row measures a lesson that has passed,
  // and the abandoned ones have no counterpart in Practice_Notes_Log at all.
  'Practice_Chat_Sessions',
  'Communication_Log',
  'Student_Portal_Access',
  'Incoming_Message_Inbox',
  'WhatsApp_Group_Map',
  'Proposals',
  'Tutor_Pay',
  'Expenses',
  'Expense_Log',
  'Finance_Snapshot',
  'Payroll_Runs',
  'Tutor_Wise',
  'Tutor_Phones',
  // Hand-entered and unrecoverable: the link between a student and a second
  // payer's Stripe subscription exists nowhere else. Stripe knows the
  // subscription, MMS knows the parent, and only this tab knows they are the
  // same household's arrangement.
  'Split_Billing',
  'Students_Archive',
  'Song_Assignments',
  'Song_Status_Log',
  'Song_Outcomes',
  'Song_Requests',
  // Not rebuildable from anything. A tutor's one-line observation about a child,
  // and a parent's recorded answer about whether their child's photo may be
  // published, exist nowhere else — the consent answers in particular are the
  // school's only record that permission was given.
  //
  // Note what this does NOT cover: `media_json` holds Google Drive file IDs, and
  // this backup captures the references, never the bytes. Drive's own trash and
  // version history is the recovery story for an uploaded photo, and
  // `npm run newsletter:media-report` is how a reference and its file are
  // reconciled after a partial failure.
  'Newsletter_Issues',
  'Newsletter_Items',
  'Stripe_Forecast_Monthly',
  'Stripe_Collected_Monthly',
  // Student_Lifecycle is rebuildable from MMS today, but it is backed up anyway:
  // MMS is a vendor, and this is the only copy of seven years of the school's
  // own retention history outside it. Lifecycle_Snapshot is append-only and not
  // rebuildable at all — each row is a measurement of a moment that has passed.
  'Student_Lifecycle',
  'Lifecycle_Snapshot',
];

// Tabs that may legitimately not exist yet when the backup runs.
export const OPTIONAL_MISSING_TABS = new Set([
  'Students_Archive',
  'Tutor_Phones',
  'Student_Lifecycle',
  'Lifecycle_Snapshot',
]);

// Managed tabs deliberately excluded from backup — each needs a reason that
// amounts to "fully rebuildable from an external truth, losing it costs nothing".
export const NON_BACKED_UP_TABS = new Map([
  ['Stripe_Amounts_Cache', 'full-replace cache rebuilt weekly by /api/cron/stripe-amounts from live Stripe'],
  ['Bridge_Status', 'heartbeat row; the bridge rewrites it within ~30 minutes of running'],
]);
