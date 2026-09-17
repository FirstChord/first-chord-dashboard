/** @fileoverview Pure practice-note parsing, id and delivery-key building, log-row mapping, and portal note selection. */
import crypto from 'node:crypto';

const MAX_FIELD_LENGTH = 5000;

function clean(value = '', maxLength = MAX_FIELD_LENGTH) {
  return `${value || ''}`.trim().slice(0, maxLength);
}

function boolString(value) {
  return value ? 'TRUE' : 'FALSE';
}

function stringList(value, maxItems = 12) {
  let entries = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      entries = Array.isArray(parsed) ? parsed : value.split(',');
    } catch {
      entries = value.split(',');
    }
  }
  if (!Array.isArray(entries)) return [];
  return [...new Set(entries.map((entry) => clean(entry, 300)).filter(Boolean))].slice(0, maxItems);
}

// Practice Chat writes each note as a raw block of bracketed section headings.
// Two heading vocabularies exist in the wild: the original Level 1 set and the
// Level 2 ("guided") set used by e.g. Fennella's notes. Both map onto the same
// three structured fields, so a note captured as a single raw block still
// yields what_we_did / progress / goals for insights, the timeline, and the
// portal. Raw text stays canonical; these fields are always derived from it.
const NOTE_SECTION_MATCHERS = [
  { key: 'whatWeDid', test: (label) => /what we did/.test(label) || /what did we do in the lesson/.test(label) },
  { key: 'progressChallenges', test: (label) => /progress\s*&\s*challenges/.test(label) || /what went well|what was challenging/.test(label) },
  { key: 'practiceGoals', test: (label) => /practice goals?/.test(label) || /good practice over the week/.test(label) },
];

const CANONICAL_SECTION_HEADINGS = {
  whatWeDid: 'What we did',
  progressChallenges: 'Progress & Challenges',
  practiceGoals: 'Practice Goals',
};

function classifyNoteHeading(label = '') {
  const normalised = `${label || ''}`.trim().toLowerCase();
  if (!normalised) return '';
  const match = NOTE_SECTION_MATCHERS.find((entry) => entry.test(normalised));
  return match ? match.key : '';
}

// Some Level 2 notes drop the brackets and use the full question as a plain
// line. These matchers anchor the whole line so a body sentence that merely
// starts with "What went well…" is not mistaken for a heading.
const NOTE_HEADING_LINE_MATCHERS = [
  { key: 'whatWeDid', re: /^what (?:did we do|we did)\b.*\blesson\b[\s?.:!]*$/i },
  { key: 'progressChallenges', re: /^what went well\b.*challeng/i },
  { key: 'practiceGoals', re: /^what would be good practice\b/i },
];

function classifyNoteHeadingLine(line = '') {
  const trimmed = `${line || ''}`.trim();
  if (!trimmed) return '';
  const match = NOTE_HEADING_LINE_MATCHERS.find((entry) => entry.re.test(trimmed));
  return match ? match.key : '';
}

// Split a raw note into its three sections. Preferred path walks the
// [bracketed] headings (both heading vocabularies, and both layouts: heading on
// its own line, or body inline immediately after the bracket). Notes that drop
// the brackets fall back to bare-line heading detection. First match for each
// field wins; unrecognised markers are ignored.
export function parsePracticeNoteSections(rawText = '') {
  const text = `${rawText || ''}`;
  const sections = { whatWeDid: '', progressChallenges: '', practiceGoals: '' };

  const bracketMatches = [...text.matchAll(/\[([^\]]+)\]/g)];
  if (bracketMatches.some((match) => classifyNoteHeading(match[1]))) {
    for (let i = 0; i < bracketMatches.length; i += 1) {
      const key = classifyNoteHeading(bracketMatches[i][1]);
      if (!key || sections[key]) continue;
      const start = bracketMatches[i].index + bracketMatches[i][0].length;
      const end = i + 1 < bracketMatches.length ? bracketMatches[i + 1].index : text.length;
      sections[key] = text.slice(start, end).trim();
    }
    return sections;
  }

  const buffers = { whatWeDid: [], progressChallenges: [], practiceGoals: [] };
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    const key = classifyNoteHeadingLine(line);
    if (key) {
      current = key;
      continue;
    }
    if (current) buffers[current].push(line);
  }
  for (const key of Object.keys(sections)) {
    sections[key] = buffers[key].join('\n').trim();
  }
  return sections;
}

