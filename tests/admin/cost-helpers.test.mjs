import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTutorPay,
  parseExpenses,
  normaliseExpenseLogRow,
  buildExpenseLogSummary,
  buildTutorCost,
  calculateTutorSlotPay,
  resolveWeeklyWeight,
  validateExpenseLogInput,
  DEFAULT_HOURLY_RATE,
} from '../../lib/admin/cost-helpers.mjs';

const tutorPay = parseTutorPay([
  { tutor: 'Salaried A', pay_model: 'salary', monthly_salary: '1000' },
  { tutor: 'Salaried B', pay_model: 'salary', monthly_salary: '800' },
  { tutor: 'Salaried C', pay_model: 'salary', monthly_salary: '600' },
]);

const oneToOne = (overrides = {}) => ({
  mmsId: overrides.mmsId || 'm1',
  fullName: overrides.fullName || 'Test One',
  lifecycleStatus: 'active',
  registryTutor: 'Patrick',
  instrument: 'Guitar',
  scheduleContext: { status: 'found', durationMinutes: '30' },
  ...overrides,
});

test('parseTutorPay marks salaried tutors and defaults the rest to hourly', () => {
  assert.equal(tutorPay.get('salaried a').payModel, 'salary');
  assert.equal(tutorPay.get('salaried a').monthlySalary, 1000);
  assert.equal(tutorPay.get('salaried a').invoiceCadence, 'weekly');
  assert.equal(tutorPay.has('patrick'), false); // unlisted => hourly default downstream
});

test('parseTutorPay reads payroll cadence and active flag', () => {
  const parsed = parseTutorPay([
    { tutor: 'Tutor A', pay_model: 'hourly', invoice_cadence: 'fortnightly', active_for_payroll: 'yes' },
    { tutor: 'Tutor B', pay_model: 'hourly', invoice_cadence: 'monthly', active_for_payroll: 'no' },
  ]);
  assert.equal(parsed.get('tutor a').invoiceCadence, 'biweekly');
  assert.equal(parsed.get('tutor a').activeForPayroll, true);
  assert.equal(parsed.get('tutor b').invoiceCadence, 'weekly');
  assert.equal(parsed.get('tutor b').activeForPayroll, false);
});

test('hourly tutor priced per hour of lessons: 30=£12, 45=£18, 60=£24', () => {
  const c30 = buildTutorCost([oneToOne({ scheduleContext: { status: 'found', durationMinutes: '30' } })], { tutorPay });
  const c45 = buildTutorCost([oneToOne({ scheduleContext: { status: 'found', durationMinutes: '45' } })], { tutorPay });
  const c60 = buildTutorCost([oneToOne({ scheduleContext: { status: 'found', durationMinutes: '60' } })], { tutorPay });
  assert.equal(c30.variableWeekly, 12);
  assert.equal(c45.variableWeekly, 18);
  assert.equal(c60.variableWeekly, 24);
  assert.equal(c60.byTutor[0].weekly, 24);
});

test('calculateTutorSlotPay applies the group uplift once at every slot duration', () => {
  assert.equal(calculateTutorSlotPay(30, 'one_to_one', 24), 12);
  assert.equal(calculateTutorSlotPay(45, 'one_to_one', 24), 18);
  assert.equal(calculateTutorSlotPay(30, 'group', 24), 14);
  assert.equal(calculateTutorSlotPay(45, 'group', 24), 20);
  assert.equal(calculateTutorSlotPay(60, 'group', 24), 26);
  assert.equal(calculateTutorSlotPay(45, 'one_to_one', 24, { studentCount: 2 }), 20);
});

test('45-min group slot adds £2 once (per slot, not per student)', () => {
  const a = { mmsId: 'a', fullName: 'Sib A', lifecycleStatus: 'active', registryTutor: 'Patrick', lessonType: 'sibling_group', scheduleContext: { status: 'found', durationMinutes: '45', sharedStudentCount: 2, sharedStudentNames: ['Sib A', 'Sib B'] } };
  const b = { ...a, mmsId: 'b', fullName: 'Sib B', scheduleContext: { ...a.scheduleContext, sharedStudentNames: ['Sib A', 'Sib B'] } };
  const cost = buildTutorCost([a, b], { tutorPay });
  // one shared 45-min group slot: £18 + £2 = £20, counted once
  assert.equal(cost.slotCount, 1);
  assert.equal(cost.variableWeekly, 20);
});

