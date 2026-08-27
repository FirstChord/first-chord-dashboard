// Invariant tests for the money path. These are properties, not examples —
// aimed at the "plausible-but-short" bug class: totals that look reasonable
// and are wrong (the EndDate-exclusivity bug paid short for 12 days in 2026;
// the single-shot 1000-row attendance cap would have done the same).
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAllPages } from '../../lib/admin/mms-pagination.mjs';
import { buildPayrollPeriod, buildPayrollPreview } from '../../lib/admin/payroll-helpers.mjs';
import { buildWiseBatch, selectPayableReviewedRuns } from '../../lib/admin/wise-helpers.mjs';
import { getPayrollWorkflowState, isPayrollRunReadyForPayment } from '../../lib/admin/payroll-workflow-helpers.mjs';

// Small deterministic PRNG (mulberry32) so property failures reproduce exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- pagination ----------

function pagedFetcher(totalRows, pageCalls) {
  return async ({ offset, limit }) => {
    pageCalls.push(offset);
    return Array.from(
      { length: Math.max(0, Math.min(limit, totalRows - offset)) },
      (_, i) => offset + i
    );
  };
}

test('pagination returns every row exactly once, in order, for any total', async () => {
  const random = rng(1);
  for (let round = 0; round < 50; round += 1) {
    const pageSize = 1 + Math.floor(random() * 40);
    const totalRows = Math.floor(random() * pageSize * 8);
    const calls = [];
    const rows = await fetchAllPages(pagedFetcher(totalRows, calls), {
      pageSize,
      maxPages: 20,
      label: 'test',
    });
    assert.deepEqual(rows, Array.from({ length: totalRows }, (_, i) => i),
      `pageSize=${pageSize} totalRows=${totalRows}`);
    assert.deepEqual(calls, calls.map((_, i) => i * pageSize), 'offsets advance by pageSize');
  }
});

test('pagination FAILS LOUDLY when the data outgrows the cap — never truncates', async () => {
  const calls = [];
  await assert.rejects(
    fetchAllPages(pagedFetcher(1000, calls), { pageSize: 100, maxPages: 5, label: 'payroll' }),
    /payroll: exceeded 500 rows; refusing to return a possibly-truncated result/
  );
});

test('an exact-multiple total terminates via one empty page', async () => {
  const calls = [];
  const rows = await fetchAllPages(pagedFetcher(200, calls), { pageSize: 100, maxPages: 5 });
  assert.equal(rows.length, 200);
  assert.deepEqual(calls, [0, 100, 200]);
});

// A fetcher that reports the endpoint's own count alongside the rows, the way
// MMS /search does via TotalItemCount.
function countedFetcher(totalRows, pageCalls, { reportTotal = totalRows, serveAtMost = Infinity } = {}) {
  return async ({ offset, limit }) => {
    pageCalls.push(offset);
    const available = Math.max(0, Math.min(totalRows, serveAtMost) - offset);
    return {
      rows: Array.from({ length: Math.max(0, Math.min(limit, available)) }, (_, i) => offset + i),
      total: reportTotal,
    };
  };
}

test('pagination stops on the reported total, without needing a short page', async () => {
  const calls = [];
  // An exact multiple: the heuristic needs a wasted extra request to learn it is
  // done, the reported total does not.
  const rows = await fetchAllPages(countedFetcher(200, calls), { pageSize: 100, maxPages: 5 });
  assert.equal(rows.length, 200);
  assert.deepEqual(calls, [0, 100], 'no trailing empty-page request');
});

test('a single page covering the reported total is one request', async () => {
  const calls = [];
  const rows = await fetchAllPages(countedFetcher(951, calls), { pageSize: 2000, maxPages: 5 });
  assert.equal(rows.length, 951);
  assert.deepEqual(calls, [0], 'a window inside the page size costs exactly one round trip');
});

// The failure the whole design exists to prevent: an endpoint that caps `limit`
// below what we asked. Under the short-page heuristic every page looks like the
// last one and the walk truncates in silence — which on this lane means a short
// payroll that looks entirely plausible.
test('a silently capped limit is caught by the reported total, not truncated', async () => {
  const calls = [];
  await assert.rejects(
    // We ask for 2000; the endpoint only ever serves 1000 but admits 3000 exist.
    fetchAllPages(countedFetcher(3000, calls, { serveAtMost: 1000 }), {
      pageSize: 2000, maxPages: 5, label: 'payroll',
    }),
    /payroll: endpoint reported 3000 rows but ran out after 1000/u,
  );

  // Same shape without the total: the heuristic accepts the short page and
  // returns 1000 of 3000 rows without complaint. This is the contrast, pinned.
  const heuristicCalls = [];
  const quietlyShort = await fetchAllPages(
    async ({ offset, limit }) => {
      heuristicCalls.push(offset);
      const available = Math.max(0, 1000 - offset);
      return Array.from({ length: Math.max(0, Math.min(limit, available)) }, (_, i) => offset + i);
    },
    { pageSize: 2000, maxPages: 5, label: 'payroll' },
  );
  assert.equal(quietlyShort.length, 1000, 'the heuristic alone cannot see the truncation');
});