function dateTimeValue(value = '') {
  const cleaned = clean(value, 120);
  if (!cleaned) return '';
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? cleaned : parsed.toISOString();
}

export function buildPracticeNoteId({ studentMmsId = '', createdAt = '', rawNoteText = '' } = {}) {
  const seed = [studentMmsId, createdAt, rawNoteText].join('|');
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `practice_note:${studentMmsId || 'unknown'}:${hash}`;
}

export function buildPracticeNoteDeliveryKey({
  studentMmsId = '',
  mmsAttendanceId = '',
  rawNoteText = '',
} = {}) {
  const cleanedStudentId = clean(studentMmsId, 120);
  const cleanedAttendanceId = clean(mmsAttendanceId, 120);
  const cleanedNoteText = clean(rawNoteText).replace(/\s+/g, ' ');
  if (!cleanedStudentId || !cleanedAttendanceId || !cleanedNoteText) return '';
  const hash = crypto.createHash('sha256').update(cleanedNoteText).digest('hex').slice(0, 16);
  return `practice_note_delivery:${cleanedStudentId}:${cleanedAttendanceId}:${hash}`;
}

export function normalisePracticeNotePayload(payload = {}, now = new Date()) {
  const createdAt = clean(payload.createdAt) || now.toISOString();
  const studentMmsId = clean(payload.studentMmsId || payload.studentId, 120);
  const studentName = clean(payload.studentName, 200);
  const tutorName = clean(payload.tutorName || payload.tutor, 200);
  const lessonDate = clean(payload.lessonDate, 120);
  const rawNoteText = clean(payload.rawNoteText || payload.noteText);
  let whatWeDid = clean(payload.whatWeDid);
  let progressChallenges = clean(payload.progressChallenges);
  let practiceGoals = clean(payload.practiceGoals);
  const emailSendStatus = clean(payload.emailSendStatus, 80);
  // Accepts the array the route builds or the comma-joined string read back off
  // the sheet, so a re-normalised existing row keeps its copied parents.
  const bccSource = payload.bccRecipientEmails ?? payload.bcc_recipient_emails ?? [];
  const bccRecipientEmails = (Array.isArray(bccSource) ? bccSource : `${bccSource}`.split(','))
    .map((email) => clean(email, 320))
    .filter(Boolean);
  const songIds = stringList(payload.songIds || payload.song_ids_json);
  const songTitles = stringList(payload.songTitles || payload.song_titles_json);
  const unlistedSongTitles = stringList(
    payload.unlistedSongTitles || payload.unlisted_song_titles_json,
    6,
  );

  // Level 2 Practice Chat posts the note as a single raw block without the split
  // fields. Derive them from the raw text so the structured columns are never
  // silently blank (this is what left Fennella's notes unindexed).
  if (rawNoteText && !whatWeDid && !progressChallenges && !practiceGoals) {
    const parsed = parsePracticeNoteSections(rawNoteText);
    whatWeDid = clean(parsed.whatWeDid);
    progressChallenges = clean(parsed.progressChallenges);
    practiceGoals = clean(parsed.practiceGoals);
  }

  const errors = [];
  if (!studentMmsId) errors.push('studentMmsId is required');
  if (!rawNoteText && !whatWeDid && !progressChallenges && !practiceGoals) {
    errors.push('note text is required');
  }

  const noteId = clean(payload.noteId, 200) || buildPracticeNoteId({
    studentMmsId,
    createdAt,
    rawNoteText: rawNoteText || [whatWeDid, progressChallenges, practiceGoals].join('\n'),
  });

  return {
    errors,
    noteId,
    deliveryKey: clean(payload.deliveryKey || payload.delivery_key, 260),
    studentMmsId,
    studentName,
    tutorName,
    actingTutor: clean(payload.actingTutor || payload.acting_tutor, 200),
    lessonDate,
    whatWeDid,
    progressChallenges,
    practiceGoals,
    rawNoteText,
    songIds,
    songTitles,
    unlistedSongTitles,
    songLinkVersion: songIds.length || unlistedSongTitles.length
      ? clean(payload.songLinkVersion || '2', 20)
      : '',
    copiedToClipboard: Boolean(payload.copiedToClipboard),
    attendanceStepOpened: Boolean(payload.attendanceStepOpened),
    mmsEventId: clean(payload.mmsEventId, 120),
    mmsAttendanceId: clean(payload.mmsAttendanceId, 120),
    mmsAttendanceStatus: clean(payload.mmsAttendanceStatus, 120),
    mmsAttendanceSaved: Boolean(payload.mmsAttendanceSaved),
    targetSelectionReason: clean(payload.targetSelectionReason, 120),
    targetSelectionLabel: clean(payload.targetSelectionLabel, 500),
    recipientProfileId: clean(payload.recipientProfileId, 120),
    recipientName: clean(payload.recipientName, 200),
    recipientEmail: clean(payload.recipientEmail, 320),
    bccRecipientEmails,
    emailChannel: clean(payload.emailChannel, 80),
    emailSendStatus: emailSendStatus || '',
    emailSentAt: dateTimeValue(payload.emailSentAt),
    gmailMessageId: clean(payload.gmailMessageId, 200),
    gmailThreadId: clean(payload.gmailThreadId, 200),
    emailError: clean(payload.emailError, 1000),
    manualFollowUpNeeded: Boolean(payload.manualFollowUpNeeded),
    operationStatus: clean(payload.operationStatus || payload.operation_status, 120),
    completedAt: dateTimeValue(payload.completedAt || payload.completed_at),
    source: clean(payload.source || 'practice_chat_pwa', 120),
    createdAt,
    userAgent: clean(payload.userAgent, 500),
  };
}

