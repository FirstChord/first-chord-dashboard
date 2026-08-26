import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFreeSlotSummary,
  buildScheduleCacheSummary,
  buildScheduleHealthList,
  buildScheduledRefreshTargets,
  buildWaitingCapacityMatches,
  isFreeCalendarEvent,
  normaliseFreeCalendarSlot,
  parseAvailabilityDays,
  parseAvailabilityTimes,
  pickMatchedInstrumentLabel,
  slotTimeBucket,
} from '../../lib/admin/capacity-helpers.mjs';
import { ADMIN_TUTORS } from '../../lib/admin/tutors-data.js';

test('buildScheduledRefreshTargets picks missing, cadence-old, and unresolved operational caches', () => {
  const now = new Date('2026-06-20T12:00:00Z');
  const rows = [
    { mmsId: 'sdt_fresh', status: 'found', checkedAt: '2026-06-18T10:00:00Z' }, // 2 days old → skip
    { mmsId: 'sdt_old', status: 'found', checkedAt: '2026-06-01T10:00:00Z' }, // 19 days old → include
    { mmsId: 'sdt_unresolved', status: 'not_found', checkedAt: '2026-06-19T10:00:00Z' }, // recent but unresolved → include
    { mmsId: 'sdt_other', status: 'found', checkedAt: '2020-01-01' }, // not operational → ignored
  ];
  const operational = ['sdt_fresh', 'sdt_old', 'sdt_unresolved', 'sdt_nocache'];

  const targets = buildScheduledRefreshTargets(rows, operational, { now, olderThanDays: 10 });
  assert.deepEqual([...targets].sort(), ['sdt_nocache', 'sdt_old', 'sdt_unresolved']);
});

test('buildScheduleHealthList flags stale, past-lesson, missing, and low-confidence rows', () => {
  const now = new Date('2026-06-20T12:00:00Z');
  const rows = [
    // healthy: recent check, future lesson, high confidence → excluded
    { mmsId: 'sdt_ok', studentName: 'OK', status: 'found', confidence: 'high', teacherId: 'tch_1', durationMinutes: '30', nextLessonAt: '2026-06-22 18:30:00', checkedAt: '2026-06-19T10:00:00Z' },
    // found but the cached next lesson already happened → "past lesson"
    { mmsId: 'sdt_past', studentName: 'Past', status: 'found', confidence: 'high', teacherId: 'tch_1', durationMinutes: '30', nextLessonAt: '2026-05-18 18:30:00', checkedAt: '2026-06-19T10:00:00Z' },
    // checked over 21 days ago → "stale"
    { mmsId: 'sdt_stale', studentName: 'Stale', status: 'found', confidence: 'high', teacherId: 'tch_1', durationMinutes: '30', nextLessonAt: '2026-07-01 18:30:00', checkedAt: '2026-05-01T10:00:00Z' },
    // no schedule found at all
    { mmsId: 'sdt_none', studentName: 'None', status: 'not_found', confidence: 'low', nextLessonAt: '', checkedAt: '2026-06-19T10:00:00Z' },
    { mmsId: '', studentName: 'No id', status: 'found' }, // skipped (no mmsId)
  ];

  const list = buildScheduleHealthList(rows, { now });
  const byId = Object.fromEntries(list.map((entry) => [entry.mmsId, entry]));

  assert.equal(list.length, 3);
  assert.equal(byId.sdt_ok, undefined); // healthy excluded
  assert.ok(byId.sdt_past.reasons.includes('past lesson'));
  assert.ok(byId.sdt_stale.reasons.includes('stale'));
  assert.ok(byId.sdt_none.reasons.includes('no schedule'));
  // "no schedule" outranks "past lesson" outranks "stale" in the sort
  assert.equal(list[0].mmsId, 'sdt_none');
});

test('isFreeCalendarEvent only matches the MMS Free category', () => {
  assert.equal(isFreeCalendarEvent({ EventCategory: { Name: 'Free' } }), true);
  assert.equal(isFreeCalendarEvent({ EventCategoryName: 'free' }), true);
  assert.equal(isFreeCalendarEvent({ EventCategory: { Name: 'Free trial' } }), false);
  assert.equal(isFreeCalendarEvent({ EventCategory: { Name: 'Lesson' } }), false);
});

