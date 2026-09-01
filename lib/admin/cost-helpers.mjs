/** @fileoverview Calculates tutor costs, expenses, and finance assumptions from schedules and pay models. */
import { derivePaymentValueContext } from './payment-value-helpers.mjs';

// Cost side of the financial layer. Variable tutor pay is modelled from the *scheduled*
// active roster: hourly tutors are paid per hour of lessons taught, per teaching *slot*
// (a shared group/orchestra lesson is one slot, paid once, even though revenue counts
// per student). Salaried tutors (set monthly wage) add no variable cost — their lessons
// are already covered by the wage — and their salary is a fixed monthly line. Paused
// students generate no lesson and so no tutor pay.

// Changing either rate? Bump PRICE_ASSUMPTIONS_VERSION in finance-assumptions.mjs.
export const DEFAULT_HOURLY_RATE = 24;
export const GROUP_SLOT_UPLIFT = 2; // tutors add £2 once per group slot
const WEEKS_PER_MONTH = 52 / 12;
const ACTIVE = 'active';
const INVOICE_CADENCES = new Set(['weekly', 'biweekly', 'bi-weekly', 'fortnightly']);

export const EXPENSE_LOG_CATEGORIES = [
  'Room improvement',
  'Equipment',
  'Repairs',
  'Staff / meetings',
  'Staff lunches',
  'Marketing',
  'Software',
  'Tutor support',
  'Event / showcase',
  'Other',
];

// Lesson cadence → weekly weight. A fortnightly student contributes half a weekly
// lesson's worth of revenue and tutor cost to the run-rate. Sourced from a registry
// `lessonFrequency` field (default weekly). The per-lesson price is unchanged — only
// the run-rate contribution is scaled.
const FREQUENCY_WEIGHTS = {
  weekly: 1,
  fortnightly: 0.5,
  biweekly: 0.5,
  'bi-weekly': 0.5,
  monthly: 0.25,
};

export function resolveWeeklyWeight(student = {}) {
  const freq = `${student.lessonFrequency || student.registry?.lessonFrequency || ''}`.trim().toLowerCase();
  if (!freq) return 1;
  return FREQUENCY_WEIGHTS[freq] ?? 1;
}

