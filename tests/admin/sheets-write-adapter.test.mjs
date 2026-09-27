// The Sheets write path, against an in-memory fake of the Google client.
//
// Everything that computes *what* to write (the buildXSheetRow helpers) was
// already covered. Nothing covered the code that turns a row into an A1 range
// and puts it somewhere — which is where a wrong answer is silent and
// destructive: writing a correct row over the wrong student's row looks like
// success to every layer above it.
//
// upsertManagedSheetRow already accepts an injected `sheets` client. Its read
// leg goes through getSheetValues, which uses the process-wide client, so that
// one is injected via the documented global the client factory caches on.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSheetReadCacheForTests,
  ensureManagedSheet,
  FINANCE_SNAPSHOT_HEADERS,
  FINANCE_SNAPSHOT_SHEET,
  getSheetValues,
  PAYROLL_RUNS_HEADERS,
  PAYROLL_RUNS_SHEET,
  STRIPE_FORECAST_MONTHLY_HEADERS,
  STRIPE_FORECAST_MONTHLY_SHEET,
  upsertManagedSheetRow,
  withSheetsRetry,
} from '../../lib/admin/sheets/core.mjs';
import { appendFinanceSnapshotRow, getPayrollRunRows, upsertPayrollRunRow } from '../../lib/admin/sheets/finance.mjs';
import { appendStripeForecastMonthlyRow } from '../../lib/admin/sheets/stripe-cache.mjs';
import { updateStudentSheetRow } from '../../lib/admin/sheets/students.mjs';

// --- the fake -----------------------------------------------------------

function unquote(name) {
  return name.replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'").trim();
}

function parseRange(range = '') {
  const bang = `${range}`.lastIndexOf('!');
  if (bang === -1) return { sheet: unquote(range), a1: '' };
  return { sheet: unquote(range.slice(0, bang)), a1: range.slice(bang + 1) };
}

// "A5:H5" -> 5, "A1:H1" -> 1, "1:1" -> 1, "A:A" -> null (whole column)
function startRowOf(a1) {
  const match = /^[A-Z]*(\d+):/.exec(a1);
  return match ? Number(match[1]) : null;
}

function cellCoordinates(a1) {
  const match = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]) {
    column = (column * 26) + character.charCodeAt(0) - 64;
  }
  return { rowIndex: Number(match[2]) - 1, columnIndex: column - 1 };
}

function fakeSheets({ tabs = {}, failures = {} } = {}) {
  const data = Object.fromEntries(
    Object.entries(tabs).map(([name, rows]) => [name, rows.map((row) => [...row])]),
  );
  const calls = [];
  // failures: { append: [503, 503] } pops one status per call until empty.
  const nextFailure = (kind) => (failures[kind] || []).shift();

  function maybeThrow(kind) {
    const status = nextFailure(kind);
    if (status === undefined) return;
    const error = new Error(`fake sheets ${kind} failure`);
    error.code = status;
    throw error;
  }

  return {
    calls,
    data,
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: Object.keys(data).map((title) => ({ properties: { title, sheetId: title.length } })),
        },
      }),
      batchUpdate: async ({ requestBody }) => {
        for (const request of requestBody.requests || []) {
          const title = request.addSheet?.properties?.title;
          if (title) {
            calls.push({ kind: 'addSheet', title });
            data[title] = [];
          }
        }
        return { data: {} };
      },
      values: {
        get: async ({ range }) => {
          maybeThrow('get');
          const { sheet, a1 } = parseRange(range);
          calls.push({ kind: 'get', sheet, a1 });
          const rows = data[sheet] || [];
          if (a1 === '1:1') return { data: { values: rows.length ? [rows[0]] : [] } };
          return { data: { values: rows.map((row) => [...row]) } };
        },
        update: async ({ range, requestBody }) => {
          maybeThrow('update');
          const { sheet, a1 } = parseRange(range);
          const values = requestBody.values || [];
          calls.push({ kind: 'update', sheet, a1, values });
          const startRow = startRowOf(a1) ?? 1;
          data[sheet] = data[sheet] || [];
          values.forEach((row, offset) => {
            data[sheet][startRow - 1 + offset] = [...row];
          });
          return { data: {} };
        },
        batchUpdate: async ({ requestBody }) => {
          maybeThrow('batchUpdate');
          for (const entry of requestBody.data || []) {
            const { sheet, a1 } = parseRange(entry.range);
            const coordinates = cellCoordinates(a1);
            if (!coordinates) throw new Error(`Unsupported fake batch range: ${entry.range}`);
            const value = entry.values?.[0]?.[0] ?? '';
            calls.push({ kind: 'valueBatchUpdate', sheet, a1, value });
            data[sheet] = data[sheet] || [];
            data[sheet][coordinates.rowIndex] = data[sheet][coordinates.rowIndex] || [];
            data[sheet][coordinates.rowIndex][coordinates.columnIndex] = value;
          }
          return { data: {} };
        },
        append: async ({ range, requestBody }) => {
          maybeThrow('append');
          const { sheet } = parseRange(range);
          const values = requestBody.values || [];
          calls.push({ kind: 'append', sheet, values });
          data[sheet] = data[sheet] || [];
          data[sheet].push(...values.map((row) => [...row]));
          return { data: {} };
        },
      },
    },
  };
}

