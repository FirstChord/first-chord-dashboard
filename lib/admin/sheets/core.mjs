/** @fileoverview Shared Google Sheets schemas and adapter primitives for managed tabs, cached reads, retries, and keyed writes. */
import { google } from 'googleapis';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { columnNumberToLetter } from '../sheets-helpers.mjs';
import { createSwrCache } from '../swr-cache.mjs';

const LOCAL_TOKEN_PATH = path.join(homedir(), 'token_musiclessons.json');
const managedSheetHeadersCache = new Map();
// Repeat navigations within this window reuse cached sheet reads. After that,
// normal page reads may serve bounded-stale values immediately while a refresh
// happens in the background. Dashboard writes invalidate their tab cache, so the
// stale window mainly protects against external writers and quiet-idle visits.
const SHEETS_READ_TTL_MS = 60_000;
const SHEETS_READ_STALE_WHILE_REVALIDATE_MS = 5 * 60_000;
// Ceiling on any single Sheets request. Generous next to a real read (well under
// two seconds) — this exists to turn "hangs forever" into an error somebody can
// act on, not to police normal slowness.
const SHEETS_REQUEST_TIMEOUT_MS = 30_000;
const sheetReadCache = createSwrCache({
  ttlMs: SHEETS_READ_TTL_MS,
  staleWhileRevalidateMs: SHEETS_READ_STALE_WHILE_REVALIDATE_MS,
  clone: cloneSheetValues,
  // Scope = the tab name, so a write to one tab invalidates that tab's reads
  // (and version-guards its in-flight fetches) without touching the others.
  scopeOf: (key) => parseSheetNameFromRange(key.split('::')[1] || ''),
  label: 'Sheets read',
});
export const ISSUE_QUEUE_SHEET = 'Issue_Queue';
export const EVENT_LOG_SHEET = 'Event_Log';
export const SHOWCASE_TASK_STATE_SHEET = 'Showcase_Task_State';
export const HOLIDAY_WORKFLOW_STATE_SHEET = 'Holiday_Workflow_State';
export const WAITING_LIST_STATE_SHEET = 'Waiting_List_State';
export const SCHEDULE_CONTEXT_SHEET = 'Schedule_Context';
export const PARENT_UNDERSTANDING_STATE_SHEET = 'Parent_Understanding_State';
export const STUDENT_PORTAL_ACCESS_SHEET = 'Student_Portal_Access';
export const TUTOR_ABSENCE_STATE_SHEET = 'Tutor_Absence_State';
export const COVER_BANK_STATE_SHEET = 'Cover_Bank_State';
export const TUTOR_LIFECYCLE_SHEET = 'Tutor_Lifecycle';
// How long each student has been with the school, derived from MMS lesson
// history on an explicit refresh (never on page load). Current-state per
// student, so it is rebuildable and safe to overwrite. Lifecycle_Snapshot is
// its append-only sibling: one row per refresh, so the retention trend has a
// memory even though this tab does not.
export const STUDENT_LIFECYCLE_SHEET = 'Student_Lifecycle';
export const LIFECYCLE_SNAPSHOT_SHEET = 'Lifecycle_Snapshot';
export const PLANNING_ITEMS_SHEET = 'Planning_Items';
export const PLANNING_PROGRESS_LOG_SHEET = 'Planning_Progress_Log';
export const PRACTICE_NOTES_LOG_SHEET = 'Practice_Notes_Log';
export const COMMUNICATION_LOG_SHEET = 'Communication_Log';
export const INCOMING_MESSAGE_INBOX_SHEET = 'Incoming_Message_Inbox';
export const WHATSAPP_GROUP_MAP_SHEET = 'WhatsApp_Group_Map';
export const PROPOSALS_SHEET = 'Proposals';
export const BRIDGE_STATUS_SHEET = 'Bridge_Status';
export const STUDENTS_ARCHIVE_SHEET = 'Students_Archive';
export const TUTOR_PAY_SHEET = 'Tutor_Pay';
export const EXPENSES_SHEET = 'Expenses';
export const EXPENSE_LOG_SHEET = 'Expense_Log';
export const FINANCE_SNAPSHOT_SHEET = 'Finance_Snapshot';
export const PAYROLL_RUNS_SHEET = 'Payroll_Runs';
export const TUTOR_WISE_SHEET = 'Tutor_Wise';
// Tutor WhatsApp numbers, so a tutor's own reply in a lesson group is recognised
// as school-side (reply evidence) instead of a mis-classified parent inbox row.
// Personal data — human-maintained, lives only in the sheet, never in git. Read
// tolerantly (getTutorPhoneRows) so the human-entered header wording is flexible.
export const TUTOR_PHONES_SHEET = 'Tutor_Phones';
export const SONG_ASSIGNMENTS_SHEET = 'Song_Assignments';
// Append-only telemetry for the song loop. Status_Log rows are written as a
// side effect of assignment writes (never blocking them); Outcomes rows are
// the tutor's optional one-tap "how did it go?" at done/parked.
export const SONG_STATUS_LOG_SHEET = 'Song_Status_Log';
export const SONG_OUTCOMES_SHEET = 'Song_Outcomes';
export const SONG_STATUS_LOG_HEADERS = [
  'log_id',
  'assignment_id',
  'mms_id',
  'song_id',
  'from_status',
  'to_status',
  'changed_by',
  'changed_at',
];
// Tutor "request this song" curation queue. The dashboard only ever appends
// status='new' rows; resolution (added/declined) happens via the add-song
// skill / manual sheet edit, not a dashboard surface.
export const SONG_REQUESTS_SHEET = 'Song_Requests';
export const SONG_REQUESTS_HEADERS = [
  'request_id',
  'requested_at',
  'requested_by',
  'mms_id',
  'instrument',
  'query_text',
  'status',
  'song_id',
  'resolution_note',
  'resolved_at',
  'updated_at',
];
export const SONG_OUTCOMES_HEADERS = [
  'outcome_id',
  'assignment_id',
  'mms_id',
  'song_id',
  'song_title',
  'at_status',
  'outcome',
  'note',
  'recorded_by',
  'recorded_at',
];
export const TUTOR_PAY_HEADERS = ['tutor', 'pay_model', 'hourly_rate', 'monthly_salary', 'invoice_cadence', 'payment_route', 'active_for_payroll', 'notes'];
// Wise batch-payment recipient details, keyed to each tutor. Sensitive — lives
// here (operational store), never in git. recipient_id is the opaque Wise id.
export const TUTOR_WISE_HEADERS = ['tutor', 'recipient_id', 'name', 'recipient_email', 'recipient_detail', 'source_currency', 'target_currency', 'amount_currency', 'receiver_type', 'notes'];
export const EXPENSES_HEADERS = ['name', 'amount', 'period', 'category', 'notes'];
export const EXPENSE_LOG_HEADERS = [
  'expense_id',
  'date',
  'amount',
  'category',
  'description',
  'paid_by',
  'reimbursable',
  'linked_area',
  'notes',
  'created_at',
  'created_by',
];
export const FINANCE_SNAPSHOT_HEADERS = [
  'snapshot_id',
  'snapshot_at',
  'period_type',
  'active_count',
  'paused_count',
  'setup_pending_count',
  'onboarded_count',
  'left_count',
  'active_unpriced_count',
  'active_weekly_revenue',
  'active_monthly_revenue',
  'paused_weekly_revenue',
  'vat_rate',
  'vat_liability_monthly',
  'net_revenue_monthly',
  'revenue_one_to_one_weekly',
  'revenue_group_weekly',
  'revenue_orchestra_weekly',
  'revenue_stripe_weekly',
  'revenue_manual_weekly',
  'unpriced_cost_slots',
  'variable_tutor_monthly',
  'salaried_monthly',
  'fixed_monthly',
  'actual_spend_month_to_date',
  'cash_view_cost_month_to_date',
  'total_cost_monthly',
  'margin_monthly',
  'cash_view_margin_month_to_date',
  'margin_pct',
  'source',
  'notes',
];
// Cached Stripe subscription amounts per student (the "slice B" actuals feed).
// Full-replace cache refreshed by /api/cron/stripe-amounts — a stale tab degrades
// the finance estimate honestly (source flips back to 'estimate'), never blocks it.
export const STRIPE_AMOUNTS_CACHE_SHEET = 'Stripe_Amounts_Cache';
export const STRIPE_AMOUNTS_CACHE_HEADERS = [
  'mms_id',
  'student_name',
  'stripe_customer_id',
  'stripe_subscription_id',
  'subscription_status',
  'paused',
  'interval',
  'weekly_amount',
  'monthly_amount',
  'currency',
  'discount_pct',
  'checked_at',
];
// First-write-wins monthly forecast made only from dashboard-owned roster,
// pricing, schedule, expectation and structured-pause evidence. The Stripe cron
// must lock this row before it makes any provider read.
export const STRIPE_FORECAST_MONTHLY_SHEET = 'Stripe_Forecast_Monthly';
export const STRIPE_FORECAST_MONTHLY_HEADERS = [
  'month',
  'forecasted_at',
  'forecast_total',
  'candidate_student_count',
  'forecasted_student_count',
  'billed_student_count',
  'zero_expected_count',
  'unpriced_count',
  'approximate_count',
  'coverage_pct',
  'unparsed_pause_count',
  'method',
  'assumptions_version',
  'items_json',
];
// One row per calendar month: what Stripe actually collected (paid invoices), for
// calibrating the estimate against reality. Keyed upsert by month.
export const STRIPE_COLLECTED_MONTHLY_SHEET = 'Stripe_Collected_Monthly';
export const STRIPE_COLLECTED_MONTHLY_HEADERS = [
  'month',
  'collected_total',
  'invoice_count',
  'matched_total',
  'matched_invoice_count',
  'unmatched_total',
  'unmatched_invoice_count',
  'student_breakdown_json',
  'currency',
  'refreshed_at',
];
export const PAYROLL_RUNS_HEADERS = [
  'payroll_id',
  'pay_date',
  'period_start',
  'period_end',
  'tutor',
  'tutor_short_name',
  'teacher_id',
  'invoice_cadence',
  'pay_model',
  'lesson_count',
  'review_lesson_count',
  'teaching_minutes',
  'expected_amount',
  'adjustment_amount',
  'final_amount',
  'status',
  'invoice_status',
  'payment_route',
  'statement_sent_at',
  'statement_sent_by',
  'notes',
  'reviewed_at',
  'reviewed_by',
  'paid_at',
  'paid_by',
  'source',
  'created_at',
  'updated_at',
  'tutor_response',
  'tutor_responded_at',
  'tutor_note',
];

