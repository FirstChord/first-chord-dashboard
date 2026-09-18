/** @fileoverview Derives a student's current age from MMS: an exact DateOfBirth when one is set, else the sign-up form's "Students Age" note line rolled forward from DateStarted. */
import { parseNoteFields } from './mms-helpers.mjs';

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wholeYearsBetween(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const beforeAnniversary = to.getMonth() < from.getMonth()
    || (to.getMonth() === from.getMonth() && to.getDate() < from.getDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

// The sign-up form's age field is free text: "9", "6 years old", "11yrs",
// "11 (12 in April)". A bracketed aside is a refinement, not a second age.
// A family form covering siblings ("9 and 6") can't say which child is which,
// so it yields nothing rather than a guess.
export function parseSignupAge(value = '') {
  const text = `${value}`.replace(/\([^)]*\)/gu, ' ');
  const numbers = text.match(/\d{1,3}/gu) || [];
  if (numbers.length === 1) {
    const age = Number(numbers[0]);
    return age > 0 && age < 110 ? age : null;
  }
  if (!numbers.length && /\badult\b/iu.test(text)) return 'adult';
  return null;
}

// Returns null when MMS holds nothing usable. `approximate` marks an age rolled
// forward from sign-up: the form records whole years on an unknown birthday, so
// the estimate can be one year low.
export function deriveStudentAge({ dateOfBirth = '', note = '', dateStarted = '' } = {}, now = new Date()) {
  const birth = toDate(dateOfBirth);
  if (birth) {
    const years = wholeYearsBetween(birth, now);
    if (years >= 0) return { years, approximate: false, short: `${years}`, label: `Age ${years}`, detail: 'Date of birth in MMS' };
  }

  const signupText = parseNoteFields(note).age;
  const signupAge = parseSignupAge(signupText);
  if (signupAge === 'adult') return { years: null, approximate: true, short: 'Adult', label: 'Adult', detail: `Sign-up form: "${signupText}"` };
  if (signupAge === null) return null;

  const started = toDate(dateStarted);
  const elapsed = started ? Math.max(0, Math.floor((now.getTime() - started.getTime()) / MS_PER_YEAR)) : 0;
  const years = signupAge + elapsed;
  const signedUp = started
    ? ` (${started.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Europe/London' })})`
    : '';
  return {
    years,
    approximate: true,
    short: `~${years}`,
    label: `Age ~${years}`,
    detail: `${signupAge} at sign-up${signedUp}`,
  };
}
