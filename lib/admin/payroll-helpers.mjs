/** @fileoverview Pure payroll period, attendance-query, saved-run normalization, and tutor-pay preview calculations. */
import { ADMIN_TUTORS } from './tutors-data.js';
import {
  calculateTutorSlotPay,
  DEFAULT_HOURLY_RATE,
} from './cost-helpers.mjs';

// MMS attendance statuses. `absentnomakeup` = absent but still invoiced (e.g. tutor
// recorded a practice video / no makeup offered) → the tutor is paid, so it's payable.
// `absentnotice` = absent with notice → not invoiced, tutor not paid → excluded (£0).
const PAYABLE_STATUSES = new Set(['present', 'attended', 'completed', 'absentnomakeup']);
const EXCLUDED_STATUSES = new Set(['absent', 'cancelled', 'canceled', 'make up', 'make-up', 'absentnotice']);
const ATTENDED_STATUSES = new Set(['present', 'attended', 'completed']);

function normalise(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function parseNumber(value) {
  const parsed = Number.parseFloat(`${value || ''}`.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `${value}`.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function toInputDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export const PAYROLL_CUTOVER_RUN_DATE = '2026-09-21';
export const PAYROLL_CUTOVER_PERIOD_END = '2026-09-20';
export const PAYROLL_NEW_SYSTEM_START = '2026-09-21';

export function isPayrollCutoverPeriod({ periodEnd = '' } = {}) {
  return dateOnly(periodEnd) === PAYROLL_CUTOVER_PERIOD_END;
}

export function nextMonday(from = new Date()) {
  const londonParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(from).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const date = new Date(`${londonParts.year}-${londonParts.month}-${londonParts.day}T12:00:00Z`);
  const day = date.getUTCDay();
  const delta = (1 - day + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Default per-tutor window length from Tutor_Pay `invoice_cadence` (first-run fallback).
export function cadenceLengthDays(cadence) {
  const c = normalise(cadence);
  if (['three-weekly', 'triweekly', '3-weekly', 'threeweekly'].includes(c)) return 21;
  if (['biweekly', 'bi-weekly', 'fortnightly'].includes(c)) return 14;
  return 7;
}

// Per-tutor pay window, set via Tutor_Pay `invoice_cadence`. Supports up to 3 weeks:
// weekly (7d), biweekly/fortnightly (14d), three-weekly (21d).
export function buildPayrollPeriod({ payDate = nextMonday(), cadence = 'weekly' } = {}) {
  const cleanPayDate = toInputDate(`${payDate}T12:00:00Z`);
  const length = cadenceLengthDays(cadence);
  const label = length === 21 ? 'three-weekly' : length === 14 ? 'biweekly' : 'weekly';
  return {
    payDate: cleanPayDate,
    periodStart: addDays(cleanPayDate, -length),
    periodEnd: addDays(cleanPayDate, -1),
    days: length,
    cadence: label,
  };
}

export function isPayrollWindowDue({
  periodStart = '',
  periodEnd = '',
  cadence = 'weekly',
  basis = '',
  empty = false,
  cutover = false,
} = {}) {
  if (empty) return false;
  // The one-off transition settles every tutor to the same Sunday boundary,
  // even when the remaining fragment is shorter than their ordinary cadence.
  if (cutover) return true;
  // A deliberate admin override is an explicit instruction to prepare this
  // window now. Normal generated windows must contain a complete cadence.
  if (`${basis || ''}`.trim() === 'override') return true;
  return daysInclusive(periodStart, periodEnd) >= cadenceLengthDays(cadence);
}

const MAX_LOOKBACK_DAYS = 35;

// The one MMS attendance query the payroll lane makes, derived from the cycle date
// alone. Both the payroll page and the tutor statement call this so they land on
// the same cache key — the statement used to ask for its own narrow
// {one tutor, one week} window and therefore always paid a cold fetch, even
// opening straight off the payroll page that already held the answer.
//
// A superset of rows is safe input: buildPayrollPreview filters slots by
// teacher and period itself (see the tutorSlots filter), so the extra tutors and
// the wider date range change nothing about the row it produces. `coversPeriod`
// exists for callers that must confirm that before relying on it.
export function buildPayrollAttendanceQuery(payDate = nextMonday()) {
  const cleanPayDate = toInputDate(`${payDate}T12:00:00Z`);
  return {
    // Full max look-back: a since-last-paid catch-up can reach back five weeks.
    startDate: addDays(cleanPayDate, -MAX_LOOKBACK_DAYS),
    endDate: buildPayrollPeriod({ payDate: cleanPayDate, cadence: 'weekly' }).periodEnd,
    teacherIds: Object.values(ADMIN_TUTORS).map((tutor) => tutor.teacherId).filter(Boolean),
    // No `limit` on purpose: page size lives in one place
    // (PAYROLL_ATTENDANCE_PAGE_SIZE in lib/admin/mms.js) and it is part of the
    // cache key, so a second copy here would silently split the cache the moment
    // the two drifted — which is the exact bug this shared query exists to fix.
  };
}

// Does a fetched window fully contain the period a caller needs? Guards the
// statement's reuse of the page-shaped query: a saved run with a hand-set
// window could in principle sit outside it, and a silently short row set on a
// money surface is exactly the failure this lane has been bitten by before.
export function attendanceQueryCoversPeriod(query, { periodStart, periodEnd } = {}) {
  if (!query || !periodStart || !periodEnd) return false;
  return query.startDate <= periodStart && query.endDate >= periodEnd;
}

function daysInclusive(start, end) {
  if (!start || !end || start > end) return 0;
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1;
}

// The real anchor: a tutor's run covers everything since they were last PAID, up to the
// Sunday before this Monday cycle date. This auto-adjusts (catch-up if they missed an invoice) and can't re-include
// already-paid lessons. Falls back to cadence length for a first/never-paid run, with a
// max look-back cap; an explicit overrideStart lets an admin match an irregular invoice.
export function resolveTutorPayrollWindow({
  payDate = nextMonday(),
  lastPaidThrough = '',
  cadence = 'weekly',
  overrideStart = '',
  overrideEnd = '',
  maxLookbackDays = MAX_LOOKBACK_DAYS,
} = {}) {
  const cleanPayDate = toInputDate(`${payDate}T12:00:00Z`);
  // Default end is the day before the Monday cycle date (Sunday). Statements may be
  // often sent earlier in the week, so an explicit overrideEnd can pull the end earlier —
  // never later than the default (lessons after that belong to the next run).
  const defaultEnd = addDays(cleanPayDate, -1);
  const cleanOverrideEnd = overrideEnd ? toInputDate(`${overrideEnd}T12:00:00Z`) : '';
  const periodEnd = cleanOverrideEnd && cleanOverrideEnd < defaultEnd ? cleanOverrideEnd : defaultEnd;
  const cleanOverride = overrideStart ? toInputDate(`${overrideStart}T12:00:00Z`) : '';
  const cleanLastPaid = lastPaidThrough ? toInputDate(`${lastPaidThrough}T12:00:00Z`) : '';

  let periodStart;
  let basis;
  if (cleanOverride) {
    periodStart = cleanOverride;
    basis = 'override';
  } else if (cleanLastPaid) {
    periodStart = addDays(cleanLastPaid, 1);
    basis = 'since_paid';
  } else {
    periodStart = addDays(cleanPayDate, -cadenceLengthDays(cadence));
    basis = 'first_run';
  }

  const floor = addDays(cleanPayDate, -maxLookbackDays);
  let capped = false;
  if (periodStart < floor) {
    periodStart = floor;
    capped = true;
  }

  const empty = periodStart > periodEnd;
  return {
    payDate: cleanPayDate,
    periodStart,
    periodEnd,
    days: daysInclusive(periodStart, periodEnd),
    basis,
    capped,
    empty,
    endCustom: Boolean(cleanOverrideEnd && cleanOverrideEnd < defaultEnd),
  };
}

// Does a window overlap any already-paid period for this tutor? Returns the first
// overlapping paid period (for a warning) or null. The since-last-paid default never
// overlaps; this guards manual overrides that reach too far back.
export function overlapsPaidRun(window, paidPeriods = []) {
  for (const p of paidPeriods) {
    if (!p.periodStart || !p.periodEnd) continue;
    if (window.periodStart <= p.periodEnd && window.periodEnd >= p.periodStart) return p;
  }
  return null;
}

export function buildPayrollRunId({ tutorKey = '', periodStart = '', periodEnd = '' } = {}) {
  const key = normalise(tutorKey).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `payroll_${key}_${periodStart}_${periodEnd}`;
}

export function formatPayrollDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `${value}`;
  return parsed.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
}

function tutorOptions() {
  return Object.entries(ADMIN_TUTORS).map(([shortName, tutor]) => ({
    shortName,
    fullName: tutor.fullName,
    teacherId: tutor.teacherId,
  }));
}

function resolveTutorPayInfo(tutor, tutorPay) {
  const keys = [
    tutor.shortName,
    tutor.fullName,
  ].map(normalise).filter(Boolean);
  for (const key of keys) {
    if (tutorPay?.has(key)) return tutorPay.get(key);
  }
  return {
    tutor: tutor.shortName || tutor.fullName,
    payModel: 'hourly',
    hourlyRate: DEFAULT_HOURLY_RATE,
    monthlySalary: 0,
    invoiceCadence: 'weekly',
    contactEmail: '',
    contactEmailVerifiedAt: '',
    paymentRoute: 'normal',
    activeForPayroll: true,
  };
}

export function normalisePayrollRunRow(row = {}) {
  return {
    payrollId: `${row.payroll_id ?? row.payrollId ?? ''}`.trim(),
    payDate: dateOnly(row.pay_date ?? row.payDate),
    periodStart: dateOnly(row.period_start ?? row.periodStart),
    periodEnd: dateOnly(row.period_end ?? row.periodEnd),
    tutor: `${row.tutor ?? row.Tutor ?? ''}`.trim(),
    tutorShortName: `${row.tutor_short_name ?? row.tutorShortName ?? ''}`.trim(),
    teacherId: `${row.teacher_id ?? row.teacherId ?? ''}`.trim(),
    invoiceCadence: normalise(row.invoice_cadence ?? row.invoiceCadence) || 'weekly',
    payModel: normalise(row.pay_model ?? row.payModel) || 'hourly',
    lessonCount: parseNumber(row.lesson_count ?? row.lessonCount) ?? 0,
    reviewLessonCount: parseNumber(row.review_lesson_count ?? row.reviewLessonCount) ?? 0,
    teachingMinutes: parseNumber(row.teaching_minutes ?? row.teachingMinutes) ?? 0,
    expectedAmount: parseNumber(row.expected_amount ?? row.expectedAmount) ?? 0,
    adjustmentAmount: parseNumber(row.adjustment_amount ?? row.adjustmentAmount) ?? 0,
    finalAmount: parseNumber(row.final_amount ?? row.finalAmount) ?? 0,
    status: normalise(row.status) || 'draft',
    invoiceStatus: normalise(row.invoice_status ?? row.invoiceStatus) || '',
    paymentRoute: normalise(row.payment_route ?? row.paymentRoute) === 'confirmation' ? 'confirmation' : 'normal',
    statementSentAt: `${row.statement_sent_at ?? row.statementSentAt ?? ''}`.trim(),
    statementSentBy: `${row.statement_sent_by ?? row.statementSentBy ?? ''}`.trim(),
    statementDeliveryStatus: normalise(row.statement_delivery_status ?? row.statementDeliveryStatus) || '',
    statementDeliveryChannel: normalise(row.statement_delivery_channel ?? row.statementDeliveryChannel) || '',
    statementDeliveryTo: `${row.statement_delivery_to ?? row.statementDeliveryTo ?? ''}`.trim().toLowerCase(),
    statementDeliveryAttemptedAt: `${row.statement_delivery_attempted_at ?? row.statementDeliveryAttemptedAt ?? ''}`.trim(),
    statementDeliveryMessageId: `${row.statement_delivery_message_id ?? row.statementDeliveryMessageId ?? ''}`.trim(),
    statementDeliveryError: `${row.statement_delivery_error ?? row.statementDeliveryError ?? ''}`.trim(),
    notes: `${row.notes ?? row.Notes ?? ''}`.trim(),
    reviewedAt: `${row.reviewed_at ?? row.reviewedAt ?? ''}`.trim(),
    reviewedBy: `${row.reviewed_by ?? row.reviewedBy ?? ''}`.trim(),
    paidAt: `${row.paid_at ?? row.paidAt ?? ''}`.trim(),
    paidBy: `${row.paid_by ?? row.paidBy ?? ''}`.trim(),
    tutorResponse: normalise(row.tutor_response ?? row.tutorResponse) || '',
    tutorRespondedAt: `${row.tutor_responded_at ?? row.tutorRespondedAt ?? ''}`.trim(),
    tutorNote: `${row.tutor_note ?? row.tutorNote ?? ''}`.trim(),
    source: `${row.source ?? ''}`.trim(),
    createdAt: `${row.created_at ?? row.createdAt ?? ''}`.trim(),
    updatedAt: `${row.updated_at ?? row.updatedAt ?? ''}`.trim(),
  };
}

function mapAttendanceRow(row = {}) {
  const attendanceId = row.ID || row.AttendanceID || '';
  const eventId = row.EventID || '';
  const teacherId = row.TeacherID || row.Teacher?.ID || '';
  const originalTeacherId = row.OriginalTeacherID || row.OriginalTeacher?.ID || '';
  const status = `${row.AttendanceStatus || ''}`.trim();
  const studentName = row.Student?.Name || row.StudentFullName || row.StudentName || '';
  return {
    attendanceId,
    eventId,
    teacherId,
    originalTeacherId,
    studentId: row.StudentID || row.Student?.ID || '',
    studentName,
    teacherName: row.Teacher?.Name || '',
    startAt: row.EventStartDate || '',
    lessonDate: dateOnly(row.EventStartDate || ''),
    durationMinutes: parseNumber(row.EventDuration) ?? parseNumber(row.Duration),
    status,
    isCover: Boolean(originalTeacherId && teacherId && originalTeacherId !== teacherId),
  };
}

function groupSlots(attendanceRows = []) {
  const slots = new Map();
  for (const raw of attendanceRows) {
    const row = mapAttendanceRow(raw);
    if (!row.teacherId || !row.lessonDate) continue;
    const key = row.eventId || row.attendanceId || `${row.teacherId}:${row.startAt}:${row.studentId}`;
    const existing = slots.get(key) || {
      eventId: row.eventId,
      teacherId: row.teacherId,
      originalTeacherId: row.originalTeacherId,
      startAt: row.startAt,
      lessonDate: row.lessonDate,
      durationMinutes: row.durationMinutes,
      statuses: [],
      students: [],
      isCover: false,
    };
    existing.statuses.push(row.status);
    if (row.studentName || row.studentId) {
      existing.students.push({
        studentId: row.studentId,
        studentName: row.studentName,
        attendanceId: row.attendanceId,
        status: row.status,
      });
    }
    existing.isCover = existing.isCover || row.isCover;
    if (!Number.isFinite(existing.durationMinutes) && Number.isFinite(row.durationMinutes)) {
      existing.durationMinutes = row.durationMinutes;
    }
    slots.set(key, existing);
  }
  return [...slots.values()];
}

function isWithinPeriod(date, start, end) {
  return date >= start && date <= end;
}

function resolveSlotState(slot) {
  const statuses = slot.statuses.map(normalise).filter(Boolean);
  if (statuses.some((status) => PAYABLE_STATUSES.has(status))) return 'payable';
  if (!statuses.length || statuses.some((status) => status === 'unrecorded')) return 'needs_review';
  if (statuses.every((status) => EXCLUDED_STATUSES.has(status))) return 'excluded';
  return 'needs_review';
}

export function buildPayrollPreview({
  attendanceRows = [],
  tutorPay = new Map(),
  payDate = nextMonday(),
  savedRuns = [],
  overrides = {},
  maxLookbackDays = MAX_LOOKBACK_DAYS,
  now = new Date(),
} = {}) {
  const normalisedSaved = savedRuns.map(normalisePayrollRunRow);
  const savedById = new Map(normalisedSaved.filter((row) => row.payrollId).map((row) => [row.payrollId, row]));

  // Per-tutor paid history: last paid-through date + all paid periods (for the overlap guard).
  const paidByTutor = new Map();
  for (const saved of normalisedSaved) {
    if (saved.status !== 'paid') continue;
    const key = normalise(saved.tutorShortName || saved.tutor);
    if (!key) continue;
    const entry = paidByTutor.get(key) || { lastPaidThrough: '', periods: [] };
    entry.periods.push({ periodStart: saved.periodStart, periodEnd: saved.periodEnd });
    if (!entry.lastPaidThrough || saved.periodEnd > entry.lastPaidThrough) entry.lastPaidThrough = saved.periodEnd;
    paidByTutor.set(key, entry);
  }

  const slots = groupSlots(attendanceRows);
  const tutors = tutorOptions();
  const rows = [];
  // A review (unrecorded) lesson on or before today is a genuine open loop
  // someone must record in MMS; a future one will self-resolve once it happens.
  const todayStr = dateOnly(new Date(now).toISOString());

  for (const tutor of tutors) {
    const payInfo = resolveTutorPayInfo(tutor, tutorPay);
    if (payInfo.activeForPayroll === false) continue;
    const tutorKey = normalise(tutor.shortName || tutor.fullName);
    const paidInfo = paidByTutor.get(tutorKey) || { lastPaidThrough: '', periods: [] };
    const ov = overrides[tutor.shortName] || overrides[tutorKey] || {};
    const overrideStart = typeof ov === 'string' ? ov : (ov.start || '');
    const overrideEnd = typeof ov === 'string' ? '' : (ov.end || '');
    const window = resolveTutorPayrollWindow({
      payDate,
      lastPaidThrough: paidInfo.lastPaidThrough,
      cadence: payInfo.invoiceCadence,
      overrideStart,
      overrideEnd,
      maxLookbackDays,
    });
    const overlapPaid = overlapsPaidRun(window, paidInfo.periods);
    const period = { payDate: window.payDate, periodStart: window.periodStart, periodEnd: window.periodEnd, cadence: payInfo.invoiceCadence || 'weekly' };
    const isCutover = isPayrollCutoverPeriod(period);
    // The cutoff must begin from recorded payment truth. Where the dashboard has
    // no paid baseline, require an explicit start rather than inferring history
    // from the tutor's current cadence.
    const cutoverNeedsStart = isCutover && !paidInfo.lastPaidThrough && window.basis !== 'override';
    const cadenceDue = isPayrollWindowDue({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      cadence: period.cadence,
      basis: window.basis,
      empty: window.empty,
      cutover: isCutover,
    });
    const nextCadencePayDate = paidInfo.lastPaidThrough
      ? addDays(paidInfo.lastPaidThrough, cadenceLengthDays(period.cadence) + 1)
      : period.payDate;
    const tutorSlots = slots.filter((slot) => (
      slot.teacherId === tutor.teacherId
      && isWithinPeriod(slot.lessonDate, period.periodStart, period.periodEnd)
    ));
    const payrollId = buildPayrollRunId({
      tutorKey: tutor.shortName || tutor.fullName,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    const saved = savedById.get(payrollId) || null;
    const payModel = payInfo.payModel || 'hourly';
    const hourlyRate = payInfo.hourlyRate ?? DEFAULT_HOURLY_RATE;

    let expectedAmount = 0;
    let teachingMinutes = 0;
    let lessonCount = 0;
    let reviewLessonCount = 0;
    const payableSlots = [];
    const reviewSlots = [];
    const excludedSlots = [];

    for (const slot of tutorSlots) {
      const state = resolveSlotState(slot);
      const studentCount = new Set(slot.students.map((student) => student.studentId || student.studentName).filter(Boolean)).size || slot.students.length || 1;
      const lessonKind = studentCount > 1 ? 'group' : 'one_to_one';
      const amount = payModel === 'salary' ? 0 : calculateTutorSlotPay(slot.durationMinutes, lessonKind, hourlyRate, { studentCount });
      const statusLabel = [...new Set(slot.statuses.map((s) => `${s || ''}`.trim()).filter(Boolean))].join(' / ');
      // A payable slot where no student was actually present (all absent-no-makeup) — paid
      // per the no-makeup policy. Worth flagging in the UI even though it's payable.
      const normalisedStatuses = slot.statuses.map(normalise).filter(Boolean);
      const isPaidAbsence = state === 'payable' && !normalisedStatuses.some((s) => ATTENDED_STATUSES.has(s));
      const normalisedSlot = {
        ...slot,
        state,
        studentCount,
        lessonKind,
        statusLabel,
        isPaidAbsence,
        timing: slot.lessonDate <= todayStr ? 'past' : 'upcoming',
        amount: Number.isFinite(amount) ? round(amount) : null,
      };

      if (state === 'payable') {
        lessonCount += 1;
        teachingMinutes += Number.isFinite(slot.durationMinutes) ? slot.durationMinutes : 0;
        if (Number.isFinite(amount)) expectedAmount += amount;
        payableSlots.push(normalisedSlot);
      } else if (state === 'needs_review') {
        reviewLessonCount += 1;
        reviewSlots.push(normalisedSlot);
      } else {
        excludedSlots.push(normalisedSlot);
      }
    }

    const reviewPastCount = reviewSlots.filter((slot) => slot.timing === 'past').length;
    const reviewUpcomingCount = reviewSlots.length - reviewPastCount;
    const adjustmentAmount = saved?.adjustmentAmount || 0;
    const recalculatedFinalAmount = round(expectedAmount + adjustmentAmount);
    const finalAmount = saved ? saved.finalAmount : recalculatedFinalAmount;
    const status = saved?.status || 'draft';
    // A reviewed run is deliberately frozen, but a later explicit MMS refresh
    // can reveal corrected attendance underneath it. Keep the saved figure as
    // the payment record until the admin reviews/saves again, while making the
    // drift impossible to miss in the payroll UI.
    const attendanceChanged = status === 'reviewed' && Boolean(saved) && (
      round(saved.expectedAmount) !== round(expectedAmount)
      || saved.lessonCount !== lessonCount
      || saved.teachingMinutes !== teachingMinutes
    );
    // Once paid, nothing is outstanding — owed drops to 0 (finalAmount kept as the record).
    const owedAmount = status === 'paid' ? 0 : round(finalAmount);
    const cutoverNothingOwed = isCutover && !window.empty && lessonCount === 0 && owedAmount === 0;
    rows.push({
      payrollId,
      tutor: tutor.fullName,
      tutorShortName: tutor.shortName,
      teacherId: tutor.teacherId,
      payModel,
      invoiceCadence: period.cadence,
      isCutover,
      cutoverNeedsStart,
      cutoverNothingOwed,
      cadenceDue,
      nextCadencePayDate,
      contactEmail: payInfo.contactEmail || '',
      contactEmailVerifiedAt: payInfo.contactEmailVerifiedAt || '',
      payDate: period.payDate,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      windowBasis: window.basis,
      windowDays: window.days,
      windowCapped: window.capped,
      windowEmpty: window.empty,
      windowEndCustom: window.endCustom,
      lastPaidThrough: paidInfo.lastPaidThrough || '',
      overlapsPaid: overlapPaid ? { periodStart: overlapPaid.periodStart, periodEnd: overlapPaid.periodEnd } : null,
      lessonCount,
      reviewLessonCount,
      reviewPastCount,
      reviewUpcomingCount,
      excludedLessonCount: excludedSlots.length,
      teachingMinutes,
      expectedAmount: round(expectedAmount),
      adjustmentAmount: round(adjustmentAmount),
      recalculatedFinalAmount,
      finalAmount: round(finalAmount),
      owedAmount,
      attendanceChanged,
      hourlyRate,
      monthlySalary: payInfo.monthlySalary || 0,
      status,
      invoiceStatus: saved?.invoiceStatus || '',
      paymentRoute: saved?.paymentRoute || (isCutover ? 'confirmation' : (payInfo.paymentRoute || 'normal')),
      statementSentAt: saved?.statementSentAt || '',
      statementSentBy: saved?.statementSentBy || '',
      statementDeliveryStatus: saved?.statementDeliveryStatus || '',
      statementDeliveryChannel: saved?.statementDeliveryChannel || '',
      statementDeliveryTo: saved?.statementDeliveryTo || '',
      statementDeliveryAttemptedAt: saved?.statementDeliveryAttemptedAt || '',
      statementDeliveryMessageId: saved?.statementDeliveryMessageId || '',
      statementDeliveryError: saved?.statementDeliveryError || '',
      notes: saved?.notes || (isCutover ? `One-off payroll cutover: closes legacy pay through ${PAYROLL_CUTOVER_PERIOD_END}; Monday-based periods start ${PAYROLL_NEW_SYSTEM_START}.` : ''),
      reviewedAt: saved?.reviewedAt || '',
      reviewedBy: saved?.reviewedBy || '',
      tutorResponse: saved?.tutorResponse || '',
      tutorRespondedAt: saved?.tutorRespondedAt || '',
      tutorNote: saved?.tutorNote || '',
      paidAt: saved?.paidAt || '',
      paidBy: saved?.paidBy || '',
      source: saved?.source || 'mms_attendance_preview',
      createdAt: saved?.createdAt || '',
      updatedAt: saved?.updatedAt || now.toISOString(),
      payableSlots,
      reviewSlots,
      excludedSlots,
    });
  }

  rows.sort((a, b) => (
    (b.expectedAmount - a.expectedAmount)
    || a.tutor.localeCompare(b.tutor)
  ));

  const hourlyRows = rows.filter((row) => row.payModel !== 'salary');
  const totals = {
    expectedAmount: round(hourlyRows.reduce((sum, row) => sum + row.expectedAmount, 0)),
    finalAmount: round(hourlyRows.reduce((sum, row) => sum + row.finalAmount, 0)),
    outstandingAmount: round(hourlyRows.reduce((sum, row) => sum + (row.owedAmount ?? 0), 0)),
    lessonCount: hourlyRows.reduce((sum, row) => sum + row.lessonCount, 0),
    reviewLessonCount: hourlyRows.reduce((sum, row) => sum + row.reviewLessonCount, 0),
    paidCount: rows.filter((row) => row.status === 'paid').length,
    reviewedCount: rows.filter((row) => row.status === 'reviewed' || row.status === 'paid').length,
  };

  return {
    payDate: toInputDate(`${payDate}T12:00:00Z`),
    fetchedRangeStart: buildPayrollPeriod({ payDate, cadence: 'biweekly' }).periodStart,
    fetchedRangeEnd: buildPayrollPeriod({ payDate, cadence: 'weekly' }).periodEnd,
    rows,
    totals,
    generatedAt: now.toISOString(),
  };
}
