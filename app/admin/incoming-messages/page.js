import { getActiveTutorOptions } from '@/lib/admin/tutors';
import AdminIncomingMessagesPageClient from '@/components/admin/AdminIncomingMessagesPageClient';
import { getBridgeStatus, getIncomingMessageInbox, getWhatsappGroupMap } from '@/lib/admin/incoming-messages';
import { getIncomingReplyProposals } from '@/lib/admin/incoming-reply-proposals';
import { isIncomingReplyDraftingConfigured } from '@/lib/admin/incoming-reply-ai-provider.mjs';
import { getOperationalAdminStudents } from '@/lib/admin/students';

export default async function AdminIncomingMessagesPage() {
  let inbox = [];
  let groupMap = [];
  let students = [];
  let tutors = [];
  let bridgeStatus = null;
  let replyProposals = {};
  let error = '';
  const replyDraftingAvailable = isIncomingReplyDraftingConfigured();
  try {
    let proposalsResult;
    [inbox, groupMap, students, bridgeStatus, proposalsResult, tutors] = await Promise.all([
      getIncomingMessageInbox(),
      getWhatsappGroupMap(),
      getOperationalAdminStudents(),
      getBridgeStatus().catch(() => null),
      // Always load existing proposals. Turning the model flag off is the
      // rollback path for new drafts; it must not strand suggestions that
      // still need a human use/edit/discard decision.
      getIncomingReplyProposals().catch(() => ({ openByIncomingId: {} })),
      getActiveTutorOptions().catch(() => {
        error = 'Tutor list unavailable. Refresh to link tutor groups; existing messages are still shown.';
        return [];
      }),
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
      initialGroupMap={groupMap}
      studentOptions={studentOptions}
      tutorOptions={tutors.map(({ shortName, fullName }) => ({ shortName, fullName }))}
      bridgeStatus={bridgeStatus}
      error={error}
      initialReplyProposals={replyProposals}
      replyDraftingAvailable={replyDraftingAvailable}
    />
  );
}