// Each test gets its own spreadsheetId and tab name because core.mjs memoises
// managed-sheet headers and spreadsheet metadata in module-level maps keyed by
// those two values. Unique keys give isolation without needing a cache reset.
let counter = 0;
function scenario({ headers, rows = [], failures = {} } = {}) {
  counter += 1;
  const sheetName = `Test_Tab_${counter}`;
  const spreadsheetId = `sheet-id-${counter}`;
  process.env.GOOGLE_SPREADSHEET_ID = spreadsheetId;
  clearSheetReadCacheForTests();

  const sheets = fakeSheets({ tabs: { [sheetName]: [headers, ...rows] }, failures });
  // getSheetValues resolves the client from this cached global.
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);
  return { sheets, sheetName, spreadsheetId };
}

test.after(() => {
  delete globalThis.__firstChordSheetsClientPromise;
});

const HEADERS = ['mms_id', 'student_name', 'status', 'updated_at'];

test('a cutoff waiver appends optional headers and updates only the existing statement, preserving its facts', async () => {
  counter += 1;
  process.env.GOOGLE_SPREADSHEET_ID = `payroll-waiver-sheet-${counter}`;
  clearSheetReadCacheForTests();
  const oldHeaders = PAYROLL_RUNS_HEADERS.slice(0, -3);
  const original = Object.fromEntries(oldHeaders.map((header) => [header, '']));
  Object.assign(original, { payroll_id: 'cutoff_calum', tutor_short_name: 'Calum', status: 'paid', final_amount: '60', paid_via: 'manual', paid_at: '2026-09-24', statement_delivery_status: 'sent' });
  const neighbour = oldHeaders.map((header) => header === 'payroll_id' ? 'other_statement' : 'untouched');
  const sheets = fakeSheets({ tabs: { [PAYROLL_RUNS_SHEET]: [oldHeaders, neighbour, oldHeaders.map((header) => original[header])] } });
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);
  const waived = { ...original, cutover_confirmation_waived_at: '2026-09-27T12:00:00Z', cutover_confirmation_waived_by: 'Admin', cutover_confirmation_waiver_reason: 'Explicit instruction' };
  await upsertPayrollRunRow(waived);
  assert.deepEqual(sheets.data[PAYROLL_RUNS_SHEET][0], PAYROLL_RUNS_HEADERS);
  assert.deepEqual(sheets.data[PAYROLL_RUNS_SHEET][1], neighbour);
  assert.equal(sheets.calls.some((call) => call.kind === 'append'), false);
  const saved = (await getPayrollRunRows({ force: true })).find((row) => row.payroll_id === original.payroll_id);
  for (const [key, value] of Object.entries(waived)) assert.equal(saved[key], value, key);
});

// --- append-only monthly identity --------------------------------------

