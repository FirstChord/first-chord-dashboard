import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveStudentAge, parseSignupAge } from '../../lib/admin/student-age.mjs';

const NOW = new Date('2026-09-18T12:00:00Z');
const note = (age) => `Instrument: Guitar\r\nStudents Age: ${age}\r\nWhich song(s) would you love to learn?: Wonderwall`;

test('parseSignupAge reads the free-text shapes the sign-up form actually produces', () => {
  assert.equal(parseSignupAge('9'), 9);
  assert.equal(parseSignupAge('6 years old'), 6);
  assert.equal(parseSignupAge('11yrs'), 11);
  assert.equal(parseSignupAge('11 (12 in April)'), 11);
  assert.equal(parseSignupAge('6 (nearly 7)'), 6);
  assert.equal(parseSignupAge('Adult'), 'adult');
});

test('parseSignupAge refuses a sibling form rather than guessing which child is which', () => {
  assert.equal(parseSignupAge('9 and 6'), null);
  assert.equal(parseSignupAge(''), null);
});

test('an exact MMS date of birth wins over the sign-up note', () => {
  const age = deriveStudentAge({ dateOfBirth: '2012-10-01T00:00:00', note: note('5'), dateStarted: '2020-01-01' }, NOW);
  assert.equal(age.years, 13); // 14th birthday is next month
  assert.equal(age.approximate, false);
  assert.equal(age.label, 'Age 13');
});

test('a sign-up age rolls forward by whole years since DateStarted and is marked approximate', () => {
  const age = deriveStudentAge({ note: note('9'), dateStarted: '2024-03-10T00:00:00' }, NOW);
  assert.equal(age.years, 11);
  assert.equal(age.short, '~11');
  assert.equal(age.detail, '9 at sign-up (Mar 2024)');
});

test('no usable age in MMS yields null, not a placeholder', () => {
  assert.equal(deriveStudentAge({ note: '' }, NOW), null);
  assert.equal(deriveStudentAge({ note: note('9 and 6'), dateStarted: '2025-01-01' }, NOW), null);
});