test('explicit billing group collapses a group slot even without shared schedule names', () => {
  const a = { mmsId: 'a', fullName: 'Sib A', lifecycleStatus: 'active', registryTutor: 'Patrick', lessonType: 'sibling_group', billingGroupId: 'family-group-1', scheduleContext: { status: 'found', durationMinutes: '45' } };
  const b = { mmsId: 'b', fullName: 'Sib B', lifecycleStatus: 'active', registryTutor: 'Patrick', lessonType: 'sibling_group', billingGroupId: 'family-group-1', scheduleContext: { status: 'found', durationMinutes: '45' } };
  const cost = buildTutorCost([a, b], { tutorPay });
  assert.equal(cost.slotCount, 1);
  assert.equal(cost.variableWeekly, 20);
});

test('duplicate group slot keeps the highest cadence weight', () => {
  const a = { mmsId: 'a', fullName: 'Sib A', lifecycleStatus: 'active', registryTutor: 'Patrick', lessonType: 'sibling_group', billingGroupId: 'family-group-1', lessonFrequency: 'fortnightly', scheduleContext: { status: 'found', durationMinutes: '45' } };
  const b = { mmsId: 'b', fullName: 'Sib B', lifecycleStatus: 'active', registryTutor: 'Patrick', lessonType: 'sibling_group', billingGroupId: 'family-group-1', scheduleContext: { status: 'found', durationMinutes: '45' } };
  const cost = buildTutorCost([a, b], { tutorPay });
  assert.equal(cost.slotCount, 1);
  assert.equal(cost.variableWeekly, 20);
});

test('salaried tutor lessons add no variable cost; salary is a fixed monthly line', () => {
  // A salaried tutor teaches the orchestra (shared 60-min slot) — so £0 variable
  const orchestra = ['o1', 'o2', 'o3'].map((id) => ({
    mmsId: id,
    fullName: `Orch ${id}`,
    lifecycleStatus: 'active',
    registryTutor: 'Salaried A',
    instrument: 'Ukulele Orchestra',
    scheduleContext: { status: 'found', durationMinutes: '60', sharedStudentCount: 3, sharedStudentNames: ['Orch o1', 'Orch o2', 'Orch o3'] },
  }));
  const cost = buildTutorCost(orchestra, { tutorPay });
  assert.equal(cost.variableWeekly, 0);
  assert.equal(cost.salariedMonthly, 1000 + 800 + 600);
});

test('paused students generate no tutor pay', () => {
  const cost = buildTutorCost([oneToOne({ lifecycleStatus: 'paused' })], { tutorPay });
  assert.equal(cost.variableWeekly, 0);
  assert.equal(cost.slotCount, 0);
});

test('unknown duration is flagged, not silently priced', () => {
  const cost = buildTutorCost([oneToOne({ scheduleContext: undefined, lessonLength: 'Uke' })], { tutorPay });
  assert.equal(cost.unpricedSlots, 1);
  assert.equal(cost.variableWeekly, 0);
});

test('unlisted tutor falls back to the default hourly rate', () => {
  const cost = buildTutorCost([oneToOne({ registryTutor: 'SomeoneNew', scheduleContext: { status: 'found', durationMinutes: '60' } })], { tutorPay });
  assert.equal(cost.variableWeekly, DEFAULT_HOURLY_RATE);
});

test('resolveWeeklyWeight halves fortnightly cadence (from registry or top-level)', () => {
  assert.equal(resolveWeeklyWeight({}), 1);
  assert.equal(resolveWeeklyWeight({ lessonFrequency: 'weekly' }), 1);
  assert.equal(resolveWeeklyWeight({ lessonFrequency: 'fortnightly' }), 0.5);
  assert.equal(resolveWeeklyWeight({ registry: { lessonFrequency: 'biweekly' } }), 0.5);
});