export const SONG_ASSIGNMENTS_HEADERS = [
  'assignment_id',
  'mms_id',
  'song_id',
  'song_title',
  'assigned_by',
  'assigned_at',
  'status',
  'sort_order',
  'path_id',
  'step_label',
  'tutor_note_override',
  'updated_at',
  // Which door the row came through, because they carry different guarantees.
  // `shelf` = the Song Browser, where `assigned_by` is taken from a verified
  // tutor-surface token. `note` = a tutor linked the song in a Practice Note,
  // where the tutor name is self-attested (that route is guarded by a shared
  // app secret, not per-tutor identity). Blank on rows written before this
  // column existed, all of which came from the shelf.
  'assigned_via',
];
export const ISSUE_QUEUE_HEADERS = [
  'issue_id',
  'source',
  'issue_type',
  'mms_id',
  'context_key',
  'student_name',
  'severity',
  'status',
  'owner',
  'created_at',
  'updated_at',
  'resolved_at',
  'ignored_at',
  'acknowledged_at',
  'last_seen_at',
  'source_present',
  'summary',
  'detail',
  'recommended_action',
  'systems_affected',
  'resolution_note',
];
export const EVENT_LOG_HEADERS = [
  'event_id',
  'occurred_at',
  'actor_email',
  'entity_type',
  'entity_id',
  'event_type',
  'mms_id',
  'student_name',
  'issue_id',
  'payload_json',
  // A stable key for machine-generated exception events. It lets the append
  // layer suppress a retried/concurrent copy of the *same transition* without
  // changing the historical append-only nature of this tab.
  'event_dedupe_key',
];
export const SHOWCASE_TASK_STATE_HEADERS = [
  'workflow_key',
  'season',
  'year',
  'group_id',
  'task_id',
  'task_label',
  'completed',
  'completed_at',
  'updated_at',
];
export const HOLIDAY_WORKFLOW_STATE_HEADERS = [
  'workflow_key',
  'season',
  'year',
  'group_id',
  'task_id',
  'task_label',
  'completed',
  'completed_at',
  'updated_at',
];
export const WAITING_LIST_STATE_HEADERS = [
  'mms_id',
  'status',
  'note',
  'parent_name',
  'parent_email',
  'date_started',
  'updated_at',
];
export const SCHEDULE_CONTEXT_HEADERS = [
  'mms_id',
  'student_name',
  'status',
  'next_lesson_at',
  'usual_weekday',
  'usual_time',
  'duration_minutes',
  'teacher_id',
  'teacher_name',
  'event_category',
  'series_id',
  'source',
  'confidence',
  'warnings',
  'checked_at',
];
export const STUDENT_LIFECYCLE_HEADERS = [
  'mms_id',
  'student_name',
  'status',
  'active',
  'departed',
  'date_started',
  'first_lesson',
  'last_lesson',
  'next_lesson',
  'lessons_past',
  'lessons_future',
  'attended',
  // Exactly one of these carries a value: tenure for students still here,
  // lifetime for students who left. Blank is meaningful, not missing.
  'tenure_years',
  'lifetime_years',
  'refreshed_at',
];
export const LIFECYCLE_SNAPSHOT_HEADERS = [
  'snapshot_at',
  'students_with_history',
  'active_students',
  'departed_students',
  'median_tenure_years',
  'longest_tenure_years',
  'tenure_three_years_plus',
  'median_lifetime_years',
  'longest_lifetime_years',
  'median_lessons_before_leaving',
  'departures_within_three_months',
  'departures_never_started',
  // The dial that validates the columns to its left: retention depends on
  // knowing when a student stopped, which depends on the register being kept.
  'marking_completeness_pct',
  'marking_lessons_counted',
  'notes',
];
export const PARENT_UNDERSTANDING_STATE_HEADERS = [
  'record_id',
  'student_mms_id',
  'student_name',
  'parent_name',
  'workflow_status',
  'loop_status',
  'call_attempt_count',
  'last_contacted_at',
  'understanding_score',
  'understanding_label',
  'risk_signals',
  'whatsapp_understanding',
  'best_contact_time',
  'community_group_status',
  'feedback_summary',
  'tutor_relevance',
  'admin_follow_up_note',
  'summary',
  'details_json',
  'updated_at',
  'updated_by',
];
export const STUDENT_PORTAL_ACCESS_HEADERS = [
  'student_mms_id',
  'student_name',
  'friendly_url',
  'tutor_name',
  'workflow_status',
  'protection_enabled',
  'claimed_by',
  'claimed_at',
  'follow_up_note',
  'active_code_ciphertext',
  'active_code_salt',
  'active_code_verifier',
  'credential_version',
  'pending_credential_id',
  'pending_code_ciphertext',
  'pending_code_salt',
  'pending_code_verifier',
  'pending_credential_version',
  'description_confirmed_at',
  'description_confirmed_by',
  'message_sent_at',
  'message_sent_by',
  'activated_at',
  'activated_by',
  'updated_at',
  'updated_by',
];
// Phone-call availability survey, one row per tutor (internal short name or
// ext:<slug> for external cover-bank tutors, who exist only as rows here).
export const COVER_BANK_STATE_HEADERS = [
  'record_id',
  'tutor_key',
  'tutor_name',
  'tutor_type',
  'phone',
  'instruments',
  'call_status',
  'willing',
  'notice',
  'available_days',
  'notes',
  'last_contacted_at',
  'updated_at',
  'updated_by',
];
export const TUTOR_ABSENCE_STATE_HEADERS = [
  'absence_id',
  'tutor_short_name',
  'tutor_name',
  'absence_date',
  'status',
  'decision',
  'cover_tutor_short_name',
  'cover_tutor_name',
  'affected_lessons_json',
  'message_state_json',
  'note',
  'created_at',
  'updated_at',
  'resolved_at',
  'updated_by',
];
// A small, human-operated lifecycle lane keyed by the immutable MMS teacher ID.
// Tutor identity itself remains generated in ADMIN_TUTORS; this records whether
// that identity is available for new/live operational work.
export const TUTOR_LIFECYCLE_HEADERS = [
  'teacher_id',
  'tutor_short_name',
  'tutor_name',
  'status',
  'final_teaching_date',
  'retired_at',
  'replacement_tutor_short_name',
  'note',
  'created_at',
  'updated_at',
  'updated_by',
];
export const PLANNING_ITEMS_HEADERS = [
  'planning_id',
  'title',
  'notes',
  'item_type',
  'owner',
  'status',
  'area',
  'linked_workflow_id',
  'linked_student_id',
  'linked_tutor_id',
  'parent_planning_id',
  'outcome',
  'next_action',
  'target_date',
  'created_at',
  'updated_at',
  'created_by',
  'last_updated_by',
  'plan_mode',
  'is_pause',
];
export const PLANNING_PROGRESS_LOG_HEADERS = [
  'progress_id',
  'planning_id',
  'progress_note',
  'progress_type',
  'created_at',
  'created_by',
];
export const PRACTICE_NOTES_LOG_HEADERS = [
  'note_id',
  'delivery_key',
  'student_mms_id',
  'student_name',
  'tutor_name',
  'acting_tutor',
  'lesson_date',
  'what_we_did',
  'progress_challenges',
  'practice_goals',
  'raw_note_text',
  'song_ids_json',
  'song_titles_json',
  'unlisted_song_titles_json',
  'song_link_version',
  'copied_to_clipboard',
  'attendance_step_opened',
  'mms_event_id',
  'mms_attendance_id',
  'mms_attendance_status',
  'mms_attendance_saved',
  'target_selection_reason',
  'target_selection_label',
  'recipient_profile_id',
  'recipient_name',
  'recipient_email',
  'email_channel',
  'email_send_status',
  'email_sent_at',
  'gmail_message_id',
  'gmail_thread_id',
  'email_error',
  'manual_follow_up_needed',
  'operation_status',
  'completed_at',
  'source',
  'created_at',
  'user_agent',
];
export const PRACTICE_CHAT_SESSIONS_SHEET = 'Practice_Chat_Sessions';
// One row per Practice Chat *attempt*, not per finished note — the whole point
// is that Practice_Notes_Log only exists when a tutor got to the end, so every
// question about friction is invisible there by construction.
//
// Deliberately carries no audio, no transcript and no note text: durations,
// counts and flags only, plus one capped free-text comment a tutor chose to
// write. That keeps this lane's sensitivity well below Practice_Notes_Log's and
// means it can be purged on its own schedule when the evaluation ends.
export const PRACTICE_CHAT_SESSIONS_HEADERS = [
  'session_id',
  'opened_at',
  'student_mms_id',
  'tutor',
  'asr_model',
  'build_version',
  // `phase` is the furthest point the client reported reaching. Abandonment is
  // never written here: a client that died cannot report that it gave up, so it
  // is derived at read time from phase + age (see practice-chat-eval-helpers).
  'phase',
  'outcome',
  'note_id',
  'questions_answered',
  'questions_skipped',
  'typed_not_spoken',
  'last_step',
  'ms_to_first_record',
  'ms_capture_total',
  'ms_transcribe_total',
  // The friction number. ms_session_total is contaminated by panels left open
  // mid-teaching, so it is context, not a measure.
  'ms_active',
  'ms_session_total',
  'asr_error_count',
  // A Back-button re-record is a correction, not a failure. Kept apart from
  // asr_error_count so a careful tutor never reads as a broken one.
  're_record_count',
  'safety_flag_count',
  'safety_ack',
  'note_edited',
  'edit_char_delta',
  'songs_selected',
  'unlisted_songs',
  'prior_note_exists',
  'prior_note_age_days',
  'prior_history_opened',
  'rating_prompted',
  'rating_accuracy',
  'rating_comment',
  'rating_answered_at',
  'prior_usefulness',
  'prior_usefulness_at',
  'steps_json',
  'created_at',
];
export const COMMUNICATION_LOG_HEADERS = [
  'message_id',
  'logged_at',
  'category',
  'channel',
  'mms_id',
  'student_name',
  'body',
  'source',
  'actor_email',
];
export const INCOMING_MESSAGE_INBOX_HEADERS = [
  'incoming_id',
  'source',
  'external_message_id',
  'captured_at',
  'message_at',
  'chat_id',
  'chat_name',
  'sender_name',
  'sender_phone',
  'message_text',
  'captured_by',
  'suspected_category',
  'proposed_category',
  'proposed_intent',
  'proposed_actionability',
  'classification_intent',
  'classification_actionability',
  'classification_confidence',
  'classification_version',
  'classification_evidence',
  'classification_decision',
  'matched_mms_id',
  'matched_student_name',
  'match_confidence',
  'match_reasons',
  'status',
  'review_note',
  'reviewed_by',
  'reviewed_at',
  'created_planning_id',
  'resolution_type',
  'snoozed_until',
  'school_replied_at',
  'school_replied_by',
  'raw_json',
  'group_type',
  'matched_tutor_id',
  'matched_tutor_name',
];
// One generic machine-prepares/human-commits proposals store (keyed upsert by
// proposal_id). V1 has a single lane, incoming_reply. evidence_json is exactly
// what the model saw (already redacted); applied_body is the text the human
// actually used, so used-unmodified vs edited telemetry needs no extra column.
export const PROPOSALS_HEADERS = [
  'proposal_id',
  'lane',
  'created_at',
  'created_by',
  'status',
  'linked_id',
  'mms_id',
  'evidence_json',
  'proposal_body',
  'applied_body',
  'decided_by',
  'decided_at',
  'rejection_reason',
  'applied_at',
];
// One row per bridge (keyed by bridge_id) — the WhatsApp bridge's heartbeat,
// so "alive but not okay" states (empty group list, stale connection) are
// visible on the dashboard instead of only in local logs.
export const BRIDGE_STATUS_HEADERS = [
  'bridge_id',
  'last_heartbeat_at',
  'connected_at',
  'started_at',
  'confirmed_groups',
  'cached_messages',
  'bridge_version',
  'raw_json',
];
export const WHATSAPP_GROUP_MAP_HEADERS = [
  'chat_id',
  'chat_name',
  'first_seen_at',
  'last_seen_at',
  'last_incoming_id',
  'last_message_at',
  'last_sender_name',
  'last_sender_phone',
  'matched_mms_id',
  'matched_fc_id',
  'matched_student_name',
  'additional_mms_ids',
  'parent_name',
  'parent_phone',
  'tutor_name',
  'instrument',
  'match_confidence',
  'match_reasons',
  'status',
  'confirmed_by',
  'confirmed_at',
  'notes',
  'raw_json',
  'group_type',
  'matched_tutor_id',
];

