import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchAttendanceForPayroll,
  clearPayrollAttendanceCacheForTests,
  updatePayrollAttendanceStatus,
  peekPayrollAttendanceAge,
  LESSON_MIRROR_MMS_PAGE_SIZE,
  PAYROLL_ATTENDANCE_PAGE_SIZE,
} from '../../lib/admin/mms.js';

// Two contracts live here:
//
// 1. MMS compares EndDate against EventStartDate at midnight, so it excludes the
//    end day. Payroll windows are inclusive of periodEnd (a Monday run covers
//    through the Tuesday), so searchAttendanceForPayroll must widen the bound by
//    one day. Regression: a Tuesday EndDate silently dropped every Tuesday lesson.
//
// 2. The attendance cache is TTL + stale-while-revalidate + in-flight coalescing
//    (mirroring lib/admin/sheets/core.mjs), so a "Mark reviewed" save never blocks
//    on a ~950-row MMS fetch.
//
// 3. The whole-school lesson mirror uses verified pagination too. Its default
//    page should keep current 28-day calendar/attendance sweeps to one request
//    per endpoint; paging is the correctness safety net, not the normal cost.

const TTL_MS = 10 * 60 * 1000;
const HARD_MAX_AGE_MS = TTL_MS + 20 * 60 * 1000;

// Each call resolves on a deferred promise so tests can control fetch timing.
async function withMockedFetch(fn) {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  const originalWarn = console.warn;

  const calls = [];
  let clock = 1_000_000;
  let nextRows = [{ ID: 'atn_1' }];
  let failNext = false;

  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (failNext) throw new Error('MMS is down');
    const rows = nextRows;
    return { ok: true, status: 200, text: async () => JSON.stringify({ ItemSubset: rows }) };
  };
  Date.now = () => clock;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  console.warn = () => {};
  clearPayrollAttendanceCacheForTests();

  const ctl = {
    calls,
    advance: (ms) => { clock += ms; },
    setRows: (rows) => { nextRows = rows; },
    setFailNext: (v) => { failNext = v; },
    // Let queued microtasks (a background refresh) settle.
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };

  try {
    await fn(ctl);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    console.warn = originalWarn;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
  }
}

const BASE = { startDate: '2026-06-03', endDate: '2026-07-07', teacherIds: ['tch_a'] };

test('sends an end-exclusive EndDate one day past the inclusive end', async () => {
  await withMockedFetch(async ({ calls }) => {
    await searchAttendanceForPayroll(BASE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].StartDate, '2026-06-03');
    assert.equal(calls[0].EndDate, '2026-07-08', 'EndDate must be periodEnd + 1 so periodEnd lessons are included');
    assert.deepEqual(calls[0].TeacherIDs, ['tch_a']);
  });
});

test('rolls the end date across a month boundary', async () => {
  await withMockedFetch(async ({ calls }) => {
    await searchAttendanceForPayroll({ ...BASE, endDate: '2026-06-30' });
    assert.equal(calls[0].EndDate, '2026-07-01');
  });
});

test('requires both dates', async () => {
  await assert.rejects(
    () => searchAttendanceForPayroll({ startDate: '2026-06-01' }),
    /startDate and endDate are required/,
  );
});

test('serves a fresh cache hit without refetching', async () => {
  await withMockedFetch(async ({ calls, advance }) => {
    await searchAttendanceForPayroll(BASE);
    advance(TTL_MS - 1);
    const rows = await searchAttendanceForPayroll(BASE);
    assert.equal(calls.length, 1, 'within TTL must not refetch');
    assert.deepEqual(rows, [{ ID: 'atn_1' }]);
  });
});

test('keys the cache on the query, so a different window refetches', async () => {
  await withMockedFetch(async ({ calls }) => {
    await searchAttendanceForPayroll(BASE);
    await searchAttendanceForPayroll({ ...BASE, teacherIds: ['tch_b'] });
    assert.equal(calls.length, 2);
  });
});

