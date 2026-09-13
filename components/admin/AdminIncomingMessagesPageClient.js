'use client';

import { planningSaveClientError } from '@/lib/admin/planning-duplicate-helpers.mjs';
import PlanningSaveError from './planning/PlanningSaveError';
import GroupMapPanel from './IncomingGroupMapPanel';
import TutorMessageBadge from './TutorMessageBadge';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Clock3, Ellipsis, RefreshCw, Reply, RotateCcw } from 'lucide-react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import {
  assessBridgeHealth,
  buildIncomingUndoSnapshot,
  buildIncomingReplyTemplate,
  buildWhatsappShareUrl,
  clusterIncomingMessages,
  extractIncomingMessageDates,
  INCOMING_MESSAGE_ACTIONABILITY,
  INCOMING_MESSAGE_CATEGORIES,
  isAutoArchivedMessage,
  mergeIncomingInboxMutation,
  isIncomingPlaceholderText,
  labelIncomingCategory,
  labelIncomingActionability,
  labelIncomingIntent,
  labelIncomingResolutionType,
  labelIncomingStatus,
  resolveIncomingPlanningAction,
  retainIncomingSelection,
  selectAdjacentIncomingId,
} from '@/lib/admin/incoming-message-helpers.mjs';
import { formatFriendlyDate } from '@/lib/admin/incoming-date-helpers.mjs';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ABSENCE_CATEGORIES = new Set(['one_off_absence', 'extended_absence', 'summer_break', 'absence_pause']);
const HANDOFF_STORAGE_KEY = 'first-chord-incoming-handoff';
const QUEUE_SELECTION_KEY = 'first-chord-incoming-selection';
const QUEUE_SCROLL_KEY = 'first-chord-incoming-scroll';
const HANDOFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function openWhatsappSurface(message = '') {
  const url = buildWhatsappShareUrl(message);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.assign(url);
}

