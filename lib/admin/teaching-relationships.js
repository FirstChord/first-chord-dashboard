/** @fileoverview Builds the read-only teaching-relationship dashboard from students, tutor identities, schedule cache, and practice-note delivery facts. */
import { getPracticeNoteLogRows } from './sheets.js';
import { loadStudentContextCollection } from './student-context.js';
import { filterOperationalStudents } from './test-student-helpers.mjs';
import {
  resolveTeachingRelationshipContext,
  sortTeachingRelationships,
  summariseTeachingRelationships,
} from './teaching-relationship-helpers.mjs';
import { resolveTutorName } from './tutor-identity.mjs';
import { getTutorOptionsWithLifecycle } from './tutors.js';

function text(value = '') {
  return `${value ?? ''}`.trim();
}

function practiceNoteDeliveryStatus(note = {}) {
  if (note.emailSendStatus === 'sent' || note.gmailMessageId) return 'sent';
  if (note.manualFollowUpNeeded) return 'follow_up';
  if (note.operationStatus === 'completed' || note.completedAt) return 'completed';
  return text(note.emailSendStatus || note.operationStatus) || 'unknown';
}

function assignmentForStudent(student, tutorsByShortName) {
  const sheetTutorName = resolveTutorName(student.tutor || '');
  const registryTutorName = resolveTutorName(student.registryTutor || '');
  const assignedShortName = sheetTutorName || registryTutorName;
  const tutor = tutorsByShortName.get(assignedShortName) || null;
  const conflicts = [];
  const warnings = [];

  if (sheetTutorName && registryTutorName && sheetTutorName !== registryTutorName) {
    conflicts.push({
      code: 'assignment_source_mismatch',
      detail: `Students says ${sheetTutorName}; the registry says ${registryTutorName}.`,
    });
  }
  if (assignedShortName && !tutor) {
    warnings.push(`Tutor identity “${assignedShortName}” is not in the canonical roster.`);
  }

  return {
    tutor,
    assignedShortName,
    assignment: {
      status: student.lifecycleStatus === 'stopped' ? 'ended' : 'current',
      source: sheetTutorName ? 'students_sheet' : registryTutorName ? 'student_registry' : 'missing',
      observedAt: '',
      conflicts,
      warnings,
    },
  };
}

function scheduleObservation(student, assignedTutor, tutorsByTeacherId) {
  const schedule = student.scheduleContext || {};
  const scheduledTutor = tutorsByTeacherId.get(text(schedule.teacherId)) || null;
  const freshness = student.provenance?.sources?.scheduleContext?.freshness || 'unknown';

  return {
    status: text(schedule.status) || 'missing',
    nextLessonAt: schedule.nextLessonAt || '',
    usualWeekday: schedule.usualWeekday || '',
    usualTime: schedule.usualTime || '',
    durationMinutes: schedule.durationMinutes || '',
    confidence: schedule.confidence || 'none',
    freshness,
    observedAt: schedule.checkedAt || '',
    sourceSystem: schedule.source || 'mms_calendar',
    matchesAssignedTutor: schedule.status === 'found'
      ? Boolean(scheduledTutor && assignedTutor && scheduledTutor.fcTutorId === assignedTutor.fcTutorId)
      : null,
    warnings: schedule.warnings || [],
  };
}

function noteObservationsForRelationship(notes, student, tutor) {
  return notes
    .filter((note) => note.studentMmsId === student.mmsId)
    .filter((note) => resolveTutorName(note.tutorName || '') === tutor.shortName)
    .map((note) => ({
      noteId: note.noteId,
      lessonDate: note.lessonDate,
      deliveryStatus: practiceNoteDeliveryStatus(note),
      observedAt: note.emailSentAt || note.completedAt || note.createdAt || note.lessonDate,
      manualFollowUpNeeded: note.manualFollowUpNeeded,
      sourceSystem: note.source || 'practice_notes_log',
    }));
}

export async function getTeachingRelationshipDashboard({ currentDate = new Date() } = {}) {
  const [{ students }, tutors, practiceNotes] = await Promise.all([
    loadStudentContextCollection({ includeSchedule: true, excludeTestStudents: true, currentDate }),
    getTutorOptionsWithLifecycle(),
    getPracticeNoteLogRows(),
  ]);
  const operationalStudents = filterOperationalStudents(students);
  const tutorsByShortName = new Map(tutors.map((tutor) => [tutor.shortName, tutor]));
  const tutorsByTeacherId = new Map(tutors.map((tutor) => [tutor.teacherId, tutor]));
  const relationships = [];
  const unmatchedAssignments = [];
  const derivedAt = currentDate.toISOString();

  for (const student of operationalStudents) {
    const { tutor, assignedShortName, assignment } = assignmentForStudent(student, tutorsByShortName);
    if (!assignedShortName) continue;
    if (!tutor) {
      unmatchedAssignments.push({
        fcStudentId: student.fcStudentId || '',
        mmsId: student.mmsId || '',
        studentName: student.fullName || '',
        tutorName: assignedShortName,
      });
      continue;
    }

    const relationship = resolveTeachingRelationshipContext({
      student: {
        fcStudentId: student.fcStudentId,
        displayName: student.fullName,
        firstName: student.firstName,
        instrument: student.instrument,
        lifecycleStatus: student.lifecycleStatus,
      },
      tutor: {
        fcTutorId: tutor.fcTutorId,
        shortName: tutor.shortName,
        displayName: tutor.fullName,
        lifecycleStatus: tutor.lifecycleStatus,
      },
      assignment,
      schedule: scheduleObservation(student, tutor, tutorsByTeacherId),
      practiceNotes: noteObservationsForRelationship(practiceNotes, student, tutor),
      derivedAt,
    });

    relationships.push({
      ...relationship,
      adminStudentHref: student.mmsId ? `/admin/students/${encodeURIComponent(student.mmsId)}` : '',
    });
  }

  const currentRelationships = relationships.filter((relationship) => relationship.phase.code !== 'ended');
  const relationshipsByTutorId = new Map();
  for (const relationship of currentRelationships) {
    const tutorRelationships = relationshipsByTutorId.get(relationship.tutor.fcTutorId) || [];
    tutorRelationships.push(relationship);
    relationshipsByTutorId.set(relationship.tutor.fcTutorId, tutorRelationships);
  }

  return {
    schemaVersion: 1,
    derivedAt,
    tutors: tutors.map((tutor) => {
      const tutorRelationships = sortTeachingRelationships(relationshipsByTutorId.get(tutor.fcTutorId) || []);
      return {
        ...tutor,
        teachingRelationships: tutorRelationships,
        teachingRelationshipSummary: summariseTeachingRelationships(tutorRelationships),
      };
    }),
    summary: {
      ...summariseTeachingRelationships(currentRelationships),
      unmatchedAssignments,
    },
  };
}