test('stale cache is served immediately and refreshed in the background', async () => {
  await withMockedFetch(async ({ calls, advance, setRows, settle }) => {
    await searchAttendanceForPayroll(BASE);
    advance(TTL_MS + 1);
    setRows([{ ID: 'atn_2' }]);

    const rows = await searchAttendanceForPayroll(BASE);
    assert.deepEqual(rows, [{ ID: 'atn_1' }], 'stale rows are returned to the caller, not the fresh fetch');
    assert.equal(calls.length, 2, 'a background refresh was kicked off');

    await settle();
    const after = await searchAttendanceForPayroll(BASE);
    assert.deepEqual(after, [{ ID: 'atn_2' }], 'background refresh replaced the cached rows');
    assert.equal(calls.length, 2, 'and did not fetch again');
  });
});

test('a failed background refresh does not reject into the caller', async () => {
  await withMockedFetch(async ({ advance, setFailNext, settle }) => {
    await searchAttendanceForPayroll(BASE);
    advance(TTL_MS + 1);
    setFailNext(true);

    const rows = await searchAttendanceForPayroll(BASE);
    assert.deepEqual(rows, [{ ID: 'atn_1' }], 'stale rows still stand when the refresh fails');
    await settle();
  });
});

test('past the hard max age the caller waits for fresh rows', async () => {
  await withMockedFetch(async ({ calls, advance, setRows }) => {
    await searchAttendanceForPayroll(BASE);
    advance(HARD_MAX_AGE_MS + 1);
    setRows([{ ID: 'atn_3' }]);

    const rows = await searchAttendanceForPayroll(BASE);
    assert.deepEqual(rows, [{ ID: 'atn_3' }], 'too-old rows must not be served');
    assert.equal(calls.length, 2);
  });
});

test('forceRefresh bypasses a fresh cache and awaits the fetch', async () => {
  await withMockedFetch(async ({ calls, setRows }) => {
    await searchAttendanceForPayroll(BASE);
    setRows([{ ID: 'atn_4' }]);

    const rows = await searchAttendanceForPayroll({ ...BASE, forceRefresh: true });
    assert.deepEqual(rows, [{ ID: 'atn_4' }]);
    assert.equal(calls.length, 2);
  });
});

test('concurrent callers coalesce onto a single MMS fetch', async () => {
  await withMockedFetch(async ({ calls }) => {
    const [a, b, c] = await Promise.all([
      searchAttendanceForPayroll(BASE),
      searchAttendanceForPayroll(BASE),
      searchAttendanceForPayroll(BASE),
    ]);
    assert.equal(calls.length, 1, 'three concurrent renders must share one fetch');
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });
});

test('payroll attendance decisions preserve notes and write an allowed status to MMS', async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  const calls = [];
  process.env.MMS_BEARER_TOKEN = 'test-token';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ItemSubset: [{
          ID: 'atn_1',
          EventID: 'evt_1',
          StudentID: 'sdt_1',
          TeacherNote: 'keep teacher',
          ParentNote: 'keep parent',
          StudentNote: 'keep student',
        }] }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  try {
    const result = await updatePayrollAttendanceStatus({
      studentId: 'sdt_1',
      eventId: 'evt_1',
      attendanceId: 'atn_1',
      attendanceStatus: 'AbsentNotice',
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /events\/evt_1\/attendance\/atn_1/u);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      TeacherNote: 'keep teacher',
      ParentNote: 'keep parent',
      StudentNote: 'keep student',
      AttendanceStatus: 'AbsentNotice',
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
  }
});

// The payroll page passes allowExpired because a save re-renders the whole page
// inside its own POST — the spinner on "Review and generate statement" lasts as
// long as that render, and a cold ~950-row MMS fetch there turned a ~1s save
// into a ~7s one. Freshness is deferred, not dropped: the refresh still runs.
test('allowExpired serves past-hard-max rows instead of making the caller wait', async () => {
  await withMockedFetch(async ({ calls, advance, setRows, settle }) => {
    await searchAttendanceForPayroll(BASE);
    advance(HARD_MAX_AGE_MS + 1);
    setRows([{ ID: 'atn_5' }]);

    const rows = await searchAttendanceForPayroll({ ...BASE, allowExpired: true });
    assert.deepEqual(rows, [{ ID: 'atn_1' }], 'the save renders with what we already had');
    assert.equal(calls.length, 2, 'and a refresh was started behind the request');

    await settle();
    const after = await searchAttendanceForPayroll({ ...BASE, allowExpired: true });
    assert.deepEqual(after, [{ ID: 'atn_5' }], 'the next render sees the refreshed rows');
    assert.equal(calls.length, 2);
  });
});

