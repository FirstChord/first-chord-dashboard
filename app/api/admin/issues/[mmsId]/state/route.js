/** @fileoverview Admin-gated endpoint moving one issue-queue row to a new status with an event-log entry. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { buildIssueStateChange, issueSourceMatchesExpected } from '@/lib/admin/issue-queue';
import { getIssueQueueRows, appendEventLogRow, upsertIssueQueueRow } from '@/lib/admin/sheets';

export async function POST(request, { params }) {
  const session = await getServerSession(authOptions);
  const { mmsId } = await params;

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const issueId = `${body?.issueId || ''}`.trim();
  const nextStatus = `${body?.nextStatus || ''}`.trim().toLowerCase();
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  if (!issueId) {
    return Response.json({ error: 'issueId is required' }, { status: 400 });
  }

  if (!['acknowledged', 'ignored', 'resolved'].includes(nextStatus)) {
    return Response.json({ error: 'Unsupported issue status' }, { status: 400 });
  }

  if (
    Object.prototype.hasOwnProperty.call(body || {}, 'expectedSourcePresent')
    && typeof body.expectedSourcePresent !== 'boolean'
  ) {
    return Response.json({ error: 'expectedSourcePresent must be a boolean' }, { status: 400 });
  }

  try {
    const queueRows = await getIssueQueueRows();
    const issueRow = queueRows.find((row) => row.issueId === issueId && row.mmsId === mmsId);

    if (!issueRow) {
      return Response.json({ error: 'Issue was not found in the queue' }, { status: 404 });
    }

    if (!issueSourceMatchesExpected(issueRow, body?.expectedSourcePresent)) {
      return Response.json({
        error: 'The source state changed after this action was prepared. Refresh the case and review it again.',
      }, { status: 409 });
    }

    const { nextRow, eventRow } = buildIssueStateChange({
      issueRow,
      nextStatus,
      note,
      actorEmail: session.user.email || '',
      now: new Date().toISOString(),
    });

    await upsertIssueQueueRow(nextRow);
    await appendEventLogRow(eventRow);

    return Response.json({
      success: true,
      issue: {
        issueId: nextRow.issueId,
        mmsId: nextRow.mmsId,
        status: nextRow.status,
        sourcePresent: nextRow.sourcePresent === 'true',
        resolutionNote: nextRow.resolutionNote || '',
        updatedAt: nextRow.updatedAt,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Issue update failed' }, { status: 500 });
  }
}
