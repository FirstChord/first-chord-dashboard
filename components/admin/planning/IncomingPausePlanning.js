'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import QuickBrainCapture from './QuickBrainCapture';
import PlanningSaveError from './PlanningSaveError';
import { buildWhatsappShareUrl } from '@/lib/admin/incoming-message-helpers.mjs';
import { buildAcknowledgementProgressPayload } from '@/lib/admin/incoming-handoff-helpers.mjs';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';
import { planningSaveClientError } from '@/lib/admin/planning-duplicate-helpers.mjs';

export default function IncomingPausePlanning({ context, studentOptions, onCreated }) {
  const panelRef = useRef(null);
  const errorRef = useRef(null);
  const [options, setOptions] = useState(context.options || {});
  const [acknowledgement, setAcknowledgement] = useState(context.acknowledgement || '');
  const [savedId, setSavedId] = useState(context.linkedPlanningId || '');
  const [pendingAction, setPendingAction] = useState('');
  const pending = Boolean(pendingAction);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'center' });
  }, [error]);
  useEffect(() => {
    if (savedId) panelRef.current?.scrollIntoView({ block: 'start' });
  }, [savedId]);

  async function createPause(_note, overrides) {
    if (pending || savedId) return;
    setPendingAction('save'); setError(null);
    try {
      const response = await fetch('/api/admin/planning/incoming-pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incomingId: context.source.incomingId, snapshots: context.snapshots,
          studentId: overrides.linkedStudentId, pauseDetails: overrides.pauseDetails, acknowledgement }),
      });
      const data = await response.json();
      if (!response.ok) throw planningSaveClientError(data, 'Pause could not be saved. Your message remains in Inbox.');
      setSavedId(data.planningId); setWarning(data.warning || '');
      onCreated(data);
    } catch (caught) { setError(caught); }
    finally { setPendingAction(''); }
  }

  async function copyAcknowledgement() {
    if (!acknowledgement.trim()) return;
    if (pending) return;
    setPendingAction('copy'); setError(null);
    try {
      await navigator.clipboard.writeText(acknowledgement.trim());
      logCommunicationCopy({ category: 'pause', channel: 'whatsapp', mmsId: options.linkedStudentIds?.[0] || '',
        body: acknowledgement.trim(), source: 'incoming_pause_acknowledgement' });
      window.open(buildWhatsappShareUrl(acknowledgement.trim()), '_blank', 'noopener,noreferrer');
      setOpenedAt(new Date().toISOString());
    } catch { setError(new Error('Could not copy the acknowledgement. Try again; no plan or message was changed.')); }
    finally { setPendingAction(''); }
  }

  async function recordAcknowledgement() {
    const payload = buildAcknowledgementProgressPayload({ alreadyResolved: true, planningId: savedId, openedAt, reply: acknowledgement });
    if (!payload || pending || recorded) return;
    setPendingAction('record'); setError(null);
    try {
      const response = await fetch('/api/admin/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw planningSaveClientError(data, 'Could not record the acknowledgement. The pause is saved.');
      setRecorded(true);
    } catch (caught) { setError(caught); }
    finally { setPendingAction(''); }
  }

  if (context.error) return <section className="rounded-2xl border border-amber-200 bg-white p-5"><p>{context.error}</p><Link className="underline" href="/admin/incoming-messages">Return to Inbox</Link></section>;
  if (context.linkedPlanningId) return <section className="rounded-2xl border border-blue-200 bg-white p-5"><p>This message already has a linked plan.</p><Link className="underline" href={`/admin/planning?view=${encodeURIComponent(savedId)}`}>View existing plan</Link></section>;

  return <section ref={panelRef} aria-label="Pause planning from message" className="scroll-mt-44 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xl font-semibold text-slate-900">{savedId ? 'Pause plan created' : 'Plan this absence'}</h3>
      <Link className="text-sm font-semibold underline" href="/admin/incoming-messages">{savedId ? 'Return to Inbox' : 'Cancel — return to Inbox'}</Link>
    </div>
    <p className="mt-2 text-sm text-slate-600">{savedId ? 'The work and final confirmation are on the pause card below.' : 'Review the student and lesson dates. Your message stays in Inbox until you create the pause.'}</p>
    <p className="mt-4 text-sm font-semibold">{context.source.senderName} · {context.source.chatName}</p>
    <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{context.source.messageText}</p>
    {context.suggestedDates && !savedId ? <p className="mt-2 text-xs text-slate-600">Dates suggested by the message: {context.suggestedDates}. Check these against the actual lesson dates below.</p> : null}
    {error ? <div ref={errorRef} role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"><PlanningSaveError message={error.message} duplicatePlanningId={error.duplicatePlanningId || ''} /></div> : null}
    {warning ? <p role="alert" className="mt-3 text-sm text-amber-800">{warning}</p> : null}
    <div className="my-4 rounded-xl border border-slate-200 p-3">
      <label className="block text-sm font-semibold">Initial acknowledgement
        <textarea className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" value={acknowledgement} maxLength={1200}
          readOnly={Boolean(savedId) || recorded} onChange={event => { setAcknowledgement(event.target.value); setOpenedAt(''); }} rows={2} />
      </label>
      <p className="mt-1 text-xs text-slate-600">Send now if needed. Choose the correct lesson chat in WhatsApp; the final confirmation comes after the work.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!recorded ? <ActionButton onClick={copyAcknowledgement} disabled={pending || !acknowledgement.trim()} pending={pendingAction === 'copy'} pendingLabel="Copying…" variant="subtle">Copy & open WhatsApp</ActionButton> : null}
        {savedId && openedAt && !recorded ? <ActionButton onClick={recordAcknowledgement} disabled={pending} pending={pendingAction === 'record'} pendingLabel="Recording…">Acknowledgement sent</ActionButton> : null}
        {recorded ? <p role="status" className="text-sm text-emerald-800">Acknowledgement recorded. The pause remains open.</p> : null}
      </div>
    </div>
    {savedId ? <Link className="inline-block rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" href={`/admin/planning?view=${encodeURIComponent(savedId)}`}>View pause plan</Link>
      : <QuickBrainCapture pauseOnly rawNote="" setRawNote={() => {}} options={options} setOptions={setOptions} studentOptions={studentOptions}
          expanded={false} setExpanded={() => {}} onSubmit={event => event.preventDefault()} onPauseCapture={createPause} pending={pendingAction === 'save'} />}
  </section>;
}
