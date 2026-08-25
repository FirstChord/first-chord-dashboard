'use client';

import { AgeChip } from '@/components/admin/ui/AgeChip';
import IssueExplanationPanel from '@/components/admin/issues/IssueExplanationPanel';
import { buildIssueEvidenceSummary, formatDateTime } from '@/lib/admin/health-helpers.mjs';
import { buildPauseWorkflowSummary } from '@/lib/admin/pause-workflow-helpers.mjs';
import {
  getIssueCategoryLabel,
  getIssueKeyFact,
  getIssueShortLabel,
  getIssueStory,
  getLifecycleContextText,
  getPaymentActionHint,
  getPaymentActionPath,
  getPaymentQuickActions,
  getPaymentValueContextText,
  getPrimaryPaymentQuickAction,
  getRecommendedActionText,
  getStudentLabel,
  isPaymentIssue,
  isPauseIssue,
  needsLiveStripeReview,
  severityEdgeClass,
  shouldRefreshStripeFirst,
  shouldShowLifecycleContext,
  shouldShowPaymentValueContext,
  summariseStripeSnapshot,
} from '@/lib/admin/issues-client-helpers.mjs';
import {
  buildStripeCustomerDashboardUrl,
  DEFAULT_STRIPE_DASHBOARD_BASE_URL,
} from '@/lib/admin/stripe-dashboard-helpers.mjs';

const STRIPE_DASHBOARD_BASE = process.env.NEXT_PUBLIC_STRIPE_DASHBOARD_BASE_URL
  || DEFAULT_STRIPE_DASHBOARD_BASE_URL;