test('normaliseFreeCalendarSlot extracts tutor, time, and duration', () => {
  const slot = normaliseFreeCalendarSlot({
    ID: 'evt_1',
    StartDate: '2026-05-18T16:30:00',
    Duration: 45,
    TeacherID: 'tch_1',
    Teacher: { DisplayName: 'Scott Brice' },
    EventCategory: { Name: 'Free' },
    Students: [],
  });

  assert.equal(slot.eventId, 'evt_1');
  assert.equal(slot.teacherName, 'Scott Brice');
  assert.equal(slot.teacherId, 'tch_1');
  assert.equal(slot.date, '2026-05-18');
  assert.equal(slot.durationMinutes, '45');
  assert.equal(slot.eventCategory, 'Free');
  assert.equal(slot.studentCount, 0);
});

test('normaliseFreeCalendarSlot preserves MMS calendar wall-clock time', () => {
  const slot = normaliseFreeCalendarSlot({
    ID: 'evt_david',
    StartDate: '2026-05-19T18:30:00Z',
    Duration: 30,
    TeacherID: 'tch_david',
    Teacher: { DisplayName: 'David Husz' },
    EventCategory: { Name: 'Free' },
    Students: [],
  });

  assert.equal(slot.weekday, 'Tuesday');
  assert.equal(slot.startTime, '18:30');
});

test('buildFreeSlotSummary counts usual weekly slots by tutor', () => {
  const summary = buildFreeSlotSummary([
    { teacherName: 'Scott Brice', weekday: 'Monday', startTime: '16:00', durationMinutes: '30' },
    { teacherName: 'Scott Brice', weekday: 'Monday', startTime: '16:00', durationMinutes: '30' },
    { teacherName: 'Scott Brice', weekday: 'Monday', startTime: '16:30', durationMinutes: '30' },
    { teacherName: 'Chloe Mak', weekday: 'Tuesday', startTime: '17:00', durationMinutes: '30' },
  ]);

  assert.equal(summary.totalEvents, 4);
  assert.equal(summary.totalWeeklySlots, 3);
  assert.equal(summary.tutorCount, 2);
  assert.deepEqual(summary.byTeacher, [
    { teacherName: 'Scott Brice', weeklySlotCount: 2 },
    { teacherName: 'Chloe Mak', weeklySlotCount: 1 },
  ]);
  assert.equal(summary.weeklySlots.find((slot) => slot.teacherName === 'Scott Brice' && slot.startTime === '16:00').occurrenceCount, 2);
});

test('buildFreeSlotSummary keeps the nearest concrete occurrence for weekly slots', () => {
  const summary = buildFreeSlotSummary([
    normaliseFreeCalendarSlot({
      ID: 'evt_later',
      StartDate: '2026-05-25T16:00:00',
      Duration: 30,
      TeacherID: 'tch_1',
      Teacher: { DisplayName: 'Scott Brice' },
      EventCategory: { Name: 'Free' },
    }),
    normaliseFreeCalendarSlot({
      ID: 'evt_earlier',
      StartDate: '2026-05-18T16:00:00',
      Duration: 30,
      TeacherID: 'tch_1',
      Teacher: { DisplayName: 'Scott Brice' },
      EventCategory: { Name: 'Free' },
    }),
  ]);

  assert.equal(summary.weeklySlots.length, 1);
  assert.equal(summary.weeklySlots[0].occurrenceCount, 2);
  assert.equal(summary.weeklySlots[0].nextDate, '2026-05-18');
  assert.equal(summary.weeklySlots[0].nextStartAt, '2026-05-18T16:00:00');
  assert.equal(summary.weeklySlots[0].eventId, 'evt_earlier');
});