test('a total the endpoint overshoots is refused too', async () => {
  const calls = [];
  await assert.rejects(
    fetchAllPages(countedFetcher(500, calls, { reportTotal: 300 }), { pageSize: 2000, maxPages: 5, label: 'payroll' }),
    /payroll: endpoint reported 300 rows but returned 500/u,
  );
});

test('a total needing more pages than the cap fails loudly and says so', async () => {
  const calls = [];
  await assert.rejects(
    fetchAllPages(countedFetcher(10000, calls), { pageSize: 100, maxPages: 3, label: 'payroll' }),
    /payroll: 10000 rows needs more than 3 pages of 100/u,
  );
});

test('pagination refuses to combine pages when the provider total changes mid-walk', async () => {
  let page = 0;
  await assert.rejects(
    fetchAllPages(async () => {
      page += 1;
      return {
        rows: Array.from({ length: 100 }, (_, index) => ({ id: `${page}:${index}` })),
        total: page === 1 ? 200 : 201,
      };
    }, { pageSize: 100, maxPages: 5, label: 'attendance' }),
    /total changed from 200 to 201/u,
  );
});

test('array-returning fetchers keep the old heuristic behaviour', async () => {
  const random = rng(7);
  for (let round = 0; round < 25; round += 1) {
    const pageSize = 1 + Math.floor(random() * 40);
    const totalRows = Math.floor(random() * pageSize * 6);
    const calls = [];
    const rows = await fetchAllPages(pagedFetcher(totalRows, calls), { pageSize, maxPages: 20, label: 'test' });
    assert.deepEqual(rows, Array.from({ length: totalRows }, (_, i) => i));
  }
});

test('the reported-total walk returns every row exactly once, for any total', async () => {
  const random = rng(11);
  for (let round = 0; round < 50; round += 1) {
    const pageSize = 1 + Math.floor(random() * 40);
    const totalRows = Math.floor(random() * pageSize * 8);
    const calls = [];
    const rows = await fetchAllPages(countedFetcher(totalRows, calls), { pageSize, maxPages: 20, label: 'test' });
    assert.deepEqual(rows, Array.from({ length: totalRows }, (_, i) => i),
      `pageSize=${pageSize} totalRows=${totalRows}`);
    assert.deepEqual(calls, calls.map((_, i) => i * pageSize), 'offsets advance by pageSize');
  }
});

// ---------- payroll windows ----------

function addDaysIso(date, days) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

const CADENCE_DAYS = { weekly: 7, biweekly: 14, 'three-weekly': 21 };

test('consecutive payroll windows tile perfectly: no lost days, no double-counted days', () => {
  const random = rng(2);
  for (let round = 0; round < 60; round += 1) {
    const cadence = Object.keys(CADENCE_DAYS)[Math.floor(random() * 3)];
    const length = CADENCE_DAYS[cadence];
    // Random pay date across 2025–2027, deliberately crossing both UK DST flips.
    const base = new Date(Date.UTC(2025, 0, 1, 12));
    base.setUTCDate(base.getUTCDate() + Math.floor(random() * 1095));
    const payDate = base.toISOString().slice(0, 10);

    const window = buildPayrollPeriod({ payDate, cadence });
    const next = buildPayrollPeriod({ payDate: addDaysIso(payDate, length), cadence });

    assert.equal(window.periodEnd, addDaysIso(payDate, -1), 'window ends the day before pay day');
    assert.equal(window.periodStart, addDaysIso(payDate, -length), 'window starts a full cadence back');
    // Inclusive day count is exactly the cadence length.
    const spanDays = (Date.parse(`${window.periodEnd}T12:00:00Z`) - Date.parse(`${window.periodStart}T12:00:00Z`)) / 86400000 + 1;
    assert.equal(spanDays, length, `${cadence} window spans ${spanDays} days at ${payDate}`);
    // The next window starts the day after this one ends: tiling, not overlap.
    assert.equal(next.periodStart, addDaysIso(window.periodEnd, 1),
      `${cadence} windows must tile across ${window.periodEnd} (DST-safe)`);
  }
});

