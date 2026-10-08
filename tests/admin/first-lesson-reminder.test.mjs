import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstLessonReminderScheduler } from '../../lib/admin/first-lesson-reminder.mjs';
import { buildFirstLessonLoopContext, buildFirstLessonLoopProgressNote } from '../../lib/admin/first-lesson-loop-helpers.mjs';
import { createPlanningItemSaver } from '../../lib/admin/planning-save.mjs';
import { buildPlanningDueSummary } from '../../lib/admin/planning-helpers.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const ITEM = {
  planningId: 'planning_first_lesson_checkin_sdt_demo', title: 'First-lesson check-in — Example Student',
  linkedStudentId: 'sdt_demo', linkedWorkflowId: 'onboarding', status: 'active', itemType: 'action',
  targetDate: '2026-10-05', owner: 'Finn', notes: 'First lesson: 2026-10-03 15:30. Tutor: Example Tutor.',
};
const PROGRESS = ['payment_decision=continue_weekly', 'whatsapp_groups=true', 'student_access=true'].map((entry, index) => {
  const [step, value] = entry.split('=');
  return { planningId: ITEM.planningId, progressNote: buildFirstLessonLoopProgressNote(step, value), createdAt: `2026-10-05T09:0${index}:00Z` };
});

function fixture({ student = { paymentMode: 'stripe', stripeCustomerId: 'cus_demo' }, item = ITEM, progress = PROGRESS, afterContext, failHistoryOnce = false } = {}) {
  let rows = item ? [{ ...item }] : [];
  const history = [...progress];
  const writes = [];
  const save = createPlanningItemSaver({
    getPlanningItemRows: async () => rows,
    upsertPlanningItemRow: async (row) => { writes.push(row); rows = [row]; },
    addPlanningProgress: async (entry) => {
      if (failHistoryOnce) { failHistoryOnce = false; throw new Error('History append failed'); }
      history.push(entry);
    },
  });
  const schedule = createFirstLessonReminderScheduler({
    getItem: async (id) => {
      const row = rows.find((entry) => entry.planningId === id);
      return row ? { ...row, progress: history } : null;
    },
    getContext: async (row) => {
      const context = buildFirstLessonLoopContext({ item: { ...row, progress: history }, student, now: NOW });
      afterContext?.(rows);
      return context;
    },
    save, now: () => NOW,
  });
  return { schedule, writes, history, row: () => rows[0] };
}

const input = { planningId: ITEM.planningId, targetDate: '2026-10-15', actorEmail: 'admin@example.com' };

test('Stripe reminder reschedules the same card and preserves its links, notes, confirmations, and audit', async () => {
  const f = fixture();
  await f.schedule(input);
  const row = f.row();
  assert.equal(row.planningId, ITEM.planningId);
  assert.equal(row.status, 'waiting');
  assert.equal(row.targetDate, input.targetDate);
  assert.equal(row.notes, ITEM.notes);
  assert.equal(row.linkedStudentId, ITEM.linkedStudentId);
  assert.equal(row.owner, 'Finn');
  assert.deepEqual(f.history.slice(0, 3), PROGRESS);
  assert.equal(f.history[3].actorEmail, input.actorEmail);
  assert.match(f.history[3].progressNote, /2026-10-15/);
  const context = buildFirstLessonLoopContext({ item: { ...row, progress: f.history }, student: { paymentMode: 'stripe' }, now: NOW });
  assert.equal(context.completedCount, 3);
  assert.equal(context.onlyPaymentRemaining, true);
  assert.equal(context.canClose, false);
  assert.equal(buildPlanningDueSummary([row], NOW).dueNow, 0);
  assert.equal(buildPlanningDueSummary([row], new Date('2026-10-15T12:00:00Z')).dueNow, 1);
});

test('retrying the same reminder does not add another card or history event', async () => {
  const f = fixture();
  await f.schedule(input);
  await f.schedule(input);
  assert.equal(f.writes.length, 1);
  assert.equal(f.history.length, 4);
});

test('retry repairs a history append failure after the reminder row was saved', async () => {
  const f = fixture({ failHistoryOnce: true });
  await assert.rejects(f.schedule(input), /History append failed/);
  assert.equal(f.row().status, 'waiting');
  assert.equal(f.history.length, 3);
  await f.schedule(input);
  assert.equal(f.history.length, 4);
  await f.schedule(input);
  assert.equal(f.writes.length, 2);
  assert.equal(f.history.length, 4);
});

test('invalid, past, today, and non-calendar reminder dates are refused before a write', async () => {
  for (const targetDate of ['', '2026-10-07', '2026-10-08', '2026-02-30', '2026-15-01', 'tomorrow', '2026-10-15T12:00:00Z']) {
    const f = fixture();
    await assert.rejects(f.schedule({ ...input, targetDate }), { status: 400 });
    assert.equal(f.writes.length, 0);
  }
});

test('closed, missing, and other Planning cards cannot be scheduled as Stripe follow-ups', async () => {
  for (const item of [null, { ...ITEM, status: 'done' }, { ...ITEM, status: 'parked' }, { ...ITEM, planningId: 'ordinary_card' }]) {
    const f = fixture({ item });
    await assert.rejects(f.schedule({ ...input, planningId: item?.planningId || input.planningId }));
    assert.equal(f.writes.length, 0);
  }
});

test('the other checks must be complete, the decision continuing, and Stripe setup still outstanding', async () => {
  for (const options of [
    { progress: PROGRESS.slice(0, 2) },
    { progress: [PROGRESS[1], PROGRESS[2]] },
    { student: { paymentMode: 'manual' } },
    { student: { paymentMode: 'unknown' } },
    { student: { paymentMode: 'stripe', stripeSubscriptionId: 'sub_demo' } },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.schedule(input), { status: 409 });
    assert.equal(f.writes.length, 0);
  }
});

test('a card closed after preview is not reopened by the reminder save', async () => {
  const f = fixture({ afterContext: (rows) => { rows[0].status = 'done'; } });
  await assert.rejects(f.schedule(input), { status: 409 });
  assert.equal(f.writes.length, 0);
});

test('a changed student link is refused at the fresh write boundary', async () => {
  const f = fixture({ afterContext: (rows) => { rows[0] = { ...rows[0], linkedStudentId: 'sdt_other' }; } });
  await assert.rejects(f.schedule(input), { status: 409 });
  assert.equal(f.writes.length, 0);
});
