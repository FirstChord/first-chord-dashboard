import AdminIncomingMessagesPageClient from '@/components/admin/AdminIncomingMessagesPageClient';
import { getBridgeStatus, getIncomingMessageInbox } from '@/lib/admin/incoming-messages';
import { getIncomingReplyProposals } from '@/lib/admin/incoming-reply-proposals';
import { isIncomingReplyDraftingConfigured } from '@/lib/admin/incoming-reply-ai-provider.mjs';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  BRIDGE_STATUS_SHEET,
  INCOMING_MESSAGE_INBOX_SHEET,
  prefetchSheetValues,
  PROPOSALS_SHEET,
  WAITING_LIST_STATE_SHEET,
} from '@/lib/admin/sheets';

export default async function AdminIncomingMessagesPage() {
  let inbox = [];
  let students = [];
  let bridgeStatus = null;
  let replyProposals = {};
  let error = '';
  const replyDraftingAvailable = isIncomingReplyDraftingConfigured();
  try {
    let proposalsResult;
    // Warm the everyday inbox in one Sheets request. Planning history and the
    // large group map are loaded only if the reviewer opens those views.
    await prefetchSheetValues([
      INCOMING_MESSAGE_INBOX_SHEET,
      PROPOSALS_SHEET,
      BRIDGE_STATUS_SHEET,
      'Students',
      'Review_Flags',
      "'Pause History'",
      WAITING_LIST_STATE_SHEET,
    ]);
    [inbox, students, bridgeStatus, proposalsResult] = await Promise.all([
      getIncomingMessageInbox({ statusScope: 'active' }),
      getOperationalAdminStudents(),
      getBridgeStatus().catch(() => null),
      // Always load existing proposals. Turning the model flag off is the
      // rollback path for new drafts; it must not strand suggestions that
      // still need a human use/edit/discard decision.
      getIncomingReplyProposals().catch(() => ({ openByIncomingId: {} })),
    ]);
    replyProposals = proposalsResult.openByIncomingId || {};
  } catch (caught) {
    error = caught.message || 'Could not load incoming messages';
  }

  const studentOptions = students.map((student) => ({
    mmsId: student.mmsId,
    fcStudentId: student.fcStudentId,
    fullName: student.fullName,
    tutor: student.tutor,
    parentName: [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ').trim(),
    parentPhone: student.contactNumber,
  }));

  return (
    <AdminIncomingMessagesPageClient
      initialInbox={inbox}
      studentOptions={studentOptions}
      bridgeStatus={bridgeStatus}
      error={error}
      initialReplyProposals={replyProposals}
      replyDraftingAvailable={replyDraftingAvailable}
    />
  );
}
