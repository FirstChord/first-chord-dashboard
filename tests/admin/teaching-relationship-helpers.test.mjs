import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTeachingRelationshipContext,
  sortTeachingRelationships,
  summariseTeachingRelationships,
} from '../../lib/admin/teaching-relationship-helpers.mjs';

const STUDENT = {
  fcStudentId: 'fc_std_12345678',
  displayName: 'Nina Example',
  firstName: 'Nina',
  instrument: 'Piano',
  lifecycleStatus: 'active',
};

const TUTOR = {
  fcTutorId: 'fc_tut_12345678',
  shortName: 'Eléna',
  displayName: 'Eléna Esposito',
  lifecycleStatus: 'active',
};

const ASSIGNMENT = {
  status: 'current',
  source: 'students_sheet',
  conflicts: [],
  warnings: [],
};

const FRESH_SCHEDULE = {
  status: 'found',
  nextLessonAt: '2026-09-03T16:00:00',
  usualWeekday: 'Thursday',
  usualTime: '16:00',
  durationMinutes: '30',
  confidence: 'high',
  freshness: 'fresh',
  observedAt: '2026-08-29T10:00:00.000Z',
  sourceSystem: 'mms_calendar',
  matchesAssignedTutor: true,
  warnings: [],
};

test('a fresh matching assignment resolves to a stable established relationship', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
    practiceNotes: [{
      noteId: 'note_1',
      lessonDate: '2026-08-27',
      deliveryStatus: 'sent',
      observedAt: '2026-08-27T18:00:00.000Z',
      sourceSystem: 'practice_chat_pwa',
    }],
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.relationshipId, 'teaching:fc_std_12345678:fc_tut_12345678');
  assert.deepEqual(relationship.phase, {
    code: 'established',
    label: 'Established',
    confidence: 'high',
    reason: 'The active assignment agrees with a current cached lesson schedule.',
  });
  assert.equal(relationship.latestPracticeNote.noteId, 'note_1');
  assert.equal(relationship.latestPracticeNote.deliveryStatus, 'sent');
  assert.equal(relationship.schedule.sourceSystem, 'mms_calendar');
  assert.deepEqual(relationship.provenance.conflicts, []);
  assert.equal('rawNoteText' in relationship.latestPracticeNote, false);
});

test('stale or mismatched schedule evidence is surfaced instead of guessed through', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: {
      ...FRESH_SCHEDULE,
      freshness: 'stale',
      matchesAssignedTutor: false,
    },
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.phase.code, 'uncertain');
  assert.equal(relationship.phase.confidence, 'low');
  assert.deepEqual(
    relationship.provenance.conflicts.map((conflict) => conflict.code),
    ['schedule_tutor_mismatch'],
  );
  assert.ok(relationship.conditions.some((item) => item.code === 'schedule_stale'));
});

test('student and tutor lifecycle facts stay separate from temporary conditions', () => {
  const paused = resolveTeachingRelationshipContext({
    student: { ...STUDENT, lifecycleStatus: 'paused' },
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });
  const leaving = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: { ...TUTOR, lifecycleStatus: 'leaving' },
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });

  assert.equal(paused.phase.code, 'established');
  assert.ok(paused.conditions.some((item) => item.code === 'student_paused'));
  assert.equal(leaving.phase.code, 'winding_down');
  assert.ok(leaving.conditions.some((item) => item.code === 'tutor_leaving'));
});

test('a retired tutor with a current assignment is kept visible as a review case', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: { ...TUTOR, lifecycleStatus: 'retired' },
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });

  assert.equal(relationship.phase.code, 'uncertain');
  assert.ok(relationship.conditions.some((item) => item.code === 'tutor_retired'));
});

test('waiting and setup states become planned and starting without practice-note inference', () => {
  const planned = resolveTeachingRelationshipContext({
    student: { ...STUDENT, lifecycleStatus: 'waiting' },
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: { status: 'missing' },
  });
  const starting = resolveTeachingRelationshipContext({
    student: { ...STUDENT, lifecycleStatus: 'setup_pending' },
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });

  assert.equal(planned.phase.code, 'planned');
  assert.equal(starting.phase.code, 'starting');
});

test('missing First Chord identity never produces a provider-keyed relationship ID', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: { ...STUDENT, fcStudentId: '' },
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });

  assert.equal(relationship.relationshipId, '');
  assert.equal(relationship.phase.code, 'uncertain');
  assert.ok(relationship.provenance.conflicts.some((item) => item.code === 'missing_first_chord_identity'));
});

test('summaries omit ended records and sorting puts handovers and starts first', () => {
  const established = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });
  const ending = resolveTeachingRelationshipContext({
    student: { ...STUDENT, displayName: 'Alex Ending' },
    tutor: { ...TUTOR, lifecycleStatus: 'leaving' },
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
  });
  const ended = resolveTeachingRelationshipContext({
    student: { ...STUDENT, displayName: 'Zed Ended', lifecycleStatus: 'stopped' },
    tutor: TUTOR,
    assignment: { ...ASSIGNMENT, status: 'ended' },
    schedule: { status: 'missing' },
  });

  const summary = summariseTeachingRelationships([established, ending, ended]);
  assert.equal(summary.total, 2);
  assert.equal(summary.byPhase.established, 1);
  assert.equal(summary.byPhase.winding_down, 1);
  assert.deepEqual(sortTeachingRelationships([established, ending]).map((item) => item.phase.code), [
    'winding_down',
    'established',
  ]);
});
