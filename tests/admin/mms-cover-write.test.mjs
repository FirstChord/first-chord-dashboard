import assert from 'node:assert/strict';
import test from 'node:test';
import { getMmsCalendarEvent, setMmsCalendarEventTutor } from '../../lib/admin/mms.js';

test('MMS cover PUT targets one event and supplies required flat fields', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MMS_BEARER_TOKEN;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalToken;
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ID: 'evt_One', TeacherID: init.method === 'PUT' ? 'tch_Arion' : 'tch_Finn' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const event = {
    ID: 'evt_One', TeacherID: 'tch_Finn', OriginalTeacherID: 'tch_Finn',
    EventCategory: { ID: 'ect_Lesson' }, EventLocation: { ID: 'loc_Room' },
    Attendances: [{ StudentID: 'sdt_One' }, { StudentID: 'sdt_Two' }],
  };
  await setMmsCalendarEventTutor({ event, teacherId: 'tch_Arion' });
  const readBack = await getMmsCalendarEvent('evt_One');
  assert.equal(readBack.TeacherID, 'tch_Finn');
  assert.equal(calls[0].url, 'https://api.mymusicstaff.com/v1/calendar/events/evt_One');
  assert.equal(calls[0].init.method, 'PUT');
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.TeacherID, 'tch_Arion');
  assert.equal(payload.OriginalTeacherID, 'tch_Finn');
  assert.equal(payload.EventCategoryID, 'ect_Lesson');
  assert.equal(payload.EventLocationID, 'loc_Room');
  assert.deepEqual(payload.StudentIDs, ['sdt_One', 'sdt_Two']);
  assert.equal(calls[1].init.cache, 'no-store');
});
