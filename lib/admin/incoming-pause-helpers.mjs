/** @fileoverview Routes parent absences to reviewed pause planning and validates source snapshots and structured dates before creating a linked pause. */
import { classifyIncomingMessage, clusterIncomingMessages, groupIncomingMessages, extractIncomingMessageDates, buildIncomingReplyTemplate } from './incoming-message-helpers.mjs';
import { buildIncomingQueueExpectation, assertIncomingQueueExpectations } from './incoming-queue-helpers.mjs';
import { buildStructuredPausePlanningDraft } from './planning-helpers.mjs';
import { INITIAL_ACKNOWLEDGEMENT_MARKER, PLANNING_FOLLOW_UP_MARKER } from './incoming-handoff-helpers.mjs';
import { validateIncomingPauseAcknowledgement } from './incoming-pause-sequence-helpers.mjs';

const ABSENCES = new Set(['one_off_absence', 'extended_absence', 'summer_break', 'absence_pause']);
function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }

export function shouldOpenIncomingPause(record = {}) {
  if (record.groupType === 'tutor') return false;
  if (ABSENCES.has(record.suspectedCategory) || ABSENCES.has(record.proposedCategory)) return true;
  const text = `${record.messageText || ''}`;
  if (/\bmake\s+(?:(?:a|the|our)\s+)?payments?\b/iu.test(text)
    && !/\b(?:lessons?|away|holiday|off)\b/iu.test(text)) return false;
  const classified = classifyIncomingMessage(text).category;
  if (classified === 'leaving') return false;
  return ABSENCES.has(classified)
    || /\b(?:cannot|can['’]?t|unable to)\s+(?:come|attend|make\s+(?:(?:his|her|their|my|our|the|a)\s+)?(?:lesson|it|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/iu.test(text)
    || /\b(?:cancel|miss|missing)\s+(?:his|her|their|my|our|the|a)\s+lesson\b/iu.test(text)
    || /\b(?:is|are|will be|am)\s+away\b/iu.test(text)
    || /\b(?:is|are|will be|am)\s+off\s+(?:for\s+(?:the\s+)?(?:half[ -]?term|holidays?|school break)|(?:next|this)\s+week)\b/iu.test(text);
}

export function selectIncomingPauseSource(rows = [], incomingId = '') {
  const lead = rows.find(row => row.incomingId === incomingId);
  if (!lead) invalid('This message could not be found. Return to Inbox and refresh.', 404);
  if (lead.groupType === 'tutor') invalid('Tutor messages use the tutor absence workflow.');
  if (lead.createdPlanningId) return { linkedPlanningId: lead.createdPlanningId };
  if (!['inbox', 'needs_review'].includes(lead.status)) invalid('This message is no longer open. Return to Inbox and refresh.', 409);
  const cluster = clusterIncomingMessages(groupIncomingMessages(rows.filter(row => ['inbox', 'needs_review'].includes(row.status))))
    .find(entry => entry.entries.some(row => row.incomingId === incomingId));
  const entries = cluster?.entries || [lead];
  const source = { ...lead, messageText: entries.map(row => row.messageText).join('\n') };
  const dates = extractIncomingMessageDates(source);
  return {
    source,
    suggestedDates: [dates.startDate, dates.returnDate].filter(Boolean).join(' → '),
    snapshots: entries.map(row => ({ ...buildIncomingQueueExpectation(row), messageText: row.messageText, matchedMmsId: row.matchedMmsId || '' })),
    options: {
      showPauseBuilder: true, hideTutorAbsenceBuilder: true,
      studentSelectionSource: lead.matchedMmsId ? 'manual' : 'cleared',
      linkedStudentIds: lead.matchedMmsId ? [lead.matchedMmsId] : [],
      pauseType: dates.returnDate ? 'range' : 'single',
      // A start alone can be an away-period boundary rather than a lesson date.
      // Keep that distinction visible; MMS suggestions and the human choose the lesson.
      pauseLessonDate: lead.suspectedCategory === 'one_off_absence' ? dates.startDate || '' : '',
      pauseFirstPauseDate: dates.startDate || '', pauseReturnDate: dates.returnDate || '',
    },
    acknowledgement: buildIncomingReplyTemplate({ category: 'one_off_absence' }),
  };
}

export function validateIncomingPauseSource(rows = [], incomingId = '', snapshots = []) {
  if (!Array.isArray(snapshots) || !snapshots.length || snapshots.length > 100
    || snapshots.some(row => !row?.incomingId || typeof row.messageText !== 'string')) invalid('The source message review is missing. Reopen it from Inbox.');
  if (!snapshots.some(row => row.incomingId === incomingId)) invalid('The source message does not match this pause.');
  const current = snapshots.map(snapshot => rows.find(row => row.incomingId === snapshot.incomingId));
  if (current.some(row => !row)) invalid('A source message is missing. Reopen it from Inbox.', 409);
  assertIncomingQueueExpectations(current, snapshots);
  if (current.some((row, index) => row.messageText !== snapshots[index].messageText || (row.matchedMmsId || '') !== snapshots[index].matchedMmsId)) {
    invalid('The message or student changed. Reopen it from Inbox.', 409);
  }
  const lead = current.find(row => row.incomingId === incomingId);
  if (current.some(row => row.groupType === 'tutor' || row.chatId !== lead.chatId || row.senderPhone !== lead.senderPhone || row.matchedMmsId !== lead.matchedMmsId)) invalid('Pause source messages must belong to the same conversation and student.');
  return current;
}

export function buildReviewedIncomingPauseDraft({ source = {}, student = {}, pauseDetails = {}, acknowledgement = '', acknowledgementConfirmation, actorEmail = '', now = new Date() } = {}) {
  const confirmed = validateIncomingPauseAcknowledgement(acknowledgementConfirmation, { now });
  if (source.groupType === 'tutor') invalid('Tutor messages use the tutor absence workflow.');
  if (!student.mmsId || !student.fullName) invalid('Choose a student before creating the pause.');
  if (!['single', 'range'].includes(pauseDetails.pauseType)) invalid('Choose one lesson or an away period.');
  for (const field of pauseDetails.pauseType === 'range' ? ['firstPauseDate', 'returnDate'] : ['lessonDate']) {
    const date = `${pauseDetails[field] || ''}`;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) invalid('Choose valid pause dates.');
  }
  if (pauseDetails.pauseType === 'range' && pauseDetails.returnDate <= pauseDetails.firstPauseDate) invalid('The return date must be after the first missed lesson.');
  const draft = buildStructuredPausePlanningDraft({ ...pauseDetails, studentName: student.fullName, now });
  if (!draft.isComplete) invalid(`Add ${draft.missingFields.join(' and ')} before creating the pause.`);
  const reply = `${acknowledgement || ''}`.trim();
  if (confirmed.mode === 'sent' && reply !== confirmed.reply) invalid('The acknowledgement changed. Confirm the reviewed message again.');
  const acknowledgementNote = confirmed.mode === 'sent'
    ? confirmed.reply : 'Already acknowledged in WhatsApp. Earlier wording is not recorded here.';
  return {
    title: draft.title, itemType: 'action', status: 'active', owner: 'Unassigned', area: 'admin', isPause: true,
    linkedStudentId: student.mmsId, linkedStudentIds: [student.mmsId], targetDate: draft.targetDate, nextAction: draft.nextAction,
    notes: [draft.notes, 'Pause dates reviewed in Planning.', `From WhatsApp incoming inbox (${source.source || 'manual'}).`,
      `Sender: ${source.senderName || ''}`, `Chat: ${source.chatName || ''}`, `Message time: ${source.messageAt || ''}`,
      `Message: ${source.messageText || ''}`, '', INITIAL_ACKNOWLEDGEMENT_MARKER, acknowledgementNote, '',
      `${PLANNING_FOLLOW_UP_MARKER} Complete the work, then send a separate final confirmation.`,
      `Acknowledgement confirmed manually: ${confirmed.mode === 'sent' ? 'sent now' : 'already acknowledged'}; ${confirmed.confirmedAt}; ${actorEmail || 'admin'}.`].join('\n'),
  };
}