export function buildPracticeNoteLogSheetRow(note = {}) {
  return {
    note_id: note.noteId || '',
    delivery_key: note.deliveryKey || '',
    student_mms_id: note.studentMmsId || '',
    student_name: note.studentName || '',
    tutor_name: note.tutorName || '',
    acting_tutor: note.actingTutor || '',
    lesson_date: note.lessonDate || '',
    what_we_did: note.whatWeDid || '',
    progress_challenges: note.progressChallenges || '',
    practice_goals: note.practiceGoals || '',
    raw_note_text: note.rawNoteText || '',
    song_ids_json: JSON.stringify(note.songIds || []),
    song_titles_json: JSON.stringify(note.songTitles || []),
    unlisted_song_titles_json: JSON.stringify(note.unlistedSongTitles || []),
    song_link_version: note.songLinkVersion || '',
    copied_to_clipboard: boolString(note.copiedToClipboard),
    attendance_step_opened: boolString(note.attendanceStepOpened),
    mms_event_id: note.mmsEventId || '',
    mms_attendance_id: note.mmsAttendanceId || '',
    mms_attendance_status: note.mmsAttendanceStatus || '',
    mms_attendance_saved: boolString(note.mmsAttendanceSaved),
    target_selection_reason: note.targetSelectionReason || '',
    target_selection_label: note.targetSelectionLabel || '',
    recipient_profile_id: note.recipientProfileId || '',
    recipient_name: note.recipientName || '',
    recipient_email: note.recipientEmail || '',
    bcc_recipient_emails: (note.bccRecipientEmails || []).join(', '),
    email_channel: note.emailChannel || '',
    email_send_status: note.emailSendStatus || '',
    email_sent_at: note.emailSentAt || '',
    gmail_message_id: note.gmailMessageId || '',
    gmail_thread_id: note.gmailThreadId || '',
    email_error: note.emailError || '',
    manual_follow_up_needed: boolString(note.manualFollowUpNeeded),
    operation_status: note.operationStatus || '',
    completed_at: note.completedAt || '',
    source: note.source || '',
    created_at: note.createdAt || '',
    user_agent: note.userAgent || '',
  };
}

