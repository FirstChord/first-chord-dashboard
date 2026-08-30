/** @fileoverview Builds the read-only teaching-relationship dashboard from students, tutor identities, schedule cache, and practice-note delivery facts. */
import { getPracticeNoteLogRows, getTutorAbsenceStateRows } from './sheets.js';
import { getLessonOccurrenceObservations } from './lesson-mirror-store.mjs';
import {
  compareNextOccurrenceToSchedule,
  matchPracticeNoteToLessonOccurrence,
  resolveLessonOccurrenceContext,
  selectLessonOccurrenceHighlights,
  sortLessonOccurrences,
  summariseLessonOccurrences,
} from './lesson-occurrence-helpers.mjs';
import { buildScheduledLessonMirrorWindow } from './lesson-window-helpers.mjs';
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

function practiceNoteObservation(note = {}) {
  return {
    noteId: note.noteId,
    studentMmsId: note.studentMmsId,
    tutorShortName: resolveTutorName(note.tutorName || note.actingTutor || ''),
    lessonDate: text(note.lessonDate).slice(0, 10),
    deliveryStatus: practiceNoteDeliveryStatus(note),
    observedAt: note.emailSentAt || note.completedAt || note.createdAt || note.lessonDate,
    manualFollowUpNeeded: note.manualFollowUpNeeded,
    sourceSystem: note.source || 'practice_notes_log',
    mmsEventId: note.mmsEventId,
    mmsAttendanceId: note.mmsAttendanceId,
  };
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
    .map(practiceNoteObservation);
}