export function buildStudentsArchiveHeaders(studentHeaders = []) {
  return [
    'archived_at',
    'archived_by',
    'archive_note',
    'date_left',
    ...studentHeaders,
  ];
}

export function buildManagedStateSheetDefinitions(studentHeaders = []) {
  return [
    { sheetName: ISSUE_QUEUE_SHEET, requiredHeaders: ISSUE_QUEUE_HEADERS },
    { sheetName: EVENT_LOG_SHEET, requiredHeaders: EVENT_LOG_HEADERS },
    { sheetName: WAITING_LIST_STATE_SHEET, requiredHeaders: WAITING_LIST_STATE_HEADERS },
    { sheetName: SHOWCASE_TASK_STATE_SHEET, requiredHeaders: SHOWCASE_TASK_STATE_HEADERS },
    { sheetName: HOLIDAY_WORKFLOW_STATE_SHEET, requiredHeaders: HOLIDAY_WORKFLOW_STATE_HEADERS },
    { sheetName: SCHEDULE_CONTEXT_SHEET, requiredHeaders: SCHEDULE_CONTEXT_HEADERS },
    { sheetName: PARENT_UNDERSTANDING_STATE_SHEET, requiredHeaders: PARENT_UNDERSTANDING_STATE_HEADERS },
    { sheetName: STUDENT_PORTAL_ACCESS_SHEET, requiredHeaders: STUDENT_PORTAL_ACCESS_HEADERS },
    { sheetName: TUTOR_ABSENCE_STATE_SHEET, requiredHeaders: TUTOR_ABSENCE_STATE_HEADERS },
    { sheetName: COVER_BANK_STATE_SHEET, requiredHeaders: COVER_BANK_STATE_HEADERS },
    { sheetName: TUTOR_LIFECYCLE_SHEET, requiredHeaders: TUTOR_LIFECYCLE_HEADERS },
    { sheetName: STUDENT_LIFECYCLE_SHEET, requiredHeaders: STUDENT_LIFECYCLE_HEADERS },
    { sheetName: LIFECYCLE_SNAPSHOT_SHEET, requiredHeaders: LIFECYCLE_SNAPSHOT_HEADERS },
    { sheetName: PLANNING_ITEMS_SHEET, requiredHeaders: PLANNING_ITEMS_HEADERS },
    { sheetName: PLANNING_PROGRESS_LOG_SHEET, requiredHeaders: PLANNING_PROGRESS_LOG_HEADERS },
    { sheetName: PRACTICE_NOTES_LOG_SHEET, requiredHeaders: PRACTICE_NOTES_LOG_HEADERS },
    { sheetName: PRACTICE_CHAT_SESSIONS_SHEET, requiredHeaders: PRACTICE_CHAT_SESSIONS_HEADERS },
    { sheetName: COMMUNICATION_LOG_SHEET, requiredHeaders: COMMUNICATION_LOG_HEADERS },
    { sheetName: INCOMING_MESSAGE_INBOX_SHEET, requiredHeaders: INCOMING_MESSAGE_INBOX_HEADERS },
    { sheetName: WHATSAPP_GROUP_MAP_SHEET, requiredHeaders: WHATSAPP_GROUP_MAP_HEADERS },
    { sheetName: PROPOSALS_SHEET, requiredHeaders: PROPOSALS_HEADERS },
    { sheetName: BRIDGE_STATUS_SHEET, requiredHeaders: BRIDGE_STATUS_HEADERS },
    { sheetName: STUDENTS_ARCHIVE_SHEET, requiredHeaders: buildStudentsArchiveHeaders(studentHeaders) },
    { sheetName: TUTOR_PAY_SHEET, requiredHeaders: TUTOR_PAY_HEADERS },
    { sheetName: TUTOR_WISE_SHEET, requiredHeaders: TUTOR_WISE_HEADERS },
    { sheetName: EXPENSES_SHEET, requiredHeaders: EXPENSES_HEADERS },
    { sheetName: EXPENSE_LOG_SHEET, requiredHeaders: EXPENSE_LOG_HEADERS },
    { sheetName: FINANCE_SNAPSHOT_SHEET, requiredHeaders: FINANCE_SNAPSHOT_HEADERS },
    { sheetName: PAYROLL_RUNS_SHEET, requiredHeaders: PAYROLL_RUNS_HEADERS },
    { sheetName: STRIPE_AMOUNTS_CACHE_SHEET, requiredHeaders: STRIPE_AMOUNTS_CACHE_HEADERS },
    { sheetName: STRIPE_FORECAST_MONTHLY_SHEET, requiredHeaders: STRIPE_FORECAST_MONTHLY_HEADERS },
    { sheetName: STRIPE_COLLECTED_MONTHLY_SHEET, requiredHeaders: STRIPE_COLLECTED_MONTHLY_HEADERS },
    { sheetName: SONG_ASSIGNMENTS_SHEET, requiredHeaders: SONG_ASSIGNMENTS_HEADERS },
    { sheetName: SONG_STATUS_LOG_SHEET, requiredHeaders: SONG_STATUS_LOG_HEADERS },
    { sheetName: SONG_OUTCOMES_SHEET, requiredHeaders: SONG_OUTCOMES_HEADERS },
    { sheetName: SONG_REQUESTS_SHEET, requiredHeaders: SONG_REQUESTS_HEADERS },
  ];
}

