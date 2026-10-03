/** @fileoverview Explicit admin send of one missing-records checklist, never a pay statement. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { sendPayrollRecordsNudge } from '@/lib/admin/payroll-record-actions';

const MESSAGES = {
  not_ready: 'This period is not ready for a records email.',
  nothing_missing: 'The records are now complete.',
  uncertain_record: 'A lesson lacks an exact MMS ID or date. Check it at school before emailing.',
  unverified_contact: 'Verify the tutor’s payroll email first.',
  contact_missing: 'The tutor’s payroll contact is missing.',
  check_gmail: 'The email result is uncertain. Check Gmail Sent before trying again.',
  already_sent: 'This checklist has already been emailed. Refresh if the records changed.',
  gmail_not_configured: 'The First Chord email sender is not configured.',
  changed: 'Payroll changed. Refresh and check again.',
  period_check: 'Finish the period checks first.',
};

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const result = await sendPayrollRecordsNudge({ context: body, actor: session.user.email || '' });
    return Response.json(result.ok ? result : { ...result, error: MESSAGES[result.reason] || 'Could not send the checklist.' }, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Could not send the checklist.' }, { status: 400 });
  }
}