test('fresh MMS corrections never silently replace a reviewed payroll amount', () => {
  const preview = buildPayrollPreview({
    payDate: '2026-07-01',
    attendanceRows: [{
      ID: 'atn_1',
      EventID: 'evt_1',
      TeacherID: 'tch_zMX5Jc',
      AttendanceStatus: 'Present',
      EventStartDate: '2026-06-24T16:00:00',
      EventDuration: 60,
      StudentID: 'sdt_1',
    }],
    savedRuns: [{
      payroll_id: 'payroll_calum_2026-06-24_2026-06-30',
      status: 'reviewed',
      lesson_count: '0',
      teaching_minutes: '0',
      expected_amount: '0',
      final_amount: '0',
    }],
  });
  const calum = preview.rows.find((row) => row.tutorShortName === 'Calum');

  assert.equal(calum.attendanceChanged, true);
  assert.equal(calum.finalAmount, 0, 'the reviewed ledger amount stays frozen until an explicit save');
  assert.ok(calum.recalculatedFinalAmount > 0, 'fresh MMS attendance still produces the corrected calculation');
  assert.equal(getPayrollWorkflowState(calum).readyForPayment, false, 'the UI must return the corrected run to review');
});

// ---------- Wise batch ----------

function randomRun(random, index) {
  const status = random() < 0.75 ? 'reviewed' : ['draft', 'paid', ''][Math.floor(random() * 3)];
  const response = ['', 'confirmed', 'disputed'][Math.floor(random() * 3)];
  const route = random() < 0.8 ? 'normal' : 'confirmation_required';
  const amount = Math.round(random() * 40000 - 2000) / 100; // includes zero/negative
  return {
    payroll_id: `run_${index}`,
    tutor: `Tutor ${index % 7}`,
    tutor_short_name: `T${index % 7}`,
    status,
    tutor_response: response,
    payment_route: route,
    final_amount: amount,
    period_end: '2026-07-14',
  };
}

test('disputed or unready runs never reach the payable set', () => {
  const random = rng(3);
  const savedRuns = Array.from({ length: 200 }, (_, i) => randomRun(random, i));
  const { payableRows } = normalisePayableResult(selectPayableReviewedRuns(savedRuns));

  const payableIds = new Set(
    payableRows.flatMap((row) => (row.allPayrollIds?.length ? row.allPayrollIds : [row.payrollId]))
  );
  for (const run of savedRuns) {
    const shouldBePayable = isPayrollRunReadyForPayment(run);
    if (!shouldBePayable) {
      assert.ok(!payableIds.has(run.payroll_id),
        `${run.payroll_id} (status=${run.status}, response=${run.tutor_response}, route=${run.payment_route}) must not be payable`);
    }
  }
});

// selectPayableReviewedRuns returns a shape we don't want to over-specify here;
// normalise the parts the invariants need and fail loudly if the shape moves.
function normalisePayableResult(result) {
  const payableRows = result?.payableRows || result?.rows || (Array.isArray(result) ? result : null);
  assert.ok(Array.isArray(payableRows), 'selectPayableReviewedRuns result shape changed — update this test deliberately');
  return { payableRows };
}

test('the Wise batch total equals the sum of its emitted CSV amounts, exactly', () => {
  const random = rng(4);
  for (let round = 0; round < 25; round += 1) {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      payrollId: `p_${round}_${i}`,
      tutor: `Tutor ${i % 9}`,
      tutorShortName: `T${i % 9}`,
      status: random() < 0.8 ? 'reviewed' : 'draft',
      owedAmount: Math.round(random() * 50000 - 5000) / 100,
      periodEnd: '2026-07-14',
    }));
    // Recipients exist for most tutors; some are deliberately missing.
    const wiseByKey = new Map();
    for (let t = 0; t < 9; t += 1) {
      if (random() < 0.75) {
        wiseByKey.set(`t${t}`, { recipientId: `R${t}`, name: `Tutor ${t}`, sourceCurrency: 'GBP', targetCurrency: 'GBP', amountCurrency: 'GBP', receiverType: 'PERSON' });
      }
    }

    const batch = buildWiseBatch({ rows, wiseByKey });

    const csvSum = batch.csvRows.reduce((sum, row) => sum + Number(row.amount), 0);
    const displayedTutorSum = batch.includedTutors.reduce((sum, row) => sum + row.owedAmount, 0);
    assert.equal(batch.totalAmount, Math.round(csvSum * 100) / 100,
      'batch total must equal the sum of what the CSV actually pays');
    assert.equal(batch.includedCount, batch.csvRows.length);
    assert.equal(batch.includedTutors.length, batch.csvRows.length,
      'the visible ready-to-pay tutor list must name every CSV payment exactly once');
    assert.equal(Math.round(displayedTutorSum * 100) / 100, batch.totalAmount,
      'the visible tutor amounts must add up to the Wise batch total');
    // Nothing non-positive or unreviewed is ever paid.
    for (const row of batch.csvRows) {
      assert.ok(Number(row.amount) > 0, 'CSV must never contain a zero/negative payment');
    }
    // Every eligible row is either paid or explicitly reported missing — none vanish.
    const eligible = rows.filter((row) => row.status === 'reviewed' && row.owedAmount > 0);
    assert.equal(batch.csvRows.length + batch.missing.length, eligible.length,
      'every eligible row must be accounted for: paid or reported missing');
  }
});
