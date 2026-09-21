// Contract guards for the state-tab layer. Each of these pins a seam where
// truth lives in two places and drift used to be silent:
//  1. managed tabs ↔ the backup list (the 2026-07-19 restore-drill finding:
//     five non-rebuildable tabs were created but never backed up)
//  2. sheet header constants ↔ the row builders that write them
//  3. header hygiene (no duplicates, no accidental camelCase)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManagedStateSheetDefinitions,
  INCOMING_MESSAGE_INBOX_HEADERS,
  WHATSAPP_GROUP_MAP_HEADERS,
  LIFECYCLE_SNAPSHOT_HEADERS,
  NEWSLETTER_ISSUES_HEADERS,
  NEWSLETTER_ITEMS_HEADERS,
  PRACTICE_CHAT_SESSIONS_HEADERS,
  PRACTICE_NOTES_LOG_HEADERS,
  PAYROLL_RUNS_HEADERS,
  PROPOSALS_HEADERS,
  SONG_ASSIGNMENTS_HEADERS,
  SONG_OUTCOMES_HEADERS,
  SONG_REQUESTS_HEADERS,
  SONG_STATUS_LOG_HEADERS,
  STRIPE_FORECAST_MONTHLY_HEADERS,
  STUDENT_LIFECYCLE_HEADERS,
  STUDENT_PORTAL_ACCESS_HEADERS,
  TUTOR_PAY_HEADERS,
} from '../../lib/admin/sheets/core.mjs';
import { buildIncomingMessageSheetRow, buildWhatsappGroupMapSheetRow } from '../../lib/admin/sheets/incoming-messages.mjs';
import { buildPracticeNoteLogSheetRow } from '../../lib/admin/practice-notes-helpers.mjs';
import { buildPracticeChatSessionSheetRow } from '../../lib/admin/practice-chat-session-helpers.mjs';
import {
  buildLifecycleSnapshotRow,
  buildStudentLifecycleRow,
} from '../../lib/admin/sheets/student-lifecycle.mjs';
import {
  buildSongAssignmentSheetRow,
  buildSongOutcomeSheetRow,
  buildSongRequestSheetRow,
  buildSongStatusLogSheetRow,
} from '../../lib/admin/sheets/song-assignments.mjs';
import { buildProposalSheetRow } from '../../lib/admin/sheets/proposals.mjs';
import {
  buildNewsletterIssueSheetRow,
  buildNewsletterItemSheetRow,
} from '../../lib/admin/sheets/newsletter.mjs';
import { buildStudentPortalAccessSheetRow } from '../../lib/admin/sheets/student-portal-access.mjs';
import { buildStripeForecastRow } from '../../lib/admin/stripe-forecast-helpers.mjs';
import { BACKUP_TABS, NON_BACKED_UP_TABS } from '../../lib/admin/backup-tabs.mjs';

// Students headers are external truth, so the definitions accept them as a
// parameter; any placeholder works for tab-name enumeration.
const managedDefinitions = buildManagedStateSheetDefinitions(['placeholder']);

test('every managed tab is backed up or has a written exclusion reason', () => {
  const unaccounted = managedDefinitions
    .map((definition) => definition.sheetName)
    .filter((sheetName) => !BACKUP_TABS.includes(sheetName) && !NON_BACKED_UP_TABS.has(sheetName));

  assert.deepEqual(
    unaccounted,
    [],
    `Managed tabs missing from BACKUP_TABS (add them there, or to NON_BACKED_UP_TABS with a reason): ${unaccounted.join(', ')}`
  );
});

test('backup list and exclusions stay consistent with the managed set', () => {
  const managedNames = new Set(managedDefinitions.map((definition) => definition.sheetName));

  // A tab in both lists would make the exclusion reason a lie.
  const contradictions = BACKUP_TABS.filter((tab) => NON_BACKED_UP_TABS.has(tab));
  assert.deepEqual(contradictions, []);

  // An exclusion for a tab that is no longer managed is stale documentation.
  const staleExclusions = [...NON_BACKED_UP_TABS.keys()].filter((tab) => !managedNames.has(tab));
  assert.deepEqual(staleExclusions, []);

  // Backed-up tabs beyond the managed set must be the known externally-owned
  // ones: Students (external school truth) and Tutor_Phones (human-maintained,
  // deliberately unmanaged so its header wording stays flexible).
  const EXTERNALLY_OWNED_BACKED_UP = new Set(['Students', 'Tutor_Phones']);
  const unknownExtras = BACKUP_TABS.filter(
    (tab) => !managedNames.has(tab) && !EXTERNALLY_OWNED_BACKED_UP.has(tab)
  );
  assert.deepEqual(unknownExtras, []);
});