export function getSheetsEnv() {
  return {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
    refreshToken: process.env.SHEETS_REFRESH_TOKEN || '',
    clientId: process.env.SHEETS_CLIENT_ID || '',
    clientSecret: process.env.SHEETS_CLIENT_SECRET || '',
  };
}

function cloneSheetValues(values = []) {
  return values.map((row) => [...row]);
}

function parseSheetNameFromRange(range = '') {
  const [sheetPart] = `${range || ''}`.split('!');
  return sheetPart.replace(/^'/u, '').replace(/'$/u, '').replace(/''/g, "'").trim();
}

function buildReadCacheKey({ spreadsheetId, range }) {
  return `${spreadsheetId}::${range}`;
}

// Google Sheets occasionally returns transient errors (503 service unavailable,
// 429 rate limit, 5xx). Retry those with backoff so a momentary blip self-heals
// instead of failing a page load or the schedule-refresh cron.
const TRANSIENT_SHEETS_STATUSES = new Set([429, 500, 502, 503, 504]);
// 429 is a *per-minute* quota, not a blip: it will not clear in the few seconds
// a full backoff ladder takes, and every extra attempt spends more of the quota
// that is already gone. So quota errors get a short ladder and we lean on the
// stale cache instead (see getSheetValues' staleOnError). 5xx really is a blip
// and keeps the full ladder.
const SHEETS_QUOTA_STATUS = 429;
const SHEETS_QUOTA_ATTEMPTS = 2;

