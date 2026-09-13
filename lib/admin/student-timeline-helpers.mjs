/** @fileoverview Provider-neutral student timeline contract plus pure adapters over existing trusted history sources. */

/**
 * A student timeline event is a read-only projection, never a stored fact.
 *
 * @typedef {Object} StudentTimelineEvent
 * @property {string} id Stable projection identity.
 * @property {string} kind UI grouping only; it never owns workflow state.
 * @property {string} title
 * @property {string} summary
 * @property {{value:string, precision:'instant'|'minute'|'day'|'month'|'unknown', certainty:'exact'|'approximate'|'unknown', timeZone:string}} date
 * @property {'recorded'|'observed'|'derived'|'uncertain'} certainty
 * @property {{key:string, label:string, recordType:string, recordId:string, observedAt:string, provider:string}} source
 * @property {{href:string, label:string}|null} link
 * @property {string} dedupeKey Internal projection key; it is not a source identifier.
 * @property {number} dedupePriority Internal preference when two source rows describe one recorded action.
 */

const EVENT_LOG_TYPES = new Set([
  'issue_detected',
  'issue_reopened',
  'issue_acknowledged',
  'issue_ignored',
  'issue_resolved',
  'payment_mode_changed',
  'payment_expectation_changed',
  'payment_expectation_reconciled',
  'pause_workflow_action_taken',
  'payment_issue_action_taken',
  'student_left',
  'student_archive_marked',
  'student_exit_registry_deleted',
  'student_exit_mms_inactive_marked',
  'student_exit_sheet_row_archived',
  'registry_created',
  'registry_deleted',
  'waiting_onboarded_by_onboarding',
  'parent_understanding_status_saved',
  'practice_note_follow_up_handled',
]);

const EVENT_LOG_TITLES = {
  issue_detected: 'Issue detected',
  issue_reopened: 'Issue reopened',
  issue_acknowledged: 'Issue acknowledged',
  issue_ignored: 'Issue ignored',
  issue_resolved: 'Issue resolved',
  payment_mode_changed: 'Payment mode changed',
  payment_expectation_changed: 'Payment expectation changed',
  payment_expectation_reconciled: 'Payment expectation reconciled',
  pause_workflow_action_taken: 'Pause workflow action recorded',
  payment_issue_action_taken: 'Payment issue action recorded',
  student_left: 'Student marked as left',
  student_archive_marked: 'Student marked inactive / stopped',
  student_exit_registry_deleted: 'Portal access removed',
  student_exit_mms_inactive_marked: 'Student marked inactive in MMS',
  student_exit_sheet_row_archived: 'Student row archived',
  registry_created: 'Portal registry entry created',
  registry_deleted: 'Portal registry entry removed',
  waiting_onboarded_by_onboarding: 'Onboarding completed from waiting list',
  parent_understanding_status_saved: 'Parent understanding updated',
  practice_note_follow_up_handled: 'Practice note follow-up handled',
};

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function truncate(value = '', length = 180) {
  const cleaned = text(value).replace(/\s+/gu, ' ');
  return cleaned.length > length ? `${cleaned.slice(0, length - 1)}…` : cleaned;
}

function humanise(value = '') {
  const cleaned = text(value).replace(/[_-]+/gu, ' ');
  return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : '';
}