test('allowExpired still fetches when the cache is empty', async () => {
  await withMockedFetch(async ({ calls }) => {
    const rows = await searchAttendanceForPayroll({ ...BASE, allowExpired: true });
    assert.deepEqual(rows, [{ ID: 'atn_1' }]);
    assert.equal(calls.length, 1, 'a cold container has nothing to serve, so it fetches');
  });
});

test('peekPayrollAttendanceAge reports staleness for the query the page rendered', async () => {
  await withMockedFetch(async ({ advance }) => {
    assert.equal(peekPayrollAttendanceAge(BASE), null, 'nothing cached yet');

    await searchAttendanceForPayroll(BASE);
    assert.equal(peekPayrollAttendanceAge(BASE).isFresh, true);

    advance(HARD_MAX_AGE_MS + 1);
    const stale = peekPayrollAttendanceAge(BASE);
    assert.equal(stale.isExpired, true, 'the page can tell the user what it served is old');
    assert.equal(stale.age, HARD_MAX_AGE_MS + 1);

    // Key must match searchAttendanceForPayroll's regardless of teacher order.
    assert.equal(peekPayrollAttendanceAge({ ...BASE, teacherIds: ['tch_a'] }).isExpired, true);
    assert.equal(peekPayrollAttendanceAge({ ...BASE, teacherIds: ['tch_zzz'] }), null);
  });
});

// `fetch` has no default timeout, so before this an MMS request that never
// answered hung the render behind it forever — the spinner that never stops.
// The failure has to be loud and legible: payroll prints loadError verbatim.
test('a hanging MMS request fails with a readable error instead of hanging', async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  const originalTimeout = process.env.MMS_REQUEST_TIMEOUT_MS;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  process.env.MMS_REQUEST_TIMEOUT_MS = '50';
  clearPayrollAttendanceCacheForTests();

  // Never resolves on its own — only the abort signal can end it.
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  // AbortSignal.timeout's timer is unref'd, so without something ref'd holding
  // the loop open Node drains it and cancels the test before the abort fires.
  const keepAlive = setInterval(() => {}, 10);

  try {
    await assert.rejects(
      () => searchAttendanceForPayroll(BASE),
      (error) => {
        assert.match(error.message, /MMS did not respond within \d+s/u);
        assert.doesNotMatch(error.message, /TimeoutError/u, 'the raw abort name must not reach the admin UI');
        return true;
      },
    );
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
    if (originalTimeout === undefined) delete process.env.MMS_REQUEST_TIMEOUT_MS;
    else process.env.MMS_REQUEST_TIMEOUT_MS = originalTimeout;
  }
});

test('an unreachable MMS host is reported as unreachable, not as a crash', async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  clearPayrollAttendanceCacheForTests();

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  try {
    await assert.rejects(
      () => searchAttendanceForPayroll(BASE),
      /Could not reach MMS: fetch failed/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
  }
});

// Recording a lesson is immediately followed by a router.refresh(). Invalidating
// the cache made that refresh pay a full ~950-row MMS fetch to learn one field we
// had just set ourselves. AttendanceStatus is the only field payroll
// classification reads, so folding it in is a complete patch for what the page
// shows — and the entry stays stale, so MMS still gets the last word.
test('recording attendance patches the payroll cache instead of dropping it', async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  clearPayrollAttendanceCacheForTests();

  const row = {
    ID: 'atn_1',
    EventID: 'evt_1',
    StudentID: 'sdt_1',
    AttendanceStatus: 'Unrecorded',
    TeacherNote: 'keep teacher',
    ParentNote: '',
    StudentNote: '',
  };
  let searches = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') searches += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ ItemSubset: [row] }) };
  };

  try {
    const before = await searchAttendanceForPayroll(BASE);
    assert.equal(before[0].AttendanceStatus, 'Unrecorded');
    const searchesAfterSeed = searches;

    await updatePayrollAttendanceStatus({
      studentId: 'sdt_1',
      eventId: 'evt_1',
      attendanceId: 'atn_1',
      attendanceStatus: 'Present',
    });

    // The value the very next render sees, without waiting on MMS.
    const after = await searchAttendanceForPayroll({ ...BASE, allowExpired: true });
    assert.equal(after[0].AttendanceStatus, 'Present', 'the decision is visible immediately');
    assert.ok(
      searches > searchesAfterSeed,
      'the write itself still reads MMS; what must not happen is the *render* blocking on a refetch',
    );

    // Stale, not fresh: the entry is a head start on the truth, not a replacement.
    assert.equal(peekPayrollAttendanceAge(BASE).isFresh, false);
  } finally {
    globalThis.fetch = originalFetch;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
  }
});

