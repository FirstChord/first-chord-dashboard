/** @fileoverview Practice-note delivery endpoint previewing and executing the MMS write, gated by tutor rollout and delivery-key deduplication. */
import {
  executePracticeNoteMmsTestWrite,
  previewPracticeNoteMmsTestWrite,
} from '@/lib/admin/mms';
import {
  normalisePracticeNoteAttendanceStatus,
} from '@/lib/admin/practice-notes-mms-helpers.mjs';
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
import {
  resolveSelectedPracticeNoteSongs,
  resolveUnlistedPracticeNoteSongs,
} from '@/lib/admin/practice-chat-music-context.mjs';
import {
  buildPracticeNoteClaimFailureResponse,
  buildPracticeNoteManualFollowUpPayload,
  buildPracticeNoteManualFollowUpResponse,
  executeClaimedPracticeNoteDelivery,
} from '@/lib/admin/practice-note-delivery-workflow.mjs';
import {
  claimPracticeNoteDelivery,
  finalisePracticeNoteDeliveryClaim,
  releasePracticeNoteDeliveryClaim,
} from '@/lib/admin/practice-note-delivery-claims.mjs';
import { getPracticeNoteLogRows, upsertPracticeNoteLogRow } from '@/lib/admin/sheets';
import { authenticatePracticeChatRequest, corsHeaders } from '@/lib/admin/practice-chat-auth.mjs';
import { syncNoteSongsToShelf } from '@/lib/admin/practice-note-shelf-sync.mjs';
import { getAdminStudentByMmsId } from '@/lib/admin/students';

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin') || ''),
  });
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

    const pilotStudent = await getAdminStudentByMmsId(studentId);
    if (!pilotStudent) {
      return Response.json({
        error: 'Student was not found in the dashboard Students sheet.',
      }, { status: 404, headers });
    }

    const enabledTutors = getPracticeNotesEnabledTutors();
    const studentTutor = resolvePracticeNotesStudentTutor(pilotStudent);
    const isPilotStudent = studentTutor.ok && enabledTutors.includes(studentTutor.tutor);

    if (!isPilotStudent) {
      const error = studentTutor && !studentTutor.ok
        ? studentTutor.reason === 'conflicting_student_tutors'
          ? 'This student has conflicting tutor records. Ask an admin to reconcile the assignment before sending practice notes.'
          : 'This student does not have one clear tutor assignment, so Practice Chat cannot safely send notes.'
        : `Practice Chat Level 2 is currently limited to enabled tutor students. Current enabled tutors: ${enabledTutors.join(', ')}.`;
      return Response.json({
        error,
        enabledTutors,
      }, { status: studentTutor?.reason === 'conflicting_student_tutors' ? 409 : 403, headers });
    }

    if (!effectiveNoteText) {
      return Response.json({ error: 'noteText is required' }, { status: 400, headers });
    }

    const snapshot = body.noteSnapshot || {};
    const requestedSongIds = Array.isArray(body.songIds)
      ? body.songIds
      : Array.isArray(snapshot.songIds)
        ? snapshot.songIds
        : [];
    const requestedUnlistedSongTitles = Array.isArray(body.unlistedSongTitles)
      ? body.unlistedSongTitles
      : Array.isArray(snapshot.unlistedSongTitles)
        ? snapshot.unlistedSongTitles
        : [];
    const songLinks = requestedSongIds.length
      ? resolveSelectedPracticeNoteSongs({ songIds: requestedSongIds })
      : { songIds: [], songTitles: [], errors: [] };
    const unlistedSongs = resolveUnlistedPracticeNoteSongs({ titles: requestedUnlistedSongTitles });
    const songErrors = [...songLinks.errors, ...unlistedSongs.errors];
    if (songErrors.length) {
      return Response.json({ error: songErrors.join(', ') }, { status: 400, headers });
    }

    if (mode === 'execute' && body.confirmLevel2Pilot !== true && body.confirmTestStudent !== true) {
      return Response.json({
        error: 'confirmLevel2Pilot must be true to write attendance in MMS and send the First Chord lesson-note email.',
      }, { status: 400, headers });
    }

    const preview = await previewPracticeNoteMmsTestWrite({
      studentId,
      noteText: effectiveNoteText,
      targetAttendanceId,
      attendanceStatus,
    });

    if (mode !== 'execute') {
      return Response.json({
        success: true,
        mode,
        practiceNoteLog: null,
        ...preview,
      }, { headers });
    }

    const target = preview.targetAttendance || {};
    const selection = preview.targetSelection || {};
    const recipient = preview.recipients?.[0] || {};
    // Households with more than one parent on the MMS record: the rest are Bcc'd
    // on the same send. The tutor still confirms only the `To:` address — the
    // gate proves the right household, and Practice Chat names who else is copied.
    const bccRecipients = (preview.recipients || []).slice(1);
    const bccRecipientEmails = bccRecipients.map((entry) => entry?.email || '').filter(Boolean);
    const confirmedRecipientEmail = `${body.confirmedRecipientEmail || ''}`.trim();
    if (!isAbsentNoMakeup && (
      body.confirmRecipient !== true
      || !confirmedRecipientEmail
      || confirmedRecipientEmail !== `${recipient.email || ''}`.trim()
    )) {
      return Response.json({
        error: 'Confirm the exact parent recipient before sending these practice notes.',
      }, { status: 400, headers });
    }
    const selfAttestedTutor = validateSelfAttestedPracticeNotesTutor({
      tutor: body.tutor || snapshot.tutorName || snapshot.tutor || '',
      student: pilotStudent,
    });
    if (mode === 'execute' && !selfAttestedTutor.ok) {
      return Response.json({
        error: selfAttestedTutor.reason === 'self_attested_tutor_mismatch'
          ? 'The selected tutor does not match this student’s assigned tutor. Re-open Practice Chat from the correct tutor dashboard.'
          : 'Practice Chat needs the selected tutor to confirm this student’s notes.',
      }, { status: selfAttestedTutor.reason === 'conflicting_student_tutors' ? 409 : 403, headers });
    }
    const deliveryKey = buildPracticeNoteDeliveryKey({
      studentMmsId: studentId,
      mmsAttendanceId: target.attendanceId || targetAttendanceId,
      rawNoteText: effectiveNoteText,
    });
    const existingRows = await getPracticeNoteLogRows(studentId);
    const existingDelivery = findPracticeNoteDeliveryRecord(existingRows, deliveryKey);
    const noteCreatedAt = existingDelivery?.createdAt || snapshot.createdAt || new Date().toISOString();
    const baseNotePayload = {
      ...snapshot,
      noteId: existingDelivery?.noteId || snapshot.noteId || '',
      deliveryKey,
      studentMmsId: studentId,
      studentName: preview.student?.name || snapshot.studentName || '',
      tutorName: target.teacherName || snapshot.tutorName || snapshot.tutor || '',
      actingTutor: selfAttestedTutor.actingTutor || existingDelivery?.actingTutor || '',
      lessonDate: target.eventStartDate || snapshot.lessonDate || '',
      rawNoteText: effectiveNoteText,
      songIds: songLinks.songIds.length ? songLinks.songIds : existingDelivery?.songIds || [],
      songTitles: songLinks.songTitles.length ? songLinks.songTitles : existingDelivery?.songTitles || [],
      unlistedSongTitles: unlistedSongs.titles.length
        ? unlistedSongs.titles
        : existingDelivery?.unlistedSongTitles || [],
      copiedToClipboard: false,
      attendanceStepOpened: true,
      mmsEventId: target.eventId || '',
      mmsAttendanceId: target.attendanceId || targetAttendanceId,
      mmsAttendanceStatus: existingDelivery?.mmsAttendanceStatus || attendanceStatus,
      targetSelectionReason: selection.reason || '',
      targetSelectionLabel: selection.label || '',
      recipientProfileId: recipient.recipientProfileId || existingDelivery?.recipientProfileId || '',
      recipientName: recipient.name || existingDelivery?.recipientName || '',
      recipientEmail: recipient.email || existingDelivery?.recipientEmail || '',
      bccRecipientEmails: bccRecipientEmails.length
        ? bccRecipientEmails
        : existingDelivery?.bccRecipientEmails || [],
      emailChannel: existingDelivery?.emailChannel || 'gmail',
      source: 'practice_chat_pwa_level_2_test',
      createdAt: noteCreatedAt,
      userAgent: request.headers.get('user-agent') || snapshot.userAgent || '',
    };

    const alreadyCompleted = isAbsentNoMakeup
      ? existingDelivery?.mmsAttendanceSaved && existingDelivery?.mmsAttendanceStatus === 'AbsentNoMakeup'
      : existingDelivery && isPracticeNoteDeliveryEmailSent(existingDelivery);

    if (existingDelivery && alreadyCompleted) {
      return Response.json({
        success: true,
        mode,
        duplicateSkipped: true,
        idempotency: {
          status: 'already_completed',
          deliveryKey,
          message: isAbsentNoMakeup
            ? 'This selected lesson has already been marked absent with no makeup.'
            : 'This exact note has already been emailed for the selected lesson.',
        },
        practiceNoteLog: {
          ok: true,
          skipped: true,
          reason: 'already_completed',
          deliveryKey,
          noteId: existingDelivery.noteId,
          existing: existingDelivery,
        },
        ...preview,
        dryRun: false,
        attendanceSave: {
          ok: true,
          skipped: true,
          reason: 'already_saved_for_delivery_key',
        },
        practiceNoteEmail: {
          ok: true,
          skipped: true,
          channel: isAbsentNoMakeup ? 'none' : existingDelivery.emailChannel || 'gmail',
          reason: isAbsentNoMakeup ? 'student_absent_no_makeup' : '',
          toEmail: existingDelivery.recipientEmail || '',
          gmailMessageId: existingDelivery.gmailMessageId || '',
          gmailThreadId: existingDelivery.gmailThreadId || '',
          sentAt: existingDelivery.emailSentAt || '',
        },
        emailNotes: {
          ok: true,
          skipped: true,
          channel: isAbsentNoMakeup ? 'none' : existingDelivery.emailChannel || 'gmail',
          reason: isAbsentNoMakeup ? 'student_absent_no_makeup' : '',
          toEmail: existingDelivery.recipientEmail || '',
          gmailMessageId: existingDelivery.gmailMessageId || '',
          gmailThreadId: existingDelivery.gmailThreadId || '',
          sentAt: existingDelivery.emailSentAt || '',
        },
        partialSuccess: false,
      }, { headers });
    }

    if (existingDelivery && isPracticeNoteDeliveryInProgress(existingDelivery)) {
      return Response.json({
        success: true,
        mode,
        inProgress: true,
        idempotency: {
          status: 'in_progress',
          deliveryKey,
          message: 'This lesson note delivery is already being processed.',
        },
        practiceNoteLog: {
          ok: true,
          skipped: true,
          reason: 'in_progress',
          deliveryKey,
          noteId: existingDelivery.noteId,
          existing: existingDelivery,
        },
        ...preview,
        dryRun: false,
      }, { headers });
    }

    const claimNote = normalisePracticeNotePayload({
      ...baseNotePayload,
      mmsAttendanceSaved: Boolean(existingDelivery?.mmsAttendanceSaved),
      emailSendStatus: existingDelivery?.emailSendStatus || '',
      emailSentAt: existingDelivery?.emailSentAt || '',
      gmailMessageId: existingDelivery?.gmailMessageId || '',
      gmailThreadId: existingDelivery?.gmailThreadId || '',
      emailError: existingDelivery?.emailError || '',
      manualFollowUpNeeded: Boolean(existingDelivery?.manualFollowUpNeeded),
      operationStatus: existingDelivery?.mmsAttendanceSaved ? 'retrying_email' : 'in_progress',
      completedAt: existingDelivery?.completedAt || '',
    });

    if (claimNote.errors.length) {
      return Response.json({ error: claimNote.errors.join(', ') }, { status: 400, headers });
    }

    const delivery = await executeClaimedPracticeNoteDelivery({
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
      executeDelivery: () => existingDelivery?.mmsAttendanceSaved
        ? manualEmailFollowUpResult(existingDelivery)
        : executePracticeNoteMmsTestWrite({
            studentId,
            noteText: effectiveNoteText,
            targetAttendanceId,
            attendanceStatus,
          }),
      finalizeDelivery: async (result) => {
        const email = result.practiceNoteEmail || result.emailNotes || {};
        const completedAt = new Date().toISOString();
        const finalNote = normalisePracticeNotePayload({
          ...baseNotePayload,
          recipientEmail: recipient.email || email.toEmail || existingDelivery?.recipientEmail || '',
          // Prefer what the send actually reported over what we intended.
          bccRecipientEmails: email.bccEmails?.length
            ? email.bccEmails
            : bccRecipientEmails.length
              ? bccRecipientEmails
              : existingDelivery?.bccRecipientEmails || [],
          emailChannel: isAbsentNoMakeup ? 'none' : email.channel || 'gmail',
          emailSendStatus: isAbsentNoMakeup ? 'not_sent_absent' : email.ok === false ? 'failed' : 'sent',
          emailSentAt: isAbsentNoMakeup || email.ok === false ? '' : completedAt,
          gmailMessageId: email.gmailMessageId || '',
          gmailThreadId: email.gmailThreadId || '',
          emailError: email.error || '',
          manualFollowUpNeeded: email.ok === false,
          mmsAttendanceSaved: Boolean(result.attendanceSave?.ok || existingDelivery?.mmsAttendanceSaved),
          mmsAttendanceStatus: attendanceStatus,
          operationStatus: isAbsentNoMakeup ? 'attendance_only_completed' : email.ok === false ? 'email_failed' : 'completed',
          completedAt: email.ok === false ? '' : completedAt,
        });

        try {
          const logResult = finalNote.errors.length
            ? { ok: false, error: finalNote.errors.join(', ') }
            : await upsertPracticeNoteLogRow(finalNote);
          const finalClaimStatus = finalNote.errors.length || logResult?.error
            ? 'tracking_failed'
            : isAbsentNoMakeup
              ? 'attendance_only_completed'
              : email.ok === false
                ? 'email_failed_manual_follow_up'
                : 'completed';
          const databaseClaim = await finalisePracticeNoteDeliveryClaim({ deliveryKey, status: finalClaimStatus });
          return {
            ok: !logResult?.error,
            ...logResult,
            databaseClaim,
          };
        } catch (error) {
          return {
            ok: false,
            error: error.message || 'Practice note log save failed',
          };
        }
      },
    });

    if (delivery.inProgress) {
      return Response.json({
        success: true,
        mode,
        inProgress: true,
        idempotency: {
          status: 'in_progress',
          deliveryKey,
          message: 'This lesson note delivery is already being processed.',
        },
        practiceNoteLog: {
          ok: true,
          skipped: true,
          reason: 'in_process',
          deliveryKey,
        },
        ...preview,
        dryRun: false,
      }, { headers });
    }

    if (delivery.manualFollowUp) {
      const manualFollowUpMessage = 'A previous delivery was interrupted. Check MMS attendance and Gmail before deciding whether any manual repair is needed; Practice Chat will not repeat an uncertain provider action.';
      const manualFollowUpNote = normalisePracticeNotePayload(
        buildPracticeNoteManualFollowUpPayload({
          claimNote,
          existingDelivery,
          claimResult: delivery.claimResult,
          message: manualFollowUpMessage,
        }),
      );
      let practiceNoteLog;
      try {
        practiceNoteLog = manualFollowUpNote.errors.length
          ? { ok: false, error: manualFollowUpNote.errors.join(', ') }
          : await upsertPracticeNoteLogRow(manualFollowUpNote);
      } catch (error) {
        practiceNoteLog = {
          ok: false,
          error: error.message || 'Practice note manual follow-up log save failed',
        };
      }

      const failure = buildPracticeNoteManualFollowUpResponse({
        mode,
        deliveryKey,
        claimResult: delivery.claimResult,
        practiceNoteLog,
        preview,
        isAbsentNoMakeup,
      });
      return Response.json(failure.body, { status: failure.status, headers });
    }

    if (!delivery.ok) {
      const failure = buildPracticeNoteClaimFailureResponse({
        mode,
        deliveryKey,
        claimResult: delivery.claimResult,
        preview,
        isAbsentNoMakeup,
      });
      return Response.json(failure.body, { status: failure.status, headers });
    }

    const result = delivery.deliveryResult;
    const practiceNoteLog = delivery.finalResult;
    const deliveryTrackingFailed = practiceNoteLog?.ok === false;

    // A confirmed song link is the tutor saying "we worked on this", so it
    // earns a place on the shelf. This is where real song links arrive — both
    // of the first two came through Level 2, not the snapshot route. Runs only
    // once the delivery is recorded, and cannot fail it.
    if (!deliveryTrackingFailed) {
      await syncNoteSongsToShelf({
        studentMmsId: studentId,
        songIds: songLinks.songIds,
        // The plain name, never `actingTutor` — that is a *label*
        // ("Self-attested: Calum") built for the note log's audit column. Put
        // it in an identity column and one human becomes two tutors in every
        // cross-song view. `assigned_via = note` already records that this
        // identity is self-attested, which is the whole reason it exists.
        tutorName: selfAttestedTutor.tutor || snapshot.tutorName || snapshot.tutor || '',
      });
    }

    return Response.json({
      success: true,
      mode,
      idempotency: {
        status: existingDelivery?.mmsAttendanceSaved ? 'retried_email_only' : 'processed',
        deliveryKey,
      },
      practiceNoteLog,
      ...result,
      deliveryTrackingFailed,
      partialSuccess: Boolean(result.partialSuccess || deliveryTrackingFailed),
    }, { headers });
  } catch (error) {
    return Response.json({
      error: error.message || 'MMS Practice Notes test failed',
    }, { status: 500, headers });
  }
}

function manualEmailFollowUpResult(existingDelivery = {}) {
  const practiceNoteEmail = {
    ok: false,
    channel: 'gmail',
    toEmail: existingDelivery.recipientEmail || '',
    error: 'A previous email attempt needs manual follow-up. Practice Chat will not retry an ambiguous Gmail send.',
  };
  return {
    dryRun: false,
    attendanceSave: {
      ok: true,
      skipped: true,
      reason: 'already_saved_for_delivery_key',
    },
    practiceNoteEmail,
    emailNotes: practiceNoteEmail,
    partialSuccess: true,
  };
}
