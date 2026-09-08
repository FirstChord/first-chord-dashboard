/** @fileoverview Incoming-message inbox endpoint covering ingest, review, correction, snooze, planning conversion, and WhatsApp group sync. */
import { planningSaveErrorBody } from '@/lib/admin/planning-duplicate-helpers.mjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { buildBridgeMutationResponse } from '@/lib/admin/incoming-route-helpers.mjs';
import {
  addStudentToGroup,
  captureIncomingMessage,
  convertIncomingMessageToPlanning,
  correctIncomingMessage,
  deleteIncomingMessage,
  getConfirmedGroupChatIds,
  getIncomingMessageInbox,
  getWhatsappGroupMap,
  recordBridgeStatus,
  reviewWhatsappGroup,
  snoozeIncomingMessage,
  syncWhatsappGroups,
  updateIncomingMessageReview,
  updateIncomingMessageText,
} from '@/lib/admin/incoming-messages';

function hasValidIngestSecret(request) {
  const configured = `${process.env.INCOMING_MESSAGE_INGEST_SECRET || ''}`.trim();
  if (!configured) return false;
  const supplied = `${request.headers.get('x-firstchord-incoming-secret') || ''}`.trim();
  return supplied && supplied === configured;
}

export async function GET(request) {
  // The bridge polls this (secret-authenticated) to learn which chats it may
  // auto-capture from — confirmed FC lesson groups only, ids only.
  const mode = new URL(request.url).searchParams.get('mode') || '';
  if (mode === 'confirmed_groups') {
    if (!hasValidIngestSecret(request)) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.isAdmin) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    try {
      const chatIds = await getConfirmedGroupChatIds();
      return Response.json({ success: true, chatIds });
    } catch (error) {
      return Response.json({ error: error.message || 'Confirmed group list failed' }, { status: 500 });
    }
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [inbox, groupMap] = await Promise.all([
      getIncomingMessageInbox(),
      getWhatsappGroupMap(),
    ]);
    return Response.json({ success: true, inbox, groupMap });
  } catch (error) {
    return Response.json({ error: error.message || 'Incoming inbox load failed' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean(session?.user?.isAdmin);
  const isBridge = hasValidIngestSecret(request);

  if (!isAdmin && !isBridge) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = `${body?.mode || 'capture'}`.trim();
  let extra = {};

  // Heartbeats are frequent and tiny — record and return without the full
  // inbox reload the interactive modes need.
  if (mode === 'bridge_status') {
    try {
      await recordBridgeStatus(body || {});
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ error: error.message || 'Bridge status save failed' }, { status: 500 });
    }
  }

  try {
    if (mode === 'review') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required for review changes' }, { status: 401 });
      }
      await updateIncomingMessageReview({
        incomingId: `${body?.incomingId || ''}`.trim(),
        status: body?.status || '',
        reviewNote: body?.reviewNote || '',
        createdPlanningId: body?.createdPlanningId || '',
        resolutionType: body?.resolutionType || '',
        classificationActionability: body?.classificationActionability || '',
        actorEmail: session.user.email || '',
      });
    } else if (mode === 'snooze') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required to move messages to Later' }, { status: 401 });
      }
      await snoozeIncomingMessage({
        incomingId: `${body?.incomingId || ''}`.trim(),
        snoozedUntil: `${body?.snoozedUntil || ''}`.trim(),
        actorEmail: session.user.email || '',
      });
    } else if (mode === 'correct') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required for message correction' }, { status: 401 });
      }
      await correctIncomingMessage({
        incomingId: `${body?.incomingId || ''}`.trim(),
        category: body?.category || '',
        actionability: body?.actionability || '',
        matchedMmsId: Object.hasOwn(body || {}, 'matchedMmsId') ? body.matchedMmsId : null,
        reviewNote: body?.reviewNote || '',
        confirmGroupMap: Boolean(body?.confirmGroupMap),
        actorEmail: session.user.email || '',
        status: body?.status || 'needs_review',
      });
    } else if (mode === 'update_text') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required to edit message text' }, { status: 401 });
      }
      await updateIncomingMessageText({
        incomingId: `${body?.incomingId || ''}`.trim(),
        messageText: body?.messageText || '',
        actorEmail: session.user.email || '',
      });
    } else if (mode === 'sync_groups') {
      // Bridge (secret) or admin can push the group dump.
      const result = await syncWhatsappGroups({
        groups: Array.isArray(body?.groups) ? body.groups : [],
        actorEmail: isAdmin ? session.user.email || '' : 'incoming-message-bridge',
      });
      extra = { groupSyncSummary: result.summary };
    } else if (mode === 'review_group') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required for group review' }, { status: 401 });
      }
      await reviewWhatsappGroup({
        chatId: `${body?.chatId || ''}`.trim(),
        matchedMmsId: Object.hasOwn(body || {}, 'matchedMmsId') ? body.matchedMmsId : null,
        status: body?.status || 'confirmed',
        actorEmail: session.user.email || '',
      });
    } else if (mode === 'add_group_student') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required to edit a group' }, { status: 401 });
      }
      await addStudentToGroup({
        chatId: `${body?.chatId || ''}`.trim(),
        mmsId: `${body?.mmsId || ''}`.trim(),
        actorEmail: session.user.email || '',
      });
    } else if (mode === 'convert') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required for planning conversion' }, { status: 401 });
      }
      const result = await convertIncomingMessageToPlanning({
        incomingId: `${body?.incomingId || ''}`.trim(),
        category: body?.category || '',
        actionability: body?.actionability || '',
        matchedMmsId: body?.matchedMmsId || '',
        reviewNote: body?.reviewNote || '',
        confirmGroupMap: Boolean(body?.confirmGroupMap),
        startDate: Object.hasOwn(body || {}, 'startDate') ? body.startDate : null,
        returnDate: Object.hasOwn(body || {}, 'returnDate') ? body.returnDate : null,
        reviewedReply: Object.hasOwn(body || {}, 'replyTemplate') ? body.replyTemplate : null,
        actorEmail: session.user.email || '',
      });
      extra = { planningId: result.planningId, replyTemplate: result.replyTemplate };
    } else if (mode === 'delete') {
      if (!isAdmin) {
        return Response.json({ error: 'Admin session required for message deletion' }, { status: 401 });
      }
      await deleteIncomingMessage({
        incomingId: `${body?.incomingId || ''}`.trim(),
      });
    } else {
      await captureIncomingMessage(body?.message || body || {}, {
        actorEmail: isAdmin ? session.user.email || '' : 'incoming-message-bridge',
      });
    }

    // The external bridge needs acknowledgement, not the admin inbox or group
    // map. Keep parent content and operational context inside the authenticated
    // dashboard. Group sync retains its small, non-sensitive summary because
    // the bridge uses it for operator diagnostics.
    if (isBridge && !isAdmin) {
      return Response.json(buildBridgeMutationResponse({
        mode,
        groupSyncSummary: extra.groupSyncSummary,
      }));
    }

    const [inbox, groupMap] = await Promise.all([
      getIncomingMessageInbox(),
      getWhatsappGroupMap(),
    ]);
    return Response.json({ success: true, inbox, groupMap, ...extra });
  } catch (error) {
    return Response.json(planningSaveErrorBody(error, 'Incoming message save failed'), { status: error.status || 500 });
  }
}
