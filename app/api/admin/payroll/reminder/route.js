/** @fileoverview Records human-copied or explicitly sent private tutor reminders; never sends WhatsApp messages. */
import { randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { getPayrollRunRows, appendEventLogRow } from '@/lib/admin/sheets';
import { recordTutorStatementSent } from '@/lib/admin/tutor-statement';
import { recordPayrollReminder } from '@/lib/admin/payroll-reminder-runner.mjs';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ ok: false, error: 'Not authorised' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    const result = await recordPayrollReminder({ payrollId: body.payrollId, fingerprint: body.fingerprint, action: body.action,
      revised: body.revised, actor: session.user.email, loadRuns: () => getPayrollRunRows({ force: true }), markSent: recordTutorStatementSent,
      appendEvent: (event) => appendEventLogRow({ ...event, eventId: `evt_${randomUUID()}` }),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Could not record this reminder.' }, { status: 409 });
  }
}