test('a deterministic monthly finance snapshot appends once and then becomes a no-op', async () => {
  counter += 1;
  process.env.GOOGLE_SPREADSHEET_ID = `finance-sheet-id-${counter}`;
  clearSheetReadCacheForTests();
  const sheets = fakeSheets({ tabs: { [FINANCE_SNAPSHOT_SHEET]: [FINANCE_SNAPSHOT_HEADERS] } });
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);
  const row = {
    snapshot_id: 'fs_monthly_2026-08',
    snapshot_at: '2026-08-03T06:30:00.000Z',
    period_type: 'monthly',
    active_count: 190,
  };

  assert.deepEqual(await appendFinanceSnapshotRow(row), {
    appended: true,
    snapshotId: 'fs_monthly_2026-08',
  });
  assert.deepEqual(await appendFinanceSnapshotRow(row), {
    appended: false,
    snapshotId: 'fs_monthly_2026-08',
  });
  assert.equal(
    sheets.calls.filter((call) => call.kind === 'append' && call.sheet === FINANCE_SNAPSHOT_SHEET).length,
    1,
  );
});

test('a monthly Stripe forecast is first-write-wins at the Sheets boundary', async () => {
  counter += 1;
  process.env.GOOGLE_SPREADSHEET_ID = `stripe-forecast-sheet-id-${counter}`;
  clearSheetReadCacheForTests();
  const sheets = fakeSheets({ tabs: { [STRIPE_FORECAST_MONTHLY_SHEET]: [STRIPE_FORECAST_MONTHLY_HEADERS] } });
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);
  const row = {
    month: '2026-08',
    forecasted_at: '2026-08-03T05:00:00.000Z',
    forecast_total: 12345,
    items_json: '[]',
  };

  assert.deepEqual(await appendStripeForecastMonthlyRow(row), {
    appended: true,
    month: '2026-08',
  });
  assert.deepEqual(await appendStripeForecastMonthlyRow({ ...row, forecast_total: 99999 }), {
    appended: false,
    month: '2026-08',
  });
  assert.equal(
    sheets.calls.filter((call) => call.kind === 'append' && call.sheet === STRIPE_FORECAST_MONTHLY_SHEET).length,
    1,
  );
  const totalIndex = STRIPE_FORECAST_MONTHLY_HEADERS.indexOf('forecast_total');
  assert.equal(sheets.data[STRIPE_FORECAST_MONTHLY_SHEET][1][totalIndex], 12345);
});

// --- row targeting ------------------------------------------------------

test('student edits bypass cached rows and preserve unrelated concurrent cells', async () => {
  counter += 1;
  process.env.GOOGLE_SPREADSHEET_ID = `students-sheet-id-${counter}`;
  clearSheetReadCacheForTests();
  const sheets = fakeSheets({
    tabs: {
      Students: [
        ['mms_id', 'Student forename', 'Tutor', 'admin_note'],
        ['sdt_1', 'Ada', 'Arion', 'old note'],
      ],
    },
  });
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);

  await getSheetValues('Students');
  sheets.data.Students[1][3] = 'manual concurrent edit';

  const result = await updateStudentSheetRow('sdt_1', { Tutor: 'Dean' });

  assert.deepEqual(result, { rowNumber: 2, changedCellCount: 1 });
  assert.deepEqual(sheets.data.Students[1], ['sdt_1', 'Ada', 'Dean', 'manual concurrent edit']);
  assert.deepEqual(
    sheets.calls.filter((call) => call.kind === 'valueBatchUpdate'),
    [{ kind: 'valueBatchUpdate', sheet: 'Students', a1: 'C2', value: 'Dean' }],
  );
  assert.equal(
    sheets.calls.filter((call) => call.kind === 'get' && call.sheet === 'Students').length,
    2,
    'the mutation must fetch live rows even when a cache entry exists',
  );
});

test('an existing row is updated in place at the correct 1-indexed sheet row', async () => {
  // The +2 in `targetRowIndex + 2` is the header row plus 1-indexing. Getting
  // it wrong overwrites a neighbouring student and reports success.
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: HEADERS,
    rows: [
      ['sdt_1', 'Ada', 'active', '2026-01-01'],
      ['sdt_2', 'Bo', 'active', '2026-01-01'],
      ['sdt_3', 'Cy', 'active', '2026-01-01'],
    ],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: HEADERS,
    valuesByHeader: { mms_id: 'sdt_3', student_name: 'Cy', status: 'paused', updated_at: '2026-07-27' },
    matchesRow: (row, headers) => row[headers.indexOf('mms_id')] === 'sdt_3',
  });

  const update = sheets.calls.find((call) => call.kind === 'update');
  assert.ok(update, 'an existing row must be updated, not appended');
  assert.equal(update.a1, 'A4:D4', 'third data row is sheet row 4 (header + 1-indexed)');
  assert.deepEqual(sheets.data[sheetName][3], ['sdt_3', 'Cy', 'paused', '2026-07-27']);
  // The neighbours are the point: nothing else moved.
  assert.deepEqual(sheets.data[sheetName][1], ['sdt_1', 'Ada', 'active', '2026-01-01']);
  assert.deepEqual(sheets.data[sheetName][2], ['sdt_2', 'Bo', 'active', '2026-01-01']);
  assert.equal(sheets.calls.some((call) => call.kind === 'append'), false);
});