function stableHash(parts = []) {
  const input = parts.map(text).join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safePayload(value = '') {
  try {
    const parsed = JSON.parse(text(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validDay(value = '') {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : '';
}

function timelineDate(value = '', {
  precision = 'instant',
  certainty = 'exact',
  timeZone = '',
} = {}) {
  const candidate = text(value);
  if (!candidate) {
    return { value: '', precision: 'unknown', certainty: 'unknown', timeZone: '' };
  }

  if (precision === 'day') {
    const day = validDay(candidate);
    return day
      ? { value: day, precision, certainty, timeZone }
      : { value: '', precision: 'unknown', certainty: 'unknown', timeZone: '' };
  }
  if (precision === 'month') {
    return /^\d{4}-(0[1-9]|1[0-2])$/u.test(candidate)
      ? { value: candidate, precision, certainty, timeZone }
      : { value: '', precision: 'unknown', certainty: 'unknown', timeZone: '' };
  }
  if (precision === 'minute') {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/u.exec(candidate);
    if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) {
      return { value: '', precision: 'unknown', certainty: 'unknown', timeZone: '' };
    }
    return { value: `${match[1]}T${match[2]}:${match[3]}`, precision, certainty, timeZone };
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime())
    ? { value: '', precision: 'unknown', certainty: 'unknown', timeZone: '' }
    : { value: parsed.toISOString(), precision: 'instant', certainty, timeZone: timeZone || 'UTC' };
}

function source({ key, label, recordType, recordId = '', observedAt = '', provider = '' }) {
  return {
    key: text(key),
    label: text(label),
    recordType: text(recordType),
    recordId: text(recordId),
    observedAt: text(observedAt),
    provider: text(provider),
  };
}

function event({
  id,
  kind,
  title,
  summary = '',
  date,
  certainty = 'recorded',
  source: eventSource,
  link = null,
  dedupeKey = '',
  dedupePriority = 0,
}) {
  return {
    id: text(id),
    kind: text(kind),
    title: text(title),
    summary: truncate(summary),
    date: date || timelineDate(),
    certainty,
    source: eventSource,
    link: link?.href ? { href: text(link.href), label: text(link.label) || 'Open source' } : null,
    dedupeKey: text(dedupeKey) || text(id),
    dedupePriority: Number(dedupePriority) || 0,
  };
}

function eventLogLink(eventType = '') {
  if (eventType.startsWith('issue_') || eventType === 'payment_issue_action_taken') {
    return { href: '/admin/flags', label: 'Open issues' };
  }
  if (eventType === 'parent_understanding_status_saved') {
    return { href: '/admin/workflows/parent-understanding', label: 'Open workflow' };
  }
  if (eventType === 'practice_note_follow_up_handled') {
    return { href: '#practice-notes', label: 'Open practice notes' };
  }
  return null;
}

function eventLogSummary(row, payload) {
  const eventType = text(row.eventType);
  const issueType = humanise(payload.issue_type);
  const note = truncate(payload.note);
  if (eventType.startsWith('issue_')) {
    return [issueType, note].filter(Boolean).join(' · ');
  }
  if (['payment_mode_changed', 'payment_expectation_changed', 'payment_expectation_reconciled'].includes(eventType)) {
    const change = [humanise(payload.previous_value) || 'Not set', humanise(payload.next_value) || 'Not set'].join(' → ');
    return [change, note].filter(Boolean).join(' · ');
  }
  if (eventType === 'student_left') {
    return [text(payload.left_month_label), note].filter(Boolean).join(' · ');
  }
  return [text(payload.action_label), note, issueType].filter(Boolean).join(' · ');
}

function eventLogBundle(row, payload) {
  const eventType = text(row.eventType);
  const occurredAt = text(row.occurredAt);
  const mmsId = text(row.mmsId);
  const actionSource = text(payload.source);
  if (eventType === 'student_left' || actionSource === 'admin_student_archive_workflow') {
    return { key: `student-exit:${mmsId}:${occurredAt}`, priority: eventType === 'student_left' ? 100 : eventType === 'student_archive_marked' ? 90 : 20 };
  }
  if (actionSource === 'admin_pause_workflow_action') {
    return { key: `pause-action:${mmsId}:${occurredAt}`, priority: eventType === 'pause_workflow_action_taken' ? 90 : 20 };
  }
  if (actionSource === 'admin_flags_payment_action') {
    return { key: `payment-issue-action:${mmsId}:${occurredAt}`, priority: eventType === 'payment_issue_action_taken' ? 90 : 20 };
  }
  return {
    key: `event-log:${text(row.eventId) || text(row.eventDedupKey) || stableHash([eventType, mmsId, occurredAt, row.payloadJson])}`,
    priority: 50,
  };
}

export function adaptEventLogRows(rows = [], { mmsId = '' } = {}) {
  const target = text(mmsId);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !target || text(row.mmsId) === target)
    .filter((row) => EVENT_LOG_TYPES.has(text(row.eventType)))
    .map((row) => {
      const payload = safePayload(row.payloadJson);
      const bundle = eventLogBundle(row, payload);
      const recordId = text(row.eventId) || text(row.eventDedupKey) || `row-${row.rowNumber || ''}`;
      return event({
        id: `event-log:${recordId || stableHash([row.eventType, row.occurredAt, row.payloadJson])}`,
        kind: text(row.eventType).startsWith('issue_') ? 'issue' : 'state_change',
        title: EVENT_LOG_TITLES[text(row.eventType)] || humanise(row.eventType),
        summary: eventLogSummary(row, payload),
        date: timelineDate(row.occurredAt),
        certainty: 'recorded',
        source: source({
          key: 'event_log',
          label: 'Event Log',
          recordType: text(row.eventType),
          recordId,
          observedAt: row.occurredAt,
        }),
        link: eventLogLink(text(row.eventType)),
        dedupeKey: bundle.key,
        dedupePriority: bundle.priority,
      });
    });
}

export function adaptPauseHistoryRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const startDate = validDay(row.startDate);
    const endDate = validDay(row.endDate);
    const matchConfidence = text(row.match?.confidence) || 'low';
    const recordId = `pause-${stableHash([row.subscriptionId, row.email, row.studentName, startDate, endDate, row.stripeStatus])}`;
    const range = startDate && endDate
      ? `${startDate} → ${endDate}`
      : startDate
        ? `${startDate} → end date unknown`
        : endDate
          ? `Start date unknown → ${endDate}`
          : 'Pause dates unknown';
    return event({
      id: `pause-history:${recordId}`,
      kind: 'pause',
      title: 'Pause recorded',
      summary: [range, text(row.tutor) ? `Tutor: ${text(row.tutor)}` : '', text(row.stripeStatus) ? `Stripe: ${text(row.stripeStatus)}` : ''].filter(Boolean).join(' · '),
      date: timelineDate(startDate || endDate, {
        precision: 'day',
        certainty: startDate ? 'exact' : endDate ? 'approximate' : 'unknown',
        timeZone: 'Europe/London',
      }),
      certainty: matchConfidence === 'high' ? 'recorded' : 'uncertain',
      source: source({
        key: 'pause_history',
        label: 'Pause History',
        recordType: 'pause_window',
        recordId,
      }),
      link: { href: '#pause-state', label: 'Open pause detail' },
      dedupeKey: `pause-history:${recordId}`,
      dedupePriority: matchConfidence === 'high' ? 70 : matchConfidence === 'medium' ? 60 : 50,
    });
  });
}