test('buildScheduleCacheSummary highlights stale, missing, and shared slots', () => {
  const now = new Date().toISOString();
  const summary = buildScheduleCacheSummary([
    {
      status: 'found',
      teacherId: 'tch_1',
      nextLessonAt: '2026-05-18T16:30:00',
      durationMinutes: '45',
      confidence: 'high',
      checkedAt: now,
    },
    {
      status: 'found',
      teacherId: 'tch_1',
      nextLessonAt: '2026-05-18T16:30:00',
      durationMinutes: '45',
      confidence: 'high',
      checkedAt: now,
    },
    {
      status: 'missing',
      confidence: 'low',
      checkedAt: '',
    },
    {
      status: 'found',
      teacherId: '',
      nextLessonAt: '2026-05-19T17:00:00',
      durationMinutes: '',
      confidence: 'low',
      checkedAt: now,
    },
  ]);

  assert.equal(summary.totalCached, 4);
  assert.equal(summary.found, 3);
  assert.equal(summary.missing, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.lowConfidence, 2);
  assert.equal(summary.missingTeacher, 1);
  assert.equal(summary.missingDuration, 1);
  assert.equal(summary.sharedSlotGroups, 1);
  assert.equal(summary.sharedStudents, 2);
});

test('buildWaitingCapacityMatches suggests only instrument-compatible free slots', () => {
  const [guitarSlot, pianoSlot, secondPianoSlot] = [
    normaliseFreeCalendarSlot({
      ID: 'evt_guitar',
      StartDate: '2026-05-18T16:30:00',
      Duration: 30,
      TeacherID: 'tch_guitar',
      Teacher: { DisplayName: 'Scott Brice' },
      EventCategory: { Name: 'Free' },
    }),
    normaliseFreeCalendarSlot({
      ID: 'evt_piano',
      StartDate: '2026-05-19T17:00:00',
      Duration: 30,
      TeacherID: 'tch_piano',
      Teacher: { DisplayName: 'Chloe Mak' },
      EventCategory: { Name: 'Free' },
    }),
    normaliseFreeCalendarSlot({
      ID: 'evt_piano_2',
      StartDate: '2026-05-19T17:30:00',
      Duration: 30,
      TeacherID: 'tch_piano',
      Teacher: { DisplayName: 'Chloe Mak' },
      EventCategory: { Name: 'Free' },
    }),
  ];

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_1', instruments: ['Piano'] }],
    freeSlots: [guitarSlot, pianoSlot, secondPianoSlot],
    tutors: [
      { fullName: 'Scott Brice', teacherId: 'tch_guitar', instruments: ['guitar'] },
      { fullName: 'Chloe Mak', teacherId: 'tch_piano', instruments: ['singing', 'piano'] },
    ],
  });

  assert.equal(student.capacityMatchStatus, 'matched');
  assert.equal(student.capacityMatches.length, 2);
  assert.equal(student.capacityMatches[0].teacherName, 'Chloe Mak');
  assert.deepEqual(student.capacityMatches[0].matchedInstruments, ['piano']);
  assert.deepEqual(student.capacityMatchDays, [
    {
      weekday: 'Tuesday',
      dayFits: null,
      tutors: [
        {
          teacherId: 'tch_piano',
          teacherName: 'Chloe Mak',
          matchedInstruments: ['piano'],
          coverageCount: 1,
          fitsAvailability: null,
          slots: [
            {
              eventId: 'evt_piano',
              startTime: '17:00',
              durationMinutes: '30',
              nextDate: '2026-05-19',
              nextStartAt: '2026-05-19T17:00:00',
              occurrenceCount: 1,
            },
            {
              eventId: 'evt_piano_2',
              startTime: '17:30',
              durationMinutes: '30',
              nextDate: '2026-05-19',
              nextStartAt: '2026-05-19T17:30:00',
              occurrenceCount: 1,
            },
          ],
        },
      ],
    },
  ]);
});

