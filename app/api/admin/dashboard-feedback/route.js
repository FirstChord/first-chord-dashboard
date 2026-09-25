/** @fileoverview Admin-gated dashboard glitch and improvement capture into the Planning Inbox. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { createDashboardFeedbackPostHandler } from '@/lib/admin/dashboard-feedback.mjs';
import { savePlanningItem } from '@/lib/admin/planning';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const handle = createDashboardFeedbackPostHandler({
    getSession: async () => session,
    savePlanningItem,
  });
  return handle(request);
}