test('managed sheet headers are unique and snake_case', () => {
  for (const { sheetName, requiredHeaders } of managedDefinitions) {
    if (sheetName === 'Students_Archive') continue; // inherits external Students headers
    assert.equal(
      new Set(requiredHeaders).size,
      requiredHeaders.length,
      `${sheetName} has duplicate headers`
    );
    for (const header of requiredHeaders) {
      assert.match(
        header,
        /^[a-z0-9_]+$/,
        `${sheetName} header "${header}" is not snake_case`
      );
    }
  }
});

test('payroll contact and delivery evidence remain separate from banking identity', () => {
  for (const header of ['contact_email', 'contact_email_verified_at', 'cadence_effective_from', 'cadence_updated_at', 'cadence_updated_by']) {
    assert.ok(TUTOR_PAY_HEADERS.includes(header), `Tutor_Pay must keep ${header}`);
  }
  assert.ok(!TUTOR_PAY_HEADERS.includes('recipient_email'), 'Wise recipient identity must not leak into Tutor_Pay');

  const deliveryStart = PAYROLL_RUNS_HEADERS.indexOf('statement_delivery_status');
  assert.deepEqual(PAYROLL_RUNS_HEADERS.slice(deliveryStart, deliveryStart + 6), [
    'statement_delivery_status',
    'statement_delivery_channel',
    'statement_delivery_to',
    'statement_delivery_attempted_at',
    'statement_delivery_message_id',
    'statement_delivery_error',
  ]);
});

// Header constants and row builders live a few lines apart but nothing joins
// them at runtime: a header added without a builder key writes a permanently
// blank column; a builder key without a header silently never lands.
const BUILDER_CONTRACTS = [
  ['Song_Assignments', SONG_ASSIGNMENTS_HEADERS, buildSongAssignmentSheetRow],
  ['Song_Status_Log', SONG_STATUS_LOG_HEADERS, buildSongStatusLogSheetRow],
  ['Song_Outcomes', SONG_OUTCOMES_HEADERS, buildSongOutcomeSheetRow],
  ['Song_Requests', SONG_REQUESTS_HEADERS, buildSongRequestSheetRow],
  ['Proposals', PROPOSALS_HEADERS, buildProposalSheetRow],
  ['Student_Portal_Access', STUDENT_PORTAL_ACCESS_HEADERS, buildStudentPortalAccessSheetRow],
  ['Student_Lifecycle', STUDENT_LIFECYCLE_HEADERS, buildStudentLifecycleRow],
  ['Lifecycle_Snapshot', LIFECYCLE_SNAPSHOT_HEADERS, buildLifecycleSnapshotRow],
  ['Stripe_Forecast_Monthly', STRIPE_FORECAST_MONTHLY_HEADERS, buildStripeForecastRow],
  ['WhatsApp_Group_Map', WHATSAPP_GROUP_MAP_HEADERS, buildWhatsappGroupMapSheetRow],
  ['Incoming_Message_Inbox', INCOMING_MESSAGE_INBOX_HEADERS, buildIncomingMessageSheetRow],
  ['Practice_Notes_Log', PRACTICE_NOTES_LOG_HEADERS, buildPracticeNoteLogSheetRow],
  ['Practice_Chat_Sessions', PRACTICE_CHAT_SESSIONS_HEADERS, buildPracticeChatSessionSheetRow],
  ['Newsletter_Issues', NEWSLETTER_ISSUES_HEADERS, buildNewsletterIssueSheetRow],
  ['Newsletter_Items', NEWSLETTER_ITEMS_HEADERS, buildNewsletterItemSheetRow],
];

