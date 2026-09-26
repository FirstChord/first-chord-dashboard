/** @fileoverview Admin-only reviewed Wise file preparation and explicit recording of its exact signed batch. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { downloadReviewedPayrollBatch, recordDownloadedPayrollBatch } from '@/lib/admin/payroll-batch';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ ok: false, error: 'Not authorised' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'download' && typeof body.expectedFingerprint === 'string' && Array.isArray(body.expectedIds) && body.expectedIds.length <= 100) {
      return Response.json({ ok: true, ...await downloadReviewedPayrollBatch({ expectedFingerprint: body.expectedFingerprint, expectedIds: body.expectedIds, actor: session.user.email }) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'record_paid' && body.confirmedPaid === true) {
      const result = await recordDownloadedPayrollBatch({ token: body.token, actor: session.user.email });
      return Response.json(result, { status: result.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: false, error: 'Review the batch and confirm the intended action.' }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'The batch could not be checked.' }, { status: 409 });
  }
}