export async function getTeachingRelationshipDashboard({ currentDate = new Date() } = {}) {
  const lessonWindow = buildScheduledLessonMirrorWindow({ at: currentDate });
  const [{ students }, tutors, practiceNotes, absenceRead, occurrenceRead] = await Promise.all([
    loadStudentContextCollection({ includeSchedule: true, excludeTestStudents: true, currentDate }),
    getTutorOptionsWithLifecycle(),
    getPracticeNoteLogRows(),
    getTutorAbsenceStateRows()
      .then((rows) => ({ rows, available: true, warning: '' }))
      .catch(() => ({ rows: [], available: false, warning: 'Tutor cover context could not be loaded.' })),
    getLessonOccurrenceObservations({
      startDate: lessonWindow.startDate,
      endDateExclusive: lessonWindow.endDateExclusive,
      now: currentDate,
    })
      .then((read) => ({ ...read, available: true, warning: '' }))
      .catch(() => ({
        observations: [],
        available: false,
        warning: 'Detailed lesson observations could not be loaded.',
        source: {
          state: 'unavailable',
          verified: false,
          lastVerifiedAt: null,
          windowStart: lessonWindow.startDate,
          windowEndExclusive: lessonWindow.endDateExclusive,
          coversRequestedWindow: false,
        },
      })),
  ]);
  const operationalStudents = filterOperationalStudents(students);
  const studentsByMmsId = new Map(operationalStudents.filter((student) => student.mmsId).map((student) => [student.mmsId, student]));
  const tutorsByShortName = new Map(tutors.map((tutor) => [tutor.shortName, tutor]));
  const tutorsByTeacherId = new Map(tutors.map((tutor) => [tutor.teacherId, tutor]));
  const relationships = [];
  const relationshipsByStudentMmsId = new Map();
  const unmatchedAssignments = [];
  const derivedAt = currentDate.toISOString();
  const parsedAbsences = absenceRead.rows.map(parseTutorAbsenceStateRow);
  const practiceNoteObservations = practiceNotes.map(practiceNoteObservation);

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
    const relationshipView = {
      ...relationship,
      attentionItems: relationship.attentionItems.map((item) => ({
        ...item,
        recommendedWorkflow: {
          ...item.recommendedWorkflow,
          href: adminStudentHref,
        },
      })),
      adminStudentHref,
    };
    relationships.push(relationshipView);
    relationshipsByStudentMmsId.set(student.mmsId, relationshipView);
  }

  const absenceLessonsByProviderKey = new Map();
  for (const absence of parsedAbsences) {
    for (const lesson of absence.affectedLessons || []) {
      const key = `${text(lesson.eventId)}:${text(lesson.studentMmsId)}`;
      if (!lesson.eventId || !lesson.studentMmsId) continue;
      const candidates = absenceLessonsByProviderKey.get(key) || [];
      candidates.push({ absence, lesson });
      absenceLessonsByProviderKey.set(key, candidates);
    }
  }

  const lessonOccurrences = [];
  const occurrencesByProviderKey = new Map();
  let unmatchedLessonOccurrences = 0;
  let ambiguousAbsenceLinks = 0;
  for (const observation of occurrenceRead.observations || []) {
    const student = studentsByMmsId.get(observation.studentExternalId) || null;
    const relationship = relationshipsByStudentMmsId.get(observation.studentExternalId) || null;
    if (!student || !relationship) {
      unmatchedLessonOccurrences += 1;
      continue;
    }
    if (relationship.phase.code === 'ended') continue;
    const scheduledTutor = tutorsByTeacherId.get(observation.tutorExternalId) || null;
    const originalTutor = tutorsByTeacherId.get(observation.originalTutorExternalId) || null;
    const providerKey = `${observation.eventExternalId}:${observation.studentExternalId}`;
    const absenceCandidates = [...(absenceLessonsByProviderKey.get(providerKey) || [])]
      .sort((left, right) => text(right.absence.updatedAt).localeCompare(text(left.absence.updatedAt)));
    const absenceLink = absenceCandidates[0] || null;
    if (absenceCandidates.length > 1) ambiguousAbsenceLinks += 1;
    const coverTutorShortName = resolveTutorName(
      absenceLink?.absence.coverTutorShortName || absenceLink?.absence.coverTutorName,
    );
    const coverTutor = tutorsByShortName.get(coverTutorShortName) || null;
    const noteMatch = matchPracticeNoteToLessonOccurrence({
      notes: practiceNoteObservations,
      studentExternalId: observation.studentExternalId,
      eventExternalId: observation.eventExternalId,
      attendanceExternalId: observation.attendanceExternalId,
      localDate: observation.localDate,
      tutorShortName: scheduledTutor?.shortName || '',
    });
    const workflowHref = absenceLink
      ? `/admin/workflows/tutor-absence?tutor=${encodeURIComponent(absenceLink.absence.tutorShortName)}&date=${encodeURIComponent(absenceLink.absence.absenceDate)}`
      : '';
    const occurrence = resolveLessonOccurrenceContext({
      observation,
      student: {
        fcStudentId: student.fcStudentId,
        displayName: student.fullName,
        instrument: student.instrument,
      },
      relationship: {
        relationshipId: relationship.relationshipId,
        tutor: relationship.tutor,
      },
      scheduledTutor: scheduledTutor ? {
        fcTutorId: scheduledTutor.fcTutorId,
        shortName: scheduledTutor.shortName,
        displayName: scheduledTutor.fullName,
      } : {},
      originalTutor: originalTutor ? {
        fcTutorId: originalTutor.fcTutorId,
        shortName: originalTutor.shortName,
        displayName: originalTutor.fullName,
      } : {},
      practiceNote: noteMatch.note,
      absence: absenceLink?.absence || null,
      coverTutor: coverTutor ? {
        fcTutorId: coverTutor.fcTutorId,
        shortName: coverTutor.shortName,
        displayName: coverTutor.fullName,
      } : {},
      source: occurrenceRead.source,
      today: lessonWindow.today,
      warnings: [
        ...noteMatch.warnings,
        ...(absenceCandidates.length > 1 ? [{
          code: 'absence_link_ambiguous',
          detail: 'More than one tutor-absence record names this lesson participation.',
        }] : []),
        ...(!scheduledTutor && observation.tutorExternalId ? [{
          code: 'scheduled_tutor_unmatched',
          detail: 'The lesson tutor is not in the canonical First Chord tutor roster.',
        }] : []),
      ],
    });
    const adminStudentHref = student.mmsId ? `/admin/students/${encodeURIComponent(student.mmsId)}` : '';
    const occurrenceView = {
      ...occurrence,
      attentionItems: occurrence.attentionItems.map((item) => ({
        ...item,
        recommendedWorkflow: {
          ...item.recommendedWorkflow,
          href: item.recommendedWorkflow.code === 'tutor_absence_review' ? workflowHref : '/admin/flags',
        },
      })),
      adminStudentHref,
      workflowHref,
    };
    lessonOccurrences.push(occurrenceView);
    occurrencesByProviderKey.set(providerKey, occurrenceView);
  }

  const lessonOccurrencesByRelationshipId = new Map();
  for (const occurrence of lessonOccurrences) {
    const rows = lessonOccurrencesByRelationshipId.get(occurrence.relationshipId) || [];
    rows.push(occurrence);
    lessonOccurrencesByRelationshipId.set(occurrence.relationshipId, rows);
  }
  const relationshipsWithLessons = relationships.map((relationship) => {
    const allOccurrences = sortLessonOccurrences(
      lessonOccurrencesByRelationshipId.get(relationship.relationshipId) || [],
    );
    const nextOccurrence = allOccurrences.find((occurrence) => occurrence.lesson.date >= lessonWindow.today) || null;
    return {
      ...relationship,
      lessonOccurrences: selectLessonOccurrenceHighlights(allOccurrences, { today: lessonWindow.today }),
      lessonOccurrenceSummary: summariseLessonOccurrences(allOccurrences, { today: lessonWindow.today }),
      lessonOccurrenceParity: compareNextOccurrenceToSchedule({
        occurrence: nextOccurrence,
        today: lessonWindow.today,
        schedule: {
          ...relationship.schedule,
          assignedTutorId: relationship.tutor.fcTutorId,
        },
      }),
    };
  });

  const coverEpisodes = [];
  let unmatchedCoverLessons = 0;
  for (const absenceRow of parsedAbsences) {
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
      const linkedOccurrence = occurrencesByProviderKey.get(`${lesson.eventId}:${lesson.studentMmsId}`) || null;
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
        lessonOccurrenceId: linkedOccurrence?.occurrenceId || '',
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
  const relationshipsWithCover = relationshipsWithLessons.map((relationship) => ({
    ...relationship,
    coverEpisodes: coverEpisodesByStudentId.get(relationship.student.fcStudentId) || [],
  }));
  const currentRelationships = relationshipsWithCover.filter((relationship) => relationship.phase.code !== 'ended');
  const lessonOccurrenceSummary = summariseLessonOccurrences(lessonOccurrences, { today: lessonWindow.today });
  const relationshipsByTutorId = new Map();
  for (const relationship of currentRelationships) {
    const tutorRelationships = relationshipsByTutorId.get(relationship.tutor.fcTutorId) || [];
    tutorRelationships.push(relationship);
    relationshipsByTutorId.set(relationship.tutor.fcTutorId, tutorRelationships);
  }

  return {
    schemaVersion: 4,
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
      lessonOccurrences: lessonOccurrenceSummary.total,
      lessonOccurrenceAttention: lessonOccurrenceSummary.attention,
      lessonOccurrenceCover: lessonOccurrenceSummary.cover,
      lessonOccurrenceCancel: lessonOccurrenceSummary.cancel,
      lessonOccurrenceSource: {
        ...occurrenceRead.source,
        available: occurrenceRead.available,
        warning: occurrenceRead.warning,
      },
      unmatchedLessonOccurrences,
      ambiguousAbsenceLinks,
    },
  };
}
