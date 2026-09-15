/** @fileoverview Sequences one claimed practice-note delivery per member of a shared lesson and aggregates the per-student outcome. */

// Each member of a group lesson is delivered through the same claimed path as a
// single student: its own delivery key, its own claim, its own attendance write
// and its own log row. Only the orchestration is new, so the idempotency and
// partial-failure guarantees are the ones already in use, not a second copy of
// them.
//
// Members are delivered one at a time on purpose. Two concurrent writes to the
// same MMS event raced in testing-shaped ways we cannot observe from here, and a
// group is two or five students — there is nothing to gain from parallelism and
// a real risk in it.
//
// A member that fails never blocks the rest. Marking one sister present must not
// depend on the other sister's email succeeding, and a half-done group where the
// failure is named is far more recoverable than one that stopped at the first
// error with no record of what had already happened.
export async function runPracticeNoteGroupDelivery({ plan = [], deliverMember } = {}) {
  if (typeof deliverMember !== 'function') {
    throw new Error('runPracticeNoteGroupDelivery requires a deliverMember function');
  }

  const results = [];
  for (const entry of plan) {
    try {
      const outcome = await deliverMember(entry);
      results.push({
        studentMmsId: entry.studentMmsId,
        studentName: entry.studentName,
        attendanceId: entry.attendanceId,
        emailRole: entry.emailRole,
        emailReason: entry.emailReason || '',
        ...outcome,
      });
    } catch (error) {
      results.push({
        studentMmsId: entry.studentMmsId,
        studentName: entry.studentName,
        attendanceId: entry.attendanceId,
        emailRole: entry.emailRole,
        emailReason: entry.emailReason || '',
        ok: false,
        attendanceSaved: false,
        emailSent: false,
        error: error?.message || `${error || ''}`.trim() || 'Practice note delivery failed.',
      });
    }
  }

  return summarisePracticeNoteGroupDelivery(results);
}

// One readable verdict for the tutor, plus the per-student detail behind it.
// "Partial" is its own state rather than a flavour of success: a group where one
// sister was marked and the other was not is precisely the situation that must
// not be reported as done.
export function summarisePracticeNoteGroupDelivery(results = []) {
  const attendanceSaved = results.filter((result) => result.attendanceSaved);
  const emailsSent = results.filter((result) => result.emailSent);
  const failures = results.filter((result) => result.ok === false);

  const status = !results.length
    ? 'empty'
    : failures.length === 0
      ? 'completed'
      : failures.length === results.length
        ? 'failed'
        : 'partial';

  return {
    status,
    ok: status === 'completed',
    partialSuccess: status === 'partial',
    results,
    attendanceSavedCount: attendanceSaved.length,
    emailSentCount: emailsSent.length,
    failureCount: failures.length,
    // Named, because a group failure that does not say who failed leaves the
    // tutor checking MMS for all of them.
    failedStudents: failures.map((result) => result.studentName || result.studentMmsId).filter(Boolean),
    message: buildGroupDeliveryMessage({ status, results, attendanceSaved, emailsSent, failures }),
  };
}

function nameList(items = []) {
  const list = items.map((item) => `${item || ''}`.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function buildGroupDeliveryMessage({ status, results, attendanceSaved, emailsSent, failures }) {
  if (status === 'empty') return 'No students were delivered.';

  if (status === 'failed') {
    return `Nothing was saved for ${nameList(results.map((result) => result.studentName))}. Check MMS before retrying.`;
  }

  const marked = `${nameList(attendanceSaved.map((result) => result.studentName))} marked in MMS`;
  const emailed = emailsSent.length
    ? `, ${emailsSent.length === 1 ? 'one email' : `${emailsSent.length} emails`} sent`
    : ', no email sent';

  if (status === 'partial') {
    return `${marked}${emailed}. Still to sort: ${nameList(failures.map((result) => result.studentName))}.`;
  }

  return `${marked}${emailed}.`;
}
