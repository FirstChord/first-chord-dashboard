'use client';

import { useState } from 'react';
import { Archive, Check, Pencil, Trash2 } from 'lucide-react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { usePressedAction } from '@/components/admin/ui/usePressedAction';
import { isFirstLessonCheckinPlanningItem, isPausePlanningItem, isTutorAbsenceNoticePlanningItem, isTutorAbsenceFinalConfirmationPlanningItem, canCloseTutorAbsenceCapture, getPlanningStory, getPlanningWhatToDo, dueChipLabel } from '@/lib/admin/planning-client-helpers.mjs';
import PlanningCard from './PlanningCard';

// Calm, focused card for the "due today" view: a plain-language headline + next step
// + minimal meta, with one obvious action. Deeper work (and the full pause toolkit)
// lives behind "Details" / inline for pauses, which renders the full PlanningCard in
// compact mode — so the pause checklist, side-screen tool, and copy button all work.
export default function DueTodayCard({
  item,
  studentOptions = [],
  paymentExpectationOverrides = {},
  onStatus,
  onArchive,
  onEdit,
  onProgress,
  onFirstLessonStep,
  onPauseCompleted,
  sortedEntry = null,
  onRepairPauseDetails,
  onOpenPauseTool,
  onConvertSchoolIdea,
  onCreateProjectAction,
  onTutorAbsenceDecision,
  onTutorAbsenceNoticeSent,
  onTutorAbsenceFinalConfirmationSent,
  onDefer,
  pendingId,
  errorMessage = '',
  nearbyPause = null,
}) {
  const isPause = isPausePlanningItem(item);
  const isFirstLesson = isFirstLessonCheckinPlanningItem(item);
  const isTutorAbsenceNotice = isTutorAbsenceNoticePlanningItem(item);
  const isTutorAbsenceFinalConfirmation = isTutorAbsenceFinalConfirmationPlanningItem(item);
  const isTutorAbsenceCapture = !isPause && item.linkedWorkflowId === 'tutor-absence' && Boolean(item.linkedTutorId);
  const canCloseAbsence = canCloseTutorAbsenceCapture(item);
  const [expanded, setExpanded] = useState(false);
  const story = getPlanningStory(item, studentOptions);
  const whatToDo = getPlanningWhatToDo(item);
  const due = dueChipLabel(item.targetDate);
  const overdue = due.startsWith('Overdue');
  const isPending = pendingId === item.planningId;
  const { press, pendingFor } = usePressedAction(isPending);

  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${overdue ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${overdue ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}>
            {due}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {item.owner && item.owner !== 'Unassigned' ? item.owner : 'Unassigned'}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ActionButton
            variant={isTutorAbsenceNotice ? 'subtle' : 'danger'}
            size="compact"
            onClick={press('archive', () => onArchive?.(item))}
            disabled={isPending}
            pending={pendingFor('archive')}
            pendingLabel={isTutorAbsenceNotice ? 'Parking…' : 'Removing…'}
            icon={isTutorAbsenceNotice ? <Archive className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          >
            {isTutorAbsenceNotice ? 'Park notice' : 'Remove'}
          </ActionButton>
          <ActionButton
            variant="subtle"
            size="compact"
            onClick={() => onEdit(item)}
            icon={<Pencil className="h-3.5 w-3.5" />}
          >
            Edit
          </ActionButton>
        </div>
      </div>

      <h3 className="mt-2 text-base font-semibold text-slate-900">{story}</h3>
      {!isPause && whatToDo ? <p className="mt-1 text-sm leading-6 text-slate-600">{whatToDo}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {/* The one case where a capture card may be closed by hand: nothing it
            delegated is still open. Without this the card could only wait for a
            server sync that had already decided not to run. */}
        {canCloseAbsence ? (
          <ActionButton
            onClick={press('done', () => onStatus(item, 'done'))}
            disabled={isPending}
            pending={pendingFor('done')}
            pendingLabel="Closing…"
            icon={<Check className="h-4 w-4" />}
          >
            Close this absence
          </ActionButton>
        ) : null}
        {!isPause && !isFirstLesson && !isTutorAbsenceCapture && !isTutorAbsenceNotice && !isTutorAbsenceFinalConfirmation && (
          <ActionButton
            onClick={press('done', () => onStatus(item, 'done'))}
            disabled={isPending || (item.itemType === 'initiative' && Boolean(item.openProjectActions?.length))}
            pending={pendingFor('done')}
            pendingLabel="Saving…"
            icon={<Check className="h-4 w-4" />}
          >
            {item.itemType === 'initiative' && item.openProjectActions?.length ? 'Finish open actions first' : 'Mark done'}
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          onClick={press('defer', () => onDefer(item))}
          disabled={isPending}
          pending={pendingFor('defer')}
          pendingLabel="Deferring…"
        >
          Defer until next meeting
        </ActionButton>
        {!isPause && !isFirstLesson && !isTutorAbsenceNotice && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            {expanded ? 'Hide details' : isTutorAbsenceCapture || isTutorAbsenceNotice || isTutorAbsenceFinalConfirmation ? 'Open absence action' : 'Details'}
          </button>
        )}
      </div>

      {/* Pause cards and initial notices show their real action inline; other
          cards reveal the full card under Details. All use compact mode. */}
      {isPause || isFirstLesson || isTutorAbsenceNotice || expanded ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <PlanningCard
            item={item}
            studentOptions={studentOptions}
            paymentExpectationOverrides={paymentExpectationOverrides}
            onStatus={onStatus}
            onArchive={onArchive}
            onEdit={onEdit}
            onProgress={onProgress}
            onFirstLessonStep={onFirstLessonStep}
            onPauseCompleted={onPauseCompleted}
            sortedEntry={sortedEntry}
            onRepairPauseDetails={onRepairPauseDetails}
            onOpenPauseTool={onOpenPauseTool}
            onConvertSchoolIdea={onConvertSchoolIdea}
            onCreateProjectAction={onCreateProjectAction}
            onTutorAbsenceDecision={onTutorAbsenceDecision}
            onTutorAbsenceNoticeSent={onTutorAbsenceNoticeSent}
            onTutorAbsenceFinalConfirmationSent={onTutorAbsenceFinalConfirmationSent}
            pendingId={pendingId}
            nearbyPause={nearbyPause}
            compact
          />
        </div>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
      ) : null}
    </article>
  );
}