export async function withSheetsRetry(operation, { attempts = 4, baseDelayMs = 600 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.code || error?.response?.status || error?.status);
      if (!TRANSIENT_SHEETS_STATUSES.has(status)) {
        throw error;
      }

      const allowedAttempts = status === SHEETS_QUOTA_STATUS
        ? Math.min(attempts, SHEETS_QUOTA_ATTEMPTS)
        : attempts;
      if (attempt >= allowedAttempts - 1) {
        throw error;
      }

      // Jitter so a burst of reads that failed together does not retry in
      // lockstep and recreate the same spike.
      const delay = baseDelayMs * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay * 0.5));
    }
  }
  throw lastError;
}

// Google caps Sheets reads at 60 per minute *per user*, and every request in
// this app shares one service account, so that single number is the ceiling for
// the whole dashboard. Count real API reads (cache misses and retries — both
// spend quota) in a rolling minute, so over-reading shows up as a warning in the
// logs before it shows up as a 429 in front of somebody.
export const SHEETS_READ_QUOTA_PER_MINUTE = 60;
const SHEETS_READ_WARN_AT = Math.floor(SHEETS_READ_QUOTA_PER_MINUTE * 0.75);
let readWindowStartedAt = Date.now();
let readWindowCount = 0;
let readWindowWarned = false;