export function adaptPracticeNoteRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Boolean(
      text(row.practiceGoals)
      || text(row.whatWeDid)
      || text(row.progressChallenges)
      || text(row.rawNoteText)
      || text(row.completedAt)
      || text(row.emailSentAt)
      || text(row.operationStatus) === 'completed'
    ))
    .map((row) => {
      const lessonDate = validDay(row.lessonDate);
      const fallbackDate = text(row.emailSentAt || row.completedAt || row.createdAt);
      const date = lessonDate
        ? timelineDate(lessonDate, { precision: 'day', timeZone: 'Europe/London' })
        : timelineDate(fallbackDate);
      const notePreview = row.practiceGoals || row.whatWeDid || row.rawNoteText || '';
      const recordId = text(row.noteId) || stableHash([row.studentMmsId, lessonDate, fallbackDate, notePreview]);
      return event({
        id: `practice-note:${recordId}`,
        kind: 'practice_note',
        title: 'Practice note logged',
        summary: [text(row.tutorName) ? `Tutor: ${text(row.tutorName)}` : '', truncate(notePreview, 135)].filter(Boolean).join(' · '),
        date,
        certainty: 'recorded',
        source: source({
          key: 'practice_notes_log',
          label: 'Practice Notes Log',
          recordType: 'practice_note',
          recordId,
          observedAt: fallbackDate,
        }),
        link: { href: '#practice-notes', label: 'Open practice notes' },
        dedupeKey: `practice-note:${recordId}`,
        dedupePriority: date.value ? 70 : 60,
      });
    });
}

export function adaptCommunicationRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const recordId = text(row.messageId) || stableHash([row.mmsId, row.loggedAt, row.body]);
    return event({
      id: `communication:${recordId}`,
      kind: 'communication',
      title: 'Message copied to send',
      summary: [humanise(row.category), humanise(row.channel), truncate(row.body, 130)].filter(Boolean).join(' · '),
      date: timelineDate(row.loggedAt),
      certainty: 'recorded',
      source: source({
        key: 'communication_log',
        label: 'Communication Log',
        recordType: 'copied_message',
        recordId,
        observedAt: row.loggedAt,
      }),
      link: { href: '#messages-logged', label: 'Open message log' },
      dedupeKey: `communication:${recordId}`,
      dedupePriority: 60,
    });
  });
}