function normalise(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function toNumber(value) {
  const parsed = Number.parseFloat(`${value || ''}`.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

// Parse the Tutor_Pay sheet into a lookup. Any tutor not listed (or marked hourly)
// is treated as hourly at DEFAULT_HOURLY_RATE; only salaried tutors need a row.
export function parseTutorPay(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const name = normalise(row.tutor ?? row.Tutor);
    if (!name) continue;
    const model = normalise(row.pay_model ?? row['Pay Model']) === 'salary' ? 'salary' : 'hourly';
    const cadence = normalise(row.invoice_cadence ?? row.invoiceCadence ?? row['Invoice Cadence']) || 'weekly';
    const invoiceCadence = INVOICE_CADENCES.has(cadence) ? cadence : 'weekly';
    const activeRaw = normalise(row.active_for_payroll ?? row.activeForPayroll ?? row['Active For Payroll']);
    map.set(name, {
      tutor: `${row.tutor ?? row.Tutor}`.trim(),
      payModel: model,
      hourlyRate: toNumber(row.hourly_rate ?? row['Hourly Rate']) ?? DEFAULT_HOURLY_RATE,
      monthlySalary: toNumber(row.monthly_salary ?? row['Monthly Salary']) ?? 0,
      invoiceCadence: invoiceCadence === 'bi-weekly' || invoiceCadence === 'fortnightly' ? 'biweekly' : invoiceCadence,
      paymentRoute: normalise(row.payment_route ?? row.paymentRoute ?? row['Payment Route']) === 'confirmation' ? 'confirmation' : 'normal',
      activeForPayroll: activeRaw ? !['no', 'false', '0', 'inactive'].includes(activeRaw) : true,
    });
  }
  return map;
}

// Parse the Expenses sheet into fixed monthly overhead. Weekly lines are converted.
export function parseExpenses(rows = []) {
  const lines = [];
  let monthlyTotal = 0;
  let skippedGeneralMonthly = 0;
  for (const row of rows) {
    const name = `${row.name ?? row.Name ?? ''}`.trim();
    const amount = toNumber(row.amount ?? row.Amount);
    if (!name || !Number.isFinite(amount)) continue;
    const period = normalise(row.period ?? row.Period) || 'monthly';
    const monthly = period === 'weekly' ? amount * WEEKS_PER_MONTH : period === 'annual' || period === 'yearly' ? amount / 12 : amount;
    const category = `${row.category ?? row.Category ?? ''}`.trim();
    // "General" used to be a recurring buffer for miscellaneous spend. Actual
    // spend now lives in Expense_Log, so keep this out of the run-rate.
    if (normalise(name) === 'general' || normalise(category) === 'general') {
      skippedGeneralMonthly += monthly;
      continue;
    }
    lines.push({ name, amount, period, category, monthly: Math.round(monthly * 100) / 100 });
    monthlyTotal += monthly;
  }
  return {
    lines,
    monthlyTotal: Math.round(monthlyTotal * 100) / 100,
    skippedGeneralMonthly: Math.round(skippedGeneralMonthly * 100) / 100,
  };
}

export function normaliseExpenseLogRow(row = {}) {
  const category = `${row.category ?? row.Category ?? 'Other'}`.trim() || 'Other';
  return {
    expenseId: `${row.expense_id ?? row.expenseId ?? ''}`.trim(),
    date: toDateOnly(row.date ?? row.Date),
    amount: toNumber(row.amount ?? row.Amount) ?? 0,
    category: EXPENSE_LOG_CATEGORIES.includes(category) ? category : 'Other',
    description: `${row.description ?? row.Description ?? ''}`.trim(),
    paidBy: `${row.paid_by ?? row.paidBy ?? row['Paid By'] ?? ''}`.trim(),
    reimbursable: ['yes', 'true', '1'].includes(normalise(row.reimbursable ?? row.Reimbursable)),
    linkedArea: `${row.linked_area ?? row.linkedArea ?? row['Linked Area'] ?? ''}`.trim(),
    notes: `${row.notes ?? row.Notes ?? ''}`.trim(),
    createdAt: `${row.created_at ?? row.createdAt ?? ''}`.trim(),
    createdBy: `${row.created_by ?? row.createdBy ?? ''}`.trim(),
  };
}

export function validateExpenseLogInput(input = {}, { at = new Date() } = {}) {
  const date = toDateOnly(input.date);
  const amount = Number.parseFloat(`${input.amount || ''}`.replace(/[^\d.-]/g, ''));
  const description = `${input.description || ''}`.trim();
  const today = at.toISOString().slice(0, 10);
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error('Expense date must be valid');
  }
  if (date > today) throw new Error('Actual spend cannot be dated in the future');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Expense amount must be greater than zero');
  if (!description) throw new Error('Expense description is required');
  return {
    ...input,
    date,
    amount: Math.round(amount * 100) / 100,
    description,
  };
}

export function buildExpenseLogSummary(rows = [], { at = new Date() } = {}) {
  const entries = rows
    .map(normaliseExpenseLogRow)
    .filter((row) => row.date && row.amount > 0)
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));

  const today = at.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const previousMonthDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const futureEntries = entries.filter((row) => row.date > today);
  const validEntries = entries.filter((row) => row.date <= today);
  const currentMonthEntries = validEntries.filter((row) => row.date.startsWith(currentMonth));
  const previousMonthEntries = validEntries.filter((row) => row.date.startsWith(previousMonth));
  const byCategory = new Map();
  let monthTotal = 0;

  for (const row of currentMonthEntries) {
    monthTotal += row.amount;
    const current = byCategory.get(row.category) || { category: row.category, amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    byCategory.set(row.category, current);
  }

  const round = (n) => Math.round(n * 100) / 100;
  return {
    currentMonth,
    previousMonth,
    entries,
    futureEntries,
    currentMonthEntries,
    previousMonthEntries,
    monthTotal: round(monthTotal),
    previousMonthTotal: round(previousMonthEntries.reduce((sum, row) => sum + row.amount, 0)),
    byCategory: [...byCategory.values()]
      .map((row) => ({ ...row, amount: round(row.amount) }))
      .sort((a, b) => b.amount - a.amount),
    latestEntries: validEntries.slice(0, 8),
  };
}