export function normalisePracticeNoteLogRow(row = {}) {
  const rawNoteText = row.raw_note_text || '';
  let whatWeDid = row.what_we_did || '';
  let progressChallenges = row.progress_challenges || '';
  let practiceGoals = row.practice_goals || '';

  // Historical rows (notably Level 2 notes) were stored with only raw text and
  // blank structured columns. Derive the sections on read so insights and the
  // per-student timeline see them without mutating the live sheet.
  if (rawNoteText && !whatWeDid && !progressChallenges && !practiceGoals) {
    const parsed = parsePracticeNoteSections(rawNoteText);
    whatWeDid = parsed.whatWeDid;
    progressChallenges = parsed.progressChallenges;
    practiceGoals = parsed.practiceGoals;
  }

  return {
    noteId: row.note_id || '',
    deliveryKey: row.delivery_key || '',
    studentMmsId: row.student_mms_id || '',
    studentName: row.student_name || '',
    tutorName: row.tutor_name || '',
    actingTutor: row.acting_tutor || '',
    lessonDate: row.lesson_date || '',
    whatWeDid,
    progressChallenges,
    practiceGoals,
    rawNoteText,
    songIds: stringList(row.song_ids_json),
    songTitles: stringList(row.song_titles_json),
    unlistedSongTitles: stringList(row.unlisted_song_titles_json, 6),
    songLinkVersion: row.song_link_version || '',
    mmsEventId: row.mms_event_id || '',
    mmsAttendanceId: row.mms_attendance_id || '',
    mmsAttendanceStatus: row.mms_attendance_status || '',
    mmsAttendanceSaved: row.mms_attendance_saved === 'TRUE',
    targetSelectionReason: row.target_selection_reason || '',
    targetSelectionLabel: row.target_selection_label || '',
    recipientProfileId: row.recipient_profile_id || '',
    recipientName: row.recipient_name || '',
    recipientEmail: row.recipient_email || '',
    bccRecipientEmails: `${row.bcc_recipient_emails || ''}`
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean),
    emailChannel: row.email_channel || '',
    emailSendStatus: row.email_send_status || '',
    emailSentAt: row.email_sent_at || '',
    gmailMessageId: row.gmail_message_id || '',
    gmailThreadId: row.gmail_thread_id || '',
    emailError: row.email_error || '',
    manualFollowUpNeeded: row.manual_follow_up_needed === 'TRUE',
    operationStatus: row.operation_status || '',
    completedAt: row.completed_at || '',
    source: row.source || '',
    createdAt: row.created_at || '',
  };
}

export function isPracticeNoteDeliveryEmailSent(record = {}) {
  return record.emailSendStatus === 'sent' || Boolean(record.gmailMessageId);
}

export function isPracticeNoteDeliveryInProgress(record = {}, now = new Date()) {
  if (record.operationStatus !== 'in_progress') return false;
  const createdAt = new Date(record.createdAt || '').getTime();
  if (!Number.isFinite(createdAt)) return true;
  return now.getTime() - createdAt < 2 * 60 * 1000;
}

export function findPracticeNoteDeliveryRecord(records = [], deliveryKey = '') {
  if (!deliveryKey) return null;
  return records.find((record) => record.deliveryKey === deliveryKey) || null;
}

