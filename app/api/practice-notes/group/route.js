/** @fileoverview Practice-note delivery for a shared lesson: one note, attendance for every student on the MMS event, and one email per household. */
import {
  executePracticeNoteMmsTestWrite,
  previewPracticeNoteGroupWrite,
} from '@/lib/admin/mms';
import { normalisePracticeNoteAttendanceStatus } from '@/lib/admin/practice-notes-mms-helpers.mjs';
import { describePracticeNoteGroupDelivery } from '@/lib/admin/practice-notes-group-helpers.mjs';
import { runPracticeNoteGroupDelivery } from '@/lib/admin/practice-note-group-delivery.mjs';
import {
  getPracticeNotesEnabledTutors,
  resolvePracticeNotesStudentTutor,
  validateSelfAttestedPracticeNotesTutor,
} from '@/lib/admin/practice-notes-rollout.mjs';
import {
  buildPracticeNoteDeliveryKey,
  findPracticeNoteDeliveryRecord,
  isPracticeNoteDeliveryEmailSent,
  isPracticeNoteDeliveryInProgress,
  normalisePracticeNotePayload,
} from '@/lib/admin/practice-notes-helpers.mjs';
import { executeClaimedPracticeNoteDelivery } from '@/lib/admin/practice-note-delivery-workflow.mjs';
import {
  claimPracticeNoteDelivery,
  finalisePracticeNoteDeliveryClaim,
  releasePracticeNoteDeliveryClaim,
} from '@/lib/admin/practice-note-delivery-claims.mjs';
import { getPracticeNoteLogRows, upsertPracticeNoteLogRow } from '@/lib/admin/sheets';
import { authenticatePracticeChatRequest, corsHeaders } from '@/lib/admin/practice-chat-auth.mjs';
import { getAdminStudentByMmsId } from '@/lib/admin/students';
import { derivePaymentValueContext } from '@/lib/admin/payment-value-helpers.mjs';

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin') || ''),
  });
}

// The ukulele orchestra is adults with their own contacts, where a parent
// practice-note email is the wrong shape entirely. Asked of the pricing model's
// lesson kind rather than re-reading the instrument string here, so "what counts
// as an orchestra" keeps one home.
function isAttendanceOnlyLesson(student) {
  return derivePaymentValueContext(student || {}).lessonKind === 'orchestra';
}

