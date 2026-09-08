/** @fileoverview Admin-gated endpoint turning a tutor absence date range into planning cards and a schedule review, capped at a bounded number of dates. */
import { planningSaveErrorBody } from '@/lib/admin/planning-duplicate-helpers.mjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { getPlanningDashboard, savePlanningItem } from '@/lib/admin/planning';
import { getTutorAbsenceScheduleReview, getTutorAbsenceWorkflow, saveTutorAbsenceWorkflow } from '@/lib/admin/tutor-absence';
import {
  buildDateInputRange,
  buildTutorAbsencePlanningId,
  buildTutorAbsencePlanningItem,
} from '@/lib/admin/planning-helpers.mjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_DATES = 21;
const MAX_PREVIEW_DAYS = 35;

function tutorAbsenceDetailsFromCard(item = {}) {
  const notes = `${item.notes || ''}`;
  const tutorShortName = notes.match(/^Tutor:\s*(.+)$/mu)?.[1]?.trim() || `${item.linkedTutorId || ''}`.trim();
  const absenceDate = notes.match(/^Tutor absence date:\s*(\d{4}-\d{2}-\d{2})$/mu)?.[1] || '';
  return { tutorShortName, absenceDate };
}

function withTutorAbsenceDecision(notes = '', decision = '') {
  const lines = `${notes || ''}`.split('\n').filter((line) => !/^Tutor absence decision:/iu.test(line));
  lines.push(`Tutor absence decision: ${decision}`);
  return lines.filter(Boolean).join('\n');
}

