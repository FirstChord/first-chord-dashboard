/** @fileoverview Admin-gated student onboarding orchestrator that steps through sheet, registry, MMS, and billing setup with recovery guidance. */
import { getServerSession } from 'next-auth';
import crypto from 'node:crypto';

import { authOptions } from '@/lib/admin/auth';
import {
  buildOnboardingCompletionStatus,
  buildOnboardingRecoveryGuidance,
  createOnboardingSteps,
  findOnboardingCompletionBlockers,
  getOnboardingDuplicateState,
  isOnboardingCoreOperationallyComplete,
  markOnboardingStep,
} from '@/lib/admin/onboarding';
import { addStudentSheetRow, appendEventLogRows } from '@/lib/admin/sheets';
import {
  appendRegistryEntry,
  assertRegistryWriteAvailable,
} from '@/lib/admin/registry';
import {
  activateStudent,
  consumeMmsFreeCalendarSlot,
  createFirstLesson,
  ensureBillingProfile,
  getStudentDetails,
  getValidatedMmsFreeCalendarSlot,
} from '@/lib/admin/mms';
import { generateFcStudentId, generateFriendlyUrl, normaliseExperienceLevel, normaliseInstrument } from '@/lib/admin/fc';
import { ADMIN_TUTORS } from '@/lib/admin/tutors';
import { markWaitingWorkflowStudentsOnboarded } from '@/lib/admin/waiting-workflow';
import {
  createEarlyStripeTimingReviewPlanningItem,
  createFirstLessonCheckinPlanningItem,
} from '@/lib/admin/planning';
import { requiresEarlyStripeTimingReview } from '@/lib/admin/planning-helpers.mjs';
import { ensureStudentNotesAccessFollowUp } from '@/lib/admin/student-notes-access';
import {
  buildOnboardingWelcomeMessage,
  buildSoundsliceFollowup,
} from '@/lib/admin/onboarding-message-helpers.mjs';

