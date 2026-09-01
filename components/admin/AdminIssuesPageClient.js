'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlideOverPanel, panelActionClass } from '@/components/admin/ui/SlideOverPanel';
import IssueCard from '@/components/admin/issues/IssueCard';
import { formatDateTime } from '@/lib/admin/health-helpers.mjs';
import {
  freshnessClasses,
  buildPaymentQuickActionAuditNote,
  getIssueWorkBucket,
  paymentQuickActionResolvesIssue,
} from '@/lib/admin/issues-client-helpers.mjs';

export default function AdminIssuesPageClient({ issues, freshness }) {
  const router = useRouter();
  const [issueList, setIssueList] = useState(issues);
  const [workView, setWorkView] = useState('needs_you');
  const [actionState, setActionState] = useState({ pendingId: '', error: '', success: '' });
  const [copiedEmailIssueId, setCopiedEmailIssueId] = useState('');
  // issueId -> { message, fading } for the brief "Sorted ✓" beat before a card leaves the queue.
  const [fadingIssues, setFadingIssues] = useState({});
  // { path, name } when the student-record slide-over is open; null when closed.
  const [recordPanel, setRecordPanel] = useState(null);

  // Show a card's "Sorted ✓" state, let it sit briefly, fade it, then run the list mutation.
  function startSortedFade(issueId, message, mutate) {
    setFadingIssues((current) => ({ ...current, [issueId]: { message, fading: false } }));
    window.setTimeout(() => {
      setFadingIssues((current) => (
        current[issueId] ? { ...current, [issueId]: { ...current[issueId], fading: true } } : current
      ));
    }, 800);
    window.setTimeout(() => {
      mutate();
      setFadingIssues((current) => {
        const next = { ...current };
        delete next[issueId];
        return next;
      });
    }, 1600);
  }

  async function copyEmail(issue) {
    if (!issue.email) return;
    try {
      await navigator.clipboard.writeText(issue.email);
    } catch {
      // best-effort; clipboard may be unavailable
    }
    setCopiedEmailIssueId(issue.issueId);
    window.setTimeout(() => setCopiedEmailIssueId((current) => (current === issue.issueId ? '' : current)), 1800);
  }
  const [stripeScanState, setStripeScanState] = useState({ pending: false, error: '', scannedAt: '', scannedCount: 0 });
  const [pauseSyncState, setPauseSyncState] = useState({ pending: false, error: '', success: '' });
  const [stripeRefreshState, setStripeRefreshState] = useState({});

  const LIVE_STRIPE_TYPES = [
    'ACTIVE_WITHOUT_SUBSCRIPTION',
    'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY',
    'SUBSCRIPTION_STATE_MISMATCH',
    'INACTIVE_STILL_BILLING',
    'PAYMENT_FAILED',
    'PAYMENT_RETRYING',
  ];

  useEffect(() => {
    setIssueList(issues);
  }, [issues]);

  useEffect(() => {
    if (!recordPanel) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setRecordPanel(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recordPanel]);

  const issueBuckets = useMemo(() => issueList.reduce((buckets, issue) => {
    buckets[getIssueWorkBucket(issue)].push(issue);
    return buckets;
  }, { needs_you: [], waiting: [], data_health: [], history: [] }), [issueList]);
  const visibleIssues = issueBuckets[workView] || [];
  const visibleSystemClearedIssues = issueList.filter(
    (issue) => ['open', 'acknowledged'].includes(issue.status) && !issue.sourcePresent,
  );

  async function handleDelete(issue) {
    const confirmed = window.confirm(`Remove ${issue.studentName || issue.mmsId} from the portal? This deletes their portal access and dashboard record but will not touch MMS.`);
    if (!confirmed) return;

    setActionState({ pendingId: issue.id, error: '', success: '' });

    try {
      const response = await fetch(`/api/admin/issues/${issue.mmsId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueType: issue.type, issueId: issue.issueId }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', error: payload.error || 'Delete failed', success: '' });
        return;
      }

      setActionState({ pendingId: '', error: '', success: '' });
      startSortedFade(
        issue.issueId,
        'Deleted registry entry — done.',
        () => setIssueList((current) => current.map((entry) => (
          entry.issueId === issue.issueId
            ? {
              ...entry,
              status: 'resolved',
              sourcePresent: false,
            }
            : entry
        ))),
      );
    } catch (error) {
      setActionState({ pendingId: '', error: error.message || 'Delete failed', success: '' });
    }
  }

  async function handleCreateRegistry(issue) {
    const fallbackInstrument = `${issue.instrument || ''}`.trim();
    const instrumentPrompt = fallbackInstrument || 'Guitar';
    const instrumentValue = window.prompt(
      `Instrument for ${issue.studentName || issue.mmsId}. Required for registry creation.`,
      instrumentPrompt,
    );

    if (instrumentValue === null) {
      return;
    }

    const trimmedInstrument = instrumentValue.trim();
    if (!trimmedInstrument) {
      setActionState({ pendingId: '', error: 'Instrument is required to create a registry entry.', success: '' });
      return;
    }

    const soundsliceValue = window.prompt(
      `Soundslice URL for ${issue.studentName || issue.mmsId}. Leave blank only if you intentionally want to finish portal setup later.`,
      '',
    );

    if (soundsliceValue === null) {
      return;
    }

    setActionState({ pendingId: issue.issueId, error: '', success: '' });

    try {
      const response = await fetch(`/api/admin/issues/${issue.mmsId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueType: issue.type,
          issueId: issue.issueId,
          action: 'create_registry_entry',
          registryOverrides: {
            instrument: trimmedInstrument,
            soundsliceUrl: soundsliceValue.trim(),
          },
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', error: payload.error || 'Create registry entry failed', success: '' });
        return;
      }

      setActionState({ pendingId: '', error: '', success: '' });
      startSortedFade(
        issue.issueId,
        'Created registry entry — nice one.',
        () => setIssueList((current) => current.map((entry) => (
          entry.issueId === issue.issueId
            ? {
              ...entry,
              status: 'resolved',
              sourcePresent: false,
              hasRegistryEntry: true,
              registryTutor: payload.student?.registryTutor || entry.registryTutor,
              lifecycleStatus: payload.student?.lifecycleStatus || entry.lifecycleStatus,
              lifecycleLabel: payload.student?.lifecycleLabel || entry.lifecycleLabel,
              lifecycleConfidence: payload.student?.lifecycleConfidence || entry.lifecycleConfidence,
              lifecycleReasons: payload.student?.lifecycleReasons || entry.lifecycleReasons,
              lifecycleWarnings: payload.student?.lifecycleWarnings || entry.lifecycleWarnings,
            }
            : entry
        ))),
      );
    } catch (error) {
      setActionState({ pendingId: '', error: error.message || 'Create registry entry failed', success: '' });
    }
  }

  async function handleRunStripeScan() {
    setStripeScanState({ pending: true, error: '', scannedAt: '', scannedCount: 0 });

    try {
      const response = await fetch('/api/admin/flags/stripe-scan', {
        method: 'POST',
      });

      const payload = await response.json();

      if (!response.ok) {
        setStripeScanState({ pending: false, error: payload.error || 'Stripe scan failed', scannedAt: '', scannedCount: 0 });
        return;
      }

      setIssueList((current) => {
        const withoutLiveStripe = current.filter((issue) => !LIVE_STRIPE_TYPES.includes(issue.type));
        return [...withoutLiveStripe, ...(payload.issues || [])];
      });

      setStripeScanState({
        pending: false,
        error: '',
        scannedAt: payload.scannedAt || '',
        scannedCount: payload.scannedCount || 0,
      });
    } catch (error) {
      setStripeScanState({ pending: false, error: error.message || 'Stripe scan failed', scannedAt: '', scannedCount: 0 });
    }
  }

  async function handleReconcilePauseExpectations() {
    setPauseSyncState({ pending: true, error: '', success: '' });

    try {
      const previewResponse = await fetch('/api/admin/issues/pause-expectations/reconcile', {
        cache: 'no-store',
      });
      const preview = await previewResponse.json();

      if (!previewResponse.ok) {
        setPauseSyncState({ pending: false, error: preview.error || 'Pause expectation preview failed', success: '' });
        return;
      }

      if (!preview.changeCount) {
        setPauseSyncState({
          pending: false,
          error: '',
          success: `Checked ${preview.checkedCount || 0} students. No pause expectations need changing.`,
        });
        return;
      }

      const changeLines = (preview.changes || [])
        .map((change) => `${change.studentName}: ${change.previousPaymentExpectation} → ${change.nextPaymentExpectation}`);
      const confirmed = window.confirm([
        `Update ${preview.changeCount} payment expectation${preview.changeCount === 1 ? '' : 's'} from high-confidence Pause History and lesson coverage?`,
        '',
        ...changeLines,
        '',
        'This updates the Students sheet and logs the changes. It does not change Stripe.',
      ].join('\n'));

      if (!confirmed) {
        setPauseSyncState({ pending: false, error: '', success: 'No pause expectations were changed.' });
        return;
      }

      const response = await fetch('/api/admin/issues/pause-expectations/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setPauseSyncState({ pending: false, error: payload.error || 'Pause expectation reconciliation failed', success: '' });
        return;
      }

      setPauseSyncState({
        pending: false,
        error: '',
        success: payload.changeCount
          ? `Updated and logged ${payload.changeCount} pause expectation${payload.changeCount === 1 ? '' : 's'}.`
          : 'The records changed after preview; no pause expectations needed updating.',
      });
      router.refresh();
    } catch (error) {
      setPauseSyncState({ pending: false, error: error.message || 'Pause expectation reconciliation failed', success: '' });
    }
  }

  async function handleRefreshIssueStripe(issue) {
    setStripeRefreshState((current) => ({
      ...current,
      [issue.issueId]: {
        ...(current[issue.issueId] || {}),
        loading: true,
        error: '',
      },
    }));

    try {
      const response = await fetch(`/api/admin/students/${issue.mmsId}/stripe`);
      const payload = await response.json();

      if (!response.ok) {
        setStripeRefreshState((current) => ({
          ...current,
          [issue.issueId]: {
            loading: false,
            error: payload.error || 'Stripe refresh failed',
            snapshot: null,
            issues: [],
            skippedReason: '',
          },
        }));
        return;
      }

      setStripeRefreshState((current) => ({
        ...current,
        [issue.issueId]: {
          loading: false,
          error: '',
          snapshot: payload.snapshot || null,
          issues: payload.issues || [],
          skippedReason: payload.skippedReason || '',
        },
      }));

      // The endpoint re-evaluates the live rules. If this issue's type is no longer
      // detected against the fresh snapshot, the live state now matches the dashboard
      // expectation — close the loop: persist the resolution and give the "Sorted ✓" beat.
      const freshIssues = payload.issues || [];
      const clearedByLiveCheck = (
        LIVE_STRIPE_TYPES.includes(issue.type)
        && issue.sourcePresent
        && Boolean(payload.snapshot)
        && !freshIssues.includes(issue.type)
      );

      if (clearedByLiveCheck) {
        try {
          await fetch(`/api/admin/issues/${issue.mmsId}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              issueId: issue.issueId,
              nextStatus: 'resolved',
              note: 'Cleared by live Stripe refresh — Stripe now matches the dashboard expectation.',
            }),
          });
        } catch {
          // Best-effort persistence; the optimistic clear below still applies for this session.
        }
        startSortedFade(
          issue.issueId,
          'Stripe now matches the dashboard — resolved.',
          () => setIssueList((current) => current.map((entry) => (
            entry.issueId === issue.issueId
              ? { ...entry, status: 'resolved', sourcePresent: false }
              : entry
          ))),
        );
      }
    } catch (error) {
      setStripeRefreshState((current) => ({
        ...current,
        [issue.issueId]: {
          loading: false,
          error: error.message || 'Stripe refresh failed',
          snapshot: null,
          issues: [],
          skippedReason: '',
        },
      }));
    }
  }

  async function handleStatusChange(issue, nextStatus, providedNote = '', { expectedSourcePresent } = {}) {
    let note = providedNote;
    if (nextStatus === 'ignored') {
      const prompted = window.prompt(`Optional note for ignoring ${issue.studentName || issue.mmsId}`, issue.resolutionNote || '');
      if (prompted === null) {
        return;
      }
      note = prompted.trim();
    }

    setActionState({ pendingId: issue.issueId, error: '', success: '' });

    try {
      const response = await fetch(`/api/admin/issues/${issue.mmsId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: issue.issueId,
          nextStatus,
          note,
          ...(typeof expectedSourcePresent === 'boolean' ? { expectedSourcePresent } : {}),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', error: payload.error || 'Issue update failed', success: '' });
        return;
      }

      const applyUpdate = () => setIssueList((current) => current.map((entry) => (
        entry.issueId === issue.issueId
          ? {
            ...entry,
            status: payload.issue.status,
            resolutionNote: payload.issue.resolutionNote,
            updatedAt: payload.issue.updatedAt,
            sourcePresent: payload.issue.sourcePresent,
          }
          : entry
      )));

      // Resolving or ignoring takes the card out of the active queue — give it the
      // brief "Sorted ✓" beat first. Keeping active stays in place, no beat.
      if (['resolved', 'ignored'].includes(nextStatus)) {
        setActionState({ pendingId: '', error: '', success: '' });
        const beat = nextStatus === 'resolved' ? 'Marked resolved — done.' : 'Ignored — done.';
        startSortedFade(issue.issueId, beat, applyUpdate);
        return;
      }

      applyUpdate();
      setActionState({ pendingId: '', error: '', success: '' });
    } catch (error) {
      setActionState({ pendingId: '', error: error.message || 'Issue update failed', success: '' });
    }
  }

  async function handleResolveVisibleSystemCleared() {
    if (!visibleSystemClearedIssues.length) {
      return;
    }

    const confirmed = window.confirm(
      `Clear ${visibleSystemClearedIssues.length} fixed issue${visibleSystemClearedIssues.length === 1 ? '' : 's'}? The system no longer detects ${visibleSystemClearedIssues.length === 1 ? 'it' : 'them'} — cleared issues will reappear if a future check finds them again.`,
    );

    if (!confirmed) {
      return;
    }

    setActionState({ pendingId: 'bulk-system-cleared', error: '', success: '' });

    try {
      const response = await fetch('/api/admin/issues/system-cleared/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueIds: visibleSystemClearedIssues.map((issue) => issue.issueId),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', error: payload.error || 'Bulk issue update failed', success: '' });
        return;
      }

      const resolvedIssues = payload.issues || [];

      setIssueList((current) => current.map((entry) => {
        const resolved = resolvedIssues.find((issue) => issue.issueId === entry.issueId);
        return resolved
          ? {
            ...entry,
            status: resolved.status,
            resolutionNote: resolved.resolutionNote,
            updatedAt: resolved.updatedAt,
            sourcePresent: resolved.sourcePresent,
          }
          : entry;
      }));

      setActionState({
        pendingId: '',
        error: '',
        success: `Cleared ${payload.resolvedCount || 0} fixed issue${payload.resolvedCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setActionState({ pendingId: '', error: error.message || 'Bulk issue update failed', success: '' });
    }
  }

  async function handlePaymentQuickAction(issue, action, { detectiveApproved = false } = {}) {
    const baseAuditNote = buildPaymentQuickActionAuditNote(issue, action);
    const auditNote = detectiveApproved
      ? `Detective proposal approved. ${baseAuditNote}`
      : baseAuditNote;

    setActionState({ pendingId: issue.issueId, error: '', success: '' });

    try {
      const response = await fetch(`/api/admin/students/${issue.mmsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...action.payload,
          expectedPaymentMode: issue.paymentMode || '',
          expectedPaymentExpectation: issue.paymentExpectation || '',
          auditContext: {
            source: 'admin_flags_payment_action',
            issueId: issue.issueId,
            issueType: issue.type,
            actionLabel: action.label,
            note: auditNote,
          },
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', issueId: issue.issueId, error: payload.error || 'Payment action failed', success: '' });
        return;
      }

      const resolvesIssue = paymentQuickActionResolvesIssue(issue, action);

      // When the action resolves this flag's condition, show a brief "Sorted ✓" beat
      // and then clear the card (the next detection pass agrees). Otherwise update the
      // row in place and keep it.
      if (resolvesIssue) {
        try {
          await fetch(`/api/admin/issues/${issue.mmsId}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              issueId: issue.issueId,
              nextStatus: 'resolved',
              note: auditNote,
            }),
          });
        } catch {
          // Best-effort persistence; the optimistic clear below still applies for this session.
        }
        setActionState({ pendingId: '', issueId: '', error: '', success: '' });
        startSortedFade(
          issue.issueId,
          `Set to ${payload.student.paymentExpectation || 'updated'} — nice one.`,
          () => setIssueList((current) => current.filter((entry) => entry.issueId !== issue.issueId)),
        );
        return;
      }

      setIssueList((current) => current.map((entry) => (
        entry.issueId === issue.issueId
          ? {
            ...entry,
            paymentMode: payload.student.paymentMode || entry.paymentMode,
            paymentExpectation: payload.student.paymentExpectation || '',
            lifecycleStatus: payload.student.lifecycleStatus || entry.lifecycleStatus,
            lifecycleLabel: payload.student.lifecycleLabel || entry.lifecycleLabel,
            lifecycleConfidence: payload.student.lifecycleConfidence || entry.lifecycleConfidence,
            lifecycleReasons: payload.student.lifecycleReasons || entry.lifecycleReasons,
            lifecycleWarnings: payload.student.lifecycleWarnings || entry.lifecycleWarnings,
          }
          : entry
      )));
      const actionLogged = Boolean(payload.audit?.issueActionLogged);
      setActionState({
        pendingId: '',
        issueId: issue.issueId,
        error: '',
        success: actionLogged
          ? `Payment action logged for ${issue.studentName || issue.mmsId}. The issue remains active until the source check clears it or you resolve it.`
          : `No payment field changed for ${issue.studentName || issue.mmsId}; the issue remains active.`,
      });
    } catch (error) {
      setActionState({ pendingId: '', issueId: issue.issueId, error: error.message || 'Payment action failed', success: '' });
    }
  }

  async function handlePracticeFollowUpHandled(issue) {
    setActionState({ pendingId: issue.issueId, error: '', success: '' });

    try {
      const response = await fetch('/api/admin/practice-notes/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryKey: issue.practiceNote?.deliveryKey || '',
          noteId: issue.practiceNote?.noteId || '',
          mmsId: issue.mmsId,
          studentName: issue.studentName || '',
          issueId: issue.issueId,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setActionState({ pendingId: '', issueId: issue.issueId, error: payload.error || 'Follow-up update failed', success: '' });
        return;
      }

      try {
        await fetch(`/api/admin/issues/${issue.mmsId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issueId: issue.issueId,
            nextStatus: 'resolved',
            note: 'Follow-up handled — parent note dealt with manually.',
          }),
        });
      } catch {
        // Best-effort persistence; the optimistic clear below still applies for this session.
      }

      setActionState({ pendingId: '', issueId: '', error: '', success: '' });
      startSortedFade(
        issue.issueId,
        'Follow-up handled — nice one.',
        () => setIssueList((current) => current.filter((entry) => entry.issueId !== issue.issueId)),
      );
    } catch (error) {
      setActionState({ pendingId: '', issueId: issue.issueId, error: error.message || 'Follow-up update failed', success: '' });
    }
  }

  const views = [
    { value: 'needs_you', label: 'Needs you', count: issueBuckets.needs_you.length },
    { value: 'waiting', label: 'Waiting', count: issueBuckets.waiting.length },
    { value: 'data_health', label: 'Data health', count: issueBuckets.data_health.length },
    { value: 'history', label: 'History', count: issueBuckets.history.length },
  ];

  const emptyCopy = {
    needs_you: ['Nothing needs you', 'The exceptional cases are clear.'],
    waiting: ['Nothing waiting', 'Stripe has no recoverable retries in progress.'],
    data_health: ['Data is tidy', 'There is no routine maintenance waiting.'],
    history: ['No history yet', 'Resolved issues will collect here.'],
  }[workView];

  function renderIssue(issue, featured = false) {
    return (
      <IssueCard
        key={issue.issueId || issue.id}
        issue={issue}
        freshness={freshness}
        featured={featured}
        readOnly={workView === 'history'}
        fadingEntry={fadingIssues[issue.issueId] || null}
        liveStripeState={stripeRefreshState[issue.issueId] || null}
        actionState={actionState}
        copiedEmailIssueId={copiedEmailIssueId}
        onStatusChange={handleStatusChange}
        onRefreshStripe={handleRefreshIssueStripe}
        onPaymentQuickAction={handlePaymentQuickAction}
        onCreateRegistry={handleCreateRegistry}
        onDelete={handleDelete}
        onPracticeFollowUpHandled={handlePracticeFollowUpHandled}
        onCopyEmail={copyEmail}
        onOpenRecord={setRecordPanel}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h2 className="fc-display text-3xl text-slate-900">Issues</h2>
            <span className="text-sm font-medium text-slate-500">
              {issueBuckets.needs_you.length} need{issueBuckets.needs_you.length === 1 ? 's' : ''} you
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span>Records checked {formatDateTime(freshness?.latestGeneratedAt)}</span>
            {stripeScanState.scannedAt ? <span>Stripe checked {formatDateTime(stripeScanState.scannedAt)}</span> : null}
            {freshness?.status && !['Fresh', 'Current'].includes(freshness.status) ? (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${freshnessClasses(freshness.status)}`}>
                {freshness.status}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:justify-end">
          <button
            type="button"
            onClick={handleReconcilePauseExpectations}
            disabled={pauseSyncState.pending || stripeScanState.pending}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-950 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pauseSyncState.pending ? 'Checking pauses…' : 'Sync pause expectations'}
          </button>
          <button
            type="button"
            onClick={handleRunStripeScan}
            disabled={stripeScanState.pending || pauseSyncState.pending}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stripeScanState.pending ? 'Checking…' : 'Check Stripe'}
          </button>
        </div>
      </header>

      {stripeScanState.error ? <p className="text-sm text-red-700">{stripeScanState.error}</p> : null}
      {stripeScanState.scannedAt ? (
        <p className="-mt-4 text-xs text-slate-500">Checked {stripeScanState.scannedCount} Stripe students.</p>
      ) : null}
      {pauseSyncState.error ? <p className="text-sm text-red-700">{pauseSyncState.error}</p> : null}
      {pauseSyncState.success ? <p className="text-sm text-emerald-700">{pauseSyncState.success}</p> : null}
      <details className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-950">
        <summary className="cursor-pointer font-semibold">What does “Sync pause expectations” do?</summary>
        <div className="mt-2 space-y-2 text-amber-900">
          <p>
            It checks high-confidence Pause History against each student’s usual lesson and shows you any
            Students-sheet payment expectation that looks out of date.
          </p>
          <p>
            Nothing changes until you review the preview and confirm. Confirmation updates only the
            dashboard’s expected payment state and writes an audit log. It does not pause, resume, charge,
            or otherwise change anything in Stripe.
          </p>
        </div>
      </details>

      {actionState.error ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {actionState.error}
        </section>
      ) : null}
      {actionState.success ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {actionState.success}
        </section>
      ) : null}

      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="Issue views">
        {views.map((view) => (
          <button
            key={view.value}
            type="button"
            onClick={() => setWorkView(view.value)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
              workView === view.value
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            {view.label} <span className="ml-1 text-xs text-slate-400">{view.count}</span>
          </button>
        ))}
      </nav>

      {workView === 'history' && visibleSystemClearedIssues.length ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-900">{visibleSystemClearedIssues.length} fixed automatically.</p>
          <button
            type="button"
            onClick={handleResolveVisibleSystemCleared}
            disabled={actionState.pendingId === 'bulk-system-cleared'}
            className="text-sm font-semibold text-emerald-900 disabled:opacity-60"
          >
            {actionState.pendingId === 'bulk-system-cleared' ? 'Clearing…' : 'Clear them'}
          </button>
        </div>
      ) : null}

      <section className="space-y-4">
        {visibleIssues.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-lg text-emerald-700">✓</div>
            <h3 className="mt-4 text-base font-semibold text-slate-950">{emptyCopy[0]}</h3>
            <p className="mt-1 text-sm text-slate-500">{emptyCopy[1]}</p>
          </div>
        ) : workView === 'needs_you' ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Next issue</p>
            {renderIssue(visibleIssues[0], true)}
            {visibleIssues.length > 1 ? (
              <div className="pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Up next</p>
                <div className="space-y-3">{visibleIssues.slice(1).map((issue) => renderIssue(issue))}</div>
              </div>
            ) : null}
          </>
        ) : (
          visibleIssues.map((issue) => renderIssue(issue))
        )}
      </section>

      {recordPanel ? (
        <SlideOverPanel
          eyebrow="Student record"
          title={recordPanel.name}
          onClose={() => setRecordPanel(null)}
          actions={(
            <a href={recordPanel.path} target="_blank" rel="noreferrer" className={panelActionClass}>
              Open in full page ↗
            </a>
          )}
        >
          <iframe
            key={recordPanel.path}
            src={recordPanel.path}
            title={`Student record: ${recordPanel.name}`}
            className="h-full w-full flex-1 border-0"
          />
        </SlideOverPanel>
      ) : null}
    </div>
  );
}