function recordSheetsRead(range) {
  const now = Date.now();
  if (now - readWindowStartedAt >= 60_000) {
    readWindowStartedAt = now;
    readWindowCount = 0;
    readWindowWarned = false;
  }

  readWindowCount += 1;

  // Warn once per window: the point is to notice the pattern, not to add its own
  // noise to a minute that is already going badly.
  if (readWindowCount >= SHEETS_READ_WARN_AT && !readWindowWarned) {
    readWindowWarned = true;
    console.warn(
      `Sheets read budget: ${readWindowCount}/${SHEETS_READ_QUOTA_PER_MINUTE} reads in the last minute `
      + `(most recent: ${range}). Cache or batch a caller before this becomes a 429.`,
    );
  }
}

export function getSheetsReadBudget() {
  return {
    reads: readWindowCount,
    quota: SHEETS_READ_QUOTA_PER_MINUTE,
    warnAt: SHEETS_READ_WARN_AT,
    windowStartedAt: readWindowStartedAt,
  };
}

export function resetSheetsReadBudgetForTests() {
  readWindowStartedAt = Date.now();
  readWindowCount = 0;
  readWindowWarned = false;
}

export function getCachedSheetValues({ spreadsheetId, range }) {
  const cached = sheetReadCache.peek(buildReadCacheKey({ spreadsheetId, range }));
  return cached?.isFresh ? cached.value : null;
}

export function getStaleCachedSheetValues({ spreadsheetId, range }) {
  const cached = sheetReadCache.peek(buildReadCacheKey({ spreadsheetId, range }));
  if (!cached) {
    return null;
  }
  return { values: cached.value, isFresh: cached.isFresh, age: cached.age };
}

export function setCachedSheetValues({ spreadsheetId, range, values }) {
  sheetReadCache.set(buildReadCacheKey({ spreadsheetId, range }), values);
}

export function clearSheetReadCacheForTests() {
  sheetReadCache.clear();
}

export function invalidateSheetReadCache(sheetName) {
  sheetReadCache.invalidateScope(`${sheetName || ''}`.trim());
}

export async function getLocalTokenCredentials() {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  try {
    const raw = await readFile(LOCAL_TOKEN_PATH, 'utf8');
    const token = JSON.parse(raw);

    if (!token.refresh_token || !token.client_id || !token.client_secret) {
      return null;
    }

    return {
      refreshToken: token.refresh_token,
      clientId: token.client_id,
      clientSecret: token.client_secret,
    };
  } catch {
    return null;
  }
}

export function mapRowsToObjects(rows) {
  if (!rows?.length) return [];

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => `${cell || ''}`.trim() !== ''))
    .map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? '';
      });
      return entry;
    });
}

export function mapRowsToObjectsWithRowNumbers(rows) {
  if (!rows?.length) return [];

  const [headers, ...dataRows] = rows;
  return dataRows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => `${cell || ''}`.trim() !== ''))
    .map(({ row, rowNumber }) => {
      const entry = { __rowNumber: rowNumber };
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? '';
      });
      return entry;
    });
}

