/** @fileoverview Matches waiting students to instrument-compatible MMS free slots and reports schedule-cache health. */
import { normaliseInstrument, normaliseTeachingInstrument } from './fc-helpers.mjs';

const DEFAULT_TIME_ZONE = 'Europe/London';
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Canonical instrument key shared by both sides of matching. Routing tutor and
// waiting-student instruments through normaliseInstrument means synonyms/spellings
// ("voice"→singing, "keys"→piano, "guitar (acoustic)"→guitar) match instead of
// silently missing.
function instrumentKey(value = '') {
  return normaliseTeachingInstrument(value).trim().toLowerCase();
}

// Availability preference parsed from the MMS sign-up note. Days are per-weekday
// (we don't teach Sunday); time is the coarse earlier/evening buckets families
// pick from. Tolerant of wording so minor label changes don't break matching.
const TIME_BUCKET_CUTOFF = '17:00'; // before = earlier, at/after = evening

export function parseAvailabilityDays(text = '') {
  const lower = `${text || ''}`.toLowerCase();
  return WEEKDAY_ORDER.filter((day) => lower.includes(day.toLowerCase()));
}

export function parseAvailabilityTimes(text = '') {
  const lower = `${text || ''}`.toLowerCase();
  const times = [];
  if (/even/.test(lower)) times.push('evening');
  if (/(earl|before\s*5|morning|afternoon|daytime|\bam\b|after\s*school)/.test(lower)) times.push('earlier');
  return times;
}

export function slotTimeBucket(startTime = '') {
  const time = `${startTime || ''}`;
  if (!time) return 'evening';
  return time < TIME_BUCKET_CUTOFF ? 'earlier' : 'evening';
}

// Does a matched slot fit the student's stated availability? Returns true/false
// when there's any preference to judge against, or null when none is stated
// (so we can leave ordering neutral rather than penalising everyone).
function slotFitsAvailability({ weekday, startTime }, availDays, availTimes) {
  const hasDayPref = availDays.length > 0;
  const hasTimePref = availTimes.length > 0;
  if (!hasDayPref && !hasTimePref) return null;
  const dayOk = !hasDayPref || availDays.includes(weekday);
  const timeOk = !hasTimePref || availTimes.includes(slotTimeBucket(startTime));
  return dayOk && timeOk;
}

