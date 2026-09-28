/** @fileoverview Admin-reviewed application of a saved tutor-cover decision to exact MMS lesson occurrences. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { applyTutorAbsenceMmsCover } from '@/lib/admin/tutor-absence';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  const absenceId = `${body?.absenceId || ''}`.trim();
  const expectedUpdatedAt = `${body?.expectedUpdatedAt || ''}`.trim();
  if (!absenceId || !expectedUpdatedAt) return Response.json({ error: 'Save the cover decision before updating MMS.' }, { status: 400 });
  try {
    const result = await applyTutorAbsenceMmsCover({ absenceId, expectedUpdatedAt, actorEmail: session.user.email || '' });
    return Response.json(result, { status: result.complete ? 200 : 409 });
  } catch (error) {
    return Response.json({ error: error.message || 'MMS cover update failed' }, { status: error.status || 503 });
  }
}
