/** @fileoverview Read-only MMS checklist plus explicit, auditable school-side note exceptions. */
import { createHash } from 'node:crypto';
import { normalisePayrollContactEmail } from './tutor-payroll-preferences-helpers.mjs';

const ATTENDED = new Set(['present', 'attended', 'completed']);
const clean = (value) => `${value ?? ''}`.trim();

export function parseRecordExceptions(value = '') {
  try {
    const parsed = JSON.parse(clean(value) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && clean(entry.attendanceId) && clean(entry.reason) && clean(entry.recordedAt) && clean(entry.actor)) : [];
  } catch { return []; }
}

export function payrollRecordReadiness(row = {}) {
  const exceptions = parseRecordExceptions(row.recordExceptionsJson ?? row.record_exceptions_json);
  const waivedIds = new Set(exceptions.map((entry) => clean(entry.attendanceId)));
  const missingAttendance = (row.reviewSlots || [])
    .filter((slot) => slot.timing === 'past')
    .flatMap((slot) => (slot.students || []).filter((student) => clean(student.status).toLowerCase() === 'unrecorded')
      .map((student) => ({ attendanceId: clean(student.attendanceId), studentName: clean(student.studentName), startAt: clean(slot.startAt), studentId: clean(student.studentId) })));
  const missingNotes = (row.payableSlots || [])
    .filter((slot) => slot.timing === 'past')
    .flatMap((slot) => (slot.students || []).filter((student) => ATTENDED.has(clean(student.status).toLowerCase()) && !student.hasStudentNote)
      .map((student) => ({ attendanceId: clean(student.attendanceId), studentName: clean(student.studentName), startAt: clean(slot.startAt), studentId: clean(student.studentId) })));
  const unresolvedNotes = missingNotes.filter((item) => !waivedIds.has(item.attendanceId) || !item.attendanceId);
  const uncertain = [...missingAttendance, ...unresolvedNotes].filter((item) => !item.attendanceId || !item.startAt);
  return { missingAttendance, missingNotes, unresolvedNotes, exceptions, uncertain,
    ready: missingAttendance.length === 0 && unresolvedNotes.length === 0 };
}

export function addRecordException({ row, attendanceId, reason, actor, recordedAt }) {
  const id = clean(attendanceId);
  const why = clean(reason);
  if (!id || why.length < 8 || why.length > 400 || !clean(actor) || !Number.isFinite(Date.parse(recordedAt))) {
    throw new Error('Choose one lesson and give a specific reason (8–400 characters).');
  }
  const readiness = payrollRecordReadiness(row);
  if (!readiness.unresolvedNotes.some((item) => item.attendanceId === id)) {
    throw new Error('That lesson no longer has a missing note. Refresh payroll.');
  }
  return JSON.stringify([...readiness.exceptions, { attendanceId: id, reason: why, actor: clean(actor), recordedAt }]);
}

export function recordNudgeFingerprint(row = {}) {
  const readiness = payrollRecordReadiness(row);
  const items = [
    ...readiness.missingAttendance.map((item) => `attendance:${item.attendanceId}:${item.startAt}`),
    ...readiness.unresolvedNotes.map((item) => `note:${item.attendanceId}:${item.startAt}`),
  ].sort();
  return createHash('sha256').update([clean(row.payrollId), ...items].join('|')).digest('hex');
}

export function decideRecordsNudge({ row = {}, contactEmail = '', verifiedAt = '' } = {}) {
  const readiness = payrollRecordReadiness(row);
  if (clean(row.status).toLowerCase() !== 'draft' || row.periodOpen || !row.cadenceDue) return { ok: false, reason: 'not_ready' };
  if (!readiness.missingAttendance.length && !readiness.unresolvedNotes.length) return { ok: false, reason: 'nothing_missing' };
  if (readiness.uncertain.length) return { ok: false, reason: 'uncertain_record' };
  const email = normalisePayrollContactEmail(contactEmail);
  if (!email || !clean(verifiedAt)) return { ok: false, reason: 'unverified_contact' };
  const fingerprint = recordNudgeFingerprint(row);
  const status = clean(row.recordsNudgeStatus ?? row.records_nudge_status).toLowerCase();
  const previous = clean(row.recordsNudgeFingerprint ?? row.records_nudge_fingerprint);
  if (['sending', 'unknown'].includes(status)) return { ok: false, reason: 'check_gmail' };
  if (status === 'sent' && previous === fingerprint && clean(row.recordsNudgeTo ?? row.records_nudge_to).toLowerCase() === email) return { ok: false, reason: 'already_sent' };
  return { ok: true, fingerprint, readiness, email };
}

export function buildRecordsNudgeEmail({ tutorName = '', periodStart = '', periodEnd = '', readiness }) {
  const firstName = clean(tutorName).split(/\s+/u)[0] || 'there';
  const items = [
    ...readiness.missingAttendance.map((item) => ({ ...item, task: 'attendance' })),
    ...readiness.unresolvedNotes.map((item) => ({ ...item, task: 'practice note' })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.studentName.localeCompare(b.studentName) || a.task.localeCompare(b.task));
  const lessonLines = items.map((item) => `- ${item.startAt.slice(0, 10)} ${item.startAt.slice(11, 16)}: ${item.studentName || 'student'} — ${item.task}`);
  const subject = `Quick check before your First Chord pay statement · ${periodStart} to ${periodEnd}`;
  const plainText = [
    `Hi ${firstName},`, '',
    'Thanks so much for your teaching! Before we send your pay statement, could you finish these lesson records in Practice Chat?', '',
    ...lessonLines, '',
    'Open your tutor dashboard, launch Practice Chat, add the practice notes, then complete attendance:',
    'https://firstchord.co.uk/dashboard', '',
    'There is no need to reply just to say it is done. We will check the records and send your statement once they are ready. If a lesson looks wrong or the note is not applicable, please reply and we will sort it.', '',
    'Thanks,', 'First Chord',
  ].join('\n');
  const escape = (value) => clean(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
  const html = plainText.split('\n').map((line) => line ? `<p>${escape(line)}</p>` : '').join('');
  return { subject, plainText, html };
}