test('fortnightly student contributes half its slot cost to variable pay', () => {
  const weekly = buildTutorCost([oneToOne({ scheduleContext: { status: 'found', durationMinutes: '60' } })], { tutorPay });
  const fortnightly = buildTutorCost([oneToOne({ lessonFrequency: 'fortnightly', scheduleContext: { status: 'found', durationMinutes: '60' } })], { tutorPay });
  assert.equal(weekly.variableWeekly, 24);
  assert.equal(fortnightly.variableWeekly, 12);
});

test('parseExpenses sums monthly overhead and converts weekly lines', () => {
  const { lines, monthlyTotal, skippedGeneralMonthly } = parseExpenses([
    { name: 'Rent', amount: '1100', period: 'monthly', category: 'Premises' },
    { name: 'SaaS', amount: '120', period: 'monthly' },
    { name: 'Insurance', amount: '12', period: 'monthly' },
    { name: 'General', amount: '120', period: 'monthly' },
  ]);
  assert.equal(lines.length, 3);
  assert.equal(monthlyTotal, 1232);
  assert.equal(skippedGeneralMonthly, 120);
});

test('normaliseExpenseLogRow parses actual spend rows without treating them as recurring overhead', () => {
  const row = normaliseExpenseLogRow({
    expense_id: 'expense_1',
    date: '2026-06-24',
    amount: '£42.50',
    category: 'Room improvement',
    description: 'Paint',
    paid_by: 'Finn',
    reimbursable: 'yes',
  });

  assert.equal(row.expenseId, 'expense_1');
  assert.equal(row.amount, 42.5);
  assert.equal(row.category, 'Room improvement');
  assert.equal(row.reimbursable, true);
});

test('buildExpenseLogSummary totals only the selected month and groups by category', () => {
  const summary = buildExpenseLogSummary([
    { expense_id: 'a', date: '2026-06-01', amount: '10', category: 'Staff / meetings', description: 'Coffee' },
    { expense_id: 'b', date: '2026-06-02', amount: '25.50', category: 'Room improvement', description: 'Plants' },
    { expense_id: 'c', date: '2026-05-31', amount: '99', category: 'Equipment', description: 'Old month' },
    { expense_id: 'd', date: '2026-07-01', amount: '15', category: 'Other', description: 'Future typo' },
  ], { at: new Date('2026-06-24T12:00:00Z') });

  assert.equal(summary.currentMonth, '2026-06');
  assert.equal(summary.monthTotal, 35.5);
  assert.equal(summary.currentMonthEntries.length, 2);
  assert.equal(summary.previousMonth, '2026-05');
  assert.equal(summary.previousMonthTotal, 99);
  assert.equal(summary.futureEntries.length, 1);
  assert.equal(summary.latestEntries.some((row) => row.expenseId === 'd'), false);
  assert.deepEqual(summary.byCategory.map((row) => [row.category, row.amount]), [
    ['Room improvement', 25.5],
    ['Staff / meetings', 10],
  ]);
});

test('validateExpenseLogInput accepts real spend and rejects future, invalid, or negative values', () => {
  const at = new Date('2026-06-24T12:00:00Z');
  assert.deepEqual(validateExpenseLogInput({
    date: '2026-06-23',
    amount: '£42.505',
    description: '  Paint  ',
  }, { at }), {
    date: '2026-06-23',
    amount: 42.51,
    description: 'Paint',
  });
  assert.throws(() => validateExpenseLogInput({ date: '2026-06-25', amount: '10', description: 'Future' }, { at }), /future/u);
  assert.throws(() => validateExpenseLogInput({ date: '2026-06-23', amount: '-10', description: 'Refund' }, { at }), /greater than zero/u);
  assert.throws(() => validateExpenseLogInput({ date: 'not-a-date', amount: '10', description: 'Bad date' }, { at }), /valid/u);
  assert.throws(() => validateExpenseLogInput({ date: '2026-06-23', amount: '10', description: '' }, { at }), /description/u);
});
