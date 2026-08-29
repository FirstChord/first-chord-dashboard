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

const REPLACEMENT_TUTOR = {
  fcTutorId: 'fc_tut_87654321',
  shortName: 'Finn',
  displayName: 'Finn Le Marinel',
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

test('a leaving tutor creates a bounded handover expectation with evidence and a clearing condition', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: {
      ...TUTOR,
      lifecycleStatus: 'leaving',
      finalTeachingDate: '2026-09-30',
      lifecycleUpdatedAt: '2026-08-28T09:00:00.000Z',
      replacementTutor: REPLACEMENT_TUTOR,
    },
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.schemaVersion, 2);
  assert.equal(relationship.attentionItems.length, 1);
  assert.deepEqual(relationship.attentionItems[0], {
    code: 'handover_assignment_open',
    severity: 'review',
    title: 'Move this relationship to Finn Le Marinel',
    detail: "Eléna Esposito is leaving on 2026-09-30. The current student assignment still points to Eléna Esposito.",
    dueDate: '2026-09-30',
    clearsWhen: 'The student assignment no longer points to Eléna Esposito, and the cached next lesson agrees with the new tutor.',
    evidence: [
      {
        code: 'current_assignment',
        label: 'Current assignment',
        value: 'Eléna Esposito',
        sourceSystem: 'students_sheet',
        observedAt: '',
        freshness: '',
      },
      {
        code: 'tutor_departure',
        label: 'Final teaching date',
        value: '2026-09-30',
        sourceSystem: 'tutor_lifecycle',
        observedAt: '2026-08-28T09:00:00.000Z',
        freshness: '',
      },
      {
        code: 'cached_next_lesson',
        label: 'Cached next lesson',
        value: '2026-09-03T16:00:00',
        sourceSystem: 'mms_calendar',
        observedAt: '2026-08-29T10:00:00.000Z',
        freshness: 'fresh',
      },
      {
        code: 'planned_replacement',
        label: 'Planned handover tutor',
        value: 'Finn Le Marinel',
        sourceSystem: 'tutor_lifecycle',
        observedAt: '2026-08-28T09:00:00.000Z',
        freshness: '',
      },
    ],
    recommendedWorkflow: {
      code: 'student_assignment_review',
      label: 'Review student assignment',
    },
  });
});

test('a lesson after the leaving date makes the handover urgent', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: {
      ...TUTOR,
      lifecycleStatus: 'leaving',
      finalTeachingDate: '2026-09-01',
      replacementTutor: REPLACEMENT_TUTOR,
    },
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.attentionItems[0].code, 'lesson_after_tutor_final_date');
  assert.equal(relationship.attentionItems[0].severity, 'urgent');
});

test('a changed assignment stays visible when the departing tutor still owns the cached lesson', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: {
      ...FRESH_SCHEDULE,
      matchesAssignedTutor: false,
      scheduledTutor: {
        ...REPLACEMENT_TUTOR,
        displayName: 'Patrick O’Brien',
        lifecycleStatus: 'leaving',
        finalTeachingDate: '2026-09-01',
      },
    },
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.attentionItems.length, 1);
  assert.equal(relationship.attentionItems[0].code, 'departing_tutor_lesson_after_final_date');
  assert.equal(relationship.attentionItems[0].severity, 'urgent');
  assert.equal(relationship.attentionItems[0].recommendedWorkflow.code, 'student_assignment_review');
});

test('stale schedule evidence requests review but cannot create an urgent handover claim', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: {
      ...FRESH_SCHEDULE,
      freshness: 'stale',
      matchesAssignedTutor: false,
      scheduledTutor: {
        ...REPLACEMENT_TUTOR,
        displayName: 'Patrick O’Brien',
        lifecycleStatus: 'retired',
        finalTeachingDate: '2026-09-01',
      },
    },
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.equal(relationship.attentionItems[0].code, 'departing_tutor_schedule_needs_refresh');
  assert.equal(relationship.attentionItems[0].severity, 'review');
  assert.equal(relationship.attentionItems[0].evidence[1].freshness, 'stale');
});

test('handover attention clears automatically when current assignment and schedule agree', () => {
  const relationship = resolveTeachingRelationshipContext({
    student: STUDENT,
    tutor: TUTOR,
    assignment: ASSIGNMENT,
    schedule: FRESH_SCHEDULE,
    derivedAt: '2026-08-29T12:00:00.000Z',
  });

  assert.deepEqual(relationship.attentionItems, []);
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
  assert.equal(summary.handoversOpen, 1);
  assert.equal(summary.attention, 1);
  assert.deepEqual(sortTeachingRelationships([established, ending]).map((item) => item.phase.code), [
    'winding_down',
    'established',
  ]);
});
