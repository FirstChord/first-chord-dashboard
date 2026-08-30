'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideOverPanel, panelActionClass } from '@/components/admin/ui/SlideOverPanel';
import {
  SCHOOL_FORWARD_PLANNING_ID,
  MONDAY_SCHEDULE_PLANNING_ID,
  buildReflectionIntentionDismissalNote,
  buildSchoolForwardReflections,
  calculateFridayReviewDate,
  calculateNextMeetingDate,
  extractDismissedReflectionIntentions,
  extractReflectionIntentions,
  getLatestSchoolForwardReflectionNote,
  flagNearbyPauses,
  normaliseReflectionIntentionKey,
  parseLinkedStudentIds,
} from '@/lib/admin/planning-helpers.mjs';
import {
  formatDateTime,
  extractPauseDatesFromPlanningItem,
  isPausePlanningItem,
  isTutorAbsenceNoticePlanningItem,
  isOpenPlanningItem,
  findStudentById,
  hasPausePaymentConfirmation,
  filterPlanningItems,
  buildSchoolNoteItem,
  PAUSE_PAYMENT_CONFIRMATION_NOTE,
  EMPTY_FORM,
  applySmartDefaults,
  buildQuickCaptureItem,
  buildPlanningRelationships,
} from '@/lib/admin/planning-client-helpers.mjs';
import { ExpandableText } from './planning/fields';
import MondayIntentionRow from './planning/MondayIntentionRow';
import SchoolNoteCapture from './planning/SchoolNoteCapture';
import ItemForm from './planning/ItemForm';
import QuickBrainCapture from './planning/QuickBrainCapture';
import PlanningCard from './planning/PlanningCard';
import PauseDatesEditor from './planning/PauseDatesEditor';
import DueTodayCard from './planning/DueTodayCard';
import { cardClasses } from '@/components/admin/ui/Card';

const STATUS_GROUPS = [
  { key: 'inbox', title: 'Inbox', hint: 'Fresh thoughts to review later.' },
  { key: 'active', title: 'Active', hint: 'Chosen work with a current next action.' },
  { key: 'waiting', title: 'Waiting', hint: 'Blocked by a reply, decision, or real-world test.' },
  { key: 'parked', title: 'Parked', hint: 'Worth keeping, but not current.' },
  { key: 'done', title: 'Done', hint: 'Completed or absorbed into normal workflow.' },
];

const PRIMARY_REVIEW_FILTERS = [
  { value: 'due_now', label: 'Due today' },
  { value: 'all', label: 'All' },
  { value: 'school_notes', label: 'Let’s work on the school' },
  { value: 'owner_fennella', label: 'Fennella' },
];

const ADVANCED_REVIEW_FILTERS = [
  { value: '', label: 'More filters' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'no_next_action', label: 'No next action' },
  { value: 'waiting_status', label: 'Waiting' },
  { value: 'linked', label: 'Linked' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'moving', label: 'Moving' },
  { value: 'initiative', label: 'Projects' },
  { value: 'action', label: 'Actions' },
  { value: 'done', label: 'Done' },
  { value: 'parked', label: 'Parked' },
];

const EMPTY_SCHOOL_NOTE_FORM = {
  title: '',
  owner: 'Unassigned',
  area: 'other',
  mainNote: '',
  keyIdeas: '',
  applications: '',
};

const PAUSE_EXPECTATION_SET_NOTE = 'Set Stripe paused expected from linked pause planning item.';
const PAUSE_COMPLETED_NOTE = 'Pause completed from Planning: pause tool run, parent confirmation sent, and payment expectation aligned.';

