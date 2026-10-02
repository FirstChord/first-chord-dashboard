/** @fileoverview Compact inbox category labels and conservative absence notice cues using original message dates, without changing planning or reply policy. */
import { labelIncomingCategory } from './incoming-message-helpers.mjs';
import { extractDatesFromMessage } from './incoming-date-helpers.mjs';
import { classifyNoticeWindow, toSchoolDateIso } from './incoming-reply-policy.mjs';

export const INCOMING_ABSENCE_CATEGORIES = new Set([
  'one_off_absence', 'extended_absence', 'summer_break', 'absence_pause',
]);

export function labelIncomingQueueCategory(category) {
  return INCOMING_ABSENCE_CATEGORIES.has(category) ? 'Absence' : labelIncomingCategory(category);
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Weekdays, bare ordinals, fuzzy months and "next week" need schedule/context
// confirmation. The planning extractor can keep its useful tentative dates;
// this scan cue must not present those guesses as a notice-policy finding.
const EXACT_DATE = new RegExp(`^(?:today|tomorrow|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}|${MONTH}\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?)$`, 'iu');

export function getIncomingAbsenceNoticeCue({ category, entries = [] } = {}) {
  if (!INCOMING_ABSENCE_CATEGORIES.has(category) || !entries.length
    || entries.some((entry) => entry.groupType === 'tutor')) return null;

  const unknown = { label: 'Check notice', window: 'unknown', description: 'Confirm the lesson date and original message date before applying the notice policy.' };
  // Never substitute capture time or the date the inbox is opened. A burst can
  // cross midnight; notice starts with its earliest original message.
  if (entries.some((entry) => !entry.messageAt || !Number.isFinite(new Date(entry.messageAt).getTime()))) return unknown;
  const messageAt = entries.reduce((earliest, entry) => (
    new Date(entry.messageAt) < new Date(earliest) ? entry.messageAt : earliest
  ), entries[0].messageAt);
  const text = entries.map((entry) => entry.messageText || '').join('\n');
  const extraction = extractDatesFromMessage(text, { referenceDate: toSchoolDateIso(messageAt) });
  // A clear start/back range can use its start. Lists of missed lessons or
  // unrelated dates still need review rather than choosing one silently.
  const clearRange = extraction.dates.length === 2
    && extraction.dates.includes(extraction.startDate)
    && extraction.dates.includes(extraction.returnDate)
    && extraction.startDate < extraction.returnDate;
  if (!extraction.startDate || (extraction.dates.length !== 1 && !clearRange)
    || !extraction.matches.every((match) => EXACT_DATE.test(match))) return unknown;
  // The existing extractor infers the year for written month dates. Refuse an
  // explicit year it did not consume rather than silently ignoring it.
  const remaining = extraction.matches.reduce((rest, match) => rest.replace(match, ''), text);
  if (/\b\d{4}\b/u.test(remaining)) return unknown;

  const window = classifyNoticeWindow({ lessonDateIso: extraction.startDate, messageDateIso: messageAt });
  if (window === 'unknown') return unknown;
  if (window === 'seven_plus') return null;
  return {
    label: 'Short notice', window,
    description: window === 'same_day'
      ? 'Same-day notice from the original message. Review the reply; a practice video is not offered for same-day cancellation.'
      : 'Less than seven days from the original message to the stated absence date. Review the lesson and reply before deciding what to offer.',
  };
}