export function buildSheetRange(sheetName, range = '') {
  const escaped = /[\s']/u.test(sheetName)
    ? `'${sheetName.replace(/'/g, "''")}'`
    : sheetName;
  return range ? `${escaped}!${range}` : escaped;
}

export async function getSheetsClient() {
  if (globalThis.__firstChordSheetsClientPromise) {
    return globalThis.__firstChordSheetsClientPromise;
  }

  globalThis.__firstChordSheetsClientPromise = (async () => {
  const { spreadsheetId, refreshToken, clientId, clientSecret } = getSheetsEnv();
  const localToken = await getLocalTokenCredentials();
  const authConfig = localToken || {
    refreshToken,
    clientId,
    clientSecret,
  };

  if (!spreadsheetId || !authConfig.refreshToken || !authConfig.clientId || !authConfig.clientSecret) {
    return null;
  }

  const auth = new google.auth.OAuth2(authConfig.clientId, authConfig.clientSecret);
  auth.setCredentials({ refresh_token: authConfig.refreshToken });

  // `timeout` is a gaxios option and applies to every request this client makes,
  // so it covers all ~46 Sheets call sites at once. Without it a stalled Google
  // connection hangs the render forever: an admin page waits on a promise that
  // never settles and the only symptom is a spinner that never stops. Failing
  // loudly at 30s is strictly better — `withSheetsRetry` already handles the
  // transient case, and a real read takes well under two seconds.
  return google.sheets({ version: 'v4', auth, timeout: SHEETS_REQUEST_TIMEOUT_MS });
  })();

  return globalThis.__firstChordSheetsClientPromise;
}

export async function ensureSheetHeaders({ sheets, spreadsheetId, sheetName, headers, missingHeaders }) {
  if (!missingHeaders.length) {
    return headers;
  }

  const nextHeaders = [...headers, ...missingHeaders];
  const endColumn = columnNumberToLetter(nextHeaders.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${endColumn}1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [nextHeaders],
    },
  });

  return nextHeaders;
}

const SPREADSHEET_METADATA_TTL_MS = 60 * 1000;
const spreadsheetMetadataCache = new Map(); // spreadsheetId -> { at, sheets }
const spreadsheetMetadataInflight = new Map(); // spreadsheetId -> Promise

// Spreadsheet (tab list) metadata is read by ensureManagedSheet for every managed tab.
// Cache it briefly so a page that touches several managed tabs shares ONE metadata read,
// and retry on transient 429/5xx instead of crashing (read-quota resilience).
export async function getSpreadsheetMetadata({ sheets, spreadsheetId, forceRefresh = false }) {
  const cached = spreadsheetMetadataCache.get(spreadsheetId);
  if (!forceRefresh && cached && Date.now() - cached.at < SPREADSHEET_METADATA_TTL_MS) {
    return cached.sheets;
  }

  // Callers arrive in parallel — a page that touches four managed tabs calls
  // ensureManagedSheet four times at once — and with only a completed-result
  // cache every one of them missed and fetched. That spent four requests on
  // one answer, on every cold start. Share the in-flight request instead.
  const existing = spreadsheetMetadataInflight.get(spreadsheetId);
  if (existing && !forceRefresh) return existing;

  const request = withSheetsRetry(() => {
    recordSheetsRead(`${spreadsheetId} (metadata)`);
    return sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
      fields: 'sheets.properties.title,sheets.properties.sheetId',
    });
  }).then((response) => {
    const sheetList = response.data.sheets || [];
    spreadsheetMetadataCache.set(spreadsheetId, { at: Date.now(), sheets: sheetList });
    return sheetList;
  }).finally(() => {
    spreadsheetMetadataInflight.delete(spreadsheetId);
  });

  spreadsheetMetadataInflight.set(spreadsheetId, request);
  return request;
}

export async function ensureManagedSheet({ sheets, spreadsheetId, sheetName, requiredHeaders }) {
  const cacheKey = `${spreadsheetId}:${sheetName}`;
  const cachedHeaders = managedSheetHeadersCache.get(cacheKey);
  if (cachedHeaders?.length) {
    const missingHeaders = requiredHeaders.filter((header) => !cachedHeaders.includes(header));
    if (!missingHeaders.length) {
      return cachedHeaders;
    }
  }

  let spreadsheetSheets = await getSpreadsheetMetadata({ sheets, spreadsheetId });
  let existingSheet = spreadsheetSheets.find((entry) => entry.properties?.title === sheetName);

  // A cached "not found" could be stale — confirm with a fresh fetch before creating, so
  // the metadata cache can never cause a duplicate addSheet.
  if (!existingSheet) {
    spreadsheetSheets = await getSpreadsheetMetadata({ sheets, spreadsheetId, forceRefresh: true });
    existingSheet = spreadsheetSheets.find((entry) => entry.properties?.title === sheetName);
  }

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
    spreadsheetMetadataCache.delete(spreadsheetId);

    const endColumn = columnNumberToLetter(requiredHeaders.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: buildSheetRange(sheetName, `A1:${endColumn}1`),
      valueInputOption: 'RAW',
      requestBody: {
        values: [requiredHeaders],
      },
    });

    managedSheetHeadersCache.set(cacheKey, requiredHeaders);
    return requiredHeaders;
  }

  const response = await withSheetsRetry(() => {
    recordSheetsRead(buildSheetRange(sheetName, '1:1'));
    return sheets.spreadsheets.values.get({
      spreadsheetId,
      range: buildSheetRange(sheetName, '1:1'),
    });
  });

  const headers = response.data.values?.[0] || [];
  if (!headers.length) {
    const endColumn = columnNumberToLetter(requiredHeaders.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: buildSheetRange(sheetName, `A1:${endColumn}1`),
      valueInputOption: 'RAW',
      requestBody: {
        values: [requiredHeaders],
      },
    });

    managedSheetHeadersCache.set(cacheKey, requiredHeaders);
    return requiredHeaders;
  }

  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  const nextHeaders = await ensureSheetHeaders({
    sheets,
    spreadsheetId,
    sheetName,
    headers,
    missingHeaders,
  });
  managedSheetHeadersCache.set(cacheKey, nextHeaders);
  return nextHeaders;
}

