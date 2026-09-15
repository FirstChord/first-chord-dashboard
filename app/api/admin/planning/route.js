/** @fileoverview Admin-gated planning dashboard read plus item save, status update, and progress append, syncing tutor-absence handoffs. */
import { planningSaveErrorBody } from '@/lib/admin/planning-duplicate-helpers.mjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { isSettledPlanningStatus } from '@/lib/admin/planning-helpers.mjs';
import {
  addPlanningProgress,
  getPlanningDashboard,
  savePlanningItem,
  updateFirstLessonLoopStep,
  updatePlanningStatus,
} from '@/lib/admin/planning';
import { resolveTutorAbsenceForCaptureCard, syncTutorAbsenceHandoffsFromPlanning } from '@/lib/admin/tutor-absence';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return Response.json({ success: true, planning: await getPlanningDashboard({ includeFirstLessonLoops: true }) });
  } catch (error) {
    return Response.json({ error: error.message || 'Planning load failed' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const mode = `${body?.mode || 'save'}`.trim();
  const actorEmail = session.user.email || '';

  try {
    if (mode === 'first_lesson_step') {
      await updateFirstLessonLoopStep({
        planningId: `${body?.planningId || ''}`.trim(),
        step: body?.step || '',
        value: body?.value,
        actorEmail,
      });
    } else if (mode === 'progress') {
      await addPlanningProgress({
        planningId: `${body?.planningId || ''}`.trim(),
        progressNote: body?.progressNote || '',
        progressType: body?.progressType || 'note',
        nextAction: body?.nextAction,
        targetDate: body?.targetDate,
        status: body?.status,
        actorEmail,
      });
    } else if (mode === 'status') {
      const planningId = `${body?.planningId || ''}`.trim();
      const status = `${body?.status || ''}`.trim();
      await updatePlanningStatus({
        planningId,
        status,
        progressNote: body?.progressNote || '',
        actorEmail,
      });
      // Parking settles a card as surely as finishing it, so it has to run the
      // handoff too. Only syncing on 'done' meant parking the last linked pause
      // card left its absence open with nothing left to click.
      if (isSettledPlanningStatus(status)) {
        if (status === 'done') {
          await resolveTutorAbsenceForCaptureCard({ planningId, actorEmail });
        }
        await syncTutorAbsenceHandoffsFromPlanning({ actorEmail });
      }
    } else {
      await savePlanningItem({
        planningId: `${body?.planningId || ''}`.trim(),
        item: body?.item || {},
        progressNote: body?.progressNote || '',
        actorEmail,
      });
    }

    return Response.json({ success: true, planning: await getPlanningDashboard({ includeFirstLessonLoops: true }) });
  } catch (error) {
    return Response.json(planningSaveErrorBody(error, 'Planning save failed'), { status: error.status || 500 });
  }
}
