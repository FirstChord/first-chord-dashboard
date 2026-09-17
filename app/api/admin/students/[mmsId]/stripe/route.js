/** @fileoverview Admin-gated live Stripe snapshot for a single student. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { assessPaymentSetupCompletion } from '@/lib/admin/payment-summary.mjs';
import { getAdminStudentByMmsId } from '@/lib/admin/students';
import { getLiveStripeSnapshot } from '@/lib/admin/stripe';

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const student = await getAdminStudentByMmsId(params.mmsId);

  if (!student) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const reviewSetup = new URL(request.url).searchParams.get('reviewSetup') === '1';
    const result = await getLiveStripeSnapshot(student, { allowSetupPending: reviewSetup });
    return Response.json({
      ...result,
      setupCompletion: reviewSetup
        ? assessPaymentSetupCompletion({
          student,
          snapshot: result.snapshot,
          issues: result.issues,
        })
        : null,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Stripe snapshot failed' }, { status: 500 });
  }
}