test('row builders emit exactly their sheet headers', () => {
  for (const [name, headers, builder] of BUILDER_CONTRACTS) {
    assert.deepEqual(
      Object.keys(builder({})).sort(),
      [...headers].sort(),
      `${name}: builder keys and headers disagree`
    );
  }
});

test('Practice Notes keep reviewed catalogue links separate from unlisted observations', () => {
  const songEvidenceStart = PRACTICE_NOTES_LOG_HEADERS.indexOf('song_ids_json');
  assert.deepEqual(PRACTICE_NOTES_LOG_HEADERS.slice(songEvidenceStart, songEvidenceStart + 4), [
    'song_ids_json',
    'song_titles_json',
    'unlisted_song_titles_json',
    'song_link_version',
  ]);
  assert.equal(PRACTICE_NOTES_LOG_HEADERS.length, 39);
  // A household can have more than one parent on the MMS record. The primary is
  // the `To:` address and stays in the singular recipient columns; everyone else
  // is Bcc'd on the same send and recorded here, so "who actually received this"
  // is answerable from the log rather than inferred from MMS as it is today.
  const recipientStart = PRACTICE_NOTES_LOG_HEADERS.indexOf('recipient_profile_id');
  assert.deepEqual(PRACTICE_NOTES_LOG_HEADERS.slice(recipientStart, recipientStart + 4), [
    'recipient_profile_id',
    'recipient_name',
    'recipient_email',
    'bcc_recipient_emails',
  ]);
});

test('Incoming messages store Later as wake-up state, not a resolution status', () => {
  const resolutionIndex = INCOMING_MESSAGE_INBOX_HEADERS.indexOf('resolution_type');
  assert.deepEqual(INCOMING_MESSAGE_INBOX_HEADERS.slice(resolutionIndex, resolutionIndex + 4), [
    'resolution_type',
    'snoozed_until',
    'school_replied_at',
    'school_replied_by',
  ]);
  assert.equal(
    buildIncomingMessageSheetRow({ snoozedUntil: '2026-08-05T08:00:00.000Z' }).snoozed_until,
    '2026-08-05T08:00:00.000Z',
  );
});

test('the newsletter lane stores facts, not a status column', () => {
  // The design derives requested/captured/declined/selected/needs_review from
  // the fields below. A `status` or `state` column appearing here would mean
  // somebody reintroduced a second, manually-advanced source of truth.
  for (const header of [...NEWSLETTER_ITEMS_HEADERS, ...NEWSLETTER_ISSUES_HEADERS]) {
    assert.ok(
      !['status', 'state', 'workflow_status', 'item_status'].includes(header),
      `Newsletter lane must not carry a "${header}" column — state is derived on read`,
    );
  }

  // The facts every derived state depends on.
  for (const required of ['requested_at', 'captured_at', 'tutor_response', 'editorial']) {
    assert.ok(
      NEWSLETTER_ITEMS_HEADERS.includes(required),
      `Newsletter_Items must keep "${required}" — a derived state depends on it`,
    );
  }
});

test('newsletter identity is the FC student id, with provider ids as provenance only', () => {
  assert.ok(NEWSLETTER_ITEMS_HEADERS.includes('fc_student_id'));
  assert.ok(NEWSLETTER_ITEMS_HEADERS.includes('fc_tutor_id'));
  // Provider/display columns are allowed, but must not be the only identity:
  // fc_student_id comes first among the identity block so the durable key is
  // what a reader sees first.
  assert.ok(
    NEWSLETTER_ITEMS_HEADERS.indexOf('fc_student_id') < NEWSLETTER_ITEMS_HEADERS.indexOf('mms_id'),
    'the FC id is the identity; the MMS id is provenance beside it',
  );
});

test('the newsletter consent record keeps the answer and when it was given', () => {
  // Standing consent is derived from these three, so losing any one of them
  // would turn a recorded permission into an unverifiable claim.
  for (const required of ['has_media', 'consent_asked_at', 'consent_answer', 'consent_recorded_at']) {
    assert.ok(
      NEWSLETTER_ITEMS_HEADERS.includes(required),
      `Newsletter_Items must keep "${required}" — consent state is derived from it`,
    );
  }
});
