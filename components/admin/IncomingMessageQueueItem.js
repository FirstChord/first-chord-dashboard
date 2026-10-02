'use client';

import { useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, Reply } from 'lucide-react';
import { getClusterReplyReceipt, schoolReplierLabel } from '@/lib/admin/incoming-reply-evidence-helpers.mjs';
import { resolveIncomingQueueSwipe } from '@/lib/admin/incoming-queue-helpers.mjs';
import IncomingCategoryBadge, { IncomingNoticeCue } from './IncomingCategoryBadge';
import { getIncomingAbsenceNoticeCue } from '@/lib/admin/incoming-category-presentation-helpers.mjs';

export default function IncomingMessageQueueItem({
  cluster, selected = false, onSelect, onHandled, selectionMode = false,
  checkedIds = {}, onToggle, disabled = false, pending = false, canHandle = false,
  formatStamp, resolutionSuggestion,
}) {
  const { lead: entry, entries } = cluster;
  const newest = entries[entries.length - 1] || entry;
  const label = entry.groupType === 'tutor'
    ? entry.matchedTutorName || entry.senderName || 'Tutor message'
    : entry.matchedStudentName || entry.senderName || 'Check student';
  const preview = entries.map((message) => message.messageText).filter(Boolean).join(' ');
  const replyReceipt = getClusterReplyReceipt(entries);
  const studentNeedsCheck = entry.groupType !== 'tutor' && (!entry.matchedMmsId || entry.matchConfidence !== 'high');
  const noticeCue = getIncomingAbsenceNoticeCue({ category: entry.suspectedCategory, entries });
  const isOpen = entries.some((message) => ['inbox', 'needs_review'].includes(message.status));
  const selectedCount = entries.filter((message) => Object.hasOwn(checkedIds, message.incomingId)).length;
  const checked = selectedCount === entries.length;
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const [swipe, setSwipe] = useState({ offset: 0, handled: false });
  const swipeEnabled = canHandle && !selectionMode && !disabled;

  function startSwipe(event) {
    suppressClick.current = false;
    if (!swipeEnabled || event.pointerType !== 'touch' || !event.isPrimary
      || event.target.closest('[data-queue-action]')) return;
    gesture.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      width: event.currentTarget.clientWidth, axis: '',
    };
  }

  function moveSwipe(event) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const next = resolveIncomingQueueSwipe({
      dx: event.clientX - start.x, dy: event.clientY - start.y,
      width: start.width, axis: start.axis,
    });
    start.axis = next.axis;
    if (next.axis !== 'horizontal') return;
    event.preventDefault();
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    suppressClick.current = true;
    setSwipe(next);
  }

  function finishSwipe(event, cancelled = false) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    gesture.current = null;
    const next = resolveIncomingQueueSwipe({
      dx: event.clientX - start.x, dy: event.clientY - start.y,
      width: start.width, axis: start.axis,
    });
    setSwipe({ offset: 0, handled: false });
    if (!cancelled && swipeEnabled && next.handled) onHandled();
  }

  return (
    <div
      data-queue-row={entry.incomingId}
      tabIndex={-1}
      className="relative scroll-mt-32 overflow-hidden rounded-2xl"
      style={{ touchAction: 'pan-y pinch-zoom' }}
      onPointerDown={startSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={(event) => finishSwipe(event)}
      onPointerCancel={(event) => finishSwipe(event, true)}
      onLostPointerCapture={(event) => {
        // Touch starts with implicit capture on the child button. Moving capture
        // to this wrapper releases that child; only losing our own capture cancels.
        if (event.target === event.currentTarget) finishSwipe(event, true);
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      {swipe.offset < 0 ? (
        <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end gap-2 pr-5 text-xs font-semibold ${swipe.handled ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
          <Check className="h-4 w-4" /> Handled
        </div>
      ) : null}
      <div
        className={`group relative flex items-center rounded-2xl border transition-transform motion-reduce:transition-none ${selected && !selectionMode
          ? 'border-[#2F6B3D]/35 bg-green-50/80 shadow-sm'
          : checked && selectionMode ? 'border-[#2F6B3D]/35 bg-green-50' : 'border-transparent bg-white hover:border-slate-200'}`}
        style={{ transform: `translateX(${swipe.offset}px)`, transitionDuration: gesture.current ? '0ms' : undefined }}
      >
        {selectionMode ? (
          <label data-queue-action className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              aria-label={`Select messages from ${label}`}
              checked={checked}
              ref={(input) => { if (input) input.indeterminate = selectedCount > 0 && !checked; }}
              onChange={onToggle}
              disabled={disabled || !canHandle}
              className="h-5 w-5 rounded accent-[#2F6B3D]"
            />
          </label>
        ) : null}
        <button
          type="button"
          data-incoming-id={entry.incomingId}
          onClick={selectionMode ? onToggle : onSelect}
          disabled={disabled || (selectionMode && !canHandle)}
          aria-current={!selectionMode && selected ? 'true' : undefined}
          aria-label={selectionMode ? `Select messages from ${label}` : undefined}
          className={`min-w-0 flex-1 py-3 text-left disabled:opacity-60 ${selectionMode ? 'pr-1' : 'pl-3 pr-1'}`}
        >
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-900">{label}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{formatStamp(newest.messageAt || newest.capturedAt)}</span>
              </span>
              <span className="mt-1 block truncate text-xs leading-5 text-slate-500">{preview}</span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <IncomingCategoryBadge category={entry.suspectedCategory} />
                {isOpen ? <IncomingNoticeCue cue={noticeCue} /> : null}
                {isOpen && studentNeedsCheck ? (
                  <span className="text-slate-600">Check student</span>
                ) : null}
                {(resolutionSuggestion?.feedback || resolutionSuggestion?.label) === 'looks_answered' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700" title="A reviewable assessment, not proof that school work is complete">Looks answered</span> : null}
                {entries.length > 1 ? <span>{entries.length} messages</span> : null}
                {replyReceipt ? <span className="inline-flex min-w-0 items-center gap-1 text-slate-500" title="A WhatsApp reply was captured. Review it before marking handled.">
                  <Reply aria-hidden="true" className="h-3 w-3 shrink-0" />
                  <span className="truncate">{schoolReplierLabel(replyReceipt.repliedBy)} replied</span>
                </span> : null}
              </span>
            </span>
          </span>
        </button>
        {!selectionMode && canHandle ? (
          <button
            type="button"
            data-queue-action
            disabled={disabled}
            onClick={onHandled}
            aria-label={`Mark messages from ${label} handled`}
            aria-busy={pending || undefined}
            title="Mark handled (E)"
            className="mx-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
          </button>
        ) : !selectionMode ? (
          <ChevronRight aria-hidden="true" className="mx-3 h-4 w-4 shrink-0 text-slate-300" />
        ) : null}
      </div>
    </div>
  );
}
