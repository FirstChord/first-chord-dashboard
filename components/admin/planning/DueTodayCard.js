'use client';

import { useState } from 'react';
import { Archive, Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import { isFirstLessonCheckinPlanningItem, isPausePlanningItem, isTutorAbsenceNoticePlanningItem, isTutorAbsenceFinalConfirmationPlanningItem, getPlanningStory, getPlanningWhatToDo, dueChipLabel } from '@/lib/admin/planning-client-helpers.mjs';
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
  nearbyPause = null,
}) {
  const isPause = isPausePlanningItem(item);
  const isFirstLesson = isFirstLessonCheckinPlanningItem(item);
  const isTutorAbsenceNotice = isTutorAbsenceNoticePlanningItem(item);
  const isTutorAbsenceFinalConfirmation = isTutorAbsenceFinalConfirmationPlanningItem(item);
  const isTutorAbsenceCapture = !isPause && item.linkedWorkflowId === 'tutor-absence' && Boolean(item.linkedTutorId);
  const [expanded, setExpanded] = useState(false);
  const story = getPlanningStory(item, studentOptions);
  const whatToDo = getPlanningWhatToDo(item);
  const due = dueChipLabel(item.targetDate);
  const overdue = due.startsWith('Overdue');
  const isPending = pendingId === item.planningId;

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
          <button
            type="button"
            onClick={() => onArchive?.(item)}
            disabled={isPending}
            className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${isTutorAbsenceNotice ? 'border-slate-200 text-slate-700 hover:bg-slate-50' : 'border-red-100 text-red-700 hover:bg-red-50'}`}
          >
            {isTutorAbsenceNotice ? <Archive className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
            {isTutorAbsenceNotice ? 'Park notice' : 'Remove'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>
      </div>

      <h3 className="mt-2 text-base font-semibold text-slate-900">{story}</h3>
      {!isPause && whatToDo ? <p className="mt-1 text-sm leading-6 text-slate-600">{whatToDo}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!isPause && !isFirstLesson && !isTutorAbsenceCapture && !isTutorAbsenceNotice && !isTutorAbsenceFinalConfirmation && (
          <button
            type="button"
            onClick={() => onStatus(item, 'done')}
            disabled={isPending || (item.itemType === 'initiative' && Boolean(item.openProjectActions?.length))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {item.itemType === 'initiative' && item.openProjectActions?.length ? 'Finish open actions first' : 'Mark done'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDefer(item)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Defer until next meeting
        </button>
        {!isPause && !isFirstLesson && !isTutorAbsenceNotice && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
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
    </article>
  );
}