export function isPracticeNoteVisibleInPortal(record = {}) {
  if (record.mmsAttendanceStatus === 'AbsentNoMakeup' && record.emailSendStatus !== 'sent') {
    return false;
  }
  return isPracticeNoteDeliveryEmailSent(record)
    || record.operationStatus === 'completed'
    || Boolean(record.completedAt);
}

// Exported because the parent email needs exactly this normalisation too. The
// note has to read the same in the portal and in Gmail, so the bracket-to-
// heading vocabulary lives here once rather than being restated per renderer.
export function normalisePracticeNoteHeadings(value = '') {
  return `${value || ''}`.replace(/\[([^\]]+)\][^\S\r\n]*/g, (full, label, offset, str) => {
    const canonical = CANONICAL_SECTION_HEADINGS[classifyNoteHeading(label)];
    if (!canonical) return full;
    // Preserve existing line breaks; synthesise them for the fully-inline Level 2
    // layout so each heading sits on its own line, separated from the previous
    // section, however the raw block was formatted.
    const prevChar = offset > 0 ? str[offset - 1] : '';
    const nextChar = str[offset + full.length];
    const leadBreak = prevChar && prevChar !== '\n' && prevChar !== '\r' ? '\n\n' : '';
    const trailBreak = nextChar && nextChar !== '\n' && nextChar !== '\r' ? '\n' : '';
    return `${leadBreak}**${canonical}:**${trailBreak}`;
  });
}

function practiceNoteSortTime(record = {}) {
  const lessonTime = new Date(record.lessonDate || '').getTime();
  if (Number.isFinite(lessonTime)) return lessonTime;

  const sentTime = new Date(record.emailSentAt || '').getTime();
  if (Number.isFinite(sentTime)) return sentTime;

  const completedTime = new Date(record.completedAt || '').getTime();
  if (Number.isFinite(completedTime)) return completedTime;

  const createdTime = new Date(record.createdAt || '').getTime();
  return Number.isFinite(createdTime) ? createdTime : 0;
}

export function buildPortalPracticeNoteText(record = {}) {
  const rawNoteText = clean(record.rawNoteText);
  if (rawNoteText) return normalisePracticeNoteHeadings(rawNoteText);

  const sections = [
    ['What we did', clean(record.whatWeDid)],
    ['Progress & Challenges', clean(record.progressChallenges)],
    ['Practice Goals', clean(record.practiceGoals)],
  ].filter(([, value]) => value);

  return sections
    .map(([heading, value]) => `**${heading}:**\n${value}`)
    .join('\n\n');
}

export function mapPracticeNoteLogRowToPortalNote(record = {}) {
  const notes = buildPortalPracticeNoteText(record);
  if (!notes) return null;

  return {
    lesson_date: record.lessonDate || record.emailSentAt || record.completedAt || record.createdAt || '',
    notes,
    tutor_name: record.tutorName || 'Unknown',
    attendance: record.mmsAttendanceStatus || (record.mmsAttendanceSaved ? 'Present' : ''),
    source: 'firstchord',
    note_id: record.noteId || '',
    email_sent_at: record.emailSentAt || '',
  };
}

// Deliberate behaviour: when a parent-visible owned note exists we return it
// without also fetching MMS to compare freshness. Cross-source comparison would
// force an MMS call on every portal load even when an owned note exists, which
// re-couples us to the API this migration is shedding. During the transition,
// preferring the owned note is the intended default; the MMS fallback only runs
// when there is no visible owned note at all.
export function selectLatestPortalPracticeNote(records = []) {
  const visibleRecords = records
    .filter(isPracticeNoteVisibleInPortal)
    .map((record) => ({
      record,
      portalNote: mapPracticeNoteLogRowToPortalNote(record),
    }))
    .filter((entry) => entry.portalNote);

  visibleRecords.sort((a, b) => practiceNoteSortTime(b.record) - practiceNoteSortTime(a.record));

  return visibleRecords[0]?.portalNote || null;
}
