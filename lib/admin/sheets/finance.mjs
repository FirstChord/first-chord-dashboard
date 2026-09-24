/** @fileoverview Sheets adapter for the finance tabs: curated Tutor_Pay and Expenses config, plus append-only Finance_Snapshot and payroll runs. */
import { buildSheetRange, ensureManagedSheet, EXPENSE_LOG_HEADERS, EXPENSE_LOG_SHEET, EXPENSES_HEADERS, EXPENSES_SHEET, FINANCE_SNAPSHOT_HEADERS, FINANCE_SNAPSHOT_SHEET, getSheetValues, getSheetsClient, getSheetsEnv, invalidateSheetReadCache, mapRowsToObjects, PAYROLL_RUNS_HEADERS, PAYROLL_RUNS_SHEET, TUTOR_PAY_HEADERS, TUTOR_PAY_SHEET, TUTOR_WISE_HEADERS, TUTOR_WISE_SHEET, upsertManagedSheetRow } from './core.mjs';

// --- Financial layer (read-only revenue/cost) -----------------------------------
// Tutor_Pay and Expenses are manually-curated config tabs (sensitive: salaries live
// here, never in the repo). Finance_Snapshot is an append-only time series.

async function getManagedSheetObjects(sheetName, requiredHeaders) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  await ensureManagedSheet({ sheets, spreadsheetId, sheetName, requiredHeaders });
  const values = await getSheetValues(sheetName);
  return mapRowsToObjects(values);
}

export async function getTutorPayRows() {
  return getManagedSheetObjects(TUTOR_PAY_SHEET, TUTOR_PAY_HEADERS);
}

export async function getTutorWiseRows() {
  return getManagedSheetObjects(TUTOR_WISE_SHEET, TUTOR_WISE_HEADERS);
}

export async function getExpenseRows() {
  return getManagedSheetObjects(EXPENSES_SHEET, EXPENSES_HEADERS);
}

export async function getExpenseLogRows() {
  return getManagedSheetObjects(EXPENSE_LOG_SHEET, EXPENSE_LOG_HEADERS);
}

export async function getFinanceSnapshotRows() {
  return getManagedSheetObjects(FINANCE_SNAPSHOT_SHEET, FINANCE_SNAPSHOT_HEADERS);
}

export async function getPayrollRunRows() {
  return getManagedSheetObjects(PAYROLL_RUNS_SHEET, PAYROLL_RUNS_HEADERS);
}

export async function appendFinanceSnapshotRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: FINANCE_SNAPSHOT_SHEET,
    requiredHeaders: FINANCE_SNAPSHOT_HEADERS,
  });
  const snapshotId = `${row.snapshot_id || ''}`.trim();
  if (!snapshotId) throw new Error('snapshot_id is required');

  if (`${row.period_type || ''}`.trim() === 'monthly') {
    const existingValues = await getSheetValues(FINANCE_SNAPSHOT_SHEET);
    const idIndex = headers.indexOf('snapshot_id');
    const exists = existingValues.slice(1).some((entry) => `${entry[idIndex] || ''}`.trim() === snapshotId);
    if (exists) return { appended: false, snapshotId };
  }

  const nextRow = headers.map((header) => row[header] ?? '');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: buildSheetRange(FINANCE_SNAPSHOT_SHEET, 'A:A'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [nextRow],
    },
  });
  invalidateSheetReadCache(FINANCE_SNAPSHOT_SHEET);
  return { appended: true, snapshotId };
}

export async function deleteFinanceSnapshotRow(snapshotId) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const idKey = `${snapshotId || ''}`.trim();
  if (!idKey) return { deleted: false };
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: FINANCE_SNAPSHOT_SHEET,
    requiredHeaders: FINANCE_SNAPSHOT_HEADERS,
  });
  const values = await getSheetValues(FINANCE_SNAPSHOT_SHEET);
  const [, ...rows] = values;
  const idIdx = headers.indexOf('snapshot_id');
  const rowIndex = rows.findIndex((entry) => `${entry[idIdx] || ''}`.trim() === idKey);
  if (rowIndex === -1) return { deleted: false };

  const metadata = await sheets.spreadsheets.get({ spreadsheetId, ranges: [FINANCE_SNAPSHOT_SHEET], includeGridData: false });
  const sheet = metadata.data.sheets?.find((entry) => entry.properties?.title === FINANCE_SNAPSHOT_SHEET);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') {
    throw new Error('Could not resolve Finance_Snapshot sheet metadata');
  }

  const targetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: targetRowNumber - 1, endIndex: targetRowNumber },
          },
        },
      ],
    },
  });
  invalidateSheetReadCache(FINANCE_SNAPSHOT_SHEET);
  return { deleted: true, rowNumber: targetRowNumber };
}