test('electric-guitar students match tutors in the general guitar teaching lane', () => {
  const guitarSlot = normaliseFreeCalendarSlot({
    ID: 'evt_electric_guitar',
    StartDate: '2026-05-18T16:30:00',
    Duration: 30,
    TeacherID: 'tch_guitar',
    Teacher: { DisplayName: 'Scott Brice' },
    EventCategory: { Name: 'Free' },
  });

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_electric', instruments: ['Electric Guitar'] }],
    freeSlots: [guitarSlot],
    tutors: [
      { fullName: 'Scott Brice', teacherId: 'tch_guitar', instruments: ['guitar'] },
    ],
  });

  assert.equal(student.capacityMatchStatus, 'matched');
  assert.equal(student.capacityMatches.length, 1);
  assert.deepEqual(student.capacityMatches[0].matchedInstruments, ['guitar']);
});

test('ukulele students match Robbie when he has a free slot', () => {
  const robbie = ADMIN_TUTORS.Robbie;
  const slot = normaliseFreeCalendarSlot({
    ID: 'evt_robbie_ukulele',
    StartDate: '2026-05-18T16:30:00',
    Duration: 30,
    TeacherID: robbie.teacherId,
    Teacher: { DisplayName: robbie.fullName },
    EventCategory: { Name: 'Free' },
  });

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_ukulele', instruments: ['Ukulele'] }],
    freeSlots: [slot],
    tutors: [{
      shortName: 'Robbie',
      ...robbie,
    }],
  });

  assert.ok(robbie.instruments.includes('guitar'));
  assert.ok(robbie.instruments.includes('ukulele'));
  assert.equal(student.capacityMatchStatus, 'matched');
  assert.equal(student.capacityMatches.length, 1);
  assert.equal(student.capacityMatches[0].teacherName, 'Robbie Tranter');
  assert.deepEqual(student.capacityMatches[0].matchedInstruments, ['ukulele']);
});

test('buildWaitingCapacityMatches includes Fennella for singing free slots', () => {
  const [fennellaSlot] = [
    normaliseFreeCalendarSlot({
      ID: 'evt_fennella_singing',
      StartDate: '2026-05-18T16:30:00',
      Duration: 30,
      TeacherID: 'tch_C2bJ9',
      Teacher: { DisplayName: 'Fennella McCallum' },
      EventCategory: { Name: 'Free' },
    }),
  ];

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_voice', instruments: ['Singing'] }],
    freeSlots: [fennellaSlot],
    tutors: [
      { fullName: 'Fennella McCallum', teacherId: 'tch_C2bJ9', instruments: ['singing', 'piano'] },
    ],
  });

  assert.equal(student.capacityMatchStatus, 'matched');
  assert.equal(student.capacityMatches.length, 1);
  assert.equal(student.capacityMatches[0].teacherName, 'Fennella McCallum');
  assert.deepEqual(student.capacityMatches[0].matchedInstruments, ['singing']);
});

test('buildWaitingCapacityMatches can match tutor short names when MMS teacher id is missing', () => {
  const [fennellaSlot] = [
    normaliseFreeCalendarSlot({
      ID: 'evt_fennella_short_name',
      StartDate: '2026-05-18T16:30:00',
      Duration: 30,
      Teacher: { DisplayName: 'Fennella' },
      EventCategory: { Name: 'Free' },
    }),
  ];

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_voice', instruments: ['Singing'] }],
    freeSlots: [fennellaSlot],
    tutors: [
      { shortName: 'Fennella', fullName: 'Fennella McCallum', teacherId: 'tch_C2bJ9', instruments: ['singing', 'piano'] },
    ],
  });

  assert.equal(student.capacityMatchStatus, 'matched');
  assert.equal(student.capacityMatches.length, 1);
  assert.equal(student.capacityMatches[0].teacherName, 'Fennella');
  assert.deepEqual(student.capacityMatches[0].matchedInstruments, ['singing']);
});

test('buildWaitingCapacityMatches refuses to guess when instrument is unknown', () => {
  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_1', instruments: [] }],
    freeSlots: [],
    tutors: [],
  });

  assert.equal(student.capacityMatchStatus, 'instrument_unknown');
  assert.deepEqual(student.capacityMatches, []);
  assert.deepEqual(student.capacityMatchDays, []);
});

