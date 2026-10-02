'use client';

import { useState } from 'react';
import { ActionButton } from './ui/ActionButton';
import { INCOMING_MESSAGE_CATEGORIES, INCOMING_MESSAGE_INTENTS, INCOMING_MESSAGE_ACTIONABILITY,
  labelIncomingCategory, labelIncomingIntent, labelIncomingActionability } from '@/lib/admin/incoming-message-helpers.mjs';

const fields = [
  ['category', 'Topic', INCOMING_MESSAGE_CATEGORIES, labelIncomingCategory],
  ['intent', 'Intent', INCOMING_MESSAGE_INTENTS, labelIncomingIntent],
  ['actionability', 'Needs', INCOMING_MESSAGE_ACTIONABILITY, labelIncomingActionability],
];
export default function IncomingClassificationAssessment({ proposal, available, eligible, pending, onAssess, onReview }) {
  const [classification, setClassification] = useState(proposal?.applied || proposal?.classification);
  const [action, setAction] = useState('');
  if (!eligible || (!proposal && !available)) return null;
  const open = proposal?.status === 'proposed';
  async function run(mode, callback) {
    setAction(mode);
    try { await callback(); } finally { setAction(''); }
  }
  const checkButton = available ? <ActionButton variant="quiet" pending={action === 'assess'} pendingLabel="Checking message…" disabled={pending} onClick={() => run('assess', onAssess)}
    title="Ask Jev to assess redacted captured message text and replies"
    className="min-h-11 rounded-full px-3 font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{proposal ? 'Check message again' : 'Check message'}</ActionButton> : null;
  return (
    <div className="my-3 space-y-2 text-xs">
      {proposal ? (
        <details open={open && !proposal.automatic} className="rounded-xl border border-slate-200 bg-slate-50 px-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700">
            {open ? proposal.automatic ? 'Message check' : 'Suggested message details' : proposal.applied ? 'Message details applied' : 'Suggestion discarded'}
          </summary>
          <div className="space-y-3 pb-3">
            {open ? <>
              <p className="text-slate-500">{proposal.guard ? 'There is not enough clear evidence for a confident suggestion. Choose the details after reviewing the message.' : 'Review or edit these details. Applying them keeps the message open.'}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {fields.map(([key, label, options, describe]) => (
                  <label key={key} className="min-w-0 space-y-1 font-medium text-slate-600">
                    <span>{label}</span>
                    <select aria-label={`Suggested ${label.toLowerCase()}`} value={classification[key]} disabled={pending}
                      onChange={event => setClassification(current => ({ ...current, [key]: event.target.value }))}
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-slate-800">
                      {options.map(value => <option key={value} value={value}>{describe(value)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton variant="green" pending={action === 'apply'} pendingLabel="Applying…" disabled={pending} onClick={() => run('apply', () => onReview('apply', proposal.proposalId, classification))}
                  className="min-h-11 rounded-lg bg-emerald-50 px-3 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Apply details</ActionButton>
                <ActionButton variant="quiet" pending={action === 'discard'} pendingLabel="Discarding…" disabled={pending} onClick={() => run('discard', () => onReview('discard', proposal.proposalId))}
                  className="min-h-11 rounded-lg px-3 font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{proposal.automatic ? 'Keep in Needs attention' : 'Discard'}</ActionButton>
              </div>
            </> : proposal.applied ? <p className="text-slate-500">{labelIncomingCategory(proposal.applied.category)} · {labelIncomingIntent(proposal.applied.intent)} · {labelIncomingActionability(proposal.applied.actionability)}. Mark handled separately when the work is complete.</p> : null}
            {proposal.automatic ? checkButton : null}
          </div>
        </details>
      ) : null}
      {!proposal?.automatic ? checkButton : null}
    </div>
  );
}