export async function POST(request) {
  const origin = request.headers.get('origin') || '';
  const headers = corsHeaders(origin);
  const auth = authenticatePracticeChatRequest(request);

  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers });
  }

  try {
    const body = await request.json();
    const studentId = `${body.studentMmsId || body.studentId || ''}`.trim();
    const noteText = `${body.rawNoteText || body.noteText || ''}`.trim();
    const mode = body.mode === 'execute' ? 'execute' : 'dry_run';
    const targetAttendanceId = `${body.targetAttendanceId || ''}`.trim();
    const attendanceStatus = normalisePracticeNoteAttendanceStatus(body.attendanceStatus);
    const isAbsentNoMakeup = attendanceStatus === 'AbsentNoMakeup';
    const effectiveNoteText = noteText || (isAbsentNoMakeup
      ? 'Student marked absent with no makeup from Practice Chat. No practice note email sent.'
      : '');

    const leadStudent = await getAdminStudentByMmsId(studentId);
    if (!leadStudent) {
      return Response.json({ error: 'Student was not found in the dashboard Students sheet.' }, { status: 404, headers });
    }

    const enabledTutors = getPracticeNotesEnabledTutors();
    const studentTutor = resolvePracticeNotesStudentTutor(leadStudent);
    if (!(studentTutor.ok && enabledTutors.includes(studentTutor.tutor))) {
      return Response.json({
        error: `Practice Chat Level 2 is currently limited to enabled tutor students. Current enabled tutors: ${enabledTutors.join(', ')}.`,
        enabledTutors,
      }, { status: 403, headers });
    }

    if (!effectiveNoteText) {
      return Response.json({ error: 'noteText is required' }, { status: 400, headers });
    }

    const sendEmails = !isAttendanceOnlyLesson(leadStudent);
    const preview = await previewPracticeNoteGroupWrite({
      studentId,
      noteText: effectiveNoteText,
      targetAttendanceId,
      attendanceStatus,
      sendEmails,
    });
    const group = preview.group || {};

    // A lesson with one student is not a group. Say so rather than quietly
    // delivering one student through the group path, so the caller falls back to
    // the ordinary single-student endpoint and keeps its confirmation flow.
    if (!group.isGroup) {
      return Response.json({
        success: true,
        mode,
        isGroup: false,
        reason: 'single_student_lesson',
        message: 'Only one student is on this lesson, so there is no group to take attendance for.',
        group,
        targetAttendance: preview.targetAttendance,
      }, { headers });
    }

    const summaryLine = describePracticeNoteGroupDelivery({
      plan: group.plan || [],
      sendEmails: group.sendEmails,
      attendanceStatus,
    });

    if (mode !== 'execute') {
      return Response.json({
        success: true,
        mode,
        isGroup: true,
        dryRun: true,
        group,
        summary: summaryLine,
        targetAttendance: preview.targetAttendance,
        targetSelection: preview.targetSelection,
        candidateAttendances: preview.candidateAttendances,
        requestedAttendanceStatus: attendanceStatus,
      }, { headers });
    }

    // Execution confirmations mirror the single-student route: the tutor states
    // who they are, and explicitly confirms the group action. The recipient
    // confirmation is by count rather than by one address, because a group can
    // legitimately email several households.
    if (body.confirmGroupDelivery !== true) {
      return Response.json({
        error: 'confirmGroupDelivery must be true to mark attendance for the whole lesson and send the group email.',
      }, { status: 400, headers });
    }

    const selfAttestedTutor = validateSelfAttestedPracticeNotesTutor({
      tutor: body.tutor || body.noteSnapshot?.tutorName || '',
      student: leadStudent,
    });
    if (!selfAttestedTutor.ok) {
      return Response.json({
        error: 'The selected tutor does not match this lesson’s assigned tutor. Re-open Practice Chat from the correct tutor dashboard.',
      }, { status: 403, headers });
    }

    const snapshot = body.noteSnapshot || {};
    const existingRowsByStudent = new Map();

    const delivery = await runPracticeNoteGroupDelivery({
      plan: group.plan || [],
      deliverMember: async (entry) => {
        const memberNoteText = effectiveNoteText;
        const deliveryKey = buildPracticeNoteDeliveryKey({
          studentMmsId: entry.studentMmsId,
          mmsAttendanceId: entry.attendanceId,
          rawNoteText: memberNoteText,
        });

        let existingRows = existingRowsByStudent.get(entry.studentMmsId);
        if (!existingRows) {
          existingRows = await getPracticeNoteLogRows(entry.studentMmsId);
          existingRowsByStudent.set(entry.studentMmsId, existingRows);
        }
        const existingDelivery = findPracticeNoteDeliveryRecord(existingRows, deliveryKey);

        // Same idempotency contract as a single student: an identical note
        // already delivered for this exact lesson is a no-op, not a second email.
        const alreadyDone = existingDelivery && (isAbsentNoMakeup || entry.emailRole !== 'carrier'
          ? existingDelivery.mmsAttendanceSaved
          : isPracticeNoteDeliveryEmailSent(existingDelivery));
        if (alreadyDone) {
          return { ok: true, attendanceSaved: true, emailSent: false, skipped: true, reason: 'already_completed' };
        }
        if (existingDelivery && isPracticeNoteDeliveryInProgress(existingDelivery)) {
          return { ok: true, attendanceSaved: false, emailSent: false, skipped: true, reason: 'in_progress' };
        }

        const suppressEmailReason = entry.emailRole === 'carrier' ? '' : (entry.emailReason || 'covered_by_group_email');
        const basePayload = {
          ...snapshot,
          noteId: existingDelivery?.noteId || '',
          deliveryKey,
          studentMmsId: entry.studentMmsId,
          studentName: entry.studentName,
          tutorName: preview.targetAttendance?.teacherName || snapshot.tutorName || '',
          actingTutor: selfAttestedTutor.actingTutor || '',
          lessonDate: preview.targetAttendance?.eventStartDate || '',
          rawNoteText: memberNoteText,
          copiedToClipboard: false,
          attendanceStepOpened: true,
          mmsEventId: entry.eventId || group.eventId || '',
          mmsAttendanceId: entry.attendanceId,
          mmsAttendanceStatus: attendanceStatus,
          recipientProfileId: entry.recipient?.recipientProfileId || '',
          recipientName: entry.recipient?.name || '',
          recipientEmail: entry.recipient?.email || '',
          emailChannel: suppressEmailReason || isAbsentNoMakeup ? 'none' : 'gmail',
          source: 'practice_chat_group_lesson',
          createdAt: existingDelivery?.createdAt || snapshot.createdAt || new Date().toISOString(),
          userAgent: request.headers.get('user-agent') || '',
        };

        const claimNote = normalisePracticeNotePayload({
          ...basePayload,
          mmsAttendanceSaved: Boolean(existingDelivery?.mmsAttendanceSaved),
          operationStatus: 'in_progress',
        });
        if (claimNote.errors.length) {
          return { ok: false, attendanceSaved: false, emailSent: false, error: claimNote.errors.join(', ') };
        }

        const memberDelivery = await executeClaimedPracticeNoteDelivery({
          deliveryKey,
          saveClaim: async () => {
            const databaseClaim = await claimPracticeNoteDelivery({
              deliveryKey,
              actorTutor: selfAttestedTutor.actingTutor || 'Self-attested: unknown',
            });
            if (!databaseClaim.ok) return databaseClaim;
            try {
              const sheetClaim = await upsertPracticeNoteLogRow(claimNote);
              if (sheetClaim?.error) throw new Error(sheetClaim.error);
              return { ...sheetClaim, databaseClaim };
            } catch (error) {
              await releasePracticeNoteDeliveryClaim({ deliveryKey });
              throw error;
            }
          },
          executeDelivery: () => executePracticeNoteMmsTestWrite({
            studentId: entry.studentMmsId,
            noteText: memberNoteText,
            // Pinned to this member's record on the shared event, so no member
            // can wander onto a different lesson of their own.
            targetAttendanceId: entry.attendanceId,
            attendanceStatus,
            emailStudentLabel: entry.emailStudentLabel || '',
            suppressEmailReason,
          }),
          finalizeDelivery: async (result) => {
            const email = result.practiceNoteEmail || result.emailNotes || {};
            const completedAt = new Date().toISOString();
            const emailSuppressed = Boolean(suppressEmailReason) || isAbsentNoMakeup;
            const finalNote = normalisePracticeNotePayload({
              ...basePayload,
              emailSendStatus: emailSuppressed
                ? 'not_sent_absent'
                : email.ok === false ? 'failed' : 'sent',
              emailSentAt: emailSuppressed || email.ok === false ? '' : completedAt,
              gmailMessageId: email.gmailMessageId || '',
              gmailThreadId: email.gmailThreadId || '',
              emailError: email.error || '',
              manualFollowUpNeeded: email.ok === false,
              mmsAttendanceSaved: Boolean(result.attendanceSave?.ok),
              operationStatus: emailSuppressed
                ? 'attendance_only_completed'
                : email.ok === false ? 'email_failed' : 'completed',
              completedAt: email.ok === false ? '' : completedAt,
            });
            const logResult = finalNote.errors.length
              ? { ok: false, error: finalNote.errors.join(', ') }
              : await upsertPracticeNoteLogRow(finalNote);
            await finalisePracticeNoteDeliveryClaim({
              deliveryKey,
              status: finalNote.errors.length || logResult?.error
                ? 'tracking_failed'
                : emailSuppressed
                  ? 'attendance_only_completed'
                  : email.ok === false ? 'email_failed_manual_follow_up' : 'completed',
            });
            return { ok: !logResult?.error, ...logResult };
          },
        });

        if (memberDelivery.inProgress) {
          return { ok: true, attendanceSaved: false, emailSent: false, skipped: true, reason: 'in_progress' };
        }
        if (memberDelivery.manualFollowUp) {
          return { ok: false, attendanceSaved: false, emailSent: false, error: 'A previous delivery was interrupted; check MMS before retrying.' };
        }
        if (memberDelivery.error) {
          return { ok: false, attendanceSaved: false, emailSent: false, error: memberDelivery.error.message || 'Delivery failed.' };
        }

        const result = memberDelivery.result || {};
        const email = result.practiceNoteEmail || {};
        return {
          ok: email.ok !== false,
          attendanceSaved: Boolean(result.attendanceSave?.ok),
          emailSent: email.ok === true && email.skipped !== true,
          error: email.ok === false ? email.error || 'Practice note email failed.' : '',
        };
      },
    });

    return Response.json({
      success: delivery.ok,
      mode,
      isGroup: true,
      dryRun: false,
      ...delivery,
      group,
      summary: summaryLine,
      targetAttendance: preview.targetAttendance,
    }, { status: delivery.status === 'failed' ? 502 : 200, headers });
  } catch (error) {
    return Response.json({
      error: error.message || 'Group practice-note delivery failed.',
    }, { status: error.status || 500, headers });
  }
}