// Consumes provider-neutral lesson observations. The MMS mirror adapter is one
// producer today; a future First Chord-owned ledger can emit this same input.
export function adaptLessonHistoryRows(rows = [], lessonSource = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const localDate = validDay(row.localDate);
    const localTime = text(row.localTime).slice(0, 5);
    const dateValue = localDate && /^\d{2}:\d{2}$/u.test(localTime)
      ? `${localDate}T${localTime}`
      : localDate;
    const recordId = text(row.participationId || row.lessonId)
      || stableHash([localDate, localTime, row.tutorName, row.attendanceLabel]);
    return event({
      id: `lesson-history:${recordId}`,
      kind: 'lesson',
      title: 'Lesson observed',
      summary: [
        text(row.tutorName) ? `Tutor: ${text(row.tutorName)}` : 'Tutor not matched',
        row.durationMinutes ? `${row.durationMinutes} mins` : '',
        text(row.attendanceLabel) ? `Attendance: ${text(row.attendanceLabel)}` : 'Attendance not recorded',
      ].filter(Boolean).join(' · '),
      date: timelineDate(dateValue, {
        precision: dateValue.includes('T') ? 'minute' : 'day',
        timeZone: text(row.timeZone) || 'Europe/London',
      }),
      certainty: 'observed',
      source: source({
        key: text(lessonSource.key) || 'lesson_history',
        label: text(lessonSource.label) || 'Lesson history',
        recordType: 'lesson_participation',
        recordId,
        observedAt: text(row.observedAt || lessonSource.observedAt),
        provider: text(lessonSource.provider),
      }),
      link: localDate ? { href: `/admin/lessons/calendar?week=${encodeURIComponent(localDate)}`, label: 'Open lesson week' } : null,
      dedupeKey: `lesson-history:${recordId}`,
      dedupePriority: 60,
    });
  });
}

export function adaptLifecycleRow(row = null) {
  const firstLesson = validDay(row?.firstLesson);
  if (!firstLesson) return [];
  return [event({
    id: `student-lifecycle:first-lesson:${firstLesson}`,
    kind: 'lifecycle',
    title: 'First recorded lesson',
    summary: 'Earliest past lesson found in the latest lifecycle refresh.',
    date: timelineDate(firstLesson, { precision: 'day', timeZone: 'Europe/London' }),
    certainty: 'derived',
    source: source({
      key: 'student_lifecycle',
      label: 'Student Lifecycle',
      recordType: 'first_lesson_observation',
      recordId: firstLesson,
      observedAt: row.refreshedAt,
      provider: 'MMS history',
    }),
    dedupeKey: `student-lifecycle:first-lesson:${firstLesson}`,
    dedupePriority: 50,
  })];
}

export function compareTimelineEvents(left, right) {
  const leftDate = text(left?.date?.value);
  const rightDate = text(right?.date?.value);
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
  const kindOrder = text(left?.kind).localeCompare(text(right?.kind));
  return kindOrder || text(left?.id).localeCompare(text(right?.id));
}

function preferDedupeCandidate(left, right) {
  if (left.dedupePriority !== right.dedupePriority) {
    return left.dedupePriority > right.dedupePriority ? left : right;
  }
  const leftKnown = Boolean(left.date?.value);
  const rightKnown = Boolean(right.date?.value);
  if (leftKnown !== rightKnown) return leftKnown ? left : right;
  const leftSummary = text(left.summary).length;
  const rightSummary = text(right.summary).length;
  if (leftSummary !== rightSummary) return leftSummary > rightSummary ? left : right;
  return text(left.id).localeCompare(text(right.id)) <= 0 ? left : right;
}

export function buildStudentTimeline({
  eventLogRows = [],
  pauseHistoryRows = [],
  practiceNoteRows = [],
  communicationRows = [],
  lessonHistoryRows = [],
  lessonSource = {},
  lifecycleRow = null,
  sourceStates = [],
  mmsId = '',
  limit = 12,
} = {}) {
  const projected = [
    ...adaptEventLogRows(eventLogRows, { mmsId }),
    ...adaptPauseHistoryRows(pauseHistoryRows),
    ...adaptPracticeNoteRows(practiceNoteRows),
    ...adaptCommunicationRows(communicationRows),
    ...adaptLessonHistoryRows(lessonHistoryRows, lessonSource),
    ...adaptLifecycleRow(lifecycleRow),
  ];
  const byDedupeKey = new Map();
  for (const candidate of projected) {
    const existing = byDedupeKey.get(candidate.dedupeKey);
    byDedupeKey.set(candidate.dedupeKey, existing ? preferDedupeCandidate(existing, candidate) : candidate);
  }
  const ordered = [...byDedupeKey.values()].sort(compareTimelineEvents);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 12;
  return {
    events: ordered.slice(0, safeLimit),
    totalCount: ordered.length,
    hasMore: ordered.length > safeLimit,
    sourceStates: (Array.isArray(sourceStates) ? sourceStates : []).map((entry) => ({
      key: text(entry.key),
      label: text(entry.label),
      status: text(entry.status) || 'available',
      observedAt: text(entry.observedAt),
    })),
  };
}
