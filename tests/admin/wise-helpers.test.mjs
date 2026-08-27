import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTutorWise,
  buildWiseBatch,
  buildPaymentReference,
  selectPayableReviewedRuns,
  toWiseCsv,
  WISE_CSV_HEADERS,
} from '../../lib/admin/wise-helpers.mjs';

function savedRun(overrides = {}) {
  return {
    payroll_id: 'payroll_david_2026-06-16_2026-07-01',
    tutor: 'David Husz',
    tutor_short_name: 'David',
    status: 'reviewed',
    final_amount: 211.42,
    period_end: '2026-07-01',
    reviewed_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function wiseRow(overrides = {}) {
  return {
    tutor: 'Kenny',
    recipient_id: '12345',
    name: 'Kenny Bates',
    recipient_email: 'kenny@example.com',
    recipient_detail: 'GB00 0000',
    source_currency: 'GBP',
    target_currency: 'GBP',
    amount_currency: 'GBP',
    receiver_type: 'PERSON',
    ...overrides,
  };
}

function payrollRow(overrides = {}) {
  return {
    payrollId: 'payroll_kenny_2026-06-24_2026-06-30',
    tutor: 'Kenny Bates',
    tutorShortName: 'Kenny',
    status: 'reviewed',
    owedAmount: 280,
    periodEnd: '2026-07-01',
    ...overrides,
  };
}

test('parseTutorWise keys by normalised tutor and defaults currencies to GBP', () => {
  const map = parseTutorWise([wiseRow({ tutor: 'Kenny', source_currency: '', target_currency: '', amount_currency: '' })]);
  const recipient = map.get('kenny');
  assert.ok(recipient);
  assert.equal(recipient.recipientId, '12345');
  assert.equal(recipient.sourceCurrency, 'GBP');
  assert.equal(recipient.targetCurrency, 'GBP');
  assert.equal(recipient.amountCurrency, 'GBP');
});

test('buildWiseBatch includes only reviewed rows with positive owed amount', () => {
  const wiseByKey = parseTutorWise([wiseRow()]);
  const rows = [
    payrollRow({ status: 'reviewed', owedAmount: 280 }),
    payrollRow({ status: 'draft', owedAmount: 100 }),
    payrollRow({ status: 'paid', owedAmount: 0 }),
    payrollRow({ status: 'reviewed', owedAmount: 0 }),
  ];
  const result = buildWiseBatch({ rows, wiseByKey });
  assert.equal(result.includedCount, 1);
  assert.equal(result.totalAmount, 280);
  assert.equal(result.csvRows[0].amount, '280.00');
  assert.equal(result.csvRows[0].paymentReference, 'FC pay 2026-07-01');
  assert.equal(result.csvRows[0].recipientId, '12345');
  assert.deepEqual(result.includedTutors, [{ tutor: 'Kenny Bates', owedAmount: 280 }]);
  assert.equal(result.missing.length, 0);
  assert.deepEqual(result.includedPayrollIds, ['payroll_kenny_2026-06-24_2026-06-30']);
});

test('buildWiseBatch excludes missing-recipient rows from includedPayrollIds', () => {
  const wiseByKey = parseTutorWise([wiseRow({ tutor: 'Kenny' })]);
  const rows = [
    payrollRow(),
    payrollRow({ payrollId: 'payroll_lucy', tutor: 'Lucy Smith', tutorShortName: 'Lucy', owedAmount: 120 }),
  ];
  const result = buildWiseBatch({ rows, wiseByKey });
  assert.deepEqual(result.includedPayrollIds, ['payroll_kenny_2026-06-24_2026-06-30']);
  assert.equal(result.missing.length, 1);
  assert.deepEqual(result.includedTutors, [{ tutor: 'Kenny Bates', owedAmount: 280 }]);
});

test('buildWiseBatch surfaces reviewed rows with no Wise recipient instead of dropping them', () => {
  const wiseByKey = parseTutorWise([wiseRow({ tutor: 'Kenny' })]);
  const rows = [
    payrollRow({ tutor: 'Lucy Smith', tutorShortName: 'Lucy', owedAmount: 120 }),
  ];
  const result = buildWiseBatch({ rows, wiseByKey });
  assert.equal(result.includedCount, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].tutor, 'Lucy Smith');
  assert.deepEqual(result.includedTutors, []);
});

test('buildWiseBatch matches by full tutor name when short name misses', () => {
  const wiseByKey = parseTutorWise([wiseRow({ tutor: 'Kenny Bates' })]);
  const rows = [payrollRow({ tutorShortName: '', tutor: 'Kenny Bates' })];
  const result = buildWiseBatch({ rows, wiseByKey });
  assert.equal(result.includedCount, 1);
});

test('buildWiseBatch skips a reviewed row whose recipient has no recipientId', () => {
  const wiseByKey = parseTutorWise([wiseRow({ recipient_id: '' })]);
  const result = buildWiseBatch({ rows: [payrollRow()], wiseByKey });
  assert.equal(result.includedCount, 0);
  assert.equal(result.missing.length, 1);
});

test('selectPayableReviewedRuns collapses a tutor reviewed under two windows to one payment', () => {
  // David's real data: two reviewed rows, different window starts, same amount.
  const { rows, amountConflicts } = selectPayableReviewedRuns([
    savedRun({ payroll_id: 'payroll_david_2026-06-16_2026-07-01' }),
    savedRun({ payroll_id: 'payroll_david_2026-06-15_2026-07-01', reviewed_at: '2026-07-01T11:00:00.000Z' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owedAmount, 211.42);
  // Both ids carried so a batch-paid flip clears the duplicate too.
  assert.deepEqual(rows[0].allPayrollIds.sort(), [
    'payroll_david_2026-06-15_2026-07-01',
    'payroll_david_2026-06-16_2026-07-01',
  ]);
  assert.equal(amountConflicts.length, 0);
});

test('selectPayableReviewedRuns warns when duplicate reviewed rows disagree on amount', () => {
  const { rows, amountConflicts } = selectPayableReviewedRuns([
    savedRun({ payroll_id: 'a', final_amount: 211.42, reviewed_at: '2026-07-01T10:00:00.000Z' }),
    savedRun({ payroll_id: 'b', final_amount: 250, reviewed_at: '2026-07-01T12:00:00.000Z' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owedAmount, 250); // latest reviewed wins
  assert.equal(amountConflicts.length, 1);
  assert.equal(amountConflicts[0].tutor, 'David Husz');
  assert.deepEqual(amountConflicts[0].amounts, [211.42, 250]);
});

test('selectPayableReviewedRuns holds a disputed row out of the batch and surfaces it', () => {
  const { rows, disputed } = selectPayableReviewedRuns([
    savedRun({ payroll_id: 'ok', tutor: 'Kenny Bates', tutor_short_name: 'Kenny', final_amount: 280 }),
    savedRun({ payroll_id: 'nope', tutor_response: 'disputed', tutor_note: 'missing a lesson' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tutorShortName, 'Kenny');
  assert.equal(disputed.length, 1);
  assert.equal(disputed[0].tutor, 'David Husz');
  assert.equal(disputed[0].note, 'missing a lesson');
});

test('selectPayableReviewedRuns holds confirmation-required rows until confirmed', () => {
  const waiting = selectPayableReviewedRuns([{
    payroll_id: 'pay_waiting',
    tutor: 'David Husz',
    tutor_short_name: 'David',
    status: 'reviewed',
    payment_route: 'confirmation',
    final_amount: '100',
  }]);
  assert.equal(waiting.rows.length, 0);

  const confirmed = selectPayableReviewedRuns([{
    payroll_id: 'pay_confirmed',
    tutor: 'David Husz',
    tutor_short_name: 'David',
    status: 'reviewed',
    payment_route: 'confirmation',
    tutor_response: 'confirmed',
    final_amount: '100',
  }]);
  assert.equal(confirmed.rows.length, 1);
});

test('selectPayableReviewedRuns ignores non-reviewed and non-positive rows', () => {
  const { rows } = selectPayableReviewedRuns([
    savedRun({ status: 'draft' }),
    savedRun({ status: 'paid' }),
    savedRun({ tutor: 'Kenny Bates', tutor_short_name: 'Kenny', final_amount: 0 }),
  ]);
  assert.equal(rows.length, 0);
});

test('selectPayableReviewedRuns feeds buildWiseBatch and carries all ids into the batch', () => {
  const wiseByKey = parseTutorWise([wiseRow({ tutor: 'David', name: 'David Husz' })]);
  const { rows } = selectPayableReviewedRuns([
    savedRun({ payroll_id: 'payroll_david_2026-06-16_2026-07-01' }),
    savedRun({ payroll_id: 'payroll_david_2026-06-15_2026-07-01' }),
  ]);
  const result = buildWiseBatch({ rows, wiseByKey });
  assert.equal(result.includedCount, 1);
  assert.equal(result.totalAmount, 211.42);
  assert.deepEqual(result.includedPayrollIds.sort(), [
    'payroll_david_2026-06-15_2026-07-01',
    'payroll_david_2026-06-16_2026-07-01',
  ]);
});

test('buildPaymentReference is short and falls back without a date', () => {
  assert.equal(buildPaymentReference({ periodEnd: '2026-07-01' }), 'FC pay 2026-07-01');
  assert.equal(buildPaymentReference({}), 'FC pay');
});

test('toWiseCsv emits the exact header order and escapes commas/quotes', () => {
  const csv = toWiseCsv([
    {
      recipientId: '1',
      name: 'Bates, Kenny',
      recipientEmail: 'k@example.com',
      recipientDetail: 'has "quote"',
      sourceCurrency: 'GBP',
      targetCurrency: 'GBP',
      amountCurrency: 'GBP',
      amount: '280.00',
      paymentReference: 'FC pay 2026-07-01',
      receiverType: 'PERSON',
    },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], WISE_CSV_HEADERS.join(','));
  assert.ok(lines[1].includes('"Bates, Kenny"'));
  assert.ok(lines[1].includes('"has ""quote"""'));
});