function readStoredHandoff() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(HANDOFF_STORAGE_KEY) || 'null');
    const createdMs = new Date(stored?.createdAt || '').getTime();
    if (!stored?.reply || !Number.isFinite(createdMs) || Date.now() - createdMs > HANDOFF_MAX_AGE_MS) {
      window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function isWhatsappGroup(chatId = '') {
  return `${chatId || ''}`.trim().endsWith('@g.us');
}

function ConversationContext({ messages = [], loading = false }) {
  if (loading) {
    return <p className="mt-3 text-xs text-slate-400">Checking recent conversation…</p>;
  }
  if (!messages.length) return null;

  return (
    <details className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
        Earlier in this chat · {messages.length}
      </summary>
      <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
        {messages.map((message) => (
          <div key={message.incomingId} className="text-xs leading-5 text-slate-600">
            <p className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>{message.senderName || message.matchedStudentName || 'Earlier message'}</span>
              <time dateTime={message.messageAt || message.capturedAt || undefined}>
                {formatMessageStamp(message.messageAt || message.capturedAt)}
              </time>
            </p>
            <p className="mt-0.5 whitespace-pre-line">{message.messageText}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function HandoffTray({ handoff, onOpenWhatsapp, onConfirmSent, onDismiss, isPending }) {
  if (!handoff) return null;
  const label = handoff.studentName || handoff.senderName || 'this conversation';
  const hasOpened = Boolean(handoff.openedAt);

  return (
    <div aria-live="polite" className="sticky top-2 z-30 rounded-2xl border border-violet-200 bg-violet-50/95 px-4 py-3 text-sm text-violet-950 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {hasOpened ? `Did that reply go to ${label}?` : `Reply for ${label} is ready.`}
          </p>
          <p className="mt-0.5 text-xs text-violet-800/80">
            {handoff.alreadyResolved
              ? 'The plan is safe; confirm the WhatsApp handoff or leave the reply with the plan.'
              : 'The inbox will only finish this message when you confirm it was sent.'}
            {handoff.chatName ? ` Choose “${handoff.chatName}” in WhatsApp.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasOpened ? (
            <button
              type="button"
              disabled={isPending}
              onClick={onConfirmSent}
              className="min-h-10 rounded-full bg-violet-700 px-4 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
            >
              {isPending ? 'Finishing…' : handoff.alreadyResolved ? 'Sent — done' : 'Sent — finish & next'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={onOpenWhatsapp}
            className="min-h-10 rounded-full border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 disabled:opacity-60"
          >
            {hasOpened ? 'Open WhatsApp again' : 'Open WhatsApp'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onDismiss}
            className="min-h-10 rounded-full px-3 text-xs font-semibold text-violet-700 disabled:opacity-60"
          >
            {handoff.alreadyResolved ? 'Leave with plan' : 'Not yet'}
          </button>
          {handoff.planningId ? (
            <Link
              href={`/admin/planning?focus=${encodeURIComponent(handoff.planningId)}`}
              className="min-h-10 rounded-full px-3 py-2.5 text-xs font-semibold text-violet-700"
            >
              Open plan
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function UndoToast({ action, onUndo, isPending }) {
  if (!action) return null;
  return (
    <div aria-live="polite" className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl sm:bottom-6">
      <span>{action.label}</span>
      <button
        type="button"
        disabled={isPending}
        onClick={onUndo}
        className="font-semibold text-emerald-300 disabled:opacity-60"
      >
        {isPending ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  );
}


function PlanPanel({ entry, studentOptions = [], onCorrect, onConvert, isPending, isOpen, onOpenChange }) {
  const extractedDates = extractIncomingMessageDates(entry);
  const [category, setCategory] = useState(entry.suspectedCategory || 'general');
  const [actionability, setActionability] = useState(entry.classificationActionability || 'uncertain');
  const [matchedMmsId, setMatchedMmsId] = useState(entry.matchedMmsId || '');
  const [startDate, setStartDate] = useState(extractedDates.startDate || '');
  const [returnDate, setReturnDate] = useState(extractedDates.returnDate || '');
  const selectedStudent = studentOptions.find((student) => student.mmsId === matchedMmsId) || null;
  const suggestedReply = buildIncomingReplyTemplate({
    groupType: entry.groupType,
    category,
    senderName: entry.senderName,
    parentName: selectedStudent?.parentName || '',
    studentName: entry.matchedStudentName || selectedStudent?.fullName || '',
    startDate,
    returnDate,
  });
  const [replyDraft, setReplyDraft] = useState(suggestedReply);
  const [replyWasEdited, setReplyWasEdited] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [confirmGroupMap, setConfirmGroupMap] = useState(entry.groupType !== 'tutor' && isWhatsappGroup(entry.chatId));
  const canConfirmGroup = isWhatsappGroup(entry.chatId) && matchedMmsId;
  const isRangePause = ['extended_absence', 'summer_break', 'absence_pause'].includes(category);
  const showDates = ABSENCE_CATEGORIES.has(category) || startDate || returnDate;

  useEffect(() => {
    if (!replyWasEdited) setReplyDraft(suggestedReply);
  }, [replyWasEdited, suggestedReply]);

  function correctionPayload(status = 'needs_review') {
    return {
      category,
      actionability,
      matchedMmsId,
      reviewNote,
      confirmGroupMap,
      startDate,
      returnDate,
      replyTemplate: replyDraft.trim(),
      status,
    };
  }

  async function createPlanWithReply() {
    const reply = replyDraft.trim();
    if (!reply) return;
    setCopyError('');
    try {
      await navigator.clipboard.writeText(reply);
    } catch {
      setCopyError('Could not copy the reply. Copy it manually, then try again.');
      return;
    }

    logCommunicationCopy({
      category: entry.groupType === 'tutor' ? 'general' : ABSENCE_CATEGORIES.has(category) ? 'pause' : 'parent',
      channel: 'whatsapp',
      mmsId: matchedMmsId,
      studentName: selectedStudent?.fullName || entry.matchedStudentName || '',
      body: reply,
      source: 'incoming_planning_reply',
    });
    const result = await onConvert(entry, correctionPayload('converted'));
    if (result?.planningId) onOpenChange(false);
  }

  if (!isOpen) return null;

  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/40 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-blue-950">Reply + Plan</p>
        <ActionButton onClick={() => onOpenChange(false)} variant="subtle" className="px-3 py-1.5 text-xs">Close</ActionButton>
      </div>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">{entry.groupType === 'tutor' ? 'Topic' : 'Plan type'}</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
            >
              {INCOMING_MESSAGE_CATEGORIES.map((option) => (
                <option key={option} value={option}>{labelIncomingCategory(option)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">{entry.groupType === 'tutor' ? 'Student (optional)' : 'Student'}</span>
            <select
              value={matchedMmsId}
              onChange={(event) => {
                const nextStudentId = event.target.value;
                setMatchedMmsId(nextStudentId);
                if (!nextStudentId) setConfirmGroupMap(false);
              }}
              className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
            >
              <option value="">No student selected</option>
              {studentOptions.map((student) => (
                <option key={student.mmsId} value={student.mmsId}>
                  {student.fullName}{student.fcStudentId ? ` · ${student.fcStudentId}` : ''}{student.parentName ? ` · ${student.parentName}` : ''}{student.tutor ? ` · ${student.tutor}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {showDates ? (
          <div className={`grid gap-3 ${isRangePause || returnDate ? 'sm:grid-cols-2' : ''}`}>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">
                {category === 'one_off_absence' ? 'Lesson date' : 'First date'}
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              />
            </label>
            {isRangePause || returnDate ? (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Back from</span>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(event) => setReturnDate(event.target.value)}
                  className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">{entry.groupType === 'tutor' ? 'Reply to tutor' : 'Reply to parent'}</span>
          <textarea
            value={replyDraft}
            onChange={(event) => {
              setReplyDraft(event.target.value);
              setReplyWasEdited(true);
            }}
            rows={4}
            maxLength={1200}
            className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-blue-300"
          />
          <span className="mt-1 block text-[11px] leading-5 text-slate-500">
            {entry.groupType === 'tutor' ? 'Saved with a tutor Action so you can follow up on the agreed next step.' : 'Copied now and saved with the plan, so it is still there after the payment or pause work.'}
          </span>
        </label>
        {copyError ? <p className="text-xs font-semibold text-red-700">{copyError}</p> : null}
        <button
          type="button"
          disabled={isPending || !replyDraft.trim() || (confirmGroupMap && !canConfirmGroup)}
          onClick={createPlanWithReply}
          className="min-h-11 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
        >
          {isPending ? 'Creating plan…' : 'Copy reply & create plan'}
        </button>
        <details className="rounded-xl border border-blue-100 bg-white/70 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">More plan details</summary>
          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">What does it need?</span>
              <select
                value={actionability}
                onChange={(event) => setActionability(event.target.value)}
                className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              >
                {INCOMING_MESSAGE_ACTIONABILITY.map((option) => (
                  <option key={option} value={option}>{labelIncomingActionability(option)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Note</span>
              <input
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                className="mt-1 w-full rounded-full border border-blue-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                placeholder="Anything the plan should remember"
              />
            </label>
            {entry.groupType !== 'tutor' && isWhatsappGroup(entry.chatId) ? (
              <label className="flex items-start gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                <input
                  type="checkbox"
                  checked={confirmGroupMap}
                  disabled={!matchedMmsId}
                  onChange={(event) => setConfirmGroupMap(event.target.checked)}
                  className="mt-1"
                />
                <span>Remember this group for the selected student.</span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending || (confirmGroupMap && !canConfirmGroup)}
                onClick={() => onCorrect(entry, correctionPayload('needs_review'))}
                className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm disabled:opacity-60"
              >
                Save details
              </button>
              <button
                type="button"
                disabled={isPending || (confirmGroupMap && !canConfirmGroup)}
                onClick={() => onCorrect(entry, correctionPayload('converted'))}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm disabled:opacity-60"
              >
                Save and mark done
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function ReplyPanel({ entry, entries = [entry], initialReply = '', planningId = '', title = 'Reply', onClose = null, onBeginHandoff, source = 'incoming_message_reply' }) {
  const [reply, setReply] = useState(initialReply);

  async function handleWhatsApp() {
    let copied = false;
    try {
      await navigator.clipboard.writeText(reply);
      copied = true;
    } catch {
      window.alert('WhatsApp will still open with the reply filled in, but the browser could not also copy a backup to the clipboard.');
    }

    if (copied) {
      logCommunicationCopy({
        category: entry.groupType === 'tutor' ? 'general' : 'parent',
        channel: 'whatsapp',
        mmsId: entry.matchedMmsId || '',
        studentName: entry.matchedStudentName || '',
        body: reply,
        source,
      });
    }
    onBeginHandoff({
      entry,
      entries,
      reply,
      planningId,
      alreadyResolved: Boolean(planningId),
      openNow: true,
    });
  }

  return (
    <div className="fc-slide-in mt-4 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-violet-950">{title}</p>
        <div className="flex items-center gap-2">
          {planningId ? (
            <Link
              href={`/admin/planning?focus=${encodeURIComponent(planningId)}`}
              className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-800 shadow-sm"
            >
              Open plan
            </Link>
          ) : null}
          {onClose ? <ActionButton onClick={onClose} variant="subtle" className="px-2.5 py-1 text-[11px]">Close</ActionButton> : null}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-violet-800/80">
        {entry.chatName ? `Choose “${entry.chatName}” in WhatsApp. ` : ''}Nothing sends until you tap Send.
      </p>
      <textarea
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        rows={5}
        className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-violet-300"
      />
      <button
        type="button"
        disabled={!reply.trim()}
        onClick={handleWhatsApp}
        className="mt-2 min-h-11 rounded-full bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
      >
        Copy &amp; open WhatsApp
      </button>
    </div>
  );
}

// The feature-gated suggested-reply block: one editable draft and one explicit
// WhatsApp handoff. The server records whether the proposal was used or edited;
// nothing sends until the admin chooses a chat and taps Send in WhatsApp.
function SuggestedReplyBlock({ entry, entries = [entry], proposal, onDecideReply, onBeginHandoff, isPending }) {
  const [text, setText] = useState(proposal.proposalBody || '');
  const edited = text.trim() !== (proposal.proposalBody || '').trim();
  const suggestionLabel = `${proposal.createdBy || ''}`.startsWith('model:') ? 'AI draft' : 'Standard reply';

  async function handleApprove() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.alert('The reply was not approved because the browser could not copy it. Try again or copy the text manually.');
      return;
    }
    const decided = await onDecideReply(entry, proposal, edited ? { decision: 'edit', finalBody: text } : { decision: 'use' });
    if (decided) {
      onBeginHandoff({ entry, entries, reply: text, alreadyResolved: false, openNow: true });
    }
  }

  function handleDiscard() {
    const reason = window.prompt('Discard this suggestion — why? (optional)') ?? '';
    onDecideReply(entry, proposal, { decision: 'discard', rejectionReason: reason });
  }

  return (
    <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-3">
      <p className="text-xs font-semibold text-violet-900">{suggestionLabel}</p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-violet-300"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending || !text.trim()}
          onClick={handleApprove}
          className="rounded-full bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition active:scale-[0.97] disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Copy & open WhatsApp'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleDiscard}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-60"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// Shown when the bridge captured a star without the original text (the message
// predates its cache): paste the message from WhatsApp and it re-classifies.
function PlaceholderFixPanel({ entry, onUpdateText, isPending }) {
  const [text, setText] = useState('');

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2">
      <p className="text-xs font-semibold leading-5 text-amber-900">
        WhatsApp only sent the star — the message text is missing. Paste the original message here and it will be classified and matched.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-amber-300"
        placeholder="Paste the original WhatsApp message..."
      />
      <button
        type="button"
        disabled={isPending || !text.trim()}
        onClick={() => onUpdateText(entry, text)}
        className="mt-2 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
      >
        Save message text
      </button>
    </div>
  );
}

// "Dates spotted: from Wednesday 24 June · back Monday 21 July" — the same
// extraction the convert action uses, shown up front so the guess can be
// sanity-checked against the message before creating a pause plan.
function describeSpottedDates(entry) {
  const dates = extractIncomingMessageDates(entry);
  const parts = [
    dates.startDate ? `from ${formatFriendlyDate(dates.startDate)}` : '',
    dates.returnDate ? `back ${formatFriendlyDate(dates.returnDate)}` : '',
    dates.durationWeeks ? `${dates.durationWeeks} week${dates.durationWeeks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (!parts.length && dates.dates.length) {
    parts.push(dates.dates.map((iso) => formatFriendlyDate(iso)).join(', '));
  }
  return parts.join(' · ');
}

// One-line bridge health: slate when fine, amber with the reasons when not.
// The heavy diagnostics stay in the bridge's local logs — this is just enough
// to tell "down", "connected but capturing nothing", and "quiet" apart.
function BridgeStatusStrip({ bridgeStatus, lastAutoCaptureAt = '' }) {
  const health = assessBridgeHealth(bridgeStatus, { lastAutoCaptureAt });

  if (health.state === 'none') return null;

  if (health.state === 'warn') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-2 text-xs leading-5 text-amber-900">
        <span className="font-semibold">WhatsApp bridge needs a look:</span> {health.problems.join(' · ')}
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">Recovery</summary>
          <p className="mt-1">Check that the bridge terminal is running and WhatsApp is linked, then refresh this page. Until the green tick returns, paste anything urgent manually.</p>
        </details>
      </div>
    );
  }

  return (
    <p
      className="flex items-center px-1"
      title={`Bridge connected · ${bridgeStatus.confirmedGroups} groups on the capture list · heartbeat ${formatDateTime(bridgeStatus.lastHeartbeatAt)}${lastAutoCaptureAt ? ` · last capture ${formatDateTime(lastAutoCaptureAt)}` : ''}`}
    >
      <span aria-label="WhatsApp bridge connected" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">✓</span>
    </p>
  );
}

function formatMessageStamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ' ·');
}

function localMorningIso(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function dateInputToMorningIso(value = '') {
  if (!value) return '';
  const date = new Date(`${value}T09:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function localDateInputMinimum() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = `${tomorrow.getMonth() + 1}`.padStart(2, '0');
  const day = `${tomorrow.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function describeReplyEvidence(entry) {
  const who = entry.schoolRepliedBy && entry.schoolRepliedBy !== 'me'
    ? entry.schoolRepliedBy
    : 'School';
  const messageMs = new Date(entry.messageAt || entry.capturedAt || '').getTime();
  const replyMs = new Date(entry.schoolRepliedAt || '').getTime();
  const differenceMinutes = Math.round((replyMs - messageMs) / 60000);
  if (Number.isFinite(differenceMinutes) && differenceMinutes > 0 && differenceMinutes < 60) {
    return `${who} replied ${differenceMinutes}m later`;
  }
  return `${who} replied later`;
}

function LaterChoices({ entries, onSnooze, isPending, onClose }) {
  const [customDate, setCustomDate] = useState('');

  function choose(snoozedUntil) {
    onSnooze(entries, snoozedUntil);
    onClose();
  }

  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
      <p className="text-xs font-semibold text-slate-700">Bring this back</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => choose(localMorningIso(1))}
          className="min-h-10 rounded-full border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 disabled:opacity-60"
        >
          Tomorrow
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => choose(localMorningIso(7))}
          className="min-h-10 rounded-full border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 disabled:opacity-60"
        >
          Next week
        </button>
        <label className="flex min-h-10 items-center gap-2 rounded-full border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800">
          Choose date
          <input
            type="date"
            min={localDateInputMinimum()}
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
            className="min-w-0 bg-transparent text-slate-700 outline-none"
          />
        </label>
        {customDate ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => choose(dateInputToMorningIso(customDate))}
            className="min-h-10 rounded-full bg-blue-700 px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            Save
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MessageQueueItem({ cluster, selected = false, onSelect }) {
  const { lead: entry, entries } = cluster;
  const newest = entries[entries.length - 1] || entry;
  const label = entry.groupType === 'tutor'
    ? entry.matchedTutorName || entry.senderName || 'Tutor message'
    : entry.matchedStudentName || entry.senderName || 'Check student';
  const preview = entries.map((message) => message.messageText).filter(Boolean).join(' ');
  const needsCheck = entries.some((message) => (
    message.status === 'needs_review'
    || message.classificationActionability === 'uncertain'
    || message.classificationConfidence === 'low'
  )) || (entry.groupType !== 'tutor' && (!entry.matchedMmsId || entry.matchConfidence !== 'high'));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`group w-full rounded-2xl border px-3 py-3 text-left transition ${selected
        ? 'border-[#2F6B3D]/35 bg-green-50/80 shadow-sm'
        : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'}`}
    >
      <span className="flex items-start gap-3">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${needsCheck ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{label}</span>
            <span className="shrink-0 text-[10px] text-slate-400">{formatMessageStamp(newest.messageAt || newest.capturedAt)}</span>
          </span>
          <span className="mt-1 block truncate text-xs leading-5 text-slate-500">{preview}</span>
          <span className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{labelIncomingCategory(entry.suspectedCategory)}</span>
            {entries.length > 1 ? <span>{entries.length} messages</span> : null}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className={`mt-4 h-4 w-4 shrink-0 ${selected ? 'text-[#2F6B3D]' : 'text-slate-300 group-hover:text-slate-500'}`} />
      </span>
    </button>
  );
}

// `entry` is the burst's lead message — the one that carries the signal, and
// the one Reply and Reply + Plan work from. `entries` is the whole burst,
// oldest first; outcome actions apply to all of it so nothing is left behind.
function MessageCard({ entry, entries = [entry], studentOptions, onReview, onSnooze, onDelete, onCorrect, onConvert, onUpdateText, pendingId, replyProposal, decidedReply, replyDraftingAvailable, onDraftReply, onDecideReply, onBeginHandoff, conversationContext = [], contextLoading = false }) {
  const isPending = entries.some((message) => pendingId === message.incomingId);
  const isBurst = entries.length > 1;
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isLaterOpen, setIsLaterOpen] = useState(false);
  // Date extraction and the plan draft read the whole burst, not just the lead:
  // "Amy can't come" and "on Thursday" are often two separate messages.
  const burstEntry = useMemo(
    () => (entries.length > 1
      ? { ...entry, messageText: entries.map((message) => message.messageText).join('\n') }
      : entry),
    [entry, entries],
  );
  const spottedDates = describeSpottedDates(burstEntry);
  // The stack is stamped with when it finished arriving.
  const newest = entries[entries.length - 1];
  const isOpen = ['inbox', 'needs_review'].includes(entry.status);
  const planningAction = resolveIncomingPlanningAction(entry);
  const studentNeedsCheck = entry.groupType !== 'tutor' && (!entry.matchedMmsId || entry.matchConfidence !== 'high');
  // Any unsure message in the burst makes the whole stack unsure.
  const needsReviewAccent = isOpen && entries.some((message) => (
    message.status === 'needs_review'
    || message.classificationActionability === 'uncertain'
    || message.classificationConfidence === 'low'
    || studentNeedsCheck
  ));
  const canDraftReply = replyDraftingAvailable
    && entry.groupType !== 'tutor'
    && isOpen
    && !entry.isSnoozed
    && !replyProposal
    && !decidedReply
    && !isIncomingPlaceholderText(entry.messageText);
  const canQuickReply = isOpen
    && !entry.isSnoozed
    && !replyProposal
    && !decidedReply
    && !isIncomingPlaceholderText(entry.messageText);
  const outcomeLabel = labelIncomingResolutionType(entry.resolutionType) || labelIncomingStatus(entry.status);
  const detailsId = `incoming-details-${entry.incomingId}`;
  const laterId = `incoming-later-${entry.incomingId}`;

  function openPlan() {
    setIsMoreOpen(false);
    setIsLaterOpen(false);
    setIsReplyOpen(false);
    setIsPlanOpen(true);
  }

  async function openReply() {
    setIsMoreOpen(false);
    setIsLaterOpen(false);
    setIsPlanOpen(false);
    setIsReplyOpen(false);
    if (canDraftReply) {
      const drafted = await onDraftReply(entry);
      if (drafted) return;
    }
    // Feature off, policy/provider failure, or timeout: keep Reply useful with
    // the deterministic editable template instead of trapping the workflow.
    setIsReplyOpen(true);
  }

  return (
    <article className={`rounded-2xl border bg-white/95 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)] ${needsReviewAccent ? 'border-amber-200 border-l-4' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {entry.groupType === 'tutor' ? (
              <><TutorMessageBadge /> <span>{entry.matchedTutorName || entry.senderName || 'Tutor message'}</span></>
            ) : entry.matchedMmsId ? (
              <Link href={`/admin/students/${encodeURIComponent(entry.matchedMmsId)}`} className="hover:text-blue-700">
                {entry.matchedStudentName || entry.matchedMmsId}
              </Link>
            ) : (
              entry.matchedStudentName || 'No student matched yet'
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {entry.senderName || 'Unknown sender'}
            {!entry.matchedMmsId && entry.senderPhone ? ` · ${entry.senderPhone}` : ''}
            {entry.chatName ? ` · ${entry.chatName}` : ''}
          </p>
          {studentNeedsCheck && isOpen ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Check student
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <time
            dateTime={newest.messageAt || newest.capturedAt || undefined}
            title={formatDateTime(newest.messageAt || newest.capturedAt)}
            className="text-[11px] text-slate-400"
          >
            {formatMessageStamp(newest.messageAt || newest.capturedAt)}
          </time>
          {isBurst ? <p className="text-[11px] text-slate-400">{entries.length} messages</p> : null}
          {!isOpen ? <p className="mt-1 text-[11px] font-semibold text-slate-500">{outcomeLabel}</p> : null}
          {entry.isSnoozed ? (
            <p className="mt-1 text-[11px] font-semibold text-blue-700">Back {formatMessageStamp(entry.snoozedUntil)}</p>
          ) : null}
        </div>
      </div>

      <div className={isBurst ? 'mt-3 space-y-1.5' : 'mt-3'}>
        {entries.map((message) => (
          <div key={message.incomingId}>
            <p className={`whitespace-pre-line text-[15px] leading-6 text-slate-700${isBurst ? ' rounded-xl bg-slate-50 px-3 py-2' : ''}`}>
              {message.messageText}
            </p>
            {isIncomingPlaceholderText(message.messageText) ? (
              <PlaceholderFixPanel entry={message} onUpdateText={onUpdateText} isPending={isPending} />
            ) : null}
          </div>
        ))}
      </div>

      <ConversationContext messages={conversationContext} loading={contextLoading} />

      {entry.schoolRepliedAt ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-500" title={`School activity seen ${formatDateTime(entry.schoolRepliedAt)}. This shows engagement, not confirmed resolution.`}>
          <Reply aria-hidden="true" className="h-3.5 w-3.5" />
          {describeReplyEvidence(entry)}
        </p>
      ) : null}

      {replyProposal ? (
        <SuggestedReplyBlock
          entry={entry}
          entries={entries}
          proposal={replyProposal}
          onDecideReply={onDecideReply}
          onBeginHandoff={onBeginHandoff}
          isPending={isPending}
        />
      ) : null}

      {decidedReply?.status === 'approved' ? (
        <p className="mt-3 text-xs font-semibold text-violet-800">
          ✓ Reply copied and added to the communication log.
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        {entry.isSnoozed ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onSnooze(entries, '')}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            {isPending ? 'Moving…' : 'Bring back'}
          </button>
        ) : null}
        {!entry.isSnoozed && entry.createdPlanningId ? (
          <Link
            href={`/admin/planning?focus=${encodeURIComponent(entry.createdPlanningId)}`}
            className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm"
          >
            Open plan
          </Link>
        ) : null}
        {!entry.isSnoozed && planningAction !== 'none' && !entry.createdPlanningId ? (
          <button
            type="button"
            disabled={isPending}
            onClick={openPlan}
            className="min-h-11 flex-1 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
          >
            Reply + Plan
          </button>
        ) : null}
        {canQuickReply ? (
          <button
            type="button"
            disabled={isPending}
            onClick={openReply}
            className="min-h-11 flex-1 rounded-full border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-800 transition active:scale-[0.98] disabled:opacity-60"
          >
            {isPending && canDraftReply ? 'Writing…' : 'Reply'}
          </button>
        ) : null}
        {isOpen && !entry.isSnoozed ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setIsMoreOpen(false);
              setIsLaterOpen((current) => !current);
            }}
            aria-expanded={isLaterOpen}
            aria-controls={laterId}
            aria-label="Move to later"
            title="Later"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 disabled:opacity-60"
          >
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {isOpen ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onReview(entries, 'converted')}
            aria-label="Mark handled"
            title="Mark handled"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 disabled:opacity-60"
          >
            <Check aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setIsLaterOpen(false);
            setIsMoreOpen((current) => !current);
          }}
          aria-label="More actions and details"
          title="More actions and details"
          aria-expanded={isMoreOpen}
          aria-controls={detailsId}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
        >
          <Ellipsis aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      {isLaterOpen ? (
        <div id={laterId}>
          <LaterChoices entries={entries} onSnooze={onSnooze} isPending={isPending} onClose={() => setIsLaterOpen(false)} />
        </div>
      ) : null}

      {isMoreOpen ? (
        <div id={detailsId} className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Details</p>
          <dl className="mt-2 grid gap-1.5 text-xs leading-5 text-slate-600 sm:grid-cols-[8rem_1fr]">
            <dt className="font-semibold text-slate-500">Suggestion</dt>
            <dd>{labelIncomingActionability(entry.classificationActionability)} · {labelIncomingCategory(entry.suspectedCategory)} · {labelIncomingIntent(entry.classificationIntent)} ({entry.classificationConfidence || 'unknown'})</dd>
            <dt className="font-semibold text-slate-500">Student match</dt>
            <dd>{entry.matchConfidence || 'none'}</dd>
            {spottedDates ? <><dt className="font-semibold text-slate-500">Dates found</dt><dd>{spottedDates}</dd></> : null}
            {entry.matchReasons ? <><dt className="font-semibold text-slate-500">Why</dt><dd>{entry.matchReasons}</dd></> : null}
            {entry.reviewNote ? <><dt className="font-semibold text-slate-500">Review note</dt><dd>{entry.reviewNote}</dd></> : null}
            {entry.schoolRepliedAt ? <><dt className="font-semibold text-slate-500">School activity</dt><dd>A later school message was seen in this chat. It shows engagement, not confirmed resolution.</dd></> : null}
            {entry.reviewedBy || entry.reviewedAt ? <><dt className="font-semibold text-slate-500">Last action</dt><dd>{entry.reviewedBy || 'Admin'}{entry.reviewedAt ? ` · ${formatDateTime(entry.reviewedAt)}` : ''}</dd></> : null}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            {isOpen ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onReview(entries, 'ignored')}
                className="min-h-10 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-60"
              >
                No action needed
              </button>
            ) : null}
            {isOpen ? (
              <button
                type="button"
                disabled={isPending}
                onClick={openPlan}
                className="min-h-10 rounded-full border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 disabled:opacity-60"
              >
                Correct details
              </button>
            ) : null}
            <ActionButton
              pending={isPending}
              onClick={() => onDelete(entries)}
              variant="red"
              className="min-h-10 px-3 text-xs"
            >
              Delete test message
            </ActionButton>
          </div>
        </div>
      ) : null}

      <PlanPanel
        entry={burstEntry}
        studentOptions={studentOptions}
        isPending={isPending}
        onCorrect={onCorrect}
        onConvert={(leadEntry, correction) => onConvert(leadEntry, correction, entries)}
        isOpen={isPlanOpen}
        onOpenChange={setIsPlanOpen}
      />

      {isReplyOpen ? (
        <ReplyPanel
          entry={entry}
          entries={entries}
          initialReply={buildIncomingReplyTemplate({
            groupType: entry.groupType,
            category: entry.suspectedCategory,
            senderName: entry.senderName,
            parentName: studentOptions.find((student) => student.mmsId === entry.matchedMmsId)?.parentName || '',
            studentName: entry.matchedStudentName || studentOptions.find((student) => student.mmsId === entry.matchedMmsId)?.fullName || '',
          })}
          onClose={() => setIsReplyOpen(false)}
          onBeginHandoff={onBeginHandoff}
        />
      ) : null}

    </article>
  );
}

export default function AdminIncomingMessagesPageClient({ initialInbox = [], initialGroupMap = [], studentOptions = [], tutorOptions = [], bridgeStatus = null, lastAutoCaptureAt = '', error = '', initialReplyProposals = {}, replyDraftingAvailable = false }) {
  const [inbox, setInbox] = useState(initialInbox);
  const [groupMap, setGroupMap] = useState(initialGroupMap);
  const [groupTutorOptions, setGroupTutorOptions] = useState(tutorOptions);
  const [replyProposals, setReplyProposals] = useState(initialReplyProposals);
  const [decidedReplies, setDecidedReplies] = useState({});
  const [messageText, setMessageText] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [chatName, setChatName] = useState('');
  const [status, setStatus] = useState('');
  const [pendingId, setPendingId] = useState('');
  const [pendingChatId, setPendingChatId] = useState('');
  const [submitError, setSubmitError] = useState(error);
  const [duplicatePlanningId, setDuplicatePlanningId] = useState('');
  const [inboxView, setInboxView] = useState('open');
  const [showCapture, setShowCapture] = useState(false);
  const [showGroupMap, setShowGroupMap] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(initialGroupMap.length > 0);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [doneLoaded, setDoneLoaded] = useState(initialInbox.some((entry) => ['converted', 'ignored'].includes(entry.status)));
  const [doneLoading, setDoneLoading] = useState(false);
  const [doneTotalCount, setDoneTotalCount] = useState(0);
  const [doneAutoArchivedCount, setDoneAutoArchivedCount] = useState(0);
  const [selectedIncomingId, setSelectedIncomingId] = useState(() => (
    clusterIncomingMessages(initialInbox.filter((entry) => (
      ['inbox', 'needs_review'].includes(entry.status) && !entry.isSnoozed
    )))[0]?.lead?.incomingId || ''
  ));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [latestAutoCaptureAt, setLatestAutoCaptureAt] = useState(lastAutoCaptureAt);
  const [conversationContexts, setConversationContexts] = useState({});
  const [contextLoadingId, setContextLoadingId] = useState('');
  const [pendingHandoff, setPendingHandoff] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [undoPending, setUndoPending] = useState(false);
  const queueScrollRef = useRef(null);

  useEffect(() => {
    setPendingHandoff(readStoredHandoff());
  }, []);

  useEffect(() => {
    if (!undoAction) return undefined;
    const timeoutId = window.setTimeout(() => setUndoAction(null), 12_000);
    return () => window.clearTimeout(timeoutId);
  }, [undoAction]);

  function rememberHandoff(handoff) {
    const next = { ...handoff, createdAt: handoff.createdAt || new Date().toISOString() };
    setPendingHandoff(next);
    try {
      window.sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }

  function clearHandoff() {
    setPendingHandoff(null);
    try {
      window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    } catch {}
  }

  function beginHandoff({ entry, entries = [entry], reply = '', planningId = '', alreadyResolved = false, openNow = false }) {
    const handoff = rememberHandoff({
      incomingIds: entries.map((message) => message.incomingId).filter(Boolean),
      leadIncomingId: entry.incomingId,
      studentName: entry.matchedStudentName || '',
      senderName: entry.senderName || '',
      chatName: entry.chatName || '',
      reply,
      planningId,
      alreadyResolved,
      openedAt: openNow ? new Date().toISOString() : '',
    });
    if (openNow) openWhatsappSurface(handoff.reply);
  }

  function openPendingHandoff() {
    if (!pendingHandoff?.reply) return;
    rememberHandoff({ ...pendingHandoff, openedAt: new Date().toISOString() });
    openWhatsappSurface(pendingHandoff.reply);
  }

  function dismissPendingHandoff() {
    if (!pendingHandoff) return;
    if (pendingHandoff.alreadyResolved) {
      clearHandoff();
      return;
    }
    rememberHandoff({ ...pendingHandoff, openedAt: '' });
  }

  // Fresh data whenever the (installed) app is opened or the tab regains
  // focus, plus the manual refresh button
  const refreshInbox = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const scope = inboxView === 'done' ? 'done' : 'active';
      const response = await fetch(`/api/admin/incoming-messages?scope=${scope}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setInbox((current) => {
          const keep = current.filter((entry) => (scope === 'done'
            ? !['converted', 'ignored'].includes(entry.status)
            : !['inbox', 'needs_review'].includes(entry.status)));
          return [...(data.inbox || []), ...keep];
        });
        if (scope === 'done') {
          setDoneTotalCount(Number(data.totalCount) || 0);
          setDoneAutoArchivedCount(Number(data.autoArchivedCount) || 0);
          setDoneLoaded(true);
        }
        if (Object.hasOwn(data, 'lastAutoCaptureAt')) setLatestAutoCaptureAt(data.lastAutoCaptureAt || '');
        setConversationContexts({});
      }
      if (replyDraftingAvailable) {
        const proposalsResponse = await fetch('/api/admin/incoming-messages/reply-proposals');
        const proposalsData = await proposalsResponse.json().catch(() => ({}));
        if (proposalsResponse.ok && proposalsData.success) {
          setReplyProposals(proposalsData.openByIncomingId || {});
        }
      }
    } catch {} finally {
      setIsRefreshing(false);
    }
  }, [inboxView, replyDraftingAvailable]);

  async function loadGroupMap() {
    if (groupsLoaded || groupsLoading) return;
    setGroupsLoading(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/admin/incoming-messages?scope=groups');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'WhatsApp groups failed to load');
      setGroupMap(data.groupMap || []);
      setGroupTutorOptions(data.tutorOptions || []);
      setGroupsLoaded(true);
    } catch (caught) {
      setSubmitError(caught.message || 'WhatsApp groups failed to load');
    } finally {
      setGroupsLoading(false);
    }
  }

  async function changeInboxView(value) {
    setInboxView(value);
    setMobileDetailOpen(false);
    if (value !== 'done' || doneLoaded || doneLoading) return;
    setDoneLoading(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/admin/incoming-messages?scope=done');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Completed messages failed to load');
      setInbox((current) => [
        ...current.filter((entry) => !['converted', 'ignored'].includes(entry.status)),
        ...(data.inbox || []),
      ]);
      setDoneTotalCount(Number(data.totalCount) || 0);
      setDoneAutoArchivedCount(Number(data.autoArchivedCount) || 0);
      if (Object.hasOwn(data, 'lastAutoCaptureAt')) setLatestAutoCaptureAt(data.lastAutoCaptureAt || '');
      setDoneLoaded(true);
    } catch (caught) {
      setSubmitError(caught.message || 'Completed messages failed to load');
    } finally {
      setDoneLoading(false);
    }
  }

  async function handleDraftReply(entry) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entry.incomingId);
    try {
      const response = await fetch('/api/admin/incoming-messages/reply-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'draft', incomingId: entry.incomingId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Reply drafting failed');
      }
      setReplyProposals((current) => ({ ...current, [entry.incomingId]: data.proposal }));
      return true;
    } catch (caught) {
      setSubmitError(caught.message || 'Reply drafting failed');
      return false;
    } finally {
      setPendingId('');
    }
  }

  async function handleDecideReply(entry, proposal, { decision, finalBody = '', rejectionReason = '' }) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entry.incomingId);
    try {
      const response = await fetch('/api/admin/incoming-messages/reply-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'decide', proposalId: proposal.proposalId, decision, finalBody, rejectionReason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Proposal decision failed');
      }
      setReplyProposals((current) => {
        const next = { ...current };
        delete next[entry.incomingId];
        return next;
      });
      if (data.proposal?.status === 'approved') {
        setDecidedReplies((current) => ({ ...current, [entry.incomingId]: { status: 'approved' } }));
      }
      return true;
    } catch (caught) {
      setSubmitError(caught.message || 'Proposal decision failed');
      return false;
    } finally {
      setPendingId('');
    }
  }

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') refreshInbox();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [refreshInbox]);

  const openCount = useMemo(() => inbox.filter((entry) => ['inbox', 'needs_review'].includes(entry.status) && !entry.isSnoozed).length, [inbox]);
  const laterCount = useMemo(() => inbox.filter((entry) => ['inbox', 'needs_review'].includes(entry.status) && entry.isSnoozed).length, [inbox]);
  const absenceCount = useMemo(() => inbox.filter((entry) => ABSENCE_CATEGORIES.has(entry.suspectedCategory) && ['inbox', 'needs_review'].includes(entry.status) && !entry.isSnoozed).length, [inbox]);
  const archivedCount = useMemo(() => inbox.filter((entry) => ['converted', 'ignored'].includes(entry.status)).length, [inbox]);
  const autoArchivedCount = useMemo(() => inbox.filter(isAutoArchivedMessage).length, [inbox]);
  const completedTotal = doneLoaded ? Math.max(doneTotalCount, archivedCount) : 0;
  const completedAutomatically = doneLoaded ? Math.max(doneAutoArchivedCount, autoArchivedCount) : 0;
  const visibleInbox = useMemo(() => {
    if (inboxView === 'later') {
      return inbox.filter((entry) => ['inbox', 'needs_review'].includes(entry.status) && entry.isSnoozed);
    }
    if (inboxView === 'done') {
      return inbox.filter((entry) => ['converted', 'ignored'].includes(entry.status));
    }
    return inbox.filter((entry) => (
      ['inbox', 'needs_review'].includes(entry.status) && !entry.isSnoozed
    ));
  }, [inbox, inboxView]);
  // One card per burst: consecutive messages from one sender in one chat are a
  // single thing to deal with. Clustering after filtering keeps each view's
  // stack limited to the messages that view is showing.
  const visibleClusters = useMemo(() => clusterIncomingMessages(visibleInbox), [visibleInbox]);
  const selectedCluster = useMemo(() => (
    visibleClusters.find((cluster) => cluster.lead.incomingId === selectedIncomingId)
    || visibleClusters[0]
    || null
  ), [selectedIncomingId, visibleClusters]);
  const selectedPosition = selectedCluster
    ? visibleClusters.findIndex((cluster) => cluster.lead.incomingId === selectedCluster.lead.incomingId) + 1
    : 0;
  const bridgeHealth = useMemo(
    () => assessBridgeHealth(bridgeStatus, { lastAutoCaptureAt: latestAutoCaptureAt }),
    [bridgeStatus, latestAutoCaptureAt],
  );

  useEffect(() => {
    let remembered = '';
    try {
      remembered = window.localStorage.getItem(`${QUEUE_SELECTION_KEY}:${inboxView}`) || '';
    } catch {}
    setSelectedIncomingId((current) => retainIncomingSelection(
      visibleClusters,
      visibleClusters.some((cluster) => cluster.lead.incomingId === current) ? current : remembered,
    ));
    if (!visibleClusters.length) setMobileDetailOpen(false);
  }, [inboxView, visibleClusters]);

  useEffect(() => {
    if (!selectedIncomingId || !visibleClusters.some((cluster) => cluster.lead.incomingId === selectedIncomingId)) return;
    try {
      window.localStorage.setItem(`${QUEUE_SELECTION_KEY}:${inboxView}`, selectedIncomingId);
    } catch {}
  }, [inboxView, selectedIncomingId, visibleClusters]);

  useEffect(() => {
    const element = queueScrollRef.current;
    if (!element) return;
    let stored = 0;
    try {
      stored = Number(window.localStorage.getItem(`${QUEUE_SCROLL_KEY}:${inboxView}`)) || 0;
    } catch {}
    const frame = window.requestAnimationFrame(() => { element.scrollTop = stored; });
    return () => window.cancelAnimationFrame(frame);
  }, [inboxView, visibleClusters.length]);

  useEffect(() => {
    const incomingId = selectedCluster?.lead?.incomingId || '';
    if (!incomingId || Object.hasOwn(conversationContexts, incomingId)) return undefined;
    const controller = new AbortController();
    setContextLoadingId(incomingId);
    fetch(`/api/admin/incoming-messages?scope=context&incomingId=${encodeURIComponent(incomingId)}`, {
      signal: controller.signal,
    })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok || !data.success) throw new Error(data.error || 'Conversation context failed to load');
        setConversationContexts((current) => ({ ...current, [incomingId]: data.context || [] }));
      })
      .catch((caught) => {
        if (caught.name !== 'AbortError') {
          setConversationContexts((current) => ({ ...current, [incomingId]: [] }));
        }
      })
      .finally(() => setContextLoadingId((current) => (current === incomingId ? '' : current)));
    return () => controller.abort();
  }, [conversationContexts, selectedCluster]);

  function selectMessage(incomingId) {
    setSelectedIncomingId(incomingId);
    setMobileDetailOpen(true);
  }

  function advanceAfter(incomingId) {
    setSelectedIncomingId(selectAdjacentIncomingId(visibleClusters, incomingId));
    // Keep the detail workspace open on mobile so a run of messages feels like
    // one queue, while the sticky Back control always returns to the list.
    setMobileDetailOpen(visibleClusters.length > 1);
  }

  async function postPayload(payload, { compact = false } = {}) {
    const response = await fetch('/api/admin/incoming-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, compact }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw planningSaveClientError(data, 'Incoming message save failed');
    }
    if (Array.isArray(data.inbox)) {
      setInbox(data.inbox);
    } else if (Array.isArray(data.updatedMessages) || Array.isArray(data.deletedIncomingIds)) {
      setInbox((current) => mergeIncomingInboxMutation(current, data));
    }
    if (Array.isArray(data.groupMap)) {
      setGroupMap(data.groupMap);
      setGroupsLoaded(true);
    }
    return data;
  }

  async function handleCapture(event) {
    event.preventDefault();
    setSubmitError('');
    setDuplicatePlanningId('');
    setStatus('Saving…');
    try {
      await postPayload({
        message: {
          source: 'manual_paste',
          senderName,
          senderPhone,
          chatName,
          messageText,
        },
      });
      setMessageText('');
      setSenderName('');
      setSenderPhone('');
      setChatName('');
      setStatus('Saved');
    } catch (caught) {
      setSubmitError(caught.message || 'Incoming message save failed');
      setStatus('');
    }
  }

  // One human outcome for a whole burst, persisted in one Sheets batch and
  // returned as a compact patch rather than rebuilding the complete inbox.
  async function reviewBurst(entries, nextStatus) {
    return postPayload({
      mode: 'review_batch',
      incomingIds: entries.map((message) => message.incomingId),
      status: nextStatus,
      classificationActionability: nextStatus === 'ignored' ? 'no_action' : '',
    }, { compact: true });
  }

  function armUndo(entries, data, label) {
    const updates = new Map((data.updatedMessages || []).map((row) => [row.incomingId, row]));
    const snapshots = entries.map((entry) => ({
      ...buildIncomingUndoSnapshot(entry),
      expectedReviewedAt: updates.get(entry.incomingId)?.reviewedAt || '',
    }));
    if (snapshots.every((snapshot) => snapshot.expectedReviewedAt)) {
      const entryIds = new Set(entries.map((entry) => entry.incomingId));
      setUndoAction({
        label,
        snapshots,
        incomingId: entries[0]?.incomingId || '',
        handoff: pendingHandoff?.incomingIds?.some((incomingId) => entryIds.has(incomingId))
          ? pendingHandoff
          : null,
      });
    }
  }

  async function handleReview(entries, nextStatus, undoLabel = '') {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entries[0].incomingId);
    try {
      const data = await reviewBurst(entries, nextStatus);
      armUndo(entries, data, undoLabel || (nextStatus === 'ignored' ? 'Marked no action needed' : 'Marked handled'));
      if (pendingHandoff?.incomingIds?.some((incomingId) => entries.some((entry) => entry.incomingId === incomingId))) {
        clearHandoff();
      }
      advanceAfter(entries[0].incomingId);
      return true;
    } catch (caught) {
      setSubmitError(caught.message || 'Review update failed');
      return false;
    } finally {
      setPendingId('');
    }
  }

  async function handleSnooze(entries, snoozedUntil) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entries[0].incomingId);
    try {
      const data = await postPayload({
        mode: 'snooze_batch',
        incomingIds: entries.map((message) => message.incomingId),
        snoozedUntil,
      }, { compact: true });
      armUndo(entries, data, snoozedUntil ? 'Moved to Later' : 'Brought back to Open');
      if (pendingHandoff?.incomingIds?.some((incomingId) => entries.some((entry) => entry.incomingId === incomingId))) {
        clearHandoff();
      }
      advanceAfter(entries[0].incomingId);
    } catch (caught) {
      setSubmitError(caught.message || 'Later update failed');
    } finally {
      setPendingId('');
    }
  }

  async function handleUndo() {
    if (!undoAction?.snapshots?.length) return;
    setUndoPending(true);
    setSubmitError('');
    try {
      await postPayload({ mode: 'restore_batch', snapshots: undoAction.snapshots }, { compact: true });
      setInboxView('open');
      setSelectedIncomingId(undoAction.incomingId);
      setMobileDetailOpen(true);
      if (undoAction.handoff) rememberHandoff({ ...undoAction.handoff, openedAt: '' });
      setUndoAction(null);
    } catch (caught) {
      setSubmitError(caught.message || 'Undo failed');
    } finally {
      setUndoPending(false);
    }
  }

  async function confirmPendingHandoff() {
    if (!pendingHandoff) return;
    if (pendingHandoff.alreadyResolved) {
      clearHandoff();
      return;
    }
    const entries = pendingHandoff.incomingIds
      .map((incomingId) => inbox.find((entry) => entry.incomingId === incomingId))
      .filter((entry) => entry && ['inbox', 'needs_review'].includes(entry.status));
    if (!entries.length) {
      clearHandoff();
      return;
    }
    const finished = await handleReview(entries, 'converted', 'Reply marked sent');
    if (finished) clearHandoff();
  }

  async function handleDelete(entries) {
    const [first] = entries;
    const label = first.matchedStudentName || first.senderName || first.messageText?.slice(0, 40) || 'this message';
    const scope = entries.length > 1 ? ` and the ${entries.length - 1} message(s) sent with it` : '';
    const confirmed = window.confirm(`Delete ${label}${scope} from the incoming message inbox? This is intended for test/noise rows.`);
    if (!confirmed) return;

    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(first.incomingId);
    try {
      for (const message of entries) {
        await postPayload({
          mode: 'delete',
          incomingId: message.incomingId,
        }, { compact: true });
      }
      if (pendingHandoff?.incomingIds?.some((incomingId) => entries.some((entry) => entry.incomingId === incomingId))) {
        clearHandoff();
      }
      advanceAfter(first.incomingId);
    } catch (caught) {
      setSubmitError(caught.message || 'Delete failed');
    } finally {
      setPendingId('');
    }
  }

  async function handleCorrect(entry, correction) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entry.incomingId);
    try {
      await postPayload({
        mode: 'correct',
        incomingId: entry.incomingId,
        ...correction,
      }, { compact: true });
    } catch (caught) {
      setSubmitError(caught.message || 'Correction failed');
    } finally {
      setPendingId('');
    }
  }

  async function handleReviewGroup(chatId, { matchedMmsId = '', matchedTutorId = '', groupType = '', status }) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingChatId(chatId);
    try {
      await postPayload({
        mode: 'review_group',
        chatId,
        matchedMmsId,
        matchedTutorId,
        groupType,
        status,
      });
    } catch (caught) {
      setSubmitError(caught.message || 'Group review failed');
    } finally {
      setPendingChatId('');
    }
  }

  async function handleAddGroupStudent(chatId, mmsId) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingChatId(chatId);
    try {
      await postPayload({
        mode: 'add_group_student',
        chatId,
        mmsId,
      });
    } catch (caught) {
      setSubmitError(caught.message || 'Add student to group failed');
    } finally {
      setPendingChatId('');
    }
  }

  async function handleUpdateText(entry, messageText) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entry.incomingId);
    try {
      await postPayload({
        mode: 'update_text',
        incomingId: entry.incomingId,
        messageText,
      }, { compact: true });
    } catch (caught) {
      setSubmitError(caught.message || 'Message text update failed');
    } finally {
      setPendingId('');
    }
  }

  async function handleConvert(entry, correction, burst = [entry]) {
    setSubmitError('');
    setDuplicatePlanningId('');
    setPendingId(entry.incomingId);
    try {
      const data = await postPayload({
        mode: 'convert',
        incomingId: entry.incomingId,
        relatedIncomingIds: burst.map((message) => message.incomingId),
        ...correction,
      }, { compact: true });
      beginHandoff({
        entry,
        entries: burst,
        reply: data.replyTemplate || correction.replyTemplate || '',
        planningId: data.planningId || '',
        alreadyResolved: true,
        openNow: false,
      });
      advanceAfter(entry.incomingId);
      return data;
    } catch (caught) {
      setSubmitError(caught.message || 'Conversion failed');
      setDuplicatePlanningId(caught.duplicatePlanningId || '');
      return null;
    } finally {
      setPendingId('');
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h2 className="fc-display text-3xl text-slate-900">Message Inbox</h2>
          <p className="mt-1 text-sm text-slate-500">
            {openCount
              ? `${openCount} open item${openCount === 1 ? '' : 's'}${absenceCount ? ` · ${absenceCount} absence-related` : ''}${laterCount ? ` · ${laterCount} later` : ''}`
              : bridgeHealth.state === 'warn'
                ? 'No captured messages waiting · capture needs attention'
                : laterCount
                ? `Nothing open · ${laterCount} later`
                : 'Nothing open'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshInbox}
            disabled={isRefreshing}
            aria-label="Refresh inbox"
            title="Refresh"
            className="mt-1 rounded-full p-2.5 text-slate-500 transition-colors hover:bg-white/80 hover:text-[#2F6B3D] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {submitError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><PlanningSaveError message={submitError} duplicatePlanningId={duplicatePlanningId} /></div>
      ) : null}

      <HandoffTray
        handoff={pendingHandoff}
        onOpenWhatsapp={openPendingHandoff}
        onConfirmSent={confirmPendingHandoff}
        onDismiss={dismissPendingHandoff}
        isPending={Boolean(pendingId)}
      />

      <BridgeStatusStrip bridgeStatus={bridgeStatus} lastAutoCaptureAt={latestAutoCaptureAt} />

      <section className="space-y-4">
        {/* Manual paste is the fallback now that auto-capture handles confirmed
            groups, so it stays collapsed until needed. */}
        <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => setShowCapture((current) => !current)}
            aria-expanded={showCapture}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="text-lg leading-none text-slate-400">{showCapture ? '−' : '+'}</span>
              Paste a message manually
            </span>
            <span className="hidden text-xs text-slate-400 sm:block">
              {showCapture ? 'Close' : 'Auto-capture handles confirmed groups — use this for anything else'}
            </span>
          </button>
          {showCapture ? (
            <form onSubmit={handleCapture} className="space-y-4 border-t border-slate-100 px-4 pb-5 pt-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Message</span>
                <textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  required
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  placeholder="Paste the parent message here..."
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Sender name</span>
                  <input
                    value={senderName}
                    onChange={(event) => setSenderName(event.target.value)}
                    className="mt-2 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Phone</span>
                  <input
                    value={senderPhone}
                    onChange={(event) => setSenderPhone(event.target.value)}
                    className="mt-2 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Chat / group name</span>
                  <input
                    value={chatName}
                    onChange={(event) => setChatName(event.target.value)}
                    className="mt-2 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  Save to inbox
                </button>
                {status ? <span className="text-sm text-slate-500">{status}</span> : null}
              </div>
            </form>
          ) : null}
        </div>

        <div className="standalone-hide rounded-2xl border border-slate-200 bg-white/80 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => {
              const opening = !showGroupMap;
              setShowGroupMap(opening);
              if (opening) loadGroupMap();
            }}
            aria-expanded={showGroupMap}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-800">WhatsApp group connections</span>
              <span className="mt-0.5 block text-xs text-slate-500">Open only when a student or tutor group needs checking.</span>
            </span>
            <span className="text-xs font-semibold text-slate-500">{showGroupMap ? 'Close' : groupsLoading ? 'Loading…' : 'Manage'}</span>
          </button>
          {showGroupMap ? (
            <div className="border-t border-slate-100 p-3">
              {groupsLoading && !groupsLoaded ? (
                <p className="px-1 py-3 text-sm text-slate-500">Loading WhatsApp groups…</p>
              ) : (
                <GroupMapPanel
                  groups={groupMap}
                  tutorOptions={groupTutorOptions}
                  studentOptions={studentOptions}
                  onReviewGroup={handleReviewGroup}
                  onAddGroupStudent={handleAddGroupStudent}
                  pendingChatId={pendingChatId}
                />
              )}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Inbox view">
            {[
              ['open', 'Open', openCount, 'Messages that need attention now'],
              ['later', 'Later', laterCount, 'Messages parked until a chosen date'],
              ['done', doneLoading ? 'Loading…' : 'Done', completedTotal, doneLoaded ? `${completedTotal} completed messages; ${completedAutomatically} cleared automatically` : 'Load completed messages'],
            ].map(([value, label, count, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => changeInboxView(value)}
                aria-pressed={inboxView === value}
                title={title}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${inboxView === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {label}{count ? ` ${count}` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <aside className={`${mobileDetailOpen ? 'hidden lg:block' : 'block'} min-w-0 lg:sticky lg:top-40`} aria-label="Message queue">
            <div
              ref={queueScrollRef}
              onScroll={(event) => {
                try {
                  window.localStorage.setItem(`${QUEUE_SCROLL_KEY}:${inboxView}`, `${event.currentTarget.scrollTop}`);
                } catch {}
              }}
              className="rounded-2xl border border-white/70 bg-white/55 p-2 shadow-[0_12px_36px_rgba(15,23,42,0.04)] backdrop-blur-sm lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto"
            >
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {inboxView === 'done' ? 'Completed' : inboxView === 'later' ? 'For later' : 'To handle'}
                </p>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                  {selectedPosition ? `${selectedPosition} of ${visibleClusters.length}` : visibleClusters.length}
                </span>
              </div>
              {inboxView === 'done' && completedTotal > visibleInbox.length ? (
                <p className="px-2 pb-2 text-xs text-slate-500">Showing the {visibleInbox.length} most recent of {completedTotal}.</p>
              ) : null}
              <div className="space-y-1">
                {visibleClusters.map((cluster) => (
                  <MessageQueueItem
                    key={cluster.clusterId}
                    cluster={cluster}
                    selected={selectedCluster?.lead?.incomingId === cluster.lead.incomingId}
                    onSelect={() => selectMessage(cluster.lead.incomingId)}
                  />
                ))}
              </div>
              {!visibleInbox.length ? (
                <div className={`rounded-xl border px-3 py-4 text-sm ${inboxView === 'open' && bridgeHealth.state === 'warn' ? 'border-amber-200 bg-amber-50/70 text-amber-900' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800'}`}>
                  {inboxView === 'later'
                    ? 'Nothing is waiting for later.'
                    : inboxView === 'done'
                      ? doneLoading ? 'Loading completed messages…' : 'No completed messages yet.'
                      : bridgeHealth.state === 'warn'
                        ? 'No captured messages are waiting, but WhatsApp capture needs attention above.'
                        : 'All caught up. New requests and questions will appear here.'}
                </div>
              ) : null}
            </div>
          </aside>

          <section className={`${mobileDetailOpen ? 'block' : 'hidden lg:block'} min-w-0`} aria-label="Selected message">
            <div className="sticky top-2 z-10 mb-2 flex items-center rounded-full border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur lg:hidden">
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-slate-700"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Back to {visibleClusters.length} message{visibleClusters.length === 1 ? '' : 's'}
              </button>
              {selectedPosition ? <span className="ml-auto pr-2 text-[11px] font-semibold text-slate-400">{selectedPosition} of {visibleClusters.length}</span> : null}
            </div>
            {selectedCluster ? (
              <MessageCard
                key={selectedCluster.clusterId}
                entry={selectedCluster.lead}
                entries={selectedCluster.entries}
                studentOptions={studentOptions}
                pendingId={pendingId}
                onReview={handleReview}
                onSnooze={handleSnooze}
                onDelete={handleDelete}
                onCorrect={handleCorrect}
                onConvert={handleConvert}
                onUpdateText={handleUpdateText}
                replyProposal={replyProposals[selectedCluster.lead.incomingId]}
                decidedReply={decidedReplies[selectedCluster.lead.incomingId]}
                replyDraftingAvailable={replyDraftingAvailable}
                onDraftReply={handleDraftReply}
                onDecideReply={handleDecideReply}
                onBeginHandoff={beginHandoff}
                conversationContext={conversationContexts[selectedCluster.lead.incomingId] || []}
                contextLoading={contextLoadingId === selectedCluster.lead.incomingId}
              />
            ) : (
              <div className="hidden rounded-2xl border border-white/70 bg-white/65 px-6 py-12 text-center text-sm text-slate-500 lg:block">
                Select a message from the queue.
              </div>
            )}
          </section>
        </div>
      </section>
      <UndoToast action={undoAction} onUndo={handleUndo} isPending={undoPending} />
    </div>
  );
}