test('buildWaitingCapacityMatches returns up to five compact matching days by default', () => {
  const freeSlots = [
    ['evt_1', '2026-05-18T16:00:00'],
    ['evt_2', '2026-05-19T16:00:00'],
    ['evt_3', '2026-05-20T16:00:00'],
    ['evt_4', '2026-05-21T16:00:00'],
    ['evt_5', '2026-05-22T16:00:00'],
    ['evt_6', '2026-05-23T16:00:00'],
  ].map(([id, start]) => normaliseFreeCalendarSlot({
    ID: id,
    StartDate: start,
    Duration: 30,
    TeacherID: 'tch_guitar',
    Teacher: { DisplayName: 'Scott Brice' },
    EventCategory: { Name: 'Free' },
  }));

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_1', instruments: ['Guitar'] }],
    freeSlots,
    tutors: [
      { fullName: 'Scott Brice', teacherId: 'tch_guitar', instruments: ['guitar'] },
    ],
  });

  assert.equal(student.capacityMatchDays.length, 5);
  assert.deepEqual(student.capacityMatchDays.map((day) => day.weekday), [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
  ]);
});

test('buildWaitingCapacityMatches ranks broader coverage first and reports covered/uncovered', () => {
  const guitarPianoSlot = normaliseFreeCalendarSlot({
    ID: 'evt_gp', StartDate: '2026-05-18T16:30:00', Duration: 30,
    TeacherID: 'tch_gp', Teacher: { DisplayName: 'Alex Multi' }, EventCategory: { Name: 'Free' },
  });
  const guitarOnlySlot = normaliseFreeCalendarSlot({
    ID: 'evt_g', StartDate: '2026-05-18T17:00:00', Duration: 30,
    TeacherID: 'tch_g', Teacher: { DisplayName: 'Sam Guitar' }, EventCategory: { Name: 'Free' },
  });

  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_gp', instruments: ['Guitar', 'Piano'] }],
    freeSlots: [guitarPianoSlot, guitarOnlySlot],
    tutors: [
      { fullName: 'Alex Multi', teacherId: 'tch_gp', instruments: ['guitar', 'piano'] },
      { fullName: 'Sam Guitar', teacherId: 'tch_g', instruments: ['guitar'] },
    ],
  });

  assert.equal(student.capacityMatchStatus, 'matched');
  assert.deepEqual(student.coveredInstruments, ['Guitar', 'Piano']);
  assert.deepEqual(student.uncoveredInstruments, []);
  // Monday has both tutors; the one covering more instruments (Alex, 2) ranks first.
  const monday = student.capacityMatchDays.find((day) => day.weekday === 'Monday');
  assert.equal(monday.tutors[0].teacherName, 'Alex Multi');
  assert.equal(monday.tutors[0].coverageCount, 2);
  assert.equal(monday.tutors[1].coverageCount, 1);
});

test('buildWaitingCapacityMatches matches instrument synonyms on both sides (voice/vocals, keyboard)', () => {
  const slot = normaliseFreeCalendarSlot({
    ID: 'evt_v', StartDate: '2026-05-18T16:30:00', Duration: 30,
    TeacherID: 'tch_v', Teacher: { DisplayName: 'Val Voice' }, EventCategory: { Name: 'Free' },
  });
  // Student wants "Voice" (→ Singing); tutor's instrument is recorded as "vocals"
  // (→ Singing) and "keyboard" (→ Piano). Previously the tutor side was only
  // lowercased, so "vocals" would not have matched "singing".
  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_k', instruments: ['Voice'] }],
    freeSlots: [slot],
    tutors: [{ fullName: 'Val Voice', teacherId: 'tch_v', instruments: ['vocals', 'keyboard'] }],
  });
  assert.equal(student.capacityMatchStatus, 'matched');
  assert.deepEqual(student.coveredInstruments, ['Singing']);
});