export default function AdminPlanningPageClient({ initialPlanning, initialFilter = 'all', initialFocusId = '', studentOptions = [], tutorOptions = [] }) {
  const [planning, setPlanning] = useState(initialPlanning || { items: [], summary: {} });
  const [quickNote, setQuickNote] = useState('');
  const [quickOptions, setQuickOptions] = useState({});
  const [quickExpanded, setQuickExpanded] = useState(false);
  const [schoolNoteForm, setSchoolNoteForm] = useState(EMPTY_SCHOOL_NOTE_FORM);
  const [schoolNotesOpen, setSchoolNotesOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  // Which editor the plan side-panel shows: 'structured' = the pause date editor,
  // 'general' = the full title/notes form. Defaults from the item type on open;
  // the panel header lets you switch (a pause card can be edited as general, and
  // a general card can be given structured pause dates).
  const [editorMode, setEditorMode] = useState('general');
  const [saveState, setSaveState] = useState({ pending: false, error: '', savedAt: '' });
  const [pendingId, setPendingId] = useState('');
  const [paymentExpectationOverrides, setPaymentExpectationOverrides] = useState({});
  const [scheduledIntentions, setScheduledIntentions] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [showDone, setShowDone] = useState(false);
  // { url, name } when the pause-tool side window is open; null when closed.
  // planningId -> { message, fading } for the brief "sorted ✓" beat when a pause
  // is completed. Deliberately the same vocabulary and timings as the issues
  // queue: one success language across the dashboard, not two.
  const [sortedPauses, setSortedPauses] = useState({});

  function startPauseSortedBeat(planningId, message, apply) {
    setSortedPauses((current) => ({ ...current, [planningId]: { message, fading: false } }));
    window.setTimeout(() => {
      setSortedPauses((current) => (
        current[planningId] ? { ...current, [planningId]: { ...current[planningId], fading: true } } : current
      ));
    }, 800);
    window.setTimeout(() => {
      apply();
      setSortedPauses((current) => {
        const next = { ...current };
        delete next[planningId];
        return next;
      });
    }, 1600);
  }

  const [pauseToolPanel, setPauseToolPanel] = useState(null);

  useEffect(() => {
    if (!pauseToolPanel && !editingItem) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') {
        setPauseToolPanel(null);
        setEditingItem(null);
        setEditForm(EMPTY_FORM);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pauseToolPanel, editingItem]);

  // Deep link (?focus=<planningId>, e.g. "Open plan" from the incoming inbox):
  // open that plan in the side panel. startEdit picks the structured pause editor
  // for pause items and the general form otherwise, so a pause converted from an
  // incoming message opens ready to edit its dates.
  const focusHandledRef = useRef(false);
  useEffect(() => {
    if (focusHandledRef.current || !initialFocusId) return;
    focusHandledRef.current = true;
    const item = (planning.items || []).find((entry) => entry.planningId === initialFocusId);
    if (item) {
      setFilter('all');
      startEdit(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Passive "noticing" aid: which open pause cards sit next to another pause for the
  // same student (so they might be one longer break). Read-only — no merging.
  const nearbyPauseFlags = useMemo(() => {
    const entries = (planning.items || [])
      .filter((item) => isOpenPlanningItem(item) && isPausePlanningItem(item))
      .map((item) => {
        const { startDate, endDate } = extractPauseDatesFromPlanningItem(item);
        return { planningId: item.planningId, studentId: item.linkedStudentId, start: startDate, end: endDate };
      });
    return flagNearbyPauses(entries);
  }, [planning.items]);

  const planningRelationships = useMemo(
    () => buildPlanningRelationships(planning.items || []),
    [planning.items],
  );

  const planningItems = useMemo(() => (planning.items || []).map((item) => {
    const projectActions = planningRelationships.actionsByProjectId.get(item.planningId) || [];
    const possibleParent = planningRelationships.itemsById.get(item.parentPlanningId) || null;
    return {
      ...item,
      parentProject: possibleParent?.itemType === 'initiative' && possibleParent.planningId !== SCHOOL_FORWARD_PLANNING_ID
        ? possibleParent
        : null,
      projectActions,
      openProjectActions: projectActions.filter((action) => !['done', 'parked'].includes(action.status)),
    };
  }), [planning.items, planningRelationships]);

  const filteredItems = useMemo(
    () => filterPlanningItems(planningItems, { filter, query, showDone }),
    [planningItems, query, filter, showDone],
  );

  // `silent` skips the pending/savedAt/pendingId bookkeeping so a multi-step
  // action (e.g. completing a pause) can own that state across several calls
  // without the button flickering enabled between steps.
  // `deferApply` hands the caller the new planning list instead of applying it
  // straight away, so a card can hold still for its completion beat before the
  // list moves underneath it.
  async function postPlanning(payload, targetId = '', { silent = false, deferApply = false } = {}) {
    if (!silent) {
      setSaveState({ pending: true, error: '', savedAt: '' });
      setPendingId(targetId);
    }
    const response = await fetch('/api/admin/planning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Planning save failed');
    }

    if (!deferApply) setPlanning(data.planning);
    if (!silent) {
      setSaveState({
        pending: false,
        error: '',
        savedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
      setPendingId('');
    }
    return data.planning;
  }

  async function handleCapture(event) {
    event.preventDefault();
    const rawNote = quickNote.trim();
    if (!rawNote) {
      setSaveState({ pending: false, error: 'Write a note before capturing.', savedAt: '' });
      return;
    }

    const item = buildQuickCaptureItem(rawNote, quickOptions, studentOptions);

    try {
      await postPlanning({
        mode: 'save',
        item,
        progressNote: item.progressNote,
      });
      setQuickNote('');
      setQuickOptions({});
      setQuickExpanded(false);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleSchoolNoteCapture(event) {
    event.preventDefault();
    const item = buildSchoolNoteItem(schoolNoteForm);
    if (!item.title) {
      setSaveState({ pending: false, error: 'Add a short title for the idea before saving.', savedAt: '' });
      return;
    }

    try {
      await postPlanning({
        mode: 'save',
        item,
        progressNote: item.progressNote,
      });
      setSchoolNoteForm(EMPTY_SCHOOL_NOTE_FORM);
      setFilter('school_notes');
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleCreateProjectAction(project, { title = '', targetDate = '' } = {}) {
    const cleanTitle = `${title || ''}`.trim();
    if (!cleanTitle || !targetDate) {
      setSaveState({ pending: false, error: 'Add an Action and choose the day you will do it.', savedAt: '' });
      return false;
    }

    try {
      await postPlanning({
        mode: 'save',
        item: {
          title: cleanTitle,
          notes: `Part of project: ${project.title}`,
          itemType: 'action',
          owner: project.owner || 'Unassigned',
          status: 'active',
          area: project.area || 'other',
          parentPlanningId: project.planningId,
          nextAction: cleanTitle,
          targetDate,
        },
        progressNote: `Created from project: ${project.title}`,
      }, project.planningId);
      return true;
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
      return false;
    }
  }

  // Monday review: turn one "next improvement" intention from Friday's reflection
  // into a dated, owned action item linked back to the reflection. The row's
  // editor supplies the shaped title/notes/owner/do-by; we key the scheduled
  // state by the original intention line so it flips even if the title was edited.
  async function handleScheduleIntention(intention, { title, notes, owner, targetDate } = {}) {
    const cleanTitle = `${title || ''}`.trim();
    if (!cleanTitle) {
      return;
    }
    try {
      await postPlanning({
        mode: 'save',
        item: {
          title: cleanTitle,
          notes: [
            `Friday intention: ${intention}`,
            `${notes || ''}`.trim(),
          ].filter(Boolean).join('\n'),
          itemType: 'action',
          owner: owner || 'Unassigned',
          status: 'active',
          area: 'other',
          parentPlanningId: SCHOOL_FORWARD_PLANNING_ID,
          targetDate: targetDate || calculateFridayReviewDate(new Date()),
          progressNote: 'Scheduled from Friday reflection.',
        },
        progressNote: 'Scheduled from Friday reflection.',
      });
      setScheduledIntentions((current) => ({
        ...current,
        [normaliseReflectionIntentionKey(intention || cleanTitle)]: { targetDate: targetDate || calculateFridayReviewDate(new Date()) },
      }));
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleDismissIntention(intention) {
    if (!mondayItem?.planningId) {
      return;
    }
    try {
      await postPlanning({
        mode: 'progress',
        planningId: mondayItem.planningId,
        progressNote: buildReflectionIntentionDismissalNote(intention),
        progressType: 'decision',
        nextAction: mondayItem.nextAction,
      }, mondayItem.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handlePauseCapture(rawNote, overrides) {
    const note = (rawNote || '').trim();
    if (!note) {
      setSaveState({ pending: false, error: 'Add the pause details before capturing.', savedAt: '' });
      return;
    }
    const item = buildQuickCaptureItem(note, overrides, studentOptions);
    try {
      await postPlanning({
        mode: 'save',
        item,
        progressNote: item.progressNote,
      });
      setQuickNote('');
      setQuickOptions({});
      setQuickExpanded(false);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleTutorAbsenceCapture(tutorShortName, dates) {
    setSaveState({ pending: true, error: '', savedAt: '' });
    try {
      const response = await fetch('/api/admin/planning/tutor-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorShortName, dates }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Tutor absence capture failed');
      }
      setPlanning(data.planning);
      setQuickNote('');
      setQuickOptions({});
      setQuickExpanded(false);
      setSaveState({
        pending: false,
        error: '',
        savedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
    }
  }

  async function handleTutorAbsenceDecision(item, decision) {
    const cancelling = decision === 'cancel_day';
    const message = cancelling
      ? 'Cancel these lessons? This creates or updates the grouped pause cards that will own the parent and payment follow-through.'
      : 'Mark these lessons as covered? You will then finish the short cover checklist.';
    if (!window.confirm(message)) return;

    setSaveState({ pending: true, error: '', savedAt: '' });
    setPendingId(item.planningId);
    try {
      const response = await fetch('/api/admin/planning/tutor-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'decide', planningId: item.planningId, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Tutor absence decision failed');
      setPlanning(data.planning);
      setSaveState({
        pending: false,
        error: '',
        savedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
      setPendingId('');
    } catch (error) {
      setSaveState({ pending: false, error: error.message || 'Tutor absence decision failed', savedAt: '' });
      setPendingId('');
    }
  }

  async function handleTutorAbsenceNoticeSent(item) {
    try {
      await verifyTutorAbsenceSchedule(item);
      await postPlanning({
        mode: 'status',
        planningId: item.planningId,
        status: 'done',
        progressNote: 'Initial tutor-absence notice sent manually; payment and final confirmation remain on the linked pause card.',
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message || 'Could not mark the initial notice sent', savedAt: '' });
      setPendingId('');
    }
  }

  async function handleTutorAbsenceFinalConfirmationSent(item) {
    try {
      await verifyTutorAbsenceSchedule(item);
      await postPlanning({
        mode: 'status',
        planningId: item.planningId,
        status: 'done',
        progressNote: 'Final tutor-absence payment outcome confirmation sent manually; no payment-tool action was required.',
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message || 'Could not mark the final confirmation sent', savedAt: '' });
      setPendingId('');
    }
  }

  async function verifyTutorAbsenceSchedule(item) {
    const notes = `${item?.notes || ''}`;
    if (!/Tutor absence IDs?:/u.test(notes)) return;
    const response = await fetch('/api/admin/planning/tutor-absence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'verify_schedule', planningId: item.planningId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ready) {
      throw new Error(data.error || 'MMS schedule needs review before continuing.');
    }
  }

  function startEdit(item, overrides = {}) {
    setEditingItem(item);
    setEditorMode(isPausePlanningItem(item) ? 'structured' : 'general');
    setEditForm(applySmartDefaults({
      ...EMPTY_FORM,
      title: item.title,
      notes: item.notes,
      itemType: item.itemType,
      planMode: item.planMode,
      owner: item.owner,
      status: item.status,
      area: item.area,
      linkedWorkflowId: item.linkedWorkflowId,
      linkedStudentId: item.linkedStudentId,
      linkedStudentIds: parseLinkedStudentIds(item.linkedStudentIds ?? item.linkedStudentId),
      linkedTutorId: item.linkedTutorId,
      parentPlanningId: item.parentPlanningId,
      outcome: item.outcome,
      nextAction: item.nextAction,
      targetDate: item.targetDate,
      isPause: item.isPause || '',
      ...overrides,
    }));
  }

  function handleConvertSchoolIdea(item, itemType) {
    startEdit(item, {
      itemType,
      status: 'active',
      linkedWorkflowId: '',
      targetDate: '',
      nextAction: itemType === 'action' ? item.title : '',
    });
  }

  async function handleEdit(event) {
    event.preventDefault();
    if (!editingItem) {
      return;
    }
    if (editForm.itemType === 'action' && ['active', 'waiting'].includes(editForm.status) && !editForm.targetDate) {
      setSaveState({ pending: false, error: 'Choose the Do on date before activating this Action.', savedAt: '' });
      return;
    }

    try {
      await postPlanning({
        mode: 'save',
        planningId: editingItem.planningId,
        item: editForm,
        progressNote: editForm.progressNote,
      }, editingItem.planningId);
      setEditingItem(null);
      setEditForm(EMPTY_FORM);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleStatus(item, status) {
    try {
      await postPlanning({
        mode: 'status',
        planningId: item.planningId,
        status,
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleArchiveItem(item) {
    const isInitialNotice = isTutorAbsenceNoticePlanningItem(item);
    const confirmed = window.confirm(isInitialNotice
      ? 'Park this initial notice card? It will leave active Planning but remain in history. This does not record the parent notice as sent.'
      : 'Remove this planning card from active planning? It will be parked, not deleted, so the history stays available.');
    if (!confirmed) return;

    try {
      await postPlanning({
        mode: 'status',
        planningId: item.planningId,
        status: 'parked',
        progressNote: isInitialNotice
          ? 'Initial tutor-absence notice parked by admin; no message-send completion was recorded.'
          : 'Removed from active Planning board by admin.',
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  // Push an item's "do by" to the next meeting day (Mon/Thu/Fri), used by the
  // calm due-today view. A save merges over the existing row, so only title +
  // targetDate need to be sent.
  async function handleDefer(item) {
    const tomorrow = new Date();
    tomorrow.setHours(12, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextMeeting = calculateNextMeetingDate(tomorrow);
    try {
      await postPlanning({
        mode: 'save',
        planningId: item.planningId,
        item: { title: item.title, targetDate: nextMeeting },
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleProgress(item, { progressNote, nextAction, targetDate, progressType = 'note', status }) {
    try {
      await postPlanning({
        mode: 'progress',
        planningId: item.planningId,
        progressNote,
        progressType,
        nextAction,
        targetDate,
        status,
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
    }
  }

  async function handleFirstLessonStep(item, { step, value }) {
    try {
      await postPlanning({
        mode: 'first_lesson_step',
        planningId: item.planningId,
        step,
        value,
      }, item.planningId);
      return true;
    } catch (error) {
      setSaveState({ pending: false, error: error.message, savedAt: '' });
      setPendingId('');
      return false;
    }
  }

  async function handleRepairPauseDetails(item, { draft, linkedStudentId }) {
    if (!draft?.isComplete) {
      setSaveState({ pending: false, error: 'Add the missing pause date details before saving.', savedAt: '' });
      return;
    }

    try {
      await postPlanning({
        mode: 'save',
        planningId: item.planningId,
        item: {
          ...item,
          title: draft.title,
          notes: draft.notes,
          itemType: 'action',
          status: item.status === 'inbox' ? 'active' : item.status,
          area: 'admin',
          linkedStudentId: linkedStudentId || item.linkedStudentId,
          targetDate: draft.targetDate || item.targetDate,
          nextAction: draft.nextAction,
          isPause: 'true',
        },
        progressNote: draft.progressNote || 'Added structured pause dates to existing planning item.',
      }, item.planningId);
    } catch (error) {
      setSaveState({ pending: false, error: error.message || 'Pause date repair failed', savedAt: '' });
      setPendingId('');
    }
  }

  async function handlePauseCompleted(item) {
    if (!item.linkedStudentId) {
      setSaveState({ pending: false, error: 'Link a student before completing a pause task.', savedAt: '' });
      return;
    }

    try {
      setSaveState({ pending: true, error: '', savedAt: '' });
      setPendingId(item.planningId);

      await verifyTutorAbsenceSchedule(item);

      if (!hasPausePaymentConfirmation(item)) {
        await postPlanning({
          mode: 'progress',
          planningId: item.planningId,
          progressNote: PAUSE_PAYMENT_CONFIRMATION_NOTE,
          progressType: 'action_completed',
          nextAction: item.nextAction,
        }, item.planningId, { silent: true });
      }

      const linkedStudent = findStudentById(studentOptions, item.linkedStudentId);
      const currentExpectation = paymentExpectationOverrides[item.linkedStudentId] || linkedStudent?.paymentExpectation || '';
      if (currentExpectation !== 'stripe_paused_expected') {
        const response = await fetch(`/api/admin/students/${encodeURIComponent(item.linkedStudentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentExpectation: 'stripe_paused_expected',
            auditContext: {
              source: 'admin_pause_workflow_action',
              actionLabel: 'Complete pause from Planning',
              note: `Linked planning item: ${item.title}`,
            },
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Pause expectation update failed');
        }

        await postPlanning({
          mode: 'progress',
          planningId: item.planningId,
          progressNote: PAUSE_EXPECTATION_SET_NOTE,
          progressType: 'action_completed',
          nextAction: item.nextAction,
        }, item.planningId, { silent: true });
        setPaymentExpectationOverrides((current) => ({
          ...current,
          [item.linkedStudentId]: 'stripe_paused_expected',
        }));
      }

      const nextPlanning = await postPlanning({
        mode: 'status',
        planningId: item.planningId,
        status: 'done',
        progressNote: PAUSE_COMPLETED_NOTE,
        progressType: 'action_completed',
        nextAction: item.nextAction,
      }, item.planningId, { silent: true, deferApply: true });

      // Clear the shared pending/pendingId once, after all steps — the button stays
      // in "Completing…" the whole time instead of flickering between calls.
      setSaveState({
        pending: false,
        error: '',
        savedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
      setPendingId('');

      // Only now — every write landed. The beat says what happened, then the
      // list catches up.
      startPauseSortedBeat(
        item.planningId,
        'Payment paused and confirmation logged.',
        () => setPlanning(nextPlanning),
      );
    } catch (error) {
      setSaveState({ pending: false, error: error.message || 'Pause completion failed', savedAt: '' });
      setPendingId('');
    }
  }

  const schoolForwardReflections = useMemo(
    () => buildSchoolForwardReflections(planning.items || [], { limit: 6 }),
    [planning.items],
  );

  const mondayItem = useMemo(
    () => (planning.items || []).find((item) => item.planningId === MONDAY_SCHEDULE_PLANNING_ID) || null,
    [planning.items],
  );
  const latestReflectionNote = useMemo(
    () => getLatestSchoolForwardReflectionNote(planning.items || []),
    [planning.items],
  );
  const reflectionIntentions = useMemo(
    () => extractReflectionIntentions(latestReflectionNote?.progressNote || ''),
    [latestReflectionNote],
  );
  const dismissedIntentions = useMemo(
    () => extractDismissedReflectionIntentions(mondayItem || {}),
    [mondayItem],
  );
  // Intentions already turned into linked action items (so they don't get
  // re-scheduled across reloads), keyed by lowercased title → the card's do-by.
  const alreadyScheduledByTitle = useMemo(() => {
    const map = new Map();
    for (const item of planning.items || []) {
      if (item.parentPlanningId === SCHOOL_FORWARD_PLANNING_ID && `${item.title || ''}`.trim()) {
        map.set(normaliseReflectionIntentionKey(item.title), { targetDate: item.targetDate || '' });
        const intentionLine = `${item.notes || ''}`.split(/\r?\n/u)
          .find((line) => /^Friday intention:/iu.test(line.trim()));
        const sourceIntention = intentionLine ? intentionLine.replace(/^Friday intention:\s*/iu, '') : '';
        const sourceKey = normaliseReflectionIntentionKey(sourceIntention);
        if (sourceKey) {
          map.set(sourceKey, { targetDate: item.targetDate || '' });
        }
      }
    }
    return map;
  }, [planning.items]);
  const openReflectionIntentions = useMemo(() => reflectionIntentions.filter((intention) => {
    const key = normaliseReflectionIntentionKey(intention);
    const sessionEntry = scheduledIntentions[key];
    const existing = alreadyScheduledByTitle.get(key);
    return !sessionEntry && !existing && !dismissedIntentions.has(key);
  }), [alreadyScheduledByTitle, dismissedIntentions, reflectionIntentions, scheduledIntentions]);
  const mondayDefaultDueDate = useMemo(() => calculateFridayReviewDate(new Date()), []);
  const mondayReviewOpen = Boolean(
    mondayItem
    && !['done', 'parked'].includes(mondayItem.status)
    && openReflectionIntentions.length > 0,
  );

  return (
    <div className="space-y-8">
      <section className="flex items-baseline justify-between gap-3">
        <h2 className="fc-display text-3xl text-slate-900">Planning</h2>
        <p className="text-sm text-slate-500">{filteredItems.length} plan{filteredItems.length === 1 ? '' : 's'}</p>
      </section>

      {mondayReviewOpen ? (
        <section className="rounded-[1.2rem] border border-blue-100 bg-blue-50/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Monday scheduling</p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">Schedule what we said we’d work on</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                From Friday’s reflection ({formatDateTime(latestReflectionNote.createdAt)}). Turn each “next improvement” into a dated, owned task — each gets a “Do by” of this Friday and links back to the reflection.
              </p>
            </div>
            <Link
              href="/admin/planning?filter=meeting"
              className="whitespace-nowrap rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-50"
            >
              Meeting view
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {openReflectionIntentions.map((intention) => (
              <MondayIntentionRow
                key={intention}
                intention={intention}
                defaultDueDate={mondayDefaultDueDate}
                onSchedule={(values) => handleScheduleIntention(intention, values)}
                onDismiss={handleDismissIntention}
                pending={saveState.pending}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Scheduled items appear on the board as dated actions. Mark the Monday card done once you’ve scheduled this week’s work.
          </p>
        </section>
      ) : null}

      {filter === 'meeting' ? (
        <section className="rounded-[1.2rem] border border-emerald-100 bg-emerald-50/80 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Meeting rhythm</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Keep things running</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Clear dated work, pauses, tutor absences, waiting items, and unresolved admin loops quickly.
              </p>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Move the school forward</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Protect time for one useful improvement, decision, or learning from the week, especially on Friday.
              </p>
            </div>
          </div>
          {schoolForwardReflections.length ? (
            <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Recent Friday reflections</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Dated progress entries from the weekly school-forward prompt. This is the raw material for monthly or quarterly summaries.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  {schoolForwardReflections.length} recent
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {schoolForwardReflections.map((reflection) => (
                  <div key={reflection.progressId} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-500">{formatDateTime(reflection.createdAt)}</p>
                    <ExpandableText text={reflection.progressNote} className="mt-1 text-sm leading-6 text-slate-700" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/70 p-4">
              <h3 className="text-base font-semibold text-slate-900">Friday reflections</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Add reflections to the Friday prompt and they will appear here as a dated record of what moved forward.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <section className={cardClasses()}>
        {saveState.savedAt && (
          <div className="flex justify-end">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Saved {saveState.savedAt}
            </span>
          </div>
        )}
        {saveState.error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveState.error}</p>
        )}
        <div className={saveState.savedAt || saveState.error ? 'mt-3' : ''}>
          <QuickBrainCapture
            rawNote={quickNote}
            setRawNote={setQuickNote}
            options={quickOptions}
            setOptions={setQuickOptions}
            studentOptions={studentOptions}
            tutorOptions={tutorOptions}
            expanded={quickExpanded}
            setExpanded={setQuickExpanded}
            onSubmit={handleCapture}
            onTutorAbsenceCapture={handleTutorAbsenceCapture}
            onPauseCapture={handlePauseCapture}
            pending={saveState.pending && !pendingId}
          />
        </div>
      </section>

      <section>
        <div className={cardClasses()}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {PRIMARY_REVIEW_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    filter === option.value
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <select
                value={PRIMARY_REVIEW_FILTERS.some((option) => option.value === filter) ? '' : filter}
                onChange={(event) => {
                  if (event.target.value) setFilter(event.target.value);
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {ADVANCED_REVIEW_FILTERS.map((option) => (
                  <option key={option.value || 'more'} value={option.value}>{option.label}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(event) => setShowDone(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                Show done/parked
              </label>
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, owner, area, workflow, student, tutor"
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>

          <div className="mt-5 space-y-6">
            {filter === 'due_now' ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">On today</h4>
                {[...filteredItems]
                  .sort((a, b) => `${a.targetDate || ''}`.localeCompare(`${b.targetDate || ''}`))
                  .map((item) => (
                    <DueTodayCard
                      key={item.planningId}
                      item={item}
                      studentOptions={studentOptions}
                      paymentExpectationOverrides={paymentExpectationOverrides}
                      onStatus={handleStatus}
                      onArchive={handleArchiveItem}
                      onEdit={startEdit}
                      onProgress={handleProgress}
                      onFirstLessonStep={handleFirstLessonStep}
                      onPauseCompleted={handlePauseCompleted}
                      sortedEntry={sortedPauses[item.planningId] || null}
                      onRepairPauseDetails={handleRepairPauseDetails}
                      onOpenPauseTool={(url, name) => setPauseToolPanel({ url, name })}
                      onConvertSchoolIdea={handleConvertSchoolIdea}
                      onCreateProjectAction={handleCreateProjectAction}
                      onTutorAbsenceDecision={handleTutorAbsenceDecision}
                      onTutorAbsenceNoticeSent={handleTutorAbsenceNoticeSent}
                      onTutorAbsenceFinalConfirmationSent={handleTutorAbsenceFinalConfirmationSent}
                      onDefer={handleDefer}
                      pendingId={pendingId}
                      nearbyPause={nearbyPauseFlags.get(item.planningId)}
                    />
                  ))}
              </div>
            ) : STATUS_GROUPS.map((group) => {
              const groupItems = filteredItems.filter((item) => item.status === group.key);
              if (!groupItems.length) {
                return null;
              }

              return (
                <section key={group.key}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{group.title}</h4>
                      <p className="mt-1 text-xs text-slate-500">{group.hint}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {groupItems.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {groupItems.map((item) => (
                      <PlanningCard
                        key={item.planningId}
                        item={item}
                        studentOptions={studentOptions}
                        paymentExpectationOverrides={paymentExpectationOverrides}
                        onStatus={handleStatus}
                        onArchive={handleArchiveItem}
                        onEdit={startEdit}
                        onProgress={handleProgress}
                        onFirstLessonStep={handleFirstLessonStep}
                        onPauseCompleted={handlePauseCompleted}
                        sortedEntry={sortedPauses[item.planningId] || null}
                        onRepairPauseDetails={handleRepairPauseDetails}
                        onOpenPauseTool={(url, name) => setPauseToolPanel({ url, name })}
                        onConvertSchoolIdea={handleConvertSchoolIdea}
                        onCreateProjectAction={handleCreateProjectAction}
                        onTutorAbsenceDecision={handleTutorAbsenceDecision}
                        onTutorAbsenceNoticeSent={handleTutorAbsenceNoticeSent}
                        onTutorAbsenceFinalConfirmationSent={handleTutorAbsenceFinalConfirmationSent}
                        pendingId={pendingId}
                        nearbyPause={nearbyPauseFlags.get(item.planningId)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {!filteredItems.length && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                No planning items match this view.
              </p>
            )}
          </div>
        </div>

      </section>

      {editingItem ? (
        <SlideOverPanel
          eyebrow="Edit plan"
          title={editingItem.title}
          maxWidth="max-w-2xl"
          onClose={() => {
            setEditingItem(null);
            setEditForm(EMPTY_FORM);
          }}
          actions={(
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setEditorMode('structured');
                  setEditForm((current) => ({ ...current, isPause: 'true' }));
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${editorMode === 'structured' ? 'bg-violet-100 text-violet-900' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Structured pause
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditorMode('general');
                  setEditForm((current) => ({ ...current, isPause: 'false' }));
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${editorMode === 'general' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                General
              </button>
            </div>
          )}
        >
          <div className="flex-1 overflow-y-auto p-5">
              {editorMode === 'structured' ? (
                <PauseDatesEditor
                  item={editingItem}
                  studentOptions={studentOptions}
                  isPending={pendingId === editingItem.planningId}
                  onSave={async (item, payload) => {
                    await handleRepairPauseDetails(item, payload);
                    setEditingItem(null);
                  }}
                  startOpen
                  hasPrefillUrl={isPausePlanningItem(editingItem)}
                />
              ) : (
                <ItemForm
                  form={editForm}
                  onChange={setEditForm}
                  studentOptions={studentOptions}
                  onSubmit={handleEdit}
                  submitLabel="Save changes"
                  pending={pendingId === editingItem.planningId}
                />
              )}
          </div>
        </SlideOverPanel>
      ) : null}

      {pauseToolPanel ? (
        <SlideOverPanel
          eyebrow="Payment pause tool"
          title={pauseToolPanel.name}
          onClose={() => setPauseToolPanel(null)}
          actions={(
            <a href={pauseToolPanel.url} target="_blank" rel="noreferrer" className={panelActionClass}>
              Open in full page ↗
            </a>
          )}
        >
          <iframe
            key={pauseToolPanel.url}
            src={pauseToolPanel.url}
            title={`Payment pause tool: ${pauseToolPanel.name}`}
            className="h-full w-full flex-1 border-0"
          />
        </SlideOverPanel>
      ) : null}


      <section className={cardClasses('border-violet-100 bg-violet-50/50')}>
        <button
          type="button"
          onClick={() => setSchoolNotesOpen((open) => !open)}
          aria-expanded={schoolNotesOpen}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <h3 className="text-lg font-semibold text-slate-900">Let&apos;s work on the school</h3>
          <span
            aria-hidden="true"
            className={`shrink-0 text-xl text-violet-700 transition-transform ${schoolNotesOpen ? 'rotate-90' : ''}`}
          >
            ›
          </span>
        </button>
        {schoolNotesOpen ? (
          <>
            <div className="mt-4 flex justify-end">
              <Link
                href="/admin/planning?filter=school_notes"
                className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-900 hover:bg-violet-50"
              >
                View all ideas
              </Link>
            </div>
            <div className="mt-3 rounded-2xl border border-violet-100 bg-white/90 p-4">
              <p className="mb-3 text-sm leading-6 text-slate-700">
                Capture anything worth discussing about the school. Ideas saved anywhere in Planning appear in this view.
              </p>
              <SchoolNoteCapture
                form={schoolNoteForm}
                onChange={setSchoolNoteForm}
                onSubmit={handleSchoolNoteCapture}
                pending={saveState.pending && !pendingId}
              />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