test('the first data row is sheet row 2, never row 1', async () => {
  // Off-by-one in the other direction: writing row 1 destroys the header, and
  // every subsequent read of the tab silently returns garbage.
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: HEADERS,
    rows: [['sdt_1', 'Ada', 'active', '2026-01-01']],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: HEADERS,
    valuesByHeader: { mms_id: 'sdt_1', student_name: 'Ada', status: 'archived', updated_at: '2026-07-27' },
    matchesRow: (row) => row[0] === 'sdt_1',
  });

  const update = sheets.calls.find((call) => call.kind === 'update');
  assert.equal(update.a1, 'A2:D2');
  assert.deepEqual(sheets.data[sheetName][0], HEADERS, 'the header row must be intact');
});

test('an unmatched row is appended and leaves existing rows alone', async () => {
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: HEADERS,
    rows: [['sdt_1', 'Ada', 'active', '2026-01-01']],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: HEADERS,
    valuesByHeader: { mms_id: 'sdt_new', student_name: 'Dee', status: 'active', updated_at: '2026-07-27' },
    matchesRow: (row) => row[0] === 'sdt_new',
  });

  assert.equal(sheets.calls.some((call) => call.kind === 'update' && call.a1 !== 'A1:D1'), false);
  const append = sheets.calls.find((call) => call.kind === 'append');
  assert.deepEqual(append.values, [['sdt_new', 'Dee', 'active', '2026-07-27']]);
  assert.equal(sheets.data[sheetName].length, 3, 'header + original + appended');
});

// --- header/value alignment ---------------------------------------------

test('values follow the live sheet header order, not the code constant order', async () => {
  // Someone reordering columns in the spreadsheet must not silently transpose
  // every subsequent write. The row is built by mapping the *sheet's* headers.
  const liveOrder = ['updated_at', 'status', 'mms_id', 'student_name'];
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: liveOrder,
    rows: [['2026-01-01', 'active', 'sdt_1', 'Ada']],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: HEADERS, // the code's order — deliberately different
    valuesByHeader: { mms_id: 'sdt_1', student_name: 'Ada', status: 'paused', updated_at: '2026-07-27' },
    matchesRow: (row, headers) => row[headers.indexOf('mms_id')] === 'sdt_1',
  });

  assert.deepEqual(
    sheets.data[sheetName][1],
    ['2026-07-27', 'paused', 'sdt_1', 'Ada'],
    'each value must land under its own header',
  );
});

test('a header the sheet lacks is added before the row is written', async () => {
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: ['mms_id', 'student_name'],
    rows: [['sdt_1', 'Ada']],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: [...HEADERS, 'pause_reason'],
    valuesByHeader: { mms_id: 'sdt_1', student_name: 'Ada', status: 'paused', updated_at: '2026-07-27', pause_reason: 'holiday' },
    matchesRow: (row) => row[0] === 'sdt_1',
  });

  assert.deepEqual(
    sheets.data[sheetName][0],
    ['mms_id', 'student_name', 'status', 'updated_at', 'pause_reason'],
    'missing headers are appended to the right, never reordered',
  );
  assert.deepEqual(sheets.data[sheetName][1], ['sdt_1', 'Ada', 'paused', '2026-07-27', 'holiday']);
});