export function resolveTutor(student = {}) {
  if (student.registryTutor) return `${student.registryTutor}`.trim();
  if (student.tutor) return `${student.tutor}`.trim();
  if (Array.isArray(student.tutors) && student.tutors.length) return `${student.tutors[0]}`.trim();
  return '';
}

// A shared group/orchestra lesson collapses to one slot keyed by tutor + the set of
// students in the slot, so it is paid once. Everything else is its own per-student slot.
function buildSlotKey(student, lessonKind, tutor) {
  if (lessonKind === 'group' || lessonKind === 'orchestra') {
    const billingGroupId = normalise(student.billingGroupId || student.registry?.billingGroupId);
    if (billingGroupId) {
      return `slot:${normalise(tutor)}:billing:${billingGroupId}`;
    }

    const names = [...new Set(
      [student.fullName, ...(student.scheduleContext?.sharedStudentNames || [])]
        .map((name) => `${name || ''}`.trim().toLowerCase())
        .filter(Boolean),
    )].sort();
    if (names.length) return `slot:${normalise(tutor)}:${names.join('|')}`;
  }
  return `solo:${student.mmsId || student.fullName}`;
}

export function calculateTutorSlotPay(durationMinutes, lessonKind, hourlyRate = DEFAULT_HOURLY_RATE, { studentCount = 1 } = {}) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  let cost = hourlyRate * (durationMinutes / 60);
  if (lessonKind === 'group' || studentCount > 1) cost += GROUP_SLOT_UPLIFT;
  return cost;
}

// Build variable tutor pay (active, scheduled, per-slot) and the salaried monthly total.
export function buildTutorCost(students = [], { tutorPay = new Map() } = {}) {
  const slots = new Map(); // slotKey -> { tutor, durationMinutes, lessonKind }
  for (const student of students) {
    if (`${student.lifecycleStatus || ''}`.trim() !== ACTIVE) continue;
    const tutor = resolveTutor(student);
    const value = derivePaymentValueContext(student);
    const durationMinutes = toNumber(value.durationMinutes);
    const key = buildSlotKey(student, value.lessonKind, tutor);
    if (!slots.has(key)) {
      slots.set(key, { tutor, durationMinutes, lessonKind: value.lessonKind, weight: resolveWeeklyWeight(student) });
    } else {
      const slot = slots.get(key);
      const weight = resolveWeeklyWeight(student);
      slot.weight = Math.max(slot.weight ?? 1, weight);
      if (!Number.isFinite(slot.durationMinutes) && Number.isFinite(durationMinutes)) {
        slot.durationMinutes = durationMinutes;
      }
      if (slot.lessonKind !== 'group' && value.lessonKind === 'group') {
        slot.lessonKind = value.lessonKind;
      }
    }
  }

  let variableWeekly = 0;
  let unpricedSlots = 0;
  const byTutor = new Map();

  for (const slot of slots.values()) {
    const payInfo = tutorPay.get(normalise(slot.tutor));
    if (payInfo?.payModel === 'salary') continue; // salaried: no variable cost
    const hourlyRate = payInfo?.hourlyRate ?? DEFAULT_HOURLY_RATE;
    const baseCost = calculateTutorSlotPay(slot.durationMinutes, slot.lessonKind, hourlyRate);
    if (baseCost === null) {
      unpricedSlots += 1;
      continue;
    }
    const cost = baseCost * (slot.weight ?? 1);
    variableWeekly += cost;
    const current = byTutor.get(slot.tutor) || { tutor: slot.tutor, weekly: 0, slots: 0 };
    current.weekly += cost;
    current.slots += 1;
    byTutor.set(slot.tutor, current);
  }

  let salariedMonthly = 0;
  const salariedTutors = [];
  for (const info of tutorPay.values()) {
    if (info.payModel === 'salary') {
      salariedMonthly += info.monthlySalary;
      salariedTutors.push({ tutor: info.tutor, monthly: info.monthlySalary });
    }
  }

  const round = (n) => Math.round(n * 100) / 100;
  return {
    variableWeekly: round(variableWeekly),
    variableMonthly: round(variableWeekly * WEEKS_PER_MONTH),
    salariedMonthly: round(salariedMonthly),
    salariedTutors,
    unpricedSlots,
    slotCount: slots.size,
    byTutor: [...byTutor.values()].map((entry) => ({ ...entry, weekly: round(entry.weekly) })),
  };
}
