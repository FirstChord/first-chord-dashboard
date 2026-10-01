'use client';

import { useState } from 'react';
import { RESOLUTION_LABELS } from '@/lib/admin/incoming-resolution-helpers.mjs';

export default function IncomingResolutionAssessment({ proposal, available, eligible, pending, onAssess, onFeedback }) {
  const [label, setLabel] = useState(proposal?.label || 'unclear');
  if (!proposal && (!available || !eligible)) return null;
  const displayed = proposal?.feedback || proposal?.label;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      {proposal ? (
        <details className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700">{RESOLUTION_LABELS[displayed]} · {proposal.decided ? 'Reviewed' : 'Suggestion'}</summary>
          <div className="space-y-2 pb-3">
            <p className="text-slate-500">{proposal.guard === 'linked_planning' ? 'Linked Planning work needs its own review.' : proposal.guard ? 'There is not enough complete, current reply evidence to judge this request.' : 'Based on captured replies. Review the conversation and any school work before marking handled.'}</p>
            {!proposal.decided ? (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Your assessment" value={label} onChange={event => setLabel(event.target.value)} disabled={pending} className="min-h-11 max-w-full rounded-lg border border-slate-200 bg-white px-2">
                  {Object.entries(RESOLUTION_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
                <button type="button" disabled={pending} onClick={() => onFeedback(proposal.proposalId, label)} className="min-h-11 rounded-lg px-3 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{label === proposal.label ? 'Accurate' : 'Save correction'}</button>
              </div>
            ) : <p className="text-slate-500">Feedback saved. The message stays in the inbox until you mark it handled.</p>}
          </div>
        </details>
      ) : null}
      {available && eligible ? <button type="button" disabled={pending} onClick={onAssess} className="min-h-11 rounded-full px-3 font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{pending ? 'Checking…' : proposal ? 'Check again' : 'Check replies'}</button> : null}
    </div>
  );
}
