/** @fileoverview Pure, bounded teaching-note projection for a reviewed tutor cover handover. */
import { isPracticeNoteVisibleInPortal } from './practice-notes-helpers.mjs';

const LOOKBACK_DAYS = 42;
const MAX_STUDENTS = 12;
const MAX_NOTES_PER_STUDENT = 4;

function conflict(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

function dateOnly(value = '') {
  const match = `${value || ''}`.match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] || '';
}

function redact(value = '') {
  return `${value || ''}`
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email removed]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, '[link removed]')
    .replace(/(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){10,15}/gu, '[phone removed]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 260);
}

function inWindow(date, coverDate) {
  const value = dateOnly(date);
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  const cover = Date.parse(`${coverDate}T12:00:00Z`);
  return Boolean(value) && Number.isFinite(timestamp) && Number.isFinite(cover)
    && timestamp < cover && cover - timestamp <= LOOKBACK_DAYS * 86400000;
}

export function buildCoverHandoverContext({ state = {}, practiceRows = [], mmsHistories = {} } = {}) {
  const lessons = Array.isArray(state.affectedLessons) ? state.affectedLessons : [];
  const byStudent = new Map();
  for (const lesson of lessons) {
    if (!/^sdt_[A-Za-z0-9_-]+$/u.test(lesson.studentMmsId || '') || !lesson.studentName || !lesson.lessonTime) {
      throw new Error('A saved lesson is missing a student name, time or MMS ID.');
    }
    if (!byStudent.has(lesson.studentMmsId)) byStudent.set(lesson.studentMmsId, lesson);
  }
  if (!byStudent.size || byStudent.size > MAX_STUDENTS) {
    throw new Error('A handover needs between one and twelve students.');
  }
  const students = [...byStudent.values()].sort((a, b) => a.lessonTime.localeCompare(b.lessonTime) || a.studentName.localeCompare(b.studentName));
  return students.map((lesson) => {
    const sheetNotes = (practiceRows || [])
      .filter((row) => row.studentMmsId === lesson.studentMmsId && isPracticeNoteVisibleInPortal(row))
      .map((row) => ({
        date: dateOnly(row.lessonDate || row.completedAt || row.createdAt),
        source: 'Practice Chat',
        focus: redact(row.whatWeDid || row.rawNoteText),
        progress: redact(row.progressChallenges),
        goal: redact(row.practiceGoals),
      }))
      .filter((note) => inWindow(note.date, state.absenceDate) && (note.focus || note.progress || note.goal));
    const sheetDates = new Set(sheetNotes.map((note) => note.date));
    const mmsNotes = (mmsHistories[lesson.studentMmsId] || [])
      .map((row) => ({ date: dateOnly(row.date), source: 'MMS', focus: redact(row.notes), progress: '', goal: '' }))
      .filter((note) => inWindow(note.date, state.absenceDate) && note.focus && !sheetDates.has(note.date));
    const notes = [...sheetNotes, ...mmsNotes]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_NOTES_PER_STUDENT);
    return {
      studentName: lesson.studentName,
      lessonTime: lesson.lessonTime,
      instrument: lesson.instrument || '',
      notes,
    };
  });
}

export function fallbackCoverHandoverSummary(student = {}) {
  const latest = student.notes?.[0];
  if (!latest) return 'No teaching notes found in the six weeks before this lesson. Check the student’s lesson record before covering.';
  const parts = [latest.goal && `Latest practice goal: ${latest.goal}`, latest.focus && `Recent work: ${latest.focus}`, latest.progress && `Progress or challenge: ${latest.progress}`].filter(Boolean);
  return (parts.join(' ') || 'Check the recent lesson notes before covering.').slice(0, 520);
}

export function validateCoverHandoverEvent({ event = {}, target = {}, absentTeacherId = '', coverTeacherId = '' } = {}) {
  if (event.ID !== target.eventId || event.StartDate !== target.startAt || Number(event.Duration) !== target.durationMinutes) {
    conflict('A covered lesson has moved in MMS. Refresh the cover plan before making a handover.');
  }
  if (event.OriginalTeacherID !== absentTeacherId || ![absentTeacherId, coverTeacherId].includes(event.TeacherID)) {
    conflict('A covered lesson has a different tutor in MMS. Review the cover plan before making a handover.');
  }
  const actual = (event.Attendances || []).map((row) => row.StudentID).filter(Boolean).sort();
  if (actual.length !== target.studentIds.length || actual.some((id, index) => id !== target.studentIds[index])) {
    conflict('The students on a covered lesson have changed in MMS. Refresh the cover plan before making a handover.');
  }
}
