/** @fileoverview Admin-gated save, delete, and group-messaged marking for a tutor absence workflow. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import {
  deleteTutorAbsenceWorkflow,
  markTutorAbsenceCancellationGroupMessaged,
  saveTutorAbsenceWorkflow,
} from '@/lib/admin/tutor-absence';

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const action = `${body?.action || ''}`.trim();
  if (action === 'mark_group_messaged') {
    try {
      const result = await markTutorAbsenceCancellationGroupMessaged({
        groupKey: body?.groupKey || '',
        updatedBy: session.user.email || '',
      });
      return Response.json({ success: true, ...result });
    } catch (error) {
      return Response.json({ error: error.message || 'Grouped message update failed' }, { status: 500 });
    }
  }

  const absenceId = `${body?.absenceId || ''}`.trim();

  if (!absenceId) {
    return Response.json({ error: 'absenceId is required' }, { status: 400 });
  }

  try {
    const state = await saveTutorAbsenceWorkflow({
      absenceId,
      tutorShortName: body?.tutorShortName || '',
      tutorName: body?.tutorName || '',
      absenceDate: body?.absenceDate || '',
      status: body?.status || '',
      decision: body?.decision || '',
      coverTutorShortName: body?.coverTutorShortName || '',
      coverTutorName: body?.coverTutorName || '',
      affectedLessons: body?.affectedLessons || [],
      messageState: body?.messageState || {},
      note: body?.note || '',
      updatedBy: session.user.email || '',
    });

    return Response.json({ success: true, state });
  } catch (error) {
    return Response.json(
      { error: error.message || 'Tutor absence save failed' },
      { status: error.code === 'TUTOR_ABSENCE_NOT_READY' ? 409 : 500 },
    );
  }
}

export async function DELETE(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const absenceId = `${body?.absenceId || ''}`.trim();

  if (!absenceId) {
    return Response.json({ error: 'absenceId is required' }, { status: 400 });
  }

  try {
    const result = await deleteTutorAbsenceWorkflow(absenceId);
    return Response.json({ success: true, ...result });
  } catch (error) {
    return Response.json({ error: error.message || 'Tutor absence delete failed' }, { status: 500 });
  }
}
