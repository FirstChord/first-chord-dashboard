/** @fileoverview Pure validation and effective-date rules for tutor payroll contact and cadence preferences. */

const CADENCES = new Set(['weekly', 'biweekly']);

function clean(value = '') {
  return `${value || ''}`.trim();
}

export function normaliseTutorPayrollCadence(value = '') {
  const cadence = clean(value).toLowerCase();
  if (['bi-weekly', 'fortnightly'].includes(cadence)) return 'biweekly';
  return CADENCES.has(cadence) ? cadence : '';
}

export function normalisePayrollContactEmail(value = '') {
  const email = clean(value).toLowerCase();
  if (!email) return '';
  // Deliberately modest validation: reject malformed/newline-bearing addresses,
  // while leaving provider-level deliverability to the explicit verification.
  if (/\s/u.test(email) || !/^[^@]+@[^@]+\.[^@]+$/u.test(email)) return '';
  return email;
}

export function addIsoDays(date = '', days = 0) {
  const parsed = new Date(`${clean(date)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

export function resolveCadenceEffectiveFrom({ lastPaidThrough = '', today = '' } = {}) {
  return lastPaidThrough ? addIsoDays(lastPaidThrough, 1) : clean(today).slice(0, 10);
}

export function tutorPayRowMatches(row = {}, { shortName = '', fullName = '' } = {}) {
  const name = clean(row.tutor ?? row.Tutor).toLowerCase();
  return Boolean(name) && [shortName, fullName].map((value) => clean(value).toLowerCase()).filter(Boolean).includes(name);
}

export function payrollRunMatchesTutor(row = {}, { shortName = '', fullName = '' } = {}) {
  const values = [row.tutor_short_name, row.tutorShortName, row.tutor, row.Tutor]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const aliases = [shortName, fullName].map((value) => clean(value).toLowerCase()).filter(Boolean);
  return values.some((value) => aliases.includes(value));
}

export function describeTutorPayrollPreference({
  row = {},
  lastPaidThrough = '',
  hasReviewedUnpaidRun = false,
} = {}) {
  return {
    cadence: normaliseTutorPayrollCadence(row.invoice_cadence ?? row.invoiceCadence) || 'weekly',
    cadenceEffectiveFrom: clean(row.cadence_effective_from ?? row.cadenceEffectiveFrom),
    cadenceUpdatedAt: clean(row.cadence_updated_at ?? row.cadenceUpdatedAt),
    contactEmail: normalisePayrollContactEmail(row.contact_email ?? row.contactEmail),
    contactEmailVerifiedAt: clean(row.contact_email_verified_at ?? row.contactEmailVerifiedAt),
    lastPaidThrough: clean(lastPaidThrough),
    hasReviewedUnpaidRun: Boolean(hasReviewedUnpaidRun),
  };
}
