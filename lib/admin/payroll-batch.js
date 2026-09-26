/** @fileoverview Server boundary for checking MMS and recording the exact admin-downloaded Wise batch. */
import { ADMIN_TUTORS } from './tutors-data.js';
import { getPayrollRunRows, getTutorWiseRows, getTutorPayRows, upsertPayrollRunRow } from '@/lib/admin/sheets';
import { searchAttendanceForPayroll } from '@/lib/admin/mms';
import { parseTutorPay } from './cost-helpers.mjs';
import { buildPayrollPreview, normalisePayrollRunRow } from './payroll-helpers.mjs';
import { shiftPayrollDate } from './payroll-cycle-helpers.mjs';
import { preparePayrollBatch, recordPayrollBatchPaid } from './payroll-batch-runner.mjs';

const loadRuns = () => getPayrollRunRows({ force: true });
export async function downloadReviewedPayrollBatch({ expectedFingerprint, expectedIds, actor }) {
  const tutorPay = parseTutorPay(await getTutorPayRows());
  return preparePayrollBatch({
    expectedFingerprint, expectedIds, actor, secret: process.env.NEXTAUTH_SECRET,
    loadRuns, loadWise: () => getTutorWiseRows({ force: true }),
    checkAttendance: async (raw, savedRuns) => {
      const row = normalisePayrollRunRow(raw);
      const teacherId = ADMIN_TUTORS[row.tutorShortName]?.teacherId;
      const span = (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000;
      if (!teacherId || !Number.isFinite(span) || span < 0 || span > 366) throw new Error('Check the tutor and historical period before payment.');
      const attendanceRows = await searchAttendanceForPayroll({ startDate: row.periodStart, endDate: row.periodEnd, teacherIds: [teacherId], forceRefresh: true });
      const preview = buildPayrollPreview({ attendanceRows, tutorPay, savedRuns, payDate: shiftPayrollDate(row.periodEnd, 1),
        maxLookbackDays: 366, overrides: { [row.tutorShortName]: { start: row.periodStart, end: row.periodEnd } } });
      const checked = preview.rows.find((entry) => entry.payrollId === row.payrollId);
      if (!checked || checked.attendanceChanged || checked.reviewPastCount || checked.windowCapped || checked.overlapsPaid)
        throw new Error(`${row.tutor}: attendance needs a fresh review before payment. Refresh MMS and check the statement.`);
    },
  });
}
export async function recordDownloadedPayrollBatch({ token, actor }) {
  return recordPayrollBatchPaid({ token, actor, secret: process.env.NEXTAUTH_SECRET, loadRuns, saveRun: upsertPayrollRunRow });
}
