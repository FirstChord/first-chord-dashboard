/** @fileoverview Admin-approved Gmail send for one reviewed tutor statement, with delivery audit state. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { sendTutorStatementEmail } from '@/lib/admin/tutor-statement-email';

const MESSAGES = {
  already_sent: 'This statement has already been sent.',
  manual_follow_up: 'A previous email attempt may have reached Gmail. Check the Sent folder before doing anything else.',
  contact_email_missing: 'Add a payroll contact email for this tutor first.',
  contact_email_unverified: 'Verify this tutor’s payroll contact email first.',
  not_reviewed: 'Review and freeze this statement before sending it.',
  gmail_not_configured: 'The First Chord Gmail sender is not configured.',
  statement_secret_missing: 'The private statement link cannot be created on this service.',
  delivery_unknown: 'Gmail did not return a definite result. Check the Sent folder; the dashboard will not retry automatically.',
};

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await sendTutorStatementEmail({
    payrollId: body.payrollId,
    actorEmail: session.user.email || '',
  });
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason, error: MESSAGES[result.reason] || 'The statement email could not be sent.' }, { status: result.reason === 'already_sent' ? 409 : 400 });
  }
  return Response.json(result);
}
