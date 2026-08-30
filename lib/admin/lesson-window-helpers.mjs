/** @fileoverview Pure London-calendar windows shared by lesson-mirror sync and bounded lesson-occurrence reads. */

export const LESSON_MIRROR_LOOKBACK_DAYS = 14;
export const LESSON_MIRROR_FUTURE_DAYS = 42;

function londonDate(at) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) throw new Error('A valid lesson-mirror schedule time is required');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDateDays(isoDate, days) {
  const match = `${isoDate || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) throw new Error('A valid ISO lesson-mirror date is required');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildScheduledLessonMirrorWindow({
  at = new Date(),
  lookbackDays = LESSON_MIRROR_LOOKBACK_DAYS,
  futureDays = LESSON_MIRROR_FUTURE_DAYS,
} = {}) {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 0 || lookbackDays > 365) {
    throw new Error('Lesson-mirror lookback must be between 0 and 365 days');
  }
  if (!Number.isInteger(futureDays) || futureDays < 0 || futureDays > 365) {
    throw new Error('Lesson-mirror future horizon must be between 0 and 365 days');
  }
  const today = londonDate(at);
  return {
    today,
    startDate: addDateDays(today, -lookbackDays),
    // End dates are exclusive: include today and exactly futureDays after it.
    endDateExclusive: addDateDays(today, futureDays + 1),
    lookbackDays,
    futureDays,
  };
}