export async function upsertTutorPayRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const tutorKey = `${row.tutor || ''}`.trim().toLowerCase();
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: TUTOR_PAY_SHEET,
    requiredHeaders: TUTOR_PAY_HEADERS,
    valuesByHeader: {
      tutor: `${row.tutor || ''}`.trim(),
      pay_model: `${row.pay_model || 'hourly'}`.trim(),
      hourly_rate: row.hourly_rate ?? '',
      monthly_salary: row.monthly_salary ?? '',
      invoice_cadence: row.invoice_cadence ?? 'weekly',
      cadence_effective_from: row.cadence_effective_from ?? row.cadenceEffectiveFrom ?? '',
      cadence_updated_at: row.cadence_updated_at ?? row.cadenceUpdatedAt ?? '',
      cadence_updated_by: row.cadence_updated_by ?? row.cadenceUpdatedBy ?? '',
      contact_email: row.contact_email ?? row.contactEmail ?? '',
      contact_email_verified_at: row.contact_email_verified_at ?? row.contactEmailVerifiedAt ?? '',
      payment_route: row.payment_route ?? row.paymentRoute ?? 'normal',
      active_for_payroll: row.active_for_payroll ?? 'yes',
      notes: row.notes ?? '',
    },
    matchesRow: (entry, headers) => `${entry[headers.indexOf('tutor')] || ''}`.trim().toLowerCase() === tutorKey,
  });
}

export async function upsertPayrollRunRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const payrollId = `${row.payroll_id || row.payrollId || ''}`.trim();
  if (!payrollId) {
    throw new Error('payroll_id is required');
  }
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: PAYROLL_RUNS_SHEET,
    requiredHeaders: PAYROLL_RUNS_HEADERS,
    valuesByHeader: {
      payroll_id: payrollId,
      pay_date: row.pay_date ?? row.payDate ?? '',
      period_start: row.period_start ?? row.periodStart ?? '',
      period_end: row.period_end ?? row.periodEnd ?? '',
      tutor: row.tutor ?? '',
      tutor_short_name: row.tutor_short_name ?? row.tutorShortName ?? '',
      teacher_id: row.teacher_id ?? row.teacherId ?? '',
      invoice_cadence: row.invoice_cadence ?? row.invoiceCadence ?? '',
      pay_model: row.pay_model ?? row.payModel ?? '',
      lesson_count: row.lesson_count ?? row.lessonCount ?? '',
      review_lesson_count: row.review_lesson_count ?? row.reviewLessonCount ?? '',
      teaching_minutes: row.teaching_minutes ?? row.teachingMinutes ?? '',
      expected_amount: row.expected_amount ?? row.expectedAmount ?? '',
      adjustment_amount: row.adjustment_amount ?? row.adjustmentAmount ?? '',
      final_amount: row.final_amount ?? row.finalAmount ?? '',
      status: row.status ?? 'draft',
      invoice_status: row.invoice_status ?? row.invoiceStatus ?? '',
      payment_route: row.payment_route ?? row.paymentRoute ?? 'normal',
      statement_sent_at: row.statement_sent_at ?? row.statementSentAt ?? '',
      statement_sent_by: row.statement_sent_by ?? row.statementSentBy ?? '',
      statement_delivery_status: row.statement_delivery_status ?? row.statementDeliveryStatus ?? '',
      statement_delivery_channel: row.statement_delivery_channel ?? row.statementDeliveryChannel ?? '',
      statement_delivery_to: row.statement_delivery_to ?? row.statementDeliveryTo ?? '',
      statement_delivery_attempted_at: row.statement_delivery_attempted_at ?? row.statementDeliveryAttemptedAt ?? '',
      statement_delivery_message_id: row.statement_delivery_message_id ?? row.statementDeliveryMessageId ?? '',
      statement_delivery_error: row.statement_delivery_error ?? row.statementDeliveryError ?? '',
      notes: row.notes ?? '',
      reviewed_at: row.reviewed_at ?? row.reviewedAt ?? '',
      reviewed_by: row.reviewed_by ?? row.reviewedBy ?? '',
      paid_at: row.paid_at ?? row.paidAt ?? '',
      paid_by: row.paid_by ?? row.paidBy ?? '',
      source: row.source ?? 'mms_attendance_preview',
      created_at: row.created_at ?? row.createdAt ?? '',
      updated_at: row.updated_at ?? row.updatedAt ?? '',
      tutor_response: row.tutor_response ?? row.tutorResponse ?? '',
      tutor_responded_at: row.tutor_responded_at ?? row.tutorRespondedAt ?? '',
      tutor_note: row.tutor_note ?? row.tutorNote ?? '',
      tutor_response_source: row.tutor_response_source ?? row.tutorResponseSource ?? '',
      paid_via: row.paid_via ?? row.paidVia ?? '',
    },
    matchesRow: (entry, headers) => `${entry[headers.indexOf('payroll_id')] || ''}`.trim() === payrollId,
  });
}