function absenceIdsFromCard(item = {}) {
  const notes = `${item.notes || ''}`;
  const matches = [...notes.matchAll(/^Tutor absence IDs?:\s*(.+?)\.?$/gmu)];
  return [...new Set(matches.flatMap((match) => match[1].split(',').map((value) => value.trim()).filter(Boolean)))];
}

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const mode = `${body?.mode || 'create'}`.trim();
  const tutorShortName = `${body?.tutorShortName || ''}`.trim();
  const dates = Array.isArray(body?.dates)
    ? [...new Set(body.dates.map((value) => `${value || ''}`.trim()).filter(Boolean))]
    : [];

  if (mode === 'verify_schedule') {
    const planningId = `${body?.planningId || ''}`.trim();
    if (!planningId) return Response.json({ error: 'planningId is required' }, { status: 400 });
    try {
      const planning = await getPlanningDashboard();
      const card = planning.items.find((item) => item.planningId === planningId);
      if (!card) return Response.json({ error: 'Planning card was not found' }, { status: 404 });
      const absenceIds = absenceIdsFromCard(card);
      if (!absenceIds.length) return Response.json({ ready: true, reviews: [] });
      const reviews = await Promise.all(absenceIds.map((absenceId) => getTutorAbsenceScheduleReview({
        absenceId,
        studentMmsId: card.linkedStudentId || '',
      })));
      const blocked = reviews.find((review) => !review.ready);
      return Response.json({ ready: !blocked, reviews, error: blocked?.message || '' }, { status: blocked ? 409 : 200 });
    } catch (error) {
      return Response.json({ error: error.message || 'Could not verify the MMS schedule' }, { status: 500 });
    }
  }

  if (mode === 'decide') {
    const planningId = `${body?.planningId || ''}`.trim();
    const decision = `${body?.decision || ''}`.trim();
    if (!planningId || !['cancel_day', 'cover'].includes(decision)) {
      return Response.json({ error: 'A tutor absence card and a cancel or cover decision are required' }, { status: 400 });
    }

    try {
      const planning = await getPlanningDashboard();
      const card = planning.items.find((item) => item.planningId === planningId);
      if (!card || card.linkedWorkflowId !== 'tutor-absence' || !card.linkedTutorId) {
        return Response.json({ error: 'Tutor absence planning card was not found' }, { status: 404 });
      }

      const details = tutorAbsenceDetailsFromCard(card);
      if (!details.tutorShortName || !details.absenceDate) {
        return Response.json({ error: 'Tutor absence date details are missing from this planning card' }, { status: 400 });
      }

      const workflow = await getTutorAbsenceWorkflow(details);
      if (!workflow.selectedTutor) {
        return Response.json({ error: 'Tutor was not found for this absence card' }, { status: 400 });
      }
      if (workflow.loadError) {
        return Response.json({ error: `MMS could not load this date: ${workflow.loadError}` }, { status: 503 });
      }
      const noAffectedLessons = workflow.lessons.length === 0;
      await saveTutorAbsenceWorkflow({
        absenceId: workflow.absenceId,
        tutorShortName: workflow.selectedTutor.shortName,
        tutorName: workflow.selectedTutor.fullName,
        absenceDate: workflow.selectedDate,
        status: decision === 'cancel_day' ? (noAffectedLessons ? 'resolved' : 'pause_handoff') : 'in_progress',
        decision,
        coverTutorShortName: workflow.state.coverTutorShortName || '',
        coverTutorName: workflow.state.coverTutorName || '',
        affectedLessons: workflow.lessons,
        messageState: workflow.state.messageState || {},
        note: workflow.state.note || '',
        updatedBy: session.user.email || '',
      });

      await savePlanningItem({
        planningId,
        item: {
          ...card,
          notes: withTutorAbsenceDecision(card.notes, decision),
          // Heal older capture rows whose unset flag would otherwise fall back
          // to the word "pause" in the cancellation handoff copy.
          isPause: false,
          status: decision === 'cancel_day' && noAffectedLessons ? 'done' : 'waiting',
          outcome: decision === 'cancel_day'
            ? noAffectedLessons
              ? 'Cancelled — no affected lessons were found, so no further action is needed.'
              : 'Cancelled — linked structured pause cards now own parent and payment follow-through.'
            : 'Cover selected — finish the short cover checklist in the tutor absence workflow.',
          nextAction: decision === 'cancel_day'
            ? noAffectedLessons
              ? 'Completed automatically: no MMS lessons were affected.'
              : 'Waiting for linked pause cards to complete; this absence closes automatically.'
            : 'Open the tutor absence workflow to confirm the cover tutor, briefing, calendar and parent message.',
        },
        actorEmail: session.user.email || '',
        progressNote: decision === 'cancel_day'
          ? noAffectedLessons
            ? 'Cancelled in Planning; no MMS lessons were affected.'
            : 'Cancelled in Planning and handed to grouped structured pause cards.'
          : 'Cover selected in Planning; direct cover checklist remains.',
      });

      return Response.json({ success: true, planning: await getPlanningDashboard() });
    } catch (error) {
      return Response.json(planningSaveErrorBody(error, 'Tutor absence decision failed'), { status: error.status || 500 });
    }
  }

  if (!tutorShortName) {
    return Response.json({ error: 'tutorShortName is required' }, { status: 400 });
  }

  if (mode === 'preview_period') {
    const startDate = `${body?.startDate || ''}`.trim();
    const endDate = `${body?.endDate || ''}`.trim();
    const { dates: previewDates, tooLong } = buildDateInputRange(startDate, endDate, { maxDays: MAX_PREVIEW_DAYS });
    if (!previewDates.length) {
      return Response.json({ error: 'Add a valid start and end date for the absence period' }, { status: 400 });
    }
    if (tooLong) {
      return Response.json({ error: `Preview range is too long; use ${MAX_PREVIEW_DAYS} days or fewer` }, { status: 400 });
    }

    try {
      const preview = [];
      let selectedTutor = null;
      // Sequential for MMS safety. The preview is intentionally read-only.
      for (const absenceDate of previewDates) {
        const workflow = await getTutorAbsenceWorkflow({ tutorShortName, absenceDate });
        if (!workflow.selectedTutor) {
          return Response.json({ error: `Unknown tutor: ${tutorShortName}` }, { status: 400 });
        }
        if (workflow.loadError) {
          return Response.json({ error: `MMS could not load ${absenceDate}: ${workflow.loadError}` }, { status: 503 });
        }
        selectedTutor = workflow.selectedTutor;
        preview.push({
          date: absenceDate,
          lessonCount: workflow.lessons.length,
          students: workflow.lessons.map((lesson) => ({
            mmsId: lesson.studentMmsId,
            name: lesson.studentName,
            time: lesson.lessonTime,
          })),
          hasLessons: workflow.lessons.length > 0,
        });
      }

      return Response.json({
        success: true,
        tutor: selectedTutor ? {
          shortName: selectedTutor.shortName,
          fullName: selectedTutor.fullName,
        } : null,
        preview,
        teachingDates: preview.filter((day) => day.hasLessons).map((day) => day.date),
      });
    } catch (error) {
      return Response.json({ error: error.message || 'Tutor absence preview failed' }, { status: 500 });
    }
  }

  const invalidDate = dates.find((date) => !DATE_PATTERN.test(date));
  if (!dates.length || invalidDate) {
    return Response.json(
      { error: invalidDate ? `Invalid date: ${invalidDate}` : 'At least one absence date is required' },
      { status: 400 },
    );
  }

  if (dates.length > MAX_DATES) {
    return Response.json({ error: `A maximum of ${MAX_DATES} dates can be captured at once` }, { status: 400 });
  }

  const actorEmail = session.user.email || '';
  const createdItems = [];

  try {
    // Sequential, not Promise.all: each date hits MMS, so avoid hammering it.
    for (const absenceDate of dates) {
      // getTutorAbsenceWorkflow lazily loads affected lessons from MMS and swallows
      // MMS errors into loadError, so a bad date still yields a card (with no students).
      const workflow = await getTutorAbsenceWorkflow({ tutorShortName, absenceDate });

      if (!workflow.selectedTutor) {
        return Response.json({ error: `Unknown tutor: ${tutorShortName}` }, { status: 400 });
      }
      if (workflow.loadError) {
        return Response.json({ error: `MMS could not load ${absenceDate}: ${workflow.loadError}` }, { status: 503 });
      }

      const item = buildTutorAbsencePlanningItem({
        tutor: workflow.selectedTutor,
        absenceDate,
        lessons: workflow.lessons,
        enableEarlyNotice: true,
      });

      const saved = await savePlanningItem({
        planningId: buildTutorAbsencePlanningId(workflow.selectedTutor.shortName, absenceDate),
        item,
        actorEmail,
        progressNote: 'Captured via tutor absence planning builder.',
      });

      createdItems.push(saved);
    }

    return Response.json({
      success: true,
      planning: await getPlanningDashboard(),
      createdItems,
    });
  } catch (error) {
    return Response.json(planningSaveErrorBody(error, 'Tutor absence capture failed'), { status: error.status || 500 });
  }
}
