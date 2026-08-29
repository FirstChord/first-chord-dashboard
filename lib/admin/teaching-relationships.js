/** @fileoverview Builds the read-only teaching-relationship dashboard from students, tutor identities, schedule cache, and practice-note delivery facts. */
import { getPracticeNoteLogRows, getTutorAbsenceStateRows } from './sheets.js';
import { loadStudentContextCollection } from './student-context.js';
import { filterOperationalStudents } from './test-student-helpers.mjs';
import { resolveTeachingCoverEpisode, sortTeachingCoverEpisodes } from './teaching-cover-helpers.mjs';
import {
  resolveTeachingRelationshipContext,
  sortTeachingRelationships,
  summariseTeachingRelationships,
} from './teaching-relationship-helpers.mjs';
import { resolveTutorName } from './tutor-identity.mjs';
import { parseTutorAbsenceStateRow } from './tutor-absence-helpers.mjs';
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
    scheduledTutor: scheduledTutor ? {
      fcTutorId: scheduledTutor.fcTutorId,
      shortName: scheduledTutor.shortName,
      displayName: scheduledTutor.fullName,
      lifecycleStatus: scheduledTutor.lifecycleStatus,
      finalTeachingDate: scheduledTutor.finalTeachingDate,
    } : null,
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
  const [{ students }, tutors, practiceNotes, absenceRead] = await Promise.all([
    loadStudentContextCollection({ includeSchedule: true, excludeTestStudents: true, currentDate }),
    getTutorOptionsWithLifecycle(),
    getPracticeNoteLogRows(),
    getTutorAbsenceStateRows()
      .then((rows) => ({ rows, available: true, warning: '' }))
      .catch(() => ({ rows: [], available: false, warning: 'Tutor cover context could not be loaded.' })),
  ]);
  const operationalStudents = filterOperationalStudents(students);
  const studentsByMmsId = new Map(operationalStudents.filter((student) => student.mmsId).map((student) => [student.mmsId, student]));
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
        finalTeachingDate: tutor.finalTeachingDate,
        lifecycleUpdatedAt: tutor.lifecycleUpdatedAt,
        replacementTutor: (() => {
          const replacement = tutorsByShortName.get(tutor.replacementTutorShortName);
          return replacement ? {
            fcTutorId: replacement.fcTutorId,
            shortName: replacement.shortName,
            displayName: replacement.fullName,
          } : null;
        })(),
      },
      assignment,
      schedule: scheduleObservation(student, tutor, tutorsByTeacherId),
      practiceNotes: noteObservationsForRelationship(practiceNotes, student, tutor),
      derivedAt,
    });

    const adminStudentHref = student.mmsId ? `/admin/students/${encodeURIComponent(student.mmsId)}` : '';
    relationships.push({
      ...relationship,
      attentionItems: relationship.attentionItems.map((item) => ({
        ...item,
        recommendedWorkflow: {
          ...item.recommendedWorkflow,
          href: adminStudentHref,
        },
      })),
      adminStudentHref,
    });
  }

  const coverEpisodes = [];
  let unmatchedCoverLessons = 0;
  for (const absenceRow of absenceRead.rows.map(parseTutorAbsenceStateRow)) {
    if (absenceRow.decision !== 'cover' || absenceRow.status === 'resolved') continue;
    const absentTutorShortName = resolveTutorName(absenceRow.tutorShortName || absenceRow.tutorName);
    const coverTutorShortName = resolveTutorName(absenceRow.coverTutorShortName || absenceRow.coverTutorName);
    const absentTutor = tutorsByShortName.get(absentTutorShortName) || null;
    const coverTutor = tutorsByShortName.get(coverTutorShortName) || null;

    for (const lesson of absenceRow.affectedLessons || []) {
      const student = studentsByMmsId.get(lesson.studentMmsId) || null;
      if (!student) {
        unmatchedCoverLessons += 1;
        continue;
      }
      const { tutor: assignedTutor } = assignmentForStudent(student, tutorsByShortName);
      const episode = resolveTeachingCoverEpisode({
        student: {
          fcStudentId: student.fcStudentId,
          displayName: student.fullName,
          firstName: student.firstName,
          instrument: student.instrument,
        },
        primaryTutor: assignedTutor ? {
          fcTutorId: assignedTutor.fcTutorId,
          shortName: assignedTutor.shortName,
          displayName: assignedTutor.fullName,
        } : {},
        absentTutor: absentTutor ? {
          fcTutorId: absentTutor.fcTutorId,
          shortName: absentTutor.shortName,
          displayName: absentTutor.fullName,
        } : {
          shortName: absenceRow.tutorShortName,
          displayName: absenceRow.tutorName,
        },
        coverTutor: coverTutor ? {
          fcTutorId: coverTutor.fcTutorId,
          shortName: coverTutor.shortName,
          displayName: coverTutor.fullName,
          type: 'internal',
        } : {
          shortName: absenceRow.coverTutorShortName,
          displayName: absenceRow.coverTutorName,
          type: 'external_or_unmatched',
        },
        absence: absenceRow,
        lesson,
        derivedAt,
      });
      if (!episode) continue;
      const workflowHref = `/admin/workflows/tutor-absence?tutor=${encodeURIComponent(absenceRow.tutorShortName)}&date=${encodeURIComponent(absenceRow.absenceDate)}`;
      coverEpisodes.push({
        ...episode,
        attentionItems: episode.attentionItems.map((item) => ({
          ...item,
          recommendedWorkflow: {
            ...item.recommendedWorkflow,
            href: workflowHref,
          },
        })),
        workflowHref,
        adminStudentHref: student.mmsId ? `/admin/students/${encodeURIComponent(student.mmsId)}` : '',
      });
    }
  }

  const sortedCoverEpisodes = sortTeachingCoverEpisodes(coverEpisodes);
  const coverEpisodesByStudentId = new Map();
  for (const episode of sortedCoverEpisodes) {
    const studentEpisodes = coverEpisodesByStudentId.get(episode.student.fcStudentId) || [];
    studentEpisodes.push(episode);
    coverEpisodesByStudentId.set(episode.student.fcStudentId, studentEpisodes);
  }
  const relationshipsWithCover = relationships.map((relationship) => ({
    ...relationship,
    coverEpisodes: coverEpisodesByStudentId.get(relationship.student.fcStudentId) || [],
  }));
  const currentRelationships = relationshipsWithCover.filter((relationship) => relationship.phase.code !== 'ended');
  const relationshipsByTutorId = new Map();
  for (const relationship of currentRelationships) {
    const tutorRelationships = relationshipsByTutorId.get(relationship.tutor.fcTutorId) || [];
    tutorRelationships.push(relationship);
    relationshipsByTutorId.set(relationship.tutor.fcTutorId, tutorRelationships);
  }

  return {
    schemaVersion: 3,
    derivedAt,
    coverEpisodes: sortedCoverEpisodes,
    tutors: tutors.map((tutor) => {
      const tutorRelationships = sortTeachingRelationships(relationshipsByTutorId.get(tutor.fcTutorId) || []);
      return {
        ...tutor,
        teachingRelationships: tutorRelationships,
        teachingRelationshipSummary: summariseTeachingRelationships(tutorRelationships),
        coverEpisodesAsAbsentTutor: sortedCoverEpisodes.filter((episode) => episode.absentTutor.fcTutorId === tutor.fcTutorId),
        coverEpisodesAsCoverTutor: sortedCoverEpisodes.filter((episode) => episode.coverTutor.fcTutorId === tutor.fcTutorId),
      };
    }),
    summary: {
      ...summariseTeachingRelationships(currentRelationships),
      unmatchedAssignments,
      coverEpisodes: sortedCoverEpisodes.length,
      coverAttention: sortedCoverEpisodes.filter((episode) => episode.attentionItems.length > 0).length,
      coverUrgent: sortedCoverEpisodes.filter((episode) => episode.attentionItems.some((item) => item.severity === 'urgent')).length,
      coverSourceAvailable: absenceRead.available,
      coverSourceWarning: absenceRead.warning,
      unmatchedCoverLessons,
    },
  };
}