function parseMmsCalendarWallClock(value) {
  const match = `${value || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const weekdayDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return {
    weekdayDate,
    time: `${hour}:${minute}`,
  };
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatWeekday(value) {
  const wallClock = parseMmsCalendarWallClock(value);
  if (wallClock) {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(wallClock.weekdayDate);
  }

  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: DEFAULT_TIME_ZONE,
  }).format(date);
}

function formatTime(value) {
  const wallClock = parseMmsCalendarWallClock(value);
  if (wallClock) return wallClock.time;

  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DEFAULT_TIME_ZONE,
  }).format(date);
}

function formatInputDate(value) {
  const match = `${value || ''}`.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function getEventCategory(event = {}) {
  return event.EventCategory?.Name || event.EventCategoryName || '';
}

function getTeacherName(event = {}) {
  return event.Teacher?.DisplayName
    || event.Teacher?.Name
    || event.TeacherName
    || event.OriginalTeacher?.DisplayName
    || event.OriginalTeacher?.Name
    || '';
}

export function isFreeCalendarEvent(event = {}) {
  return getEventCategory(event).trim().toLowerCase() === 'free';
}

export function normaliseFreeCalendarSlot(event = {}) {
  return {
    eventId: event.ID || '',
    startAt: event.StartDate || '',
    date: formatInputDate(event.StartDate),
    weekday: formatWeekday(event.StartDate),
    startTime: formatTime(event.StartDate),
    durationMinutes: event.Duration ? String(event.Duration) : '',
    teacherId: event.TeacherID || event.OriginalTeacherID || '',
    teacherName: getTeacherName(event),
    eventCategory: getEventCategory(event),
    studentCount: Array.isArray(event.Students)
      ? event.Students.length
      : Array.isArray(event.StudentIDs)
        ? event.StudentIDs.length
        : 0,
  };
}

export function buildFreeSlotSummary(slots = []) {
  const weeklySlotKeys = new Map();
  const byWeekday = new Map();

  for (const slot of slots) {
    const teacherKey = slot.teacherName || slot.teacherId || 'Unknown tutor';
    const weekdayKey = slot.weekday || 'Unknown day';
    const weeklyKey = [
      slot.teacherId || teacherKey,
      teacherKey,
      weekdayKey,
      slot.startTime || '',
      slot.durationMinutes || '',
    ].join('::');

    if (!weeklySlotKeys.has(weeklyKey)) {
      weeklySlotKeys.set(weeklyKey, {
        eventId: slot.eventId || '',
        teacherId: slot.teacherId || '',
        teacherName: teacherKey,
        weekday: weekdayKey,
        startTime: slot.startTime || '',
        durationMinutes: slot.durationMinutes || '',
        nextDate: slot.date || '',
        nextStartAt: slot.startAt || '',
        occurrenceCount: 0,
      });
    }

    const weeklySlot = weeklySlotKeys.get(weeklyKey);
    weeklySlot.occurrenceCount += 1;
    if (slot.startAt && (!weeklySlot.nextStartAt || slot.startAt < weeklySlot.nextStartAt)) {
      weeklySlot.eventId = slot.eventId || '';
      weeklySlot.nextStartAt = slot.startAt;
      weeklySlot.nextDate = slot.date || weeklySlot.nextDate;
    }
  }

  const weeklySlots = [...weeklySlotKeys.values()];
  const byTeacher = new Map();

  for (const slot of weeklySlots) {
    byTeacher.set(slot.teacherName, (byTeacher.get(slot.teacherName) || 0) + 1);
    byWeekday.set(slot.weekday, (byWeekday.get(slot.weekday) || 0) + 1);
  }

  return {
    totalEvents: slots.length,
    totalWeeklySlots: weeklySlots.length,
    tutorCount: byTeacher.size,
    byTeacher: [...byTeacher.entries()]
      .map(([teacherName, weeklySlotCount]) => ({ teacherName, weeklySlotCount }))
      .sort((a, b) => b.weeklySlotCount - a.weeklySlotCount || a.teacherName.localeCompare(b.teacherName)),
    byWeekday: [...byWeekday.entries()].map(([weekday, weeklySlotCount]) => ({ weekday, weeklySlotCount })),
    weeklySlots: weeklySlots.sort((a, b) => (
      a.teacherName.localeCompare(b.teacherName)
      || a.weekday.localeCompare(b.weekday)
      || a.startTime.localeCompare(b.startTime)
    )),
  };
}

function buildTutorLookup(tutors = []) {
  const byTeacherId = new Map();
  const byName = new Map();

  for (const tutor of tutors) {
    const record = {
      teacherId: tutor.teacherId || '',
      shortName: tutor.shortName || '',
      teacherName: tutor.fullName || tutor.teacherName || '',
      instruments: (tutor.instruments || []).map(instrumentKey).filter(Boolean),
    };
    if (record.teacherId) byTeacherId.set(record.teacherId, record);
    if (record.teacherName) byName.set(record.teacherName.toLowerCase(), record);
    if (record.shortName) byName.set(record.shortName.toLowerCase(), record);
  }

  return { byTeacherId, byName };
}

function findTutorForSlot(slot, tutorLookup) {
  if (slot.teacherId && tutorLookup.byTeacherId.has(slot.teacherId)) {
    return tutorLookup.byTeacherId.get(slot.teacherId);
  }

  const teacherName = `${slot.teacherName || ''}`.toLowerCase();
  return tutorLookup.byName.get(teacherName) || null;
}

function sortByWeekdayThenTime(a, b) {
  const weekdayDiff = WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday);
  if (weekdayDiff) return weekdayDiff;
  return a.startTime.localeCompare(b.startTime)
    || a.teacherName.localeCompare(b.teacherName)
    || a.durationMinutes.localeCompare(b.durationMinutes);
}

// Availability fit is scored so day and time both count, with day weighted higher
// (full fit = 3, day-only = 2, time-only = 1, neither = 0). Days/tutors/slots are
// ranked by score — so when nothing fully fits, a time-matching slot still surfaces
// above a total miss, rather than a preferred-day-wrong-time slot burying it.
const AVAILABILITY_DAY_WEIGHT = 2;
const AVAILABILITY_TIME_WEIGHT = 1;

function groupMatchesByDay(matches = [], maxDays = 3, { availDays = [], availTimes = [] } = {}) {
  const byDay = new Map();
  const hasDayPref = availDays.length > 0;
  const hasTimePref = availTimes.length > 0;
  const timeFits = (startTime) => !hasTimePref || availTimes.includes(slotTimeBucket(startTime));
  const dayScore = (weekday) => (hasDayPref && availDays.includes(weekday) ? AVAILABILITY_DAY_WEIGHT : 0);
  const slotScore = (weekday, startTime) => dayScore(weekday)
    + (hasTimePref && availTimes.includes(slotTimeBucket(startTime)) ? AVAILABILITY_TIME_WEIGHT : 0);

  for (const match of matches.sort(sortByWeekdayThenTime)) {
    if (!byDay.has(match.weekday)) {
      byDay.set(match.weekday, new Map());
    }

    const tutorKey = match.teacherName || match.teacherId || 'Unknown tutor';
    const dayTutors = byDay.get(match.weekday);
    if (!dayTutors.has(tutorKey)) {
      dayTutors.set(tutorKey, {
        teacherId: match.teacherId,
        teacherName: tutorKey,
        matchedInstruments: [],
        slots: [],
      });
    }

    const tutorGroup = dayTutors.get(tutorKey);
    tutorGroup.matchedInstruments = [
      ...new Set([...tutorGroup.matchedInstruments, ...match.matchedInstruments]),
    ];
    tutorGroup.slots.push({
      eventId: match.eventId,
      startTime: match.startTime,
      durationMinutes: match.durationMinutes,
      nextDate: match.nextDate,
      nextStartAt: match.nextStartAt,
      occurrenceCount: match.occurrenceCount,
    });
  }

  const hasPref = hasDayPref || hasTimePref;

  return [...byDay.entries()]
    .map(([weekday, tutorMap]) => {
      // A day fits if it's in the day preference (when one is set).
      const dayFits = hasDayPref ? availDays.includes(weekday) : null;
      const tutors = [...tutorMap.values()]
        .map((tutor) => {
          // A tutor fits availability if the day fits and it has a time-fitting slot.
          const tutorTimeFits = tutor.slots.some((slot) => timeFits(slot.startTime));
          const fitsAvailability = hasPref ? ((dayFits !== false) && tutorTimeFits) : null;
          // Best availability score across this tutor's slots (drives ranking).
          const tutorScore = tutor.slots.reduce((best, slot) => Math.max(best, slotScore(weekday, slot.startTime)), 0);
          return {
            ...tutor,
            coverageCount: tutor.matchedInstruments.length,
            fitsAvailability,
            tutorScore,
            // Higher-scoring (time-fitting) slots first, then by time.
            slots: tutor.slots.sort((a, b) => (slotScore(weekday, b.startTime) - slotScore(weekday, a.startTime))
              || a.startTime.localeCompare(b.startTime)),
          };
        })
        // Best availability score first, then broader instrument coverage, then earliest slot.
        .sort((a, b) => (b.tutorScore - a.tutorScore)
          || (b.coverageCount - a.coverageCount)
          || (a.slots[0]?.startTime || '').localeCompare(b.slots[0]?.startTime || ''));
      const dayBestScore = tutors.reduce((best, tutor) => Math.max(best, tutor.tutorScore), 0);
      return { weekday, dayFits, dayScore: dayBestScore, tutors };
    })
    // Rank days by best availability score (day weighted over time), keeping
    // weekday order within equal scores. Non-matching days stay visible.
    .sort((a, b) => (b.dayScore - a.dayScore)
      || (WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday)))
    .slice(0, maxDays)
    // dayScore was only needed for ordering; drop it from the returned shape.
    .map((day) => ({
      ...Object.fromEntries(Object.entries(day).filter(([key]) => key !== 'dayScore' && key !== 'tutors')),
      tutors: day.tutors.map((tutor) => (
        Object.fromEntries(Object.entries(tutor).filter(([key]) => key !== 'tutorScore'))
      )),
    }));
}

// A waiting student can want several instruments, and a suggested tutor covers
// only some of them. Onboarding has to be told which one the suggestion was for
// — left to re-derive it from the note, it picks whichever label normalisation
// happens to hit first, which is how a guitar suggestion arrived set to Ukulele.
export function pickMatchedInstrumentLabel(student = {}, matchedInstruments = []) {
  const wanted = student.instruments || [];
  const matchedKeys = matchedInstruments.map((entry) => instrumentKey(entry));
  return wanted.find((name) => matchedKeys.includes(instrumentKey(name))) || wanted[0] || '';
}

export function buildWaitingCapacityMatches({
  waitingStudents = [],
  freeSlots = [],
  tutors = [],
  maxDays = 5,
} = {}) {
  const weeklySlots = buildFreeSlotSummary(freeSlots).weeklySlots;
  const tutorLookup = buildTutorLookup(tutors);

  // Which instruments any tutor teaches (regardless of free slots), with a tutor
  // count — lets "no match" explain *why* (nobody teaches it vs taught-but-full).
  const tutorsByInstrument = new Map();
  for (const tutor of tutors) {
    for (const instrument of tutor.instruments || []) {
      const key = instrumentKey(instrument);
      if (key) tutorsByInstrument.set(key, (tutorsByInstrument.get(key) || 0) + 1);
    }
  }

  return waitingStudents.map((student) => {
    const availDays = Array.isArray(student.availabilityDays) ? student.availabilityDays : [];
    const availTimes = Array.isArray(student.availabilityTimes) ? student.availabilityTimes : [];

    const wantedKeys = [];
    const displayByKey = new Map();
    for (const name of student.instruments || []) {
      const key = instrumentKey(name);
      if (key && !displayByKey.has(key)) {
        wantedKeys.push(key);
        displayByKey.set(key, normaliseInstrument(name));
      }
    }
    const display = (key) => displayByKey.get(key) || key;

    if (!wantedKeys.length) {
      return {
        ...student,
        capacityMatchStatus: 'instrument_unknown',
        capacityMatchReason: 'Instrument could not be parsed from the MMS sign-up note.',
        wantedInstruments: [],
        coveredInstruments: [],
        uncoveredInstruments: [],
        capacityMatches: [],
        capacityMatchDays: [],
      };
    }

    const matches = weeklySlots
      .map((slot) => ({
        ...slot,
        tutor: findTutorForSlot(slot, tutorLookup),
      }))
      .filter((slot) => slot.tutor?.instruments.some((instrument) => wantedKeys.includes(instrument)))
      .map((slot) => ({
        eventId: slot.eventId,
        teacherId: slot.teacherId,
        teacherName: slot.teacherName,
        weekday: slot.weekday,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        nextDate: slot.nextDate,
        nextStartAt: slot.nextStartAt,
        occurrenceCount: slot.occurrenceCount,
        matchedInstruments: slot.tutor.instruments
          .filter((instrument) => wantedKeys.includes(instrument)),
      }))
      .map((match) => ({
        ...match,
        fitsAvailability: slotFitsAvailability(match, availDays, availTimes),
      }))
      .sort(sortByWeekdayThenTime);
    const capacityMatchDays = groupMatchesByDay(matches, maxDays, { availDays, availTimes });

    const coveredKeys = new Set();
    for (const match of matches) {
      for (const instrument of match.matchedInstruments) coveredKeys.add(instrument);
    }
    const uncoveredKeys = wantedKeys.filter((key) => !coveredKeys.has(key));
    const wantedInstruments = wantedKeys.map(display);
    const coveredInstruments = wantedKeys.filter((key) => coveredKeys.has(key)).map(display);
    const uncoveredInstruments = uncoveredKeys.map((key) => ({
      instrument: display(key),
      reason: tutorsByInstrument.has(key) ? 'no_free_slots' : 'not_taught',
    }));

    let capacityMatchStatus;
    let capacityMatchReason;
    if (matches.length) {
      capacityMatchStatus = 'matched';
      if (!uncoveredKeys.length) {
        capacityMatchReason = wantedKeys.length > 1
          ? `Free slots found for all requested instruments (${coveredInstruments.join(', ')}).`
          : `Free slots found with tutors who teach ${coveredInstruments.join(', ')}.`;
      } else {
        const noSlots = uncoveredInstruments.filter((u) => u.reason === 'no_free_slots').map((u) => u.instrument);
        const notTaught = uncoveredInstruments.filter((u) => u.reason === 'not_taught').map((u) => u.instrument);
        const parts = [`Free slots for ${coveredInstruments.join(', ')}.`];
        if (noSlots.length) parts.push(`No free slots right now for ${noSlots.join(', ')}.`);
        if (notTaught.length) parts.push(`No tutor here teaches ${notTaught.join(', ')}.`);
        capacityMatchReason = parts.join(' ');
      }
    } else {
      capacityMatchStatus = 'no_match';
      const taughtWanted = wantedKeys.filter((key) => tutorsByInstrument.has(key)).map(display);
      const notTaught = wantedKeys.filter((key) => !tutorsByInstrument.has(key)).map(display);
      if (!taughtWanted.length) {
        capacityMatchReason = `No tutor currently teaches ${notTaught.join(' or ')}.`;
      } else {
        capacityMatchReason = `${taughtWanted.join(', ')} ${taughtWanted.length > 1 ? 'are' : 'is'} taught here, but no tutor has a free slot right now`
          + (notTaught.length ? `; no tutor teaches ${notTaught.join(' or ')}.` : '.');
      }
    }

    return {
      ...student,
      capacityMatchStatus,
      capacityMatchReason,
      wantedInstruments,
      coveredInstruments,
      uncoveredInstruments,
      availabilityDays: availDays,
      availabilityTimes: availTimes,
      capacityMatches: matches,
      capacityMatchDays,
    };
  });
}

export function buildScheduleCacheSummary(scheduleRows = [], { staleAfterDays = 21 } = {}) {
  const now = Date.now();
  const staleAfterMs = staleAfterDays * 24 * 60 * 60 * 1000;
  const sharedSlots = new Map();
  let found = 0;
  let missing = 0;
  let error = 0;
  let stale = 0;
  let missingTeacher = 0;
  let missingDuration = 0;
  let lowConfidence = 0;

  for (const row of scheduleRows) {
    if (row.status === 'found') found += 1;
    else if (row.status === 'missing') missing += 1;
    else if (row.status === 'error') error += 1;

    const checkedAt = parseDate(row.checkedAt);
    if (!checkedAt || now - checkedAt.getTime() > staleAfterMs) {
      stale += 1;
    }

    if (row.status === 'found' && !row.teacherId) missingTeacher += 1;
    if (row.status === 'found' && !row.durationMinutes) missingDuration += 1;
    if (row.confidence === 'low') lowConfidence += 1;

    if (row.status === 'found' && row.teacherId && row.nextLessonAt && row.durationMinutes) {
      const key = [row.teacherId, row.nextLessonAt, row.durationMinutes].join('::');
      const list = sharedSlots.get(key) || [];
      list.push(row);
      sharedSlots.set(key, list);
    }
  }

  const sharedSlotGroups = [...sharedSlots.values()].filter((rows) => rows.length > 1);

  return {
    totalCached: scheduleRows.length,
    found,
    missing,
    error,
    stale,
    lowConfidence,
    missingTeacher,
    missingDuration,
    sharedSlotGroups: sharedSlotGroups.length,
    sharedStudents: sharedSlotGroups.reduce((total, rows) => total + rows.length, 0),
  };
}

// Per-student schedule rows that need attention, each tagged with why. Drives the
// actionable list on /admin/capacity. Includes the "past lesson" case (a found
// row whose next lesson already happened — i.e. the cache is behind MMS) that the
// aggregate summary misses, which is the class that caused the Lloyd stale-cache
// confusion.
export function buildScheduleHealthList(scheduleRows = [], { now = new Date(), staleAfterDays = 21 } = {}) {
  const ref = now instanceof Date ? now : new Date(now);
  const nowMs = ref.getTime();
  const staleAfterMs = staleAfterDays * 24 * 60 * 60 * 1000;
  const todayInput = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;

  const flagged = [];
  for (const row of scheduleRows) {
    if (!row.mmsId) continue;
    const reasons = [];

    if (row.status === 'error') {
      reasons.push('error');
    } else if (row.status && row.status !== 'found') {
      reasons.push('no schedule'); // not_found / missing / missing_identity
    }

    const nextDay = formatInputDate(row.nextLessonAt);
    if (row.status === 'found' && nextDay && nextDay < todayInput) {
      reasons.push('past lesson');
    }

    const checked = parseDate(row.checkedAt);
    if (!checked || nowMs - checked.getTime() > staleAfterMs) {
      reasons.push('stale');
    }

    if (row.confidence === 'low') reasons.push('low confidence');
    if (row.status === 'found' && !row.teacherId) reasons.push('missing teacher');
    if (row.status === 'found' && !row.durationMinutes) reasons.push('missing duration');

    if (!reasons.length) continue;

    flagged.push({
      mmsId: row.mmsId,
      studentName: row.studentName || row.mmsId,
      teacherName: row.teacherName || '',
      status: row.status || '',
      confidence: row.confidence || '',
      nextLessonAt: row.nextLessonAt || '',
      checkedAt: row.checkedAt || '',
      reasons,
    });
  }

  const rank = (entry) => {
    if (entry.reasons.includes('error') || entry.reasons.includes('no schedule')) return 0;
    if (entry.reasons.includes('past lesson')) return 1;
    if (entry.reasons.includes('stale')) return 2;
    return 3;
  };
  flagged.sort((a, b) => rank(a) - rank(b) || `${a.checkedAt}`.localeCompare(`${b.checkedAt}`));
  return flagged;
}

// MMS IDs to refresh on the scheduled (cadence-based) job: operational students
// whose cache is missing, older than `olderThanDays`, or unresolved. This is
// cadence-based on purpose (e.g. 10 days for a bi-weekly run) so the cohort stays
// fresh, rather than the 21-day display-stale threshold which a 2-week job would
// never trip. Used by the scheduled refresh endpoint.
export function buildScheduledRefreshTargets(scheduleRows = [], operationalMmsIds = [], { now = new Date(), olderThanDays = 10 } = {}) {
  const ref = now instanceof Date ? now : new Date(now);
  const cutoffMs = ref.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  const rowByMmsId = new Map();
  for (const row of scheduleRows) {
    if (row.mmsId) rowByMmsId.set(row.mmsId, row);
  }

  const targets = [];
  for (const mmsId of operationalMmsIds) {
    if (!mmsId) continue;
    const row = rowByMmsId.get(mmsId);
    if (!row) {
      targets.push(mmsId); // no cache yet
      continue;
    }
    const checked = parseDate(row.checkedAt);
    if (!checked || checked.getTime() < cutoffMs) {
      targets.push(mmsId); // older than the cadence (or never checked)
      continue;
    }
    if (row.status && row.status !== 'found') {
      targets.push(mmsId); // unresolved — retry periodically
    }
  }
  return targets;
}
