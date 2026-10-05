/** @fileoverview Authenticated cancellation of a waiting per-period statement approval, never a provider email or payment. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { cancelDeferredPayroll } from '@/lib/admin/payroll-deferred-delivery';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!/^[a-f0-9-]{36}$/iu.test(`${body.id || ''}`)) return Response.json({ error: 'Refresh payroll and try again.' }, { status: 400 });
  try { return Response.json(await cancelDeferredPayroll({ id: body.id, actor: session.user.email || '' })); }
  catch (error) { return Response.json({ error: error.message || 'Could not cancel the approval.' }, { status: 409 }); }
}
