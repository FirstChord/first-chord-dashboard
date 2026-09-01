'use client';

import { useState } from 'react';

const STATUS_CLASSES = {
  attention: 'border-red-200 bg-red-50 text-red-900',
  caution: 'border-amber-200 bg-amber-50 text-amber-900',
  clear: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
};

const CORRECTION_OPTIONS = [
  ['evidence_wrong', 'The evidence is wrong'],
  ['diagnosis_wrong', 'The diagnosis is wrong'],
  ['proposed_fix_wrong', 'The proposed fix is wrong'],
  ['missing_context', 'Something important is missing'],
  ['not_an_issue', 'This should not be an issue'],
];

function formatGeneratedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function IssueExplanationPanel({
  issue,
  detectiveResolution = null,
  onApproveResolution,
  resolutionPending = false,
  readOnly = false,
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', explanation: null, error: '', aiBriefingAvailable: false });
  const [aiState, setAiState] = useState({
    status: 'idle',
    briefing: null,
    requestId: '',
    error: '',
    feedback: '',
  });

  async function loadAiBriefing() {
    setAiState({ status: 'loading', briefing: null, requestId: '', error: '', feedback: '' });
    try {
      const response = await fetch(`/api/admin/issues/${encodeURIComponent(issue.mmsId)}/ai-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: issue.source || '',
          issueType: issue.type || '',
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The detective is unavailable right now');
      setAiState((current) => ({
        status: 'ready',
        briefing: body.briefing,
        requestId: body.requestId || '',
        error: '',
        feedback: current.feedback === 'held' ? 'choose_reason' : current.feedback,
      }));
    } catch (error) {
      setAiState((current) => ({
        status: 'error',
        briefing: null,
        requestId: '',
        error: error.message || 'The detective is unavailable right now',
        feedback: current.feedback,
      }));
    }
  }

  async function loadExplanation() {
    setState({ status: 'loading', explanation: null, error: '', aiBriefingAvailable: false });
    try {
      const query = new URLSearchParams({
        source: issue.source || '',
        issueType: issue.type || '',
      });
      const response = await fetch(`/api/admin/issues/${encodeURIComponent(issue.mmsId)}/explanation?${query}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not investigate this case');
      const aiBriefingAvailable = body.aiBriefingAvailable === true;
      setState({ status: 'ready', explanation: body.explanation, error: '', aiBriefingAvailable });
      if (aiBriefingAvailable) loadAiBriefing();
    } catch (error) {
      setState({
        status: 'error',
        explanation: null,
        error: error.message || 'Could not investigate this case',
        aiBriefingAvailable: false,
      });
    }
  }

  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && state.status === 'idle') loadExplanation();
  }

  async function submitAiFeedback(rating, reason = '') {
    if (!aiState.requestId) return false;
    setAiState((current) => ({ ...current, feedback: 'saving' }));
    try {
      const response = await fetch('/api/admin/ai/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: aiState.requestId, rating, reason }),
      });
      if (!response.ok) throw new Error('Feedback could not be saved');
      setAiState((current) => ({
        ...current,
        feedback: rating === 'helpful' ? 'saved_helpful' : 'saved_correction',
      }));
      return true;
    } catch {
      setAiState((current) => ({ ...current, feedback: 'error' }));
      return false;
    }
  }

  function reconsider() {
    if (!aiState.requestId) {
      setAiState((current) => ({ ...current, feedback: 'held' }));
      return;
    }
    setAiState((current) => ({ ...current, feedback: 'choose_reason' }));
  }

  async function approveResolution() {
    if (!detectiveResolution || !onApproveResolution) return;
    if (aiState.requestId) void submitAiFeedback('helpful');
    await onApproveResolution(detectiveResolution);
  }

  if (!issue?.mmsId || !issue?.source || !issue?.type) return null;

  const explanation = state.explanation;
  const generatedAt = formatGeneratedAt(explanation?.generatedAt);
  const correctionHeld = ['choose_reason', 'saving', 'held', 'saved_correction', 'error'].includes(aiState.feedback);
  const opinion = aiState.status === 'ready' && aiState.briefing
    ? aiState.briefing.explanation
    : explanation?.rule?.result;
  const nextMove = aiState.status === 'ready' && aiState.briefing
    ? aiState.briefing.whatToCheck
    : explanation?.nextStep?.label;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 transition hover:border-indigo-300 hover:bg-indigo-100"
      >
        {open ? 'Close case file' : 'Ask the detective'}
      </button>

      {open ? (
        <section className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4" aria-label="Detective case file">
          {state.status === 'loading' ? (
            <p className="text-sm text-slate-600" role="status">Collecting the checked evidence…</p>
          ) : null}

          {state.status === 'error' ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-red-700" role="alert">{state.error}</p>
              <button
                type="button"
                onClick={loadExplanation}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50"
              >
                Try again
              </button>
            </div>
          ) : null}

          {state.status === 'ready' && explanation ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Detective&apos;s working view</p>
                  <h4 className="mt-1 font-semibold text-slate-950">
                    {aiState.briefing?.headline || explanation.rule.name}
                  </h4>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[explanation.status.tone] || STATUS_CLASSES.neutral}`}>
                  {explanation.status.label}
                </span>
              </div>

              {aiState.status === 'loading' ? (
                <p className="rounded-lg border border-indigo-200 bg-white p-3 text-sm text-indigo-900" role="status">
                  Following the clues and preparing an opinion…
                </p>
              ) : null}

              {aiState.status === 'error' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>{aiState.error}</p>
                  <p className="mt-1 text-xs text-amber-800">The checked case assessment below is still available.</p>
                </div>
              ) : null}

              {opinion ? (
                <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    {aiState.status === 'ready' ? 'Generated opinion' : 'Checked assessment'}
                  </p>
                  <p className="mt-2 text-base leading-relaxed text-slate-900">
                    <span className="font-semibold">Listen — </span>{opinion}
                  </p>
                  {nextMove ? (
                    <p className="mt-3 text-sm text-slate-700"><span className="font-semibold">My next move:</span> {nextMove}</p>
                  ) : null}
                  {aiState.briefing?.caveat ? (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {aiState.briefing.caveat}
                    </p>
                  ) : null}
                  {aiState.status === 'ready' ? (
                    <p className="mt-3 text-xs text-indigo-700">Generated from the checked evidence in this case file; it cannot create facts or choose an action.</p>
                  ) : null}
                </div>
              ) : null}

              {!readOnly && detectiveResolution ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Proposed resolution</p>
                  <p className="mt-2 text-sm text-emerald-950">{detectiveResolution.proposal}</p>

                  {correctionHeld ? (
                    <p className="mt-3 text-sm font-medium text-amber-900">Case kept open. The proposed resolution will not run.</p>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={approveResolution}
                        disabled={resolutionPending || aiState.feedback === 'saving'}
                        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resolutionPending ? 'Solving…' : detectiveResolution.buttonLabel}
                      </button>
                      <button
                        type="button"
                        onClick={reconsider}
                        disabled={resolutionPending || aiState.feedback === 'saving'}
                        className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        No, reconsider
                      </button>
                    </div>
                  )}

                  {aiState.feedback === 'choose_reason' ? (
                    <div className="mt-3 border-t border-emerald-200 pt-3">
                      <p className="text-xs font-semibold text-slate-700">What did the detective get wrong?</p>
                      <div className="mt-2 flex flex-wrap gap-2" aria-label="Why the detective should reconsider">
                        {CORRECTION_OPTIONS.map(([reason, label]) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() => submitAiFeedback('not_helpful', reason)}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 hover:bg-slate-50"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {aiState.feedback === 'saving' ? <p className="mt-3 text-xs text-slate-600">Recording the correction…</p> : null}
                  {aiState.feedback === 'error' ? <p className="mt-3 text-xs text-red-700">The feedback was not recorded. The case was not changed.</p> : null}
                </div>
              ) : null}

              {!readOnly && !detectiveResolution ? (
                <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  I can narrow this case down, but I cannot safely close it in one step. Use the main case action after checking the evidence.
                </p>
              ) : null}

              <details className="rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">Evidence and case rules</summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">The rule</p>
                    <p className="mt-1 text-sm text-slate-800">{explanation.rule.statement}</p>
                    <p className="mt-2 text-sm font-medium text-slate-950">Result: {explanation.rule.result}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Evidence source</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{explanation.source.label}</p>
                      <p className="mt-1 text-xs text-slate-600">Detector {explanation.source.detectorRechecked ? 'rechecked now' : 'not rechecked'}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Issue Queue</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{explanation.queue.label}</p>
                      <p className="mt-1 text-xs text-slate-600">Workflow state, not source truth</p>
                    </div>
                  </div>

                  {explanation.evidence.length ? (
                    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
                      {explanation.evidence.map((item) => (
                        <div key={`${item.label}:${item.value}`} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <dt className="text-sm text-slate-600">{item.label}</dt>
                          <dd className="text-sm font-medium text-slate-900 sm:text-right">
                            {item.value}
                            <span className="block text-xs font-normal text-slate-500">{item.sourceRole}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm text-slate-600">No detailed source facts were retrieved; only the recorded issue state is available.</p>
                  )}

                  {explanation.notChecked.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Not checked</p>
                      <ul className="mt-2 space-y-1 text-sm text-amber-950">
                        {explanation.notChecked.map((item) => <li key={item}>• {item}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  {explanation.ambiguity.length ? (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">Needs human judgement</p>
                      <ul className="mt-2 space-y-1 text-sm text-violet-950">
                        {explanation.ambiguity.map((item) => <li key={item.code}>• {item.explanation}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  {generatedAt ? <p className="text-right text-xs text-slate-500">Evidence checked {generatedAt}</p> : null}
                </div>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