test('an attendance row outside every cached window falls back to invalidating', async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.MMS_BEARER_TOKEN;
  process.env.MMS_BEARER_TOKEN = 'test-token';
  clearPayrollAttendanceCacheForTests();

  // The cached payroll window holds one row; the lesson being recorded is a
  // different one (a window the page never fetched). The write succeeds, but
  // there is nothing here to correct — so the cache must be dropped, not left
  // asserting a state we never reconciled.
  let searchRows = [{ ID: 'atn_cached', EventID: 'evt_cached', StudentID: 'sdt_1', AttendanceStatus: 'Present' }];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ItemSubset: searchRows }),
  });

  try {
    await searchAttendanceForPayroll(BASE);
    assert.equal(peekPayrollAttendanceAge(BASE).isFresh, true, 'seeded');

    searchRows = [{ ID: 'atn_far', EventID: 'evt_far', StudentID: 'sdt_1', AttendanceStatus: 'Unrecorded' }];
    const result = await updatePayrollAttendanceStatus({
      studentId: 'sdt_1',
      eventId: 'evt_far',
      attendanceId: 'atn_far',
      attendanceStatus: 'Present',
    });

    assert.equal(result.ok, true, 'the MMS write itself succeeded');
    assert.equal(peekPayrollAttendanceAge(BASE), null, 'an unpatchable write invalidates rather than lying');
  } finally {
    globalThis.fetch = originalFetch;
    clearPayrollAttendanceCacheForTests();
    if (originalBearer === undefined) delete process.env.MMS_BEARER_TOKEN;
    else process.env.MMS_BEARER_TOKEN = originalBearer;
  }
});

// The page size is part of the cache key, so it has to have one home. A caller
// that omits `limit` and one that passes the default explicitly must land on the
// same entry; if they ever diverged, the payroll page and the tutor statement
// would quietly stop sharing a fetch again.
test('omitting the limit and passing the default hit the same cache entry', async () => {
  await withMockedFetch(async ({ calls }) => {
    const query = { startDate: '2026-06-24', endDate: '2026-07-28', teacherIds: ['tch_a'] };
    await searchAttendanceForPayroll(query);
    assert.equal(calls.length, 1);

    // Asking for the default by name must not be a different key.
    await searchAttendanceForPayroll({ ...query, limit: PAYROLL_ATTENDANCE_PAGE_SIZE });
    assert.equal(calls.length, 1, 'the explicit default must not open a second cache entry');

    // A genuinely different page size is a different fetch, as it must be.
    await searchAttendanceForPayroll({ ...query, limit: PAYROLL_ATTENDANCE_PAGE_SIZE + 1 });
    assert.equal(calls.length, 2);
  });
});

// One request should cover a payroll window; paging is the safety net. The page
// size is only safe to raise because completeness is verified against
// TotalItemCount — see lib/admin/mms-pagination.mjs.
test('a window inside the page size costs exactly one MMS request', async () => {
  await withMockedFetch(async ({ calls, setRows }) => {
    setRows(Array.from({ length: 951 }, (_, i) => ({ ID: `atn_${i}` })));
    const rows = await searchAttendanceForPayroll(BASE);
    assert.equal(rows.length, 951);
    assert.equal(calls.length, 1, '951 rows must not need a second round trip');
    assert.ok(
      PAYROLL_ATTENDANCE_PAGE_SIZE > 951,
      'the page size must keep real headroom over the current window, or this stops being true',
    );
  });
});

test('the lesson mirror page size has headroom over the verified whole-school window', () => {
  assert.ok(
    LESSON_MIRROR_MMS_PAGE_SIZE > 772,
    'the 2026-08-10 live calendar sample should fit in one request',
  );
});