export async function upsertExpenseRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const nameKey = `${row.name || ''}`.trim().toLowerCase();
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: EXPENSES_SHEET,
    requiredHeaders: EXPENSES_HEADERS,
    valuesByHeader: {
      name: `${row.name || ''}`.trim(),
      amount: row.amount ?? '',
      period: `${row.period || 'monthly'}`.trim(),
      category: `${row.category || ''}`.trim(),
      notes: row.notes ?? '',
    },
    matchesRow: (entry, headers) => `${entry[headers.indexOf('name')] || ''}`.trim().toLowerCase() === nameKey,
  });
}

export async function deleteExpenseRow(name) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const nameKey = `${name || ''}`.trim().toLowerCase();
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: EXPENSES_SHEET,
    requiredHeaders: EXPENSES_HEADERS,
  });
  const values = await getSheetValues(EXPENSES_SHEET);
  const [, ...rows] = values;
  const nameIdx = headers.indexOf('name');
  const rowIndex = rows.findIndex((entry) => `${entry[nameIdx] || ''}`.trim().toLowerCase() === nameKey);
  if (rowIndex === -1) {
    return { deleted: false };
  }

  const metadata = await sheets.spreadsheets.get({ spreadsheetId, ranges: [EXPENSES_SHEET], includeGridData: false });
  const sheet = metadata.data.sheets?.find((entry) => entry.properties?.title === EXPENSES_SHEET);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') {
    throw new Error('Could not resolve Expenses sheet metadata');
  }

  const targetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: targetRowNumber - 1, endIndex: targetRowNumber },
          },
        },
      ],
    },
  });
  invalidateSheetReadCache(EXPENSES_SHEET);
  return { deleted: true, rowNumber: targetRowNumber };
}

export async function appendExpenseLogRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: EXPENSE_LOG_SHEET,
    requiredHeaders: EXPENSE_LOG_HEADERS,
  });
  const nextRow = headers.map((header) => row[header] ?? '');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: buildSheetRange(EXPENSE_LOG_SHEET, 'A:A'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [nextRow],
    },
  });
  invalidateSheetReadCache(EXPENSE_LOG_SHEET);
}

export async function deleteExpenseLogRow(expenseId) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();
  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }
  const idKey = `${expenseId || ''}`.trim();
  if (!idKey) return { deleted: false };
  const headers = await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: EXPENSE_LOG_SHEET,
    requiredHeaders: EXPENSE_LOG_HEADERS,
  });
  const values = await getSheetValues(EXPENSE_LOG_SHEET);
  const [, ...rows] = values;
  const idIdx = headers.indexOf('expense_id');
  const rowIndex = rows.findIndex((entry) => `${entry[idIdx] || ''}`.trim() === idKey);
  if (rowIndex === -1) return { deleted: false };

  const metadata = await sheets.spreadsheets.get({ spreadsheetId, ranges: [EXPENSE_LOG_SHEET], includeGridData: false });
  const sheet = metadata.data.sheets?.find((entry) => entry.properties?.title === EXPENSE_LOG_SHEET);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') {
    throw new Error('Could not resolve Expense_Log sheet metadata');
  }

  const targetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: targetRowNumber - 1, endIndex: targetRowNumber },
          },
        },
      ],
    },
  });
  invalidateSheetReadCache(EXPENSE_LOG_SHEET);
  return { deleted: true, rowNumber: targetRowNumber };
}