test('buildWaitingCapacityMatches distinguishes not-taught from no-free-slot in no_match reason', () => {
  // Drums: nobody teaches it.
  const [drummer] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_d', instruments: ['Drums'] }],
    freeSlots: [],
    tutors: [{ fullName: 'Sam Guitar', teacherId: 'tch_g', instruments: ['guitar'] }],
  });
  assert.equal(drummer.capacityMatchStatus, 'no_match');
  assert.match(drummer.capacityMatchReason, /No tutor currently teaches Drums/);

  // Guitar: taught, but no free slots.
  const [guitarist] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_g', instruments: ['Guitar'] }],
    freeSlots: [],
    tutors: [{ fullName: 'Sam Guitar', teacherId: 'tch_g', instruments: ['guitar'] }],
  });
  assert.equal(guitarist.capacityMatchStatus, 'no_match');
  assert.match(guitarist.capacityMatchReason, /no tutor has a free slot/);
});

test('parseAvailabilityDays / parseAvailabilityTimes read sign-up note answers', () => {
  assert.deepEqual(parseAvailabilityDays('Tuesday, Thursday, Saturday'), ['Tuesday', 'Thursday', 'Saturday']);
  assert.deepEqual(parseAvailabilityDays('weekdays only'), []); // coarse word, no specific day
  assert.deepEqual(parseAvailabilityTimes('Evenings (after 5pm)'), ['evening']);
  assert.deepEqual(parseAvailabilityTimes('Earlier (before 5pm), Evenings (after 5pm)'), ['evening', 'earlier']);
});

test('slotTimeBucket splits on the 5pm cutoff', () => {
  assert.equal(slotTimeBucket('16:30'), 'earlier');
  assert.equal(slotTimeBucket('17:00'), 'evening');
  assert.equal(slotTimeBucket('18:30'), 'evening');
});

test('buildWaitingCapacityMatches ranks availability-fitting slots first without hiding others', () => {
  const slots = [
    // Monday earlier (does NOT fit: wants Tue/evening)
    normaliseFreeCalendarSlot({ ID: 'm', StartDate: '2026-05-18T16:00:00', Duration: 30, TeacherID: 'tch_g', Teacher: { DisplayName: 'Sam Guitar' }, EventCategory: { Name: 'Free' } }),
    // Tuesday evening (fits: Tue + evening)
    normaliseFreeCalendarSlot({ ID: 't', StartDate: '2026-05-19T18:00:00', Duration: 30, TeacherID: 'tch_g', Teacher: { DisplayName: 'Sam Guitar' }, EventCategory: { Name: 'Free' } }),
  ];
  const [student] = buildWaitingCapacityMatches({
    waitingStudents: [{ mmsId: 'sdt_a', instruments: ['Guitar'], availabilityDays: ['Tuesday'], availabilityTimes: ['evening'] }],
    freeSlots: slots,
    tutors: [{ fullName: 'Sam Guitar', teacherId: 'tch_g', instruments: ['guitar'] }],
  });

  // Both days still present (ranked, not hidden)...
  assert.deepEqual(student.capacityMatchDays.map((d) => d.weekday), ['Tuesday', 'Monday']);
  // ...with the fitting day first and flagged.
  assert.equal(student.capacityMatchDays[0].dayFits, true);
  assert.equal(student.capacityMatchDays[0].tutors[0].fitsAvailability, true);
  assert.equal(student.capacityMatchDays[1].dayFits, false);
  assert.equal(student.capacityMatchDays[1].tutors[0].fitsAvailability, false);
  assert.deepEqual(student.availabilityDays, ['Tuesday']);
});

test('pickMatchedInstrumentLabel names the instrument a suggested tutor was matched on', () => {
  const student = { instruments: ['Guitar', 'Ukulele'] };

  // A guitar-only tutor was suggested, so onboarding must open on Guitar even
  // though Ukulele is the label the whole note collapses to.
  assert.equal(pickMatchedInstrumentLabel(student, ['guitar']), 'Guitar');
  assert.equal(pickMatchedInstrumentLabel(student, ['ukulele']), 'Ukulele');
  // Electric guitar shares the guitar teaching lane.
  assert.equal(pickMatchedInstrumentLabel({ instruments: ['Electric Guitar'] }, ['guitar']), 'Electric Guitar');
  // No match reported: fall back to the first instrument asked for.
  assert.equal(pickMatchedInstrumentLabel(student, []), 'Guitar');
  assert.equal(pickMatchedInstrumentLabel({}, ['guitar']), '');
});
