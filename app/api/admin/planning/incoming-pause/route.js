/** @fileoverview Admin-only creation of a reviewed structured pause from unchanged inbox evidence, with no payment or sending actions. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { saveIncomingPausePlanning } from '@/lib/admin/incoming-pause';
import { getPlanningDashboard } from '@/lib/admin/planning';
import { planningSaveErrorBody } from '@/lib/admin/planning-duplicate-helpers.mjs';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const result = await saveIncomingPausePlanning({ ...body, actorEmail: session.user.email || '' });
    return Response.json({ success: true, ...result, planning: await getPlanningDashboard({ includeFirstLessonLoops: true }).catch(() => null) });
  } catch (error) {
    return Response.json(planningSaveErrorBody(error, 'Pause planning save failed'), { status: error.status || 500 });
  }
}
