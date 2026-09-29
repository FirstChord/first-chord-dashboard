/** @fileoverview Generate an admin-reviewed, read-only tutor-cover teaching brief from exact saved lessons. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { createCoverHandover } from '@/lib/admin/cover-handover';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  try {
    const handover = await createCoverHandover({
      absenceId: `${body?.absenceId || ''}`.trim(),
      expectedUpdatedAt: `${body?.expectedUpdatedAt || ''}`.trim(),
    });
    return Response.json(handover, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ error: error.message || 'The handover could not be created.' }, { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
