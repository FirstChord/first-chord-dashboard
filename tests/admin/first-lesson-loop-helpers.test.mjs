import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFirstLessonLoopContext,
  buildFirstLessonLoopProgressNote,
  deriveFirstLessonLoopProgress,
  isFirstLessonLoopDue,
  matchFirstLessonObservation,
  parseFirstLessonLoopMetadata,
  parseFirstLessonLoopProgressNote,
} from '../../lib/admin/first-lesson-loop-helpers.mjs';

const item = {
  planningId: 'planning_first_lesson_checkin_sdt_1',
  linkedStudentId: 'sdt_1',
  targetDate: '2026-08-28',
  notes: 'Auto-created at onboarding. First lesson: 2026-08-27 16:00. Tutor: Finn Lemarinel. Check in after the first lesson.',
};

function step(stepName, value, createdAt) {
  return {
    progressType: 'workflow_step',
    progressNote: buildFirstLessonLoopProgressNote(stepName, value),
    createdAt,
  };
}

test('first-lesson metadata and controlled progress notes round-trip', () => {
  assert.deepEqual(parseFirstLessonLoopMetadata(item), {
    studentMmsId: 'sdt_1', lessonDate: '2026-08-27', lessonTime: '16:00', tutorName: 'Finn Lemarinel',
  });
  assert.deepEqual(parseFirstLessonLoopProgressNote('First lesson loop v1: whatsapp_groups=true'), {
    step: 'whatsapp_groups', value: 'true',
  });
  assert.equal(parseFirstLessonLoopProgressNote('ordinary note'), null);
  assert.throws(() => buildFirstLessonLoopProgressNote('anything', 'true'), /Unknown/u);
  assert.equal(isFirstLessonLoopDue(item, { now: new Date('2026-08-27T12:00:00Z') }), false);
  assert.equal(isFirstLessonLoopDue(item, { now: new Date('2026-08-28T12:00:00Z') }), true);
});

test('latest first-lesson value wins so corrections persist without rewriting history', () => {
  const progress = deriveFirstLessonLoopProgress([
    step('payment_decision', 'continue_weekly', '2026-08-28T09:00:00Z'),
    step('payment_decision', 'stop', '2026-08-28T10:00:00Z'),
    step('whatsapp_groups', 'true', '2026-08-28T09:30:00Z'),
  ]);
  assert.equal(progress.paymentDecision, 'stop');
  assert.equal(progress.whatsappGroups, true);
});

test('verified lesson evidence matches exact student, date, and time without exposing provider ids', () => {
  const evidence = matchFirstLessonObservation({
    metadata: parseFirstLessonLoopMetadata(item),
    source: { verified: true, state: 'fresh', lastVerifiedAt: '2026-08-28T06:00:00Z' },
    observations: [{
      studentExternalId: 'sdt_1', localDate: '2026-08-27', localTime: '16:00:00',
      rawAttendanceStatus: 'Present', sourceStatus: 'Active', eventExternalId: 'evt_private',
    }],
  });
  assert.equal(evidence.state, 'observed');
  assert.equal(evidence.rawAttendanceStatus, 'Present');
  assert.equal('eventExternalId' in evidence, false);
});

test('lesson evidence remains unknown when stale and ambiguous when the exact join is not unique', () => {
  assert.equal(matchFirstLessonObservation({ metadata: {}, source: { verified: false, state: 'stale' } }).state, 'unavailable');
  const metadata = parseFirstLessonLoopMetadata(item);
  const duplicate = { studentExternalId: 'sdt_1', localDate: '2026-08-27', localTime: '16:00:00' };
  assert.equal(matchFirstLessonObservation({ metadata, source: { verified: true }, observations: [duplicate, duplicate] }).state, 'ambiguous');
});

test('continuing closes only with recorded subscription plus WhatsApp and access confirmations', () => {
  const context = buildFirstLessonLoopContext({
    item: {
      ...item,
      progress: [
        step('payment_decision', 'continue_weekly', '2026-08-28T09:00:00Z'),
        step('whatsapp_groups', 'true', '2026-08-28T09:01:00Z'),
        step('student_access', 'true', '2026-08-28T09:02:00Z'),
      ],
    },
    student: { paymentMode: 'stripe', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' },
    now: new Date('2026-08-28T12:00:00Z'),
  });
  assert.equal(context.canClose, true);
  assert.deepEqual(context.blockers, []);
});

test('stop path requires cancellation handling while completed portal workflow can satisfy access', () => {
  const base = {
    ...item,
    progress: [
      step('payment_decision', 'stop', '2026-08-28T09:00:00Z'),
      step('whatsapp_groups', 'true', '2026-08-28T09:01:00Z'),
    ],
  };
  const portalAccess = { workflowStatus: 'completed', protectionEnabled: true, messageSentAt: '2026-08-27T18:00:00Z' };
  assert.equal(buildFirstLessonLoopContext({ item: base, portalAccess, now: new Date('2026-08-28T12:00:00Z') }).canClose, false);
  const complete = buildFirstLessonLoopContext({
    item: { ...base, progress: [...base.progress, step('cancellation_handled', 'true', '2026-08-28T09:02:00Z')] },
    portalAccess,
    now: new Date('2026-08-28T12:00:00Z'),
  });
  assert.equal(complete.canClose, true);
  assert.equal(complete.studentAccess.source, 'portal_workflow');
});
