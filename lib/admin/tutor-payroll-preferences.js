/** @fileoverview Loads and updates admin-maintained tutor payroll cadence and verified statement contact details. */
import { randomUUID } from 'node:crypto';
import { ADMIN_TUTORS } from './tutors-data.js';
import { DEFAULT_HOURLY_RATE } from './cost-helpers.mjs';
import {
  appendEventLogRow,
  getPayrollRunRows,
  getTutorPayRows,
  upsertTutorPayRow,
} from './sheets.js';
import {
  describeTutorPayrollPreference,
  normalisePayrollContactEmail,
  normaliseTutorPayrollCadence,
  payrollRunMatchesTutor,
  resolveCadenceEffectiveFrom,
  tutorPayRowMatches,
} from './tutor-payroll-preferences-helpers.mjs';

function tutorIdentity(tutorShortName = '') {
  const shortName = `${tutorShortName || ''}`.trim();
  const tutor = ADMIN_TUTORS[shortName];
  if (!tutor) return null;
  return { shortName, fullName: tutor.fullName || shortName, teacherId: tutor.teacherId || '' };
}

function runState(runs = [], identity = {}) {
  const matching = runs.filter((row) => payrollRunMatchesTutor(row, identity));
  const paid = matching
    .filter((row) => `${row.status || ''}`.trim().toLowerCase() === 'paid')
    .map((row) => `${row.period_end ?? row.periodEnd ?? ''}`.trim())
    .filter(Boolean)
    .sort();
  return {
    lastPaidThrough: paid.at(-1) || '',
    hasReviewedUnpaidRun: matching.some((row) => `${row.status || ''}`.trim().toLowerCase() === 'reviewed'),
  };
}

function baseTutorPayRow(existing = {}, identity = {}) {
  return {
    ...existing,
    tutor: `${existing.tutor ?? existing.Tutor ?? identity.shortName ?? ''}`.trim(),
    pay_model: existing.pay_model ?? existing.payModel ?? 'hourly',
    hourly_rate: existing.hourly_rate ?? existing.hourlyRate ?? DEFAULT_HOURLY_RATE,
    monthly_salary: existing.monthly_salary ?? existing.monthlySalary ?? '',
    invoice_cadence: existing.invoice_cadence ?? existing.invoiceCadence ?? 'weekly',
    payment_route: existing.payment_route ?? existing.paymentRoute ?? 'normal',
    active_for_payroll: existing.active_for_payroll ?? existing.activeForPayroll ?? 'yes',
    notes: existing.notes ?? '',
  };
}

function buildLoadedPreference({ identity, payRows = [], runs = [] } = {}) {
  const row = payRows.find((entry) => tutorPayRowMatches(entry, identity)) || {};
  const state = runState(runs, identity);
  return {
    ok: true,
    tutor: identity,
    rawRow: row,
    preference: describeTutorPayrollPreference({ row, ...state }),
  };
}

export async function loadTutorPayrollPreferences({ tutorShortNames = [] } = {}) {
  const identities = tutorShortNames.map(tutorIdentity).filter(Boolean);
  const [payRows, runs] = await Promise.all([getTutorPayRows(), getPayrollRunRows()]);
  return identities.map((identity) => buildLoadedPreference({ identity, payRows, runs }));
}

export async function loadTutorPayrollPreference({ tutorShortName = '' } = {}) {
  const identity = tutorIdentity(tutorShortName);
  if (!identity) return { ok: false, reason: 'unknown_tutor' };
  const [loaded] = await loadTutorPayrollPreferences({ tutorShortNames: [identity.shortName] });
  return loaded;
}

export async function saveTutorPayrollAdminSettings({
  tutorShortName = '',
  cadence = '',
  contactEmail = '',
  verifyContactEmail = false,
  actorEmail = '',
  now = new Date(),
} = {}) {
  const nextCadence = normaliseTutorPayrollCadence(cadence);
  const rawEmail = `${contactEmail || ''}`.trim();
  const nextEmail = normalisePayrollContactEmail(rawEmail);
  if (!nextCadence) return { ok: false, reason: 'invalid_cadence' };
  if (rawEmail && !nextEmail) return { ok: false, reason: 'invalid_email' };

  const loaded = await loadTutorPayrollPreference({ tutorShortName });
  if (!loaded.ok) return loaded;
  if (loaded.preference.hasReviewedUnpaidRun && loaded.preference.cadence !== nextCadence) {
    return { ok: false, reason: 'reviewed_run_exists' };
  }

  const changedAt = now.toISOString();
  const emailChanged = loaded.preference.contactEmail !== nextEmail;
  const cadenceChanged = loaded.preference.cadence !== nextCadence;
  const effectiveFrom = cadenceChanged
    ? resolveCadenceEffectiveFrom({ lastPaidThrough: loaded.preference.lastPaidThrough, today: changedAt.slice(0, 10) })
    : loaded.preference.cadenceEffectiveFrom;
  const verifiedAt = nextEmail && verifyContactEmail
    ? (emailChanged ? changedAt : loaded.preference.contactEmailVerifiedAt || changedAt)
    : (emailChanged ? '' : loaded.preference.contactEmailVerifiedAt);

  await upsertTutorPayRow({
    ...baseTutorPayRow(loaded.rawRow, loaded.tutor),
    invoice_cadence: nextCadence,
    cadence_effective_from: effectiveFrom,
    cadence_updated_at: cadenceChanged ? changedAt : (loaded.rawRow.cadence_updated_at || ''),
    cadence_updated_by: cadenceChanged ? `${actorEmail || ''}`.trim().toLowerCase() : (loaded.rawRow.cadence_updated_by || ''),
    contact_email: nextEmail,
    contact_email_verified_at: verifiedAt,
  });

  if (emailChanged || cadenceChanged || Boolean(verifiedAt) !== Boolean(loaded.preference.contactEmailVerifiedAt)) {
    await appendEventLogRow({
      eventId: `evt_${randomUUID()}`,
      occurredAt: changedAt,
      actorEmail,
      entityType: 'tutor',
      entityId: loaded.tutor.teacherId || loaded.tutor.shortName,
      eventType: 'tutor_pay_settings_changed',
      payloadJson: JSON.stringify({
        tutorShortName: loaded.tutor.shortName,
        cadenceBefore: loaded.preference.cadence,
        cadenceAfter: nextCadence,
        cadenceEffectiveFrom: effectiveFrom,
        contactEmailChanged: emailChanged,
        contactEmailVerified: Boolean(verifiedAt),
      }),
    });
  }

  return { ok: true, changed: emailChanged || cadenceChanged, contactEmail: nextEmail, contactEmailVerifiedAt: verifiedAt, cadence: nextCadence, cadenceEffectiveFrom: effectiveFrom };
}