// One issue card: the "sorted ✓" fade state, a single obvious primary action,
// and everything else under Details. Pure view — all state and mutations live
// in the AdminIssuesPageClient orchestrator and arrive as props.
export default function IssueCard({
  issue,
  freshness,
  featured = false,
  readOnly = false,
  fadingEntry,
  liveStripeState,
  actionState,
  copiedEmailIssueId,
  onStatusChange,
  onRefreshStripe,
  onPaymentQuickAction,
  onCreateRegistry,
  onDelete,
  onPracticeFollowUpHandled,
  onCopyEmail,
  onOpenRecord,
}) {
  return (
    <article
      className={`rounded-2xl border bg-white transition-opacity duration-700 ${featured ? 'p-7 shadow-[0_18px_50px_rgba(15,23,42,0.08)]' : 'p-5 shadow-sm'} ${severityEdgeClass(issue.severity)} ${fadingEntry ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}
      style={fadingEntry?.fading ? { opacity: 0 } : undefined}
    >
      {fadingEntry ? (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg text-emerald-600" aria-hidden>✓</span>
          <div>
            <p className="text-base font-semibold text-emerald-900">
              {getStudentLabel(issue)} — sorted
            </p>
            <p className="mt-1 text-sm text-emerald-800">{fadingEntry.message}</p>
          </div>
        </div>
      ) : (
        <IssueCardBody
          issue={issue}
          freshness={freshness}
          featured={featured}
          readOnly={readOnly}
          liveStripeState={liveStripeState}
          actionState={actionState}
          copiedEmailIssueId={copiedEmailIssueId}
          onStatusChange={onStatusChange}
          onRefreshStripe={onRefreshStripe}
          onPaymentQuickAction={onPaymentQuickAction}
          onCreateRegistry={onCreateRegistry}
          onDelete={onDelete}
          onPracticeFollowUpHandled={onPracticeFollowUpHandled}
          onCopyEmail={onCopyEmail}
          onOpenRecord={onOpenRecord}
        />
      )}
    </article>
  );
}

function IssueCardBody({
  issue,
  freshness,
  featured,
  readOnly,
  liveStripeState,
  actionState,
  copiedEmailIssueId,
  onStatusChange,
  onRefreshStripe,
  onPaymentQuickAction,
  onCreateRegistry,
  onDelete,
  onPracticeFollowUpHandled,
  onCopyEmail,
  onOpenRecord,
}) {
  const paymentActionPath = isPaymentIssue(issue) ? getPaymentActionPath(issue) : [];
  const paymentQuickActions = getPaymentQuickActions(issue);
  const primaryQuickAction = issue.sourcePresent ? getPrimaryPaymentQuickAction(issue, paymentQuickActions) : null;
  const secondaryQuickActions = issue.sourcePresent
    ? paymentQuickActions.filter((action) => action.label !== primaryQuickAction?.label)
    : [];
  const keyFact = getIssueKeyFact(issue);
  const refreshStripeFirst = issue.sourcePresent && shouldRefreshStripeFirst(issue);
  const recommendedActionText = getRecommendedActionText(issue);
  const evidence = buildIssueEvidenceSummary(issue, freshness);
  const stripeCustomerUrl = issue.stripeCustomerId && issue.systemsAffected?.includes('Stripe')
    ? buildStripeCustomerDashboardUrl(issue.stripeCustomerId, STRIPE_DASHBOARD_BASE)
    : '';
  const pauseWorkflow = isPauseIssue(issue)
    ? buildPauseWorkflowSummary({
      pauseSummary: issue.pauseSummary,
      pauseCoverageContext: issue.pauseCoverageContext,
      paymentExpectation: issue.paymentExpectation || '',
      stripeSnapshot: liveStripeState?.snapshot || null,
    })
    : null;

  // One obvious primary action per card; everything else lives under Details.
  let primaryKind = 'none';
  if (readOnly || issue.type === 'PAYMENT_RETRYING') primaryKind = 'none';
  else if (!issue.sourcePresent) primaryKind = 'resolve';
  else if (refreshStripeFirst) primaryKind = 'refresh';
  else if (primaryQuickAction) primaryKind = 'quick';
  else if (needsLiveStripeReview(issue)) primaryKind = 'refresh';
  else if (issue.type === 'SHEETS ONLY') primaryKind = 'create';
  else if (issue.type === 'PRACTICE NOTE DELIVERY FAILED' && issue.practiceNote) primaryKind = 'follow_up';
  else if (issue.adminStudentPath) primaryKind = 'open';

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`${featured ? 'text-xl' : 'text-lg'} font-semibold tracking-[-0.015em] text-slate-950`}>{getStudentLabel(issue)}</h3>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                {getIssueShortLabel(issue)}
              </span>
              {issue.reappeared ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Reappeared
                </span>
              ) : null}
              {!issue.sourcePresent ? (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  No longer detected
                </span>
              ) : null}
              {issue.status === 'resolved' && issue.sourcePresent ? (
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">
                  Resolved but still detected
                </span>
              ) : null}
              <AgeChip updatedAt={issue.updatedAt} />
              {stripeCustomerUrl ? (
                <a
                  href={stripeCustomerUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${getStudentLabel(issue)}'s Stripe customer page`}
                  className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-800 transition hover:border-violet-300 hover:bg-violet-100 hover:text-violet-950"
                >
                  Stripe customer ↗
                </a>
              ) : null}
            </div>
            <p className={`${featured ? 'text-[1.08rem]' : 'text-base'} max-w-3xl leading-relaxed text-slate-700`}>{getIssueStory(issue)}</p>
            {issue.type === 'PAYMENT_RETRYING' && issue.stripeSnapshot?.nextPaymentAttemptAt ? (
              <p className="text-sm text-slate-500">Next attempt {formatDateTime(issue.stripeSnapshot.nextPaymentAttemptAt)}</p>
            ) : null}
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-400">
            {getIssueCategoryLabel(issue)} · {issue.severity?.toLowerCase()}
          </span>
        </div>

        {issue.identityMismatchHint ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {issue.identityMismatchHint.description}
          </p>
        ) : null}
        <IssueExplanationPanel issue={issue} />
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {primaryKind === 'resolve' ? (
            <button
              type="button"
              onClick={() => onStatusChange(issue, 'resolved')}
              disabled={actionState.pendingId === issue.issueId}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionState.pendingId === issue.issueId ? 'Saving…' : 'Mark resolved'}
            </button>
          ) : null}
          {primaryKind === 'refresh' ? (
            <button
              type="button"
              onClick={() => onRefreshStripe(issue)}
              disabled={Boolean(liveStripeState?.loading)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {liveStripeState?.loading ? 'Checking…' : 'Refresh Stripe'}
            </button>
          ) : null}
          {primaryKind === 'quick' && primaryQuickAction ? (
            <button
              type="button"
              onClick={() => onPaymentQuickAction(issue, primaryQuickAction)}
              disabled={actionState.pendingId === issue.issueId}
              className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionState.pendingId === issue.issueId ? 'Saving…' : primaryQuickAction.label}
            </button>
          ) : null}
          {primaryKind === 'create' ? (
            <button
              type="button"
              onClick={() => onCreateRegistry(issue)}
              disabled={actionState.pendingId === issue.issueId}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionState.pendingId === issue.issueId ? 'Creating…' : 'Create registry entry'}
            </button>
          ) : null}
          {primaryKind === 'follow_up' ? (
            issue.adminStudentPath ? (
              <button
                type="button"
                onClick={() => onOpenRecord({ path: issue.adminStudentPath, name: getStudentLabel(issue) })}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                Open student record
              </button>
            ) : null
          ) : null}
          {primaryKind === 'open' && issue.adminStudentPath ? (
            <button
              type="button"
              onClick={() => onOpenRecord({ path: issue.adminStudentPath, name: getStudentLabel(issue) })}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Open student record
            </button>
          ) : null}
          <details className="rounded-lg px-2 py-2 text-sm text-slate-700">
            <summary className="cursor-pointer list-none font-medium text-slate-500 transition hover:text-slate-900" aria-label="More options">•••</summary>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-3">
                {issue.email ? (
                  <button
                    type="button"
                    onClick={() => onCopyEmail(issue)}
                    title="Copy email to search in Stripe"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
                  >
                    {copiedEmailIssueId === issue.issueId ? 'Email copied ✓' : `Copy email: ${issue.email}`}
                  </button>
                ) : null}
                {issue.adminStudentPath && primaryKind !== 'open' ? (
                  <button
                    type="button"
                    onClick={() => onOpenRecord({ path: issue.adminStudentPath, name: getStudentLabel(issue) })}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Open student record
                  </button>
                ) : null}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Recommended next action</p>
                <p className="mt-2 text-sm text-slate-700">{recommendedActionText}</p>
                {keyFact ? (
                  <p className="mt-3 text-sm font-medium text-slate-900">{keyFact}</p>
                ) : null}
                {issue.resolutionNote ? (
                  <p className="mt-3 text-sm text-slate-600">
                    Resolution note: {issue.resolutionNote}
                  </p>
                ) : null}
                {issue.detail && !isPaymentIssue(issue) ? (
                  <p className="mt-3 text-sm text-slate-600">
                    Source detail: {issue.detail}
                  </p>
                ) : null}
                {shouldShowLifecycleContext(issue) ? (
                  <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                    {getLifecycleContextText(issue)}
                  </p>
                ) : null}
                {shouldShowPaymentValueContext(issue) ? (
                  <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                    {getPaymentValueContextText(issue)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onStatusChange(issue, 'acknowledged')}
                  disabled={actionState.pendingId === issue.issueId}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionState.pendingId === issue.issueId ? 'Saving…' : 'Keep active'}
                </button>
                {issue.sourcePresent && primaryKind !== 'resolve' ? (
                  <button
                    type="button"
                    onClick={() => onStatusChange(issue, 'resolved')}
                    disabled={actionState.pendingId === issue.issueId}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionState.pendingId === issue.issueId ? 'Saving…' : 'Mark resolved'}
                  </button>
                ) : null}
                {issue.type === 'REGISTRY ONLY' ? (
                  <button
                    type="button"
                    onClick={() => onDelete(issue)}
                    disabled={actionState.pendingId === issue.id}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionState.pendingId === issue.id ? 'Removing…' : 'Remove from portal'}
                  </button>
                ) : null}
                {issue.type === 'PRACTICE NOTE DELIVERY FAILED' && issue.practiceNote ? (
                  <button
                    type="button"
                    onClick={() => onPracticeFollowUpHandled(issue)}
                    disabled={actionState.pendingId === issue.issueId}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionState.pendingId === issue.issueId ? 'Saving…' : 'Mark follow-up handled'}
                  </button>
                ) : null}
                {!refreshStripeFirst && needsLiveStripeReview(issue) && primaryQuickAction ? (
                  <button
                    type="button"
                    onClick={() => onRefreshStripe(issue)}
                    disabled={Boolean(liveStripeState?.loading)}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {liveStripeState?.loading ? 'Checking…' : 'Refresh Stripe'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onStatusChange(issue, 'ignored')}
                  disabled={actionState.pendingId === issue.issueId}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionState.pendingId === issue.issueId ? 'Saving…' : 'Ignore'}
                </button>
                {secondaryQuickActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => onPaymentQuickAction(issue, action)}
                    disabled={actionState.pendingId === issue.issueId}
                    className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionState.pendingId === issue.issueId ? 'Saving…' : action.label}
                  </button>
                ))}
              </div>
              {isPaymentIssue(issue) && getPaymentActionHint(issue) ? (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  {getPaymentActionHint(issue)}
                </p>
              ) : null}
              {paymentActionPath.length ? (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Suggested path</p>
                  <ol className="mt-2 space-y-2 text-sm text-slate-700">
                    {paymentActionPath.map((step, index) => (
                      <li key={step} className="flex gap-2">
                        <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {pauseWorkflow ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-violet-800">Pause loop</p>
                  <p className="mt-2 text-sm font-medium text-violet-950">{pauseWorkflow.state}</p>
                  <p className="mt-2 text-sm text-violet-950">{pauseWorkflow.nextAction}</p>
                  {issue.pauseSummary?.matchEvidence ? (
                    <p className="mt-2 text-xs text-violet-900">Evidence: {issue.pauseSummary.matchEvidence}</p>
                  ) : null}
                  {issue.pauseCoverageContext?.summary ? (
                    <p className="mt-2 text-xs text-violet-900">Coverage: {issue.pauseCoverageContext.summary}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-violet-900">Closes when: {pauseWorkflow.closureCondition}</p>
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Record state</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <p>Sheets row: {issue.hasSheetRow ? 'Present' : 'Missing'}</p>
                    <p>Registry entry: {issue.hasRegistryEntry ? 'Present' : 'Missing'}</p>
                    <p>Sheets tutor: {issue.sheetTutor || '—'}</p>
                    <p>Registry tutor: {issue.registryTutor || '—'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Source context</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <p>Generated: {issue.generatedDate || '—'}</p>
                    <p>Last seen: {formatDateTime(issue.lastSeenAt)}</p>
                    <p>MMS ID: <span className="font-mono text-xs">{issue.mmsId || '—'}</span></p>
                    <p>Issue ID: <span className="font-mono text-xs">{issue.issueId || '—'}</span></p>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Evidence</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <p>Source: {evidence.label}</p>
                    <p>Status: {evidence.status}</p>
                    <p>Updated: {formatDateTime(evidence.updatedAt)}</p>
                    <p>{evidence.detail}</p>
                  </div>
                </div>
                {issue.lifecycleLabel ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Lifecycle context</p>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <p>{issue.lifecycleLabel} ({issue.lifecycleConfidence || 'low'} confidence)</p>
                      {issue.lifecycleReasons?.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                      {issue.lifecycleWarnings?.map((warning) => (
                        <p key={warning} className="text-amber-800">{warning}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {issue.identityMismatchHint ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Possible identity match</p>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <p>System: {issue.identityMismatchHint.system}</p>
                      <p>Name: {issue.identityMismatchHint.studentName || '—'}</p>
                      <p>MMS ID: <span className="font-mono text-xs">{issue.identityMismatchHint.mmsId || '—'}</span></p>
                      <p>Tutor: {issue.identityMismatchHint.tutor || '—'}</p>
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Systems involved</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issue.systemsAffected.map((system) => (
                      <span key={system} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                        {system}
                      </span>
                    ))}
                  </div>
                </div>
                {isPaymentIssue(issue) ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Payment context</p>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <p>Payment mode: {issue.paymentMode || '—'}</p>
                      <p>Payment expectation: {issue.paymentExpectation || '—'}</p>
                      <p>Stripe customer: {issue.stripeCustomerId || '—'}</p>
                      <p>Stripe subscription: {issue.stripeSubscriptionId || '—'}</p>
                      <p>Currently paused: {issue.pauseSummary?.hasPauseHistory ? (issue.pauseSummary.currentlyPaused ? 'Yes' : 'No') : 'No pause history'}</p>
                      {issue.pauseSummary?.matchConfidence ? (
                        <p>Pause match: {issue.pauseSummary.matchConfidence} confidence</p>
                      ) : null}
                      {issue.paymentValueContext?.baselineWeeklyLabel || issue.paymentValueContext?.baselineMonthlyLabel ? (
                        <p>
                          Baseline value: {[issue.paymentValueContext.baselineWeeklyLabel ? `${issue.paymentValueContext.baselineWeeklyLabel}/week` : '', issue.paymentValueContext.baselineMonthlyLabel ? `${issue.paymentValueContext.baselineMonthlyLabel}/month` : ''].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                      {issue.pauseSummary?.latestPause ? (
                        <p>
                          Latest pause window: {issue.pauseSummary.latestPause.startDate || '—'} to {issue.pauseSummary.latestPause.endDate || '—'}
                        </p>
                      ) : null}
                      {issue.pauseCoverageContext?.summary ? (
                        <p>Likely coverage: {issue.pauseCoverageContext.summary}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </details>
        </div>
        {actionState.issueId === issue.issueId && (actionState.error || actionState.success) ? (
          <p className={`text-sm ${actionState.error ? 'text-red-700' : 'text-emerald-700'}`}>
            {actionState.error || actionState.success}
          </p>
        ) : null}
      </div>
      {needsLiveStripeReview(issue) && (liveStripeState?.error || liveStripeState?.skippedReason || liveStripeState?.snapshot) ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <p className="text-xs uppercase tracking-wide text-blue-800">Latest live Stripe check</p>
          {liveStripeState?.error ? (
            <p className="mt-2 text-sm text-red-700">{liveStripeState.error}</p>
          ) : liveStripeState?.skippedReason ? (
            <p className="mt-2 text-sm text-slate-700">{liveStripeState.skippedReason}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-800">
              {summariseStripeSnapshot(liveStripeState?.snapshot, liveStripeState?.issues)}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