export async function upsertManagedSheetRow({
  sheets,
  spreadsheetId,
  sheetName,
  requiredHeaders,
  valuesByHeader,
  matchesRow,
}) {
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders,
  });

  const values = await getSheetValues(sheetName, { force: true });
  const [, ...rows] = values;
  const targetRowIndex = rows.findIndex((entry) => matchesRow(entry, headers));
  const nextRow = headers.map((header) => valuesByHeader[header] ?? '');
  const endColumn = columnNumberToLetter(headers.length);

  if (targetRowIndex === -1) {
    await withSheetsRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId,
      range: buildSheetRange(sheetName, 'A:A'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [nextRow],
      },
    }));
    invalidateSheetReadCache(sheetName);
    return;
  }

  const rowNumber = targetRowIndex + 2;
  await withSheetsRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: buildSheetRange(sheetName, `A${rowNumber}:${endColumn}${rowNumber}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [nextRow],
    },
  }));
  invalidateSheetReadCache(sheetName);
}

// Row-object view of a tab. This shares getSheetValues' cache on purpose: it
// used to read straight through to the API, which meant the three busiest
// readers in the app (Students, Review_Flags, Pause History — see
// lib/admin/student-context.js) spent three requests of the per-minute quota on
// every call no matter how recently they had run.
export async function getSheetObjects(range) {
  return mapRowsToObjects(await getSheetValues(range));
}

export async function getSheetValues(range, { force = false } = {}) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  return sheetReadCache.read(
    buildReadCacheKey({ spreadsheetId, range }),
    () => withSheetsRetry(() => {
      recordSheetsRead(range);
      return sheets.spreadsheets.values.get({ spreadsheetId, range });
    }).then((response) => response.data.values || []),
    // A forced read is feeding a write, so it must never be satisfied from a
    // stale copy. An ordinary read would rather show bounded-stale data than
    // fail the page when Sheets is rate-limiting or wobbling.
    { force, staleOnError: !force },
  );
}

/**
 * Fetches several tabs in ONE Sheets request and leaves them in the same cache
 * `getSheetValues` reads from.
 *
 * The quota is 60 reads per minute per user and cannot be raised (see
 * `docs/architecture/data/sheets-reads.md`), so the only lever is reading less.
 * A `batchGet` of eight ranges costs one request where eight `get` calls cost
 * eight — the single best ratio available to us.
 *
 * Deliberately a cache-warmer rather than a new read API: call it once at the
 * top of anything that touches several tabs, and every existing reader
 * underneath finds its data already there and makes no request of its own. That
 * keeps the batching decision at the call site, where someone can see all the
 * tabs at once, instead of threading it through every adapter.
 *
 * Ranges already fresh in cache are not re-fetched. Failure is not fatal: the
 * readers behind it will simply fetch as they always did.
 */
export async function prefetchSheetValues(ranges = []) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return;

  const unique = [...new Set(ranges.map((range) => `${range || ''}`.trim()).filter(Boolean))];
  if (unique.length < 2) return; // One range is just a normal read.

  // Anything not already fresh has to be fetched, including entries inside the
  // stale-while-revalidate window — those serve instantly but still refresh.
  const wanted = unique.filter((range) => {
    const cached = sheetReadCache.peek(buildReadCacheKey({ spreadsheetId, range }), { keepExpired: true });
    return !cached?.isFresh;
  });
  if (wanted.length < 2) return;

  let batch = null;
  const runBatch = () => {
    if (!batch) {
      batch = withSheetsRetry(() => {
        // One request against the budget, however many ranges it carries.
        recordSheetsRead(`batchGet ${wanted.length} ranges: ${wanted.join(', ')}`);
        return sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: wanted });
      }).then((response) => {
        const byRange = new Map();
        for (const [index, valueRange] of (response.data.valueRanges || []).entries()) {
          byRange.set(wanted[index], valueRange?.values || []);
        }
        return byRange;
      });
    }
    return batch;
  };

  // Each range still goes through the cache's own read path, so in-flight
  // de-duplication and write-invalidation versioning behave exactly as usual —
  // they simply all resolve from the one shared request.
  await Promise.all(wanted.map((range) => sheetReadCache
    .read(
      buildReadCacheKey({ spreadsheetId, range }),
      () => runBatch().then((byRange) => byRange.get(range) || []),
      { staleOnError: true },
    )
    .catch((error) => {
      console.warn(`Sheets prefetch failed for ${range}; the reader will fetch it:`, error?.message || error);
      return [];
    })));
}

export async function ensureDashboardStateTabs() {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const studentsValues = await getSheetValues('Students');
  const studentHeaders = studentsValues[0] || [];
  if (!studentHeaders.length) {
    throw new Error('Students sheet is empty or unavailable');
  }

  const results = [];
  for (const definition of buildManagedStateSheetDefinitions(studentHeaders)) {
    const headers = await ensureManagedSheet({
      sheets,
      spreadsheetId,
      sheetName: definition.sheetName,
      requiredHeaders: definition.requiredHeaders,
    });
    results.push({
      sheetName: definition.sheetName,
      headerCount: headers.length,
    });
  }

  return results;
}