test('a header with no supplied value is written as empty string, not a hole', async () => {
  // `undefined` in the values array would shift every later column left once
  // the payload is serialised.
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: HEADERS,
    rows: [['sdt_1', 'Ada', 'active', '2026-01-01']],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: HEADERS,
    valuesByHeader: { mms_id: 'sdt_1' }, // three headers unsupplied
    matchesRow: (row) => row[0] === 'sdt_1',
  });

  const written = sheets.data[sheetName][1];
  assert.deepEqual(written, ['sdt_1', '', '', '']);
  assert.equal(written.length, HEADERS.length);
  assert.equal(written.some((cell) => cell === undefined), false);
  assert.equal(JSON.parse(JSON.stringify(written)).length, HEADERS.length, 'survives serialisation');
});

// --- column arithmetic past Z -------------------------------------------

test('a tab wider than 26 columns writes an AA-style end column', async () => {
  // Finance_Snapshot and Payroll_Runs are already in this territory. A range
  // that stops at Z quietly truncates every write past column 26.
  const wide = Array.from({ length: 28 }, (_, index) => `col_${index + 1}`);
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: wide,
    rows: [wide.map((_, index) => `v${index}`)],
  });

  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName,
    requiredHeaders: wide,
    valuesByHeader: Object.fromEntries(wide.map((header, index) => [header, `n${index}`])),
    matchesRow: () => true,
  });

  const update = sheets.calls.find((call) => call.kind === 'update' && call.a1.startsWith('A2'));
  assert.equal(update.a1, 'A2:AB2', '28 columns ends at AB');
  assert.equal(sheets.data[sheetName][1].length, 28);
  assert.equal(sheets.data[sheetName][1][27], 'n27', 'the 28th column is actually written');
});

// --- creating a managed tab ---------------------------------------------

test('a missing tab is created once, with its headers, before any row write', async () => {
  counter += 1;
  const sheetName = `Test_New_Tab_${counter}`;
  const spreadsheetId = `sheet-id-new-${counter}`;
  process.env.GOOGLE_SPREADSHEET_ID = spreadsheetId;
  clearSheetReadCacheForTests();
  const sheets = fakeSheets({ tabs: { Other_Tab: [['x']] } });
  globalThis.__firstChordSheetsClientPromise = Promise.resolve(sheets);

  const headers = await ensureManagedSheet({ sheets, spreadsheetId, sheetName, requiredHeaders: HEADERS });

  assert.deepEqual(headers, HEADERS);
  const addSheets = sheets.calls.filter((call) => call.kind === 'addSheet');
  assert.equal(addSheets.length, 1, 'exactly one addSheet — a duplicate tab is unrecoverable by hand');
  assert.deepEqual(sheets.data[sheetName][0], HEADERS);

  const addIndex = sheets.calls.findIndex((call) => call.kind === 'addSheet');
  const headerWriteIndex = sheets.calls.findIndex((call) => call.kind === 'update');
  assert.ok(addIndex < headerWriteIndex, 'headers are written after the tab exists');
});

// --- transient failure ---------------------------------------------------

test('a transient 429/503 is retried and then succeeds', async () => {
  let attempts = 0;
  const result = await withSheetsRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('rate limited');
      error.code = attempts === 1 ? 429 : 503;
      throw error;
    }
    return 'written';
  }, { attempts: 4, baseDelayMs: 1 });

  assert.equal(result, 'written');
  assert.equal(attempts, 3);
});

test('a non-transient failure is thrown immediately, not retried into quota exhaustion', async () => {
  let attempts = 0;
  await assert.rejects(
    withSheetsRetry(async () => {
      attempts += 1;
      const error = new Error('bad range');
      error.code = 400;
      throw error;
    }, { attempts: 4, baseDelayMs: 1 }),
    /bad range/,
  );
  assert.equal(attempts, 1, '400 means the request is wrong — repeating it cannot help');
});

test('a write that never succeeds surfaces the error rather than reporting success', async () => {
  const { sheets, sheetName, spreadsheetId } = scenario({
    headers: HEADERS,
    rows: [['sdt_1', 'Ada', 'active', '2026-01-01']],
    failures: { update: [400] },
  });

  await assert.rejects(
    upsertManagedSheetRow({
      sheets,
      spreadsheetId,
      sheetName,
      requiredHeaders: HEADERS,
      valuesByHeader: { mms_id: 'sdt_1', status: 'paused' },
      matchesRow: (row) => row[0] === 'sdt_1',
    }),
    /fake sheets update failure/,
    'a failed write must not resolve — the caller logs success on resolve',
  );
});