function formatLessonDateForMessage(value) {
  const parsed = new Date(`${value}T12:00:00`);
  const weekday = parsed.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = parsed.toLocaleDateString('en-GB', { month: 'long' });
  const day = parsed.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13
    ? 'th'
    : { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th';

  return `${weekday} ${day}${suffix} of ${month}`;
}

function formatLessonTimeForMessage(value) {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) {
    throw new Error('Lesson time is required');
  }

  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    throw new Error('Lesson time is invalid');
  }

  const [, hours, minutes] = match;
  const parsed = new Date(`2000-01-01T${hours}:${minutes}:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Lesson time is invalid');
  }

  const hour = parsed.getHours();
  const minute = parsed.getMinutes();
  const suffix = hour >= 12 ? 'pm' : 'am';
  const displayHour = hour % 12 || 12;

  return minute === 0
    ? `${displayHour}${suffix}`
    : `${displayHour}:${String(minute).padStart(2, '0')}${suffix}`;
}

function deriveWeekday(value) {
  const parsed = new Date(`${value}T12:00:00`);
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
  });
}

function firstNameOnly(value, fallback = '') {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] || fallback;
}

function firstNameList(values = []) {
  const names = values.map((value) => firstNameOnly(value, value)).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function buildWelcomeMessage(data) {
  const paymentLink = process.env.STRIPE_PAYMENT_LINK || process.env.PAYMENT_LINK || '[ADD PAYMENT LINK]';
  const groupPaymentLink = process.env.GROUP_LESSON_PAYMENT_LINK || 'https://buy.stripe.com/14AdRab7C1b28N79ZM5J60D';
  const handbookUrl = process.env.HANDBOOK_URL || 'https://firstchord.co.uk/handbook';
  return buildOnboardingWelcomeMessage({
    ...data,
    paymentLink,
    groupPaymentLink,
    handbookUrl,
  });
}

function generateBillingGroupId(mmsIds = []) {
  const seed = [...mmsIds].filter(Boolean).sort().join(':');
  return `bg_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8)}`;
}

async function appendCanonicalStudent({
  student,
  tutor,
  parentEmail,
  lessonLength,
  instrument,
  billingGroupId = '',
  groupPartnerMmsId = '',
  lessonType = 'individual',
}) {
  const fcStudentId = generateFcStudentId(student.firstName, student.lastName, parentEmail);
  const friendlyUrl = await generateFriendlyUrl(student.firstName, student.lastName);
  const thetaUsername = student.thetaUsername || `${student.firstName}${student.lastName}fc`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const duplicateState = await getOnboardingDuplicateState({
    mmsId: student.mmsId,
    tutorFullName: tutor.fullName,
    tutorShortName: tutor.shortName,
  });

  if (duplicateState.exactDuplicate) {
    throw new Error(duplicateState.blockingReasons.join(' '));
  }

  const sheetInsert = await addStudentSheetRow({
    'Student Surname': student.lastName,
    'Student forename': student.firstName,
    Tutor: tutor.fullName,
    'Parent surname': student.parentLastName,
    'Parent forename': student.parentFirstName,
    Email: parentEmail,
    mms_id: student.mmsId,
    'Lesson length': String(lessonLength || 30),
    'Contact Number': student.contactNumber || '',
    Soundslice: student.soundsliceUrl || '',
    Instrument: instrument,
    'FC Student ID': fcStudentId,
    'Theta Username': thetaUsername,
    Theta: thetaUsername,
    lesson_type: lessonType,
    billing_group_id: billingGroupId,
    group_partner_mms_id: groupPartnerMmsId,
  });

  let registryAction = 'kept_existing';
  if (duplicateState.shouldAppendRegistry) {
    try {
      await appendRegistryEntry({
        mmsId: student.mmsId,
        firstName: student.firstName,
        lastName: student.lastName,
        friendlyUrl,
        tutor: tutor.shortName,
        instrument,
        soundsliceUrl: student.soundsliceUrl || '',
        thetaUsername,
        fcStudentId,
      });
    } catch (error) {
      const registryError = new Error(
        error?.message || 'Registry write failed after the Students row was inserted.',
      );
      registryError.onboardingStage = 'registryWrite';
      registryError.sheetInsert = sheetInsert;
      throw registryError;
    }
    registryAction = 'appended';
  }

  return {
    sheetInsert,
    registryAction,
    duplicateState,
    fcStudentId,
    friendlyUrl,
    thetaUsername,
  };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const completionBlockers = findOnboardingCompletionBlockers(payload);
  if (completionBlockers.length > 0) {
    return Response.json({
      error: completionBlockers[0].message,
      blockers: completionBlockers,
    }, { status: 400 });
  }

  const tutor = ADMIN_TUTORS[payload.tutorShortName];

  if (!tutor) {
    return Response.json({ error: 'Tutor is required' }, { status: 400 });
  }

  const instrument = normaliseInstrument(payload.instrument);
  const isAdult = Boolean(payload.isAdult);
  const lessonType = payload.lessonType === 'sibling_group' ? 'sibling_group' : 'individual';
  const resolvedLessonLength = lessonType === 'sibling_group' ? 45 : Number(payload.lessonLength || 30);
  const parentEmail = payload.parentEmail || payload.studentEmail || '';
  const experienceLevel = normaliseExperienceLevel(payload.experienceLevel);
  const lessonDay = deriveWeekday(payload.lessonDate);
  const lessonDateLabel = formatLessonDateForMessage(payload.lessonDate);
  const lessonTimeLabel = formatLessonTimeForMessage(payload.lessonTime);
  const studentName = `${payload.studentFirstName} ${payload.studentLastName}`.trim();
  const parentName = `${payload.parentFirstName || ''} ${payload.parentLastName || ''}`.trim() || payload.studentFirstName;
  const secondStudentRequired = lessonType === 'sibling_group';
  if (secondStudentRequired && !payload.secondStudentMmsId) {
    return Response.json({ error: 'Second student is required for a sibling group lesson' }, { status: 400 });
  }

  const secondStudentDetails = secondStudentRequired ? await getStudentDetails(payload.secondStudentMmsId) : null;
  const studentIds = [payload.mmsId];
  if (secondStudentDetails?.mmsId) {
    studentIds.push(secondStudentDetails.mmsId);
  }
  const billingGroupId = secondStudentRequired ? generateBillingGroupId(studentIds) : '';
  const secondStudentName = secondStudentDetails?.fullName || '';
  const studentNamesLabel = secondStudentRequired && secondStudentName ? `${studentName} and ${secondStudentName}` : studentName;
  const studentFirstNamesLabel = firstNameList([studentName, secondStudentRequired ? secondStudentName : '']);
  let steps = createOnboardingSteps();
  let duplicateState = null;

  try {
    await assertRegistryWriteAvailable();
    steps = markOnboardingStep(
      steps,
      'registryPreflight',
      'succeeded',
      'GitHub registry write path is available.',
    );
  } catch (error) {
    steps = markOnboardingStep(
      steps,
      'registryPreflight',
      'failed',
      error.message || 'GitHub registry write path is unavailable.',
    );
    steps = markOnboardingStep(steps, 'duplicateCheck', 'skipped', 'Skipped because registry preflight failed.');
    steps = markOnboardingStep(steps, 'sheetsWrite', 'skipped', 'No Students row was written because registry preflight failed.');
    steps = markOnboardingStep(steps, 'registryWrite', 'skipped', 'No registry write was attempted because preflight failed.');
    steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'No MMS write was attempted because registry preflight failed.');
    steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'No MMS write was attempted because registry preflight failed.');
    steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'No MMS write was attempted because registry preflight failed.');
    steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'No MMS write was attempted because registry preflight failed.');

    return Response.json(
      {
        error: error.message || 'GitHub registry write path is unavailable.',
        steps,
        recoveryGuidance: buildOnboardingRecoveryGuidance({ steps }),
      },
      { status: 503 },
    );
  }

  duplicateState = await getOnboardingDuplicateState({
    mmsId: payload.mmsId,
    tutorFullName: tutor.fullName,
    tutorShortName: payload.tutorShortName,
  });

  // A sibling group writes two canonical records in sequence. appendCanonicalStudent
  // rechecks each student and throws, but by then the first sibling exists — so the
  // second student's duplicate state has to block here, before any write.
  const secondDuplicateState = secondStudentDetails?.mmsId
    ? await getOnboardingDuplicateState({
        mmsId: secondStudentDetails.mmsId,
        tutorFullName: tutor.fullName,
        tutorShortName: payload.tutorShortName,
      })
    : null;

  const blockingReasons = [
    ...duplicateState.blockingReasons,
    ...(secondDuplicateState?.blockingReasons || []).map(
      (reason) => `${secondStudentName || secondStudentDetails?.mmsId}: ${reason}`,
    ),
  ];
  const duplicateWarnings = [
    ...duplicateState.warnings,
    ...(secondDuplicateState?.warnings || []).map(
      (warning) => `${secondStudentName || secondStudentDetails?.mmsId}: ${warning}`,
    ),
  ];

  if (blockingReasons.length > 0) {
    steps = markOnboardingStep(
      steps,
      'duplicateCheck',
      'failed',
      blockingReasons.join(' '),
    );
    steps = markOnboardingStep(steps, 'sheetsWrite', 'skipped', 'Skipped because an exact duplicate already exists.');
    steps = markOnboardingStep(steps, 'registryWrite', 'skipped', 'Skipped because an exact duplicate already exists.');
    steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'Skipped because an exact duplicate already exists.');
    steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Skipped because an exact duplicate already exists.');
    steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because an exact duplicate already exists.');
    steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'Skipped because an exact duplicate already exists.');

    return Response.json(
      {
        error: blockingReasons.join(' '),
        duplicateWarnings,
        steps,
        recoveryGuidance: buildOnboardingRecoveryGuidance({
          steps,
          duplicateState: secondDuplicateState?.exactDuplicate && !duplicateState.exactDuplicate
            ? secondDuplicateState
            : duplicateState,
        }),
      },
      { status: 409 },
    );
  }

  try {
    steps = markOnboardingStep(steps, 'duplicateCheck', 'succeeded', duplicateWarnings.length ? duplicateWarnings.join(' ') : 'No blocking duplicate found.');

    if (payload.freeEventId) {
      try {
        await getValidatedMmsFreeCalendarSlot({
          eventId: payload.freeEventId,
          teacherId: tutor.teacherId,
          lessonDate: payload.lessonDate,
          lessonTime: payload.lessonTime,
          durationMinutes: resolvedLessonLength,
        });
      } catch (error) {
        steps = markOnboardingStep(steps, 'sheetsWrite', 'skipped', 'No canonical write was attempted because the selected MMS Free event is stale or changed.');
        steps = markOnboardingStep(steps, 'registryWrite', 'skipped', 'No canonical write was attempted because the selected MMS Free event is stale or changed.');
        steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'No MMS write was attempted because the selected Free event could not be confirmed.');
        steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'No MMS write was attempted because the selected Free event could not be confirmed.');
        steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'No lesson was created because the selected Free event could not be confirmed.');
        steps = markOnboardingStep(steps, 'mmsFreeSlot', 'failed', error.message || 'The selected MMS Free event could not be confirmed.');
        return Response.json({
          error: error.message || 'The selected MMS Free event could not be confirmed.',
          steps,
          recoveryGuidance: [
            'No student records were written.',
            'The first lesson must fall on the selected Free slot or a whole number of weeks after it. Use the week buttons on the free-slot banner to bump it forward.',
            'If the slot itself has changed or is taken, return to Waiting, refresh the free slots, and choose again — or onboard without the slot and remove it in MMS afterwards.',
          ],
        }, { status: 409 });
      }
    }

    const primaryRecord = await appendCanonicalStudent({
      student: {
        mmsId: payload.mmsId,
        firstName: payload.studentFirstName,
        lastName: payload.studentLastName,
        parentFirstName: payload.parentFirstName,
        parentLastName: payload.parentLastName,
        contactNumber: payload.contactNumber,
        soundsliceUrl: payload.soundsliceUrl || '',
        thetaUsername: payload.thetaUsername || '',
      },
      tutor: { fullName: tutor.fullName, shortName: payload.tutorShortName },
      parentEmail,
      lessonLength: resolvedLessonLength,
      instrument,
      billingGroupId,
      groupPartnerMmsId: secondStudentDetails?.mmsId || '',
      lessonType,
    });

    let secondaryRecord = null;
    if (secondStudentDetails) {
      secondaryRecord = await appendCanonicalStudent({
        student: {
          mmsId: secondStudentDetails.mmsId,
          firstName: secondStudentDetails.firstName,
          lastName: secondStudentDetails.lastName,
          parentFirstName: secondStudentDetails.parentFirstName || payload.parentFirstName,
          parentLastName: secondStudentDetails.parentLastName || payload.parentLastName,
          contactNumber: secondStudentDetails.studentTelephone || secondStudentDetails.parentTelephone || payload.contactNumber,
          soundsliceUrl: payload.soundsliceUrl || '',
          thetaUsername: '',
        },
        tutor: { fullName: tutor.fullName, shortName: payload.tutorShortName },
        parentEmail: secondStudentDetails.parentEmail || parentEmail,
        lessonLength: resolvedLessonLength,
        instrument,
        billingGroupId,
        groupPartnerMmsId: payload.mmsId,
        lessonType,
      });
    }

    steps = markOnboardingStep(
      steps,
      'sheetsWrite',
      'succeeded',
      secondStudentDetails
        ? `Inserted both students into the Students sheet (${primaryRecord.sheetInsert.insertedAt}, ${secondaryRecord?.sheetInsert.insertedAt}).`
        : `Inserted into Students sheet at row ${primaryRecord.sheetInsert.insertedAt}.`,
    );

    const registryAction = secondStudentDetails
      ? `${primaryRecord.registryAction}, ${secondaryRecord?.registryAction || 'kept_existing'}`
      : primaryRecord.registryAction;
    if (primaryRecord.registryAction === 'appended' || secondaryRecord?.registryAction === 'appended') {
      steps = markOnboardingStep(steps, 'registryWrite', 'succeeded', secondStudentDetails ? 'Registry entries processed for both students.' : 'Appended new registry entry.');
    } else {
      steps = markOnboardingStep(steps, 'registryWrite', 'skipped', secondStudentDetails ? 'Existing registry entries retained for both students.' : 'Existing registry entry retained.');
    }

    let lesson = null;
    let lessonConfirmed = false;
    let lessonWarning = '';
    let freeSlot = null;
    let freeSlotWarning = '';
    let mmsStatus = {
      activated: false,
      billingProfileReady: false,
    };

    try {
      const activation = await activateStudent({
        studentId: payload.mmsId,
      });
      if (secondStudentDetails?.mmsId) {
        await activateStudent({ studentId: secondStudentDetails.mmsId });
      }
      mmsStatus.activated = true;
      steps = markOnboardingStep(
        steps,
        'mmsActivation',
        activation?.alreadyActive ? 'skipped' : 'succeeded',
        secondStudentDetails
          ? 'Both students are active in MMS or were already active.'
          : activation?.alreadyActive ? 'Student was already active in MMS.' : 'Student activated in MMS.',
      );

      const billingProfile = await ensureBillingProfile({
        studentId: payload.mmsId,
        teacherId: tutor.teacherId,
        lessonDuration: resolvedLessonLength,
      });
      const secondBillingProfile = secondStudentDetails?.mmsId
        ? await ensureBillingProfile({
            studentId: secondStudentDetails.mmsId,
            teacherId: tutor.teacherId,
            lessonDuration: resolvedLessonLength,
          })
        : null;
      mmsStatus.billingProfileReady = true;
      steps = markOnboardingStep(
        steps,
        'mmsBillingProfile',
        billingProfile?.alreadyExists && (!secondBillingProfile || secondBillingProfile.alreadyExists) ? 'skipped' : 'succeeded',
        secondStudentDetails
          ? 'Billing profiles are ready for both students in MMS.'
          : billingProfile?.alreadyExists ? 'Existing billing profile reused in MMS.' : 'Billing profile is ready in MMS.',
      );

      lesson = await createFirstLesson({
        studentIds,
        teacherId: tutor.teacherId,
        lessonDate: payload.lessonDate,
        lessonTime: payload.lessonTime,
        durationMinutes: resolvedLessonLength,
        billingProfile,
        isRecurring: payload.isRecurring !== false,
      });
      lessonConfirmed = true;
      steps = markOnboardingStep(
        steps,
        'mmsFirstLesson',
        lesson?.duplicateSkipped ? 'skipped' : 'succeeded',
        lesson?.duplicateSkipped
          ? `Matching ${payload.isRecurring !== false ? secondStudentDetails ? 'group recurring lesson series' : 'recurring lesson series' : secondStudentDetails ? 'group lesson' : 'lesson'} already existed in MMS${lesson?.ID ? ` (${lesson.ID})` : ''}`
          : `${payload.isRecurring !== false ? secondStudentDetails ? 'Created recurring group lesson series' : 'Created recurring lesson series' : secondStudentDetails ? 'Created single group lesson' : 'Created single lesson'}${lesson?.ID ? ` (${lesson.ID})` : ''}`,
      );
    } catch (error) {
      lessonWarning = error.message || 'MMS lesson creation failed';
      if (!mmsStatus.activated) {
        steps = markOnboardingStep(steps, 'mmsActivation', 'failed', lessonWarning);
        steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Skipped because MMS activation did not complete.');
        steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because MMS activation did not complete.');
      } else if (!mmsStatus.billingProfileReady) {
        steps = markOnboardingStep(steps, 'mmsBillingProfile', 'failed', lessonWarning);
        steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because MMS billing profile was not ready.');
      } else {
        steps = markOnboardingStep(steps, 'mmsFirstLesson', 'failed', lessonWarning);
      }
    }

    if (!payload.freeEventId) {
      steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'No MMS Free source event was selected.');
    } else if (lessonConfirmed) {
      try {
        freeSlot = await consumeMmsFreeCalendarSlot({
          eventId: payload.freeEventId,
          teacherId: tutor.teacherId,
          lessonDate: payload.lessonDate,
          lessonTime: payload.lessonTime,
          durationMinutes: resolvedLessonLength,
        });
        steps = markOnboardingStep(
          steps,
          'mmsFreeSlot',
          'succeeded',
          freeSlot.alreadyAbsent
            ? `Selected MMS Free event ${freeSlot.eventId} was already absent after the first lesson was confirmed.`
            : `Removed selected MMS Free event ${freeSlot.eventId} and its future occurrences after confirming the first lesson${freeSlot.seriesId ? ` (series ${freeSlot.seriesId})` : ''}.${
              freeSlot.weekOffset
                ? ` The first lesson starts ${freeSlot.weekOffset} week${freeSlot.weekOffset === 1 ? '' : 's'} later, so the free weeks before it were removed with the slot.`
                : ''
            }`,
        );
      } catch (error) {
        freeSlotWarning = error.message || 'MMS Free event removal failed';
        steps = markOnboardingStep(steps, 'mmsFreeSlot', 'failed', freeSlotWarning);
      }
    } else {
      steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'The selected Free event was kept because the first lesson was not confirmed.');
    }

    const completionStatus = buildOnboardingCompletionStatus({ steps });
    const postOnboardingReady = isOnboardingCoreOperationallyComplete({ steps });

    let waitingCloseout = [];
    let waitingCloseoutWarning = '';

    if (!postOnboardingReady) {
      waitingCloseoutWarning = 'Waiting status remains open because the canonical record or core MMS lesson setup is incomplete.';
    } else {
      try {
        const now = new Date().toISOString();
        waitingCloseout = await markWaitingWorkflowStudentsOnboarded({
          students: [
            {
              mmsId: payload.mmsId,
              studentName,
              parentName,
              parentEmail,
            },
            secondStudentDetails
              ? {
                  mmsId: secondStudentDetails.mmsId,
                  studentName: secondStudentName,
                  parentName: `${secondStudentDetails.parentFirstName || payload.parentFirstName || ''} ${secondStudentDetails.parentLastName || payload.parentLastName || ''}`.trim(),
                  parentEmail: secondStudentDetails.parentEmail || parentEmail,
                }
              : null,
          ].filter(Boolean),
          tutorName: tutor.fullName,
          lessonDate: payload.lessonDate,
          lessonTime: lessonTimeLabel,
          lessonWarning,
          now,
        });

        if (waitingCloseout.length > 0) {
          await appendEventLogRows(waitingCloseout.map((state) => ({
            eventId: crypto.randomUUID(),
            occurredAt: now,
            actorEmail: session.user.email || '',
            entityType: 'waiting',
            entityId: state.mmsId,
            eventType: 'waiting_onboarded_by_onboarding',
            mmsId: state.mmsId,
            studentName: state.mmsId === payload.mmsId ? studentName : secondStudentName || state.mmsId,
            issueId: '',
            payloadJson: JSON.stringify({
              next_status: state.status,
              lesson_id: lesson?.ID || '',
              lesson_warning: lessonWarning,
              source_free_event_id: payload.freeEventId || '',
              source_free_event_removed: Boolean(freeSlot),
              source_free_event_week_offset: freeSlot?.weekOffset ?? '',
            }),
          })));
        }
      } catch (error) {
        waitingCloseoutWarning = error.message || 'Waiting-list closeout failed';
      }
    }

    let firstLessonCheckin = null;
    let firstLessonCheckinWarning = '';

    if (!postOnboardingReady) {
      firstLessonCheckinWarning = 'First-lesson check-in was not queued because the canonical record or core MMS lesson setup is incomplete.';
    } else {
      try {
        const checkin = await createFirstLessonCheckinPlanningItem({
          mmsId: payload.mmsId,
          studentName,
          tutorName: tutor.fullName,
          lessonDate: payload.lessonDate,
          lessonTime: lessonTimeLabel,
          actorEmail: session.user.email || '',
        });
        firstLessonCheckin = {
          planningId: checkin.planningId,
          title: checkin.title,
          targetDate: checkin.targetDate,
        };

        await appendEventLogRows([
          {
            eventId: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            actorEmail: session.user.email || '',
            entityType: 'planning',
            entityId: checkin.planningId,
            eventType: 'first_lesson_checkin_created',
            mmsId: payload.mmsId,
            studentName,
            issueId: '',
            payloadJson: JSON.stringify({
              planning_id: checkin.planningId,
              target_date: checkin.targetDate,
              owner: 'Unassigned',
            }),
          },
        ]);
      } catch (error) {
        firstLessonCheckinWarning = error.message || 'First-lesson check-in task creation failed';
      }
    }

    let earlyStripeTimingReview = null;
    let earlyStripeTimingReviewWarning = '';
    const needsEarlyStripeTimingReview = requiresEarlyStripeTimingReview(payload.lessonDate);

    if (needsEarlyStripeTimingReview && !postOnboardingReady) {
      earlyStripeTimingReviewWarning = 'Early Stripe timing review was not queued because the canonical record or core MMS lesson setup is incomplete.';
    } else if (needsEarlyStripeTimingReview) {
      try {
        const review = await createEarlyStripeTimingReviewPlanningItem({
          mmsId: payload.mmsId,
          studentName,
          lessonDate: payload.lessonDate,
          actorEmail: session.user.email || '',
        });
        earlyStripeTimingReview = {
          planningId: review.planningId,
          title: review.title,
          targetDate: review.targetDate,
        };

        await appendEventLogRows([
          {
            eventId: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            actorEmail: session.user.email || '',
            entityType: 'planning',
            entityId: review.planningId,
            eventType: 'early_stripe_timing_review_created',
            mmsId: payload.mmsId,
            studentName,
            issueId: '',
            payloadJson: JSON.stringify({
              planning_id: review.planningId,
              target_date: review.targetDate,
              owner: 'Unassigned',
              first_lesson_date: payload.lessonDate,
            }),
          },
        ]);
      } catch (error) {
        earlyStripeTimingReviewWarning = error.message || 'Early Stripe timing review task creation failed';
      }
    }

    let notesPrivacyFollowUp = [];
    let notesPrivacyFollowUpWarning = '';
    if (!postOnboardingReady) {
      notesPrivacyFollowUpWarning = 'Student notes privacy follow-up was not queued because the canonical record or core MMS lesson setup is incomplete.';
    } else {
      try {
        notesPrivacyFollowUp = await Promise.all([
          ensureStudentNotesAccessFollowUp({
            studentMmsId: payload.mmsId,
            studentName,
            friendlyUrl: primaryRecord.friendlyUrl,
            tutorName: tutor.fullName,
            actorEmail: session.user.email || '',
          }),
          secondStudentDetails && secondaryRecord
            ? ensureStudentNotesAccessFollowUp({
                studentMmsId: secondStudentDetails.mmsId,
                studentName: secondStudentName,
                friendlyUrl: secondaryRecord.friendlyUrl,
                tutorName: tutor.fullName,
                actorEmail: session.user.email || '',
              })
            : null,
        ].filter(Boolean));
      } catch (error) {
        notesPrivacyFollowUpWarning = error.message || 'Student notes privacy follow-up could not be queued';
      }
    }

    return Response.json({
      success: true,
      steps,
      completionStatus,
      recoveryGuidance: buildOnboardingRecoveryGuidance({ steps, duplicateState }),
      lessonId: lesson?.ID || '',
      lessonWarning,
      freeSlot,
      freeSlotWarning,
      mmsStatus,
      fcStudentId: primaryRecord.fcStudentId,
      friendlyUrl: primaryRecord.friendlyUrl,
      registryAction,
      waitingCloseout,
      waitingCloseoutWarning,
      firstLessonCheckin,
      firstLessonCheckinWarning,
      earlyStripeTimingReview,
      earlyStripeTimingReviewWarning,
      notesPrivacyFollowUp,
      notesPrivacyFollowUpWarning,
      duplicateWarnings,
      siblingGroup: secondStudentDetails
        ? {
            billingGroupId,
            secondStudentMmsId: secondStudentDetails.mmsId,
            secondStudentName,
          }
        : null,
      messages: {
        welcomeMessage: buildWelcomeMessage({
          studentName,
          studentNamesLabel,
          studentFirstNamesLabel,
          parentName,
          lessonTime: lessonTimeLabel,
          lessonDay,
          lessonDate: lessonDateLabel,
          tutorFullName: tutor.fullName,
          age: payload.age,
          experienceLevel,
          interests: payload.interests || 'music',
          isAdult,
          lessonType,
        }),
        soundsliceFollowup: buildSoundsliceFollowup({
          soundsliceCode: payload.soundsliceCode || '',
          studentName: studentFirstNamesLabel,
          tutorFullName: tutor.fullName,
        }),
      },
    });
  } catch (error) {
    if (steps.duplicateCheck.status === 'pending') {
      steps = markOnboardingStep(steps, 'duplicateCheck', 'succeeded', 'No blocking duplicate found.');
    }

    if (error.onboardingStage === 'registryWrite') {
      const insertedAt = error.sheetInsert?.insertedAt;
      steps = markOnboardingStep(
        steps,
        'sheetsWrite',
        'succeeded',
        insertedAt
          ? `At least one Students row was inserted (latest row ${insertedAt}) before the registry write failed.`
          : 'At least one Students row was inserted before the registry write failed.',
      );
      steps = markOnboardingStep(steps, 'registryWrite', 'failed', error.message || 'Registry write failed.');
      steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'Skipped because the canonical registry write did not complete.');
      steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Skipped because the canonical registry write did not complete.');
      steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because the canonical registry write did not complete.');
      steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'Skipped because the canonical registry write did not complete.');
    } else if (steps.sheetsWrite.status === 'pending') {
      steps = markOnboardingStep(steps, 'sheetsWrite', 'failed', error.message || 'Onboarding failed before the Students sheet write completed.');
      steps = markOnboardingStep(steps, 'registryWrite', 'skipped', 'Skipped because the Students sheet write did not complete.');
      steps = markOnboardingStep(steps, 'mmsActivation', 'skipped', 'Skipped because the Students sheet write did not complete.');
      steps = markOnboardingStep(steps, 'mmsBillingProfile', 'skipped', 'Skipped because the Students sheet write did not complete.');
      steps = markOnboardingStep(steps, 'mmsFirstLesson', 'skipped', 'Skipped because the Students sheet write did not complete.');
      steps = markOnboardingStep(steps, 'mmsFreeSlot', 'skipped', 'Skipped because the Students sheet write did not complete.');
    }

    return Response.json(
      {
        error: error.message || 'Onboarding failed',
        steps,
        recoveryGuidance: buildOnboardingRecoveryGuidance({ steps, duplicateState }),
      },
      { status: 500 },
    );
  }
}
