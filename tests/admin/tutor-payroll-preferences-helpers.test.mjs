import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeTutorPayrollPreference,
  normalisePayrollContactEmail,
  normaliseTutorPayrollCadence,
  payrollRunMatchesTutor,
  resolveCadenceEffectiveFrom,
  tutorPayRowMatches,
} from '../../lib/admin/tutor-payroll-preferences-helpers.mjs';

test('payroll cadence accepts only the two tutor-facing choices', () => {
  assert.equal(normaliseTutorPayrollCadence('Weekly'), 'weekly');
  assert.equal(normaliseTutorPayrollCadence('fortnightly'), 'biweekly');
  assert.equal(normaliseTutorPayrollCadence('monthly'), '');
});

test('contact email is normalised and newline or malformed input is rejected', () => {
  assert.equal(normalisePayrollContactEmail(' Tutor@Example.com '), 'tutor@example.com');
  assert.equal(normalisePayrollContactEmail('tutor example.com'), '');
  assert.equal(normalisePayrollContactEmail('a@example.com\nBcc:x@example.com'), '');
});

test('cadence starts after the last paid-through date, or today for a first run', () => {
  assert.equal(resolveCadenceEffectiveFrom({ lastPaidThrough: '2026-09-15', today: '2026-09-21' }), '2026-09-16');
  assert.equal(resolveCadenceEffectiveFrom({ today: '2026-09-21' }), '2026-09-21');
});

test('tutor matching accepts short or full names without crossing tutors', () => {
  const identity = { shortName: 'Dean', fullName: 'Dean Parker' };
  assert.equal(tutorPayRowMatches({ tutor: 'dean parker' }, identity), true);
  assert.equal(payrollRunMatchesTutor({ tutor_short_name: 'Dean' }, identity), true);
  assert.equal(payrollRunMatchesTutor({ tutor: 'Finn Le Marinel' }, identity), false);
});

test('preference description preserves verification and outstanding-run evidence', () => {
  assert.deepEqual(describeTutorPayrollPreference({
    row: {
      invoice_cadence: 'bi-weekly',
      contact_email: 'DEAN@example.com',
      contact_email_verified_at: '2026-09-20T10:00:00Z',
    },
    lastPaidThrough: '2026-09-15',
    hasReviewedUnpaidRun: true,
  }), {
    cadence: 'biweekly',
    cadenceEffectiveFrom: '',
    cadenceUpdatedAt: '',
    contactEmail: 'dean@example.com',
    contactEmailVerifiedAt: '2026-09-20T10:00:00Z',
    lastPaidThrough: '2026-09-15',
    hasReviewedUnpaidRun: true,
  });
});
