'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import QuickBrainCapture from './QuickBrainCapture';
import PlanningSaveError from './PlanningSaveError';
import { buildWhatsappShareUrl } from '@/lib/admin/incoming-message-helpers.mjs';
import { logCommunicationCopy } from '@/lib/admin/log-communication-copy.js';
import { planningSaveClientError } from '@/lib/admin/planning-duplicate-helpers.mjs';
import { confirmIncomingPauseAcknowledgement, incomingPauseDraftKey, buildIncomingPauseBrowserDraft, restoreIncomingPauseBrowserDraft } from '@/lib/admin/incoming-pause-sequence-helpers.mjs';

export default function IncomingPausePlanning({ context, studentOptions, onCreated }) {
  const panelRef = useRef(null);
  const errorRef = useRef(null);
  const planningStepRef = useRef(null);
  const acknowledgementRef = useRef(null);
  const editingRef = useRef(false);
  const [options, setOptions] = useState(context.options || {});
  const [acknowledgement, setAcknowledgement] = useState(context.acknowledgement || '');
  const [confirmation, setConfirmation] = useState(null);
  const [restoredContext, setRestoredContext] = useState(null);
  const restored = restoredContext === context;
  const acknowledged = restored && Boolean(confirmation);
  const [rememberError, setRememberError] = useState(false);
  const [savedId, setSavedId] = useState(context.linkedPlanningId || '');
  const [pendingAction, setPendingAction] = useState('');
  const pending = Boolean(pendingAction);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const storageKey = incomingPauseDraftKey(context);

  useEffect(() => {
    if (!storageKey || context.linkedPlanningId) { setRestoredContext(context); return; }
    setAcknowledgement(context.acknowledgement || ''); setConfirmation(null); setOpenedAt(''); setOptions(context.options || {});
    try {
      const draft = restoreIncomingPauseBrowserDraft(context, JSON.parse(window.sessionStorage.getItem(storageKey) || 'null'));
      if (draft) {
        setAcknowledgement(draft.acknowledgement); setConfirmation(draft.confirmation); setOpenedAt(draft.openedAt); setOptions(draft.options);
      } else window.sessionStorage.removeItem(storageKey);
    } catch { setRememberError(true); }
    setRestoredContext(context);
  }, [context, storageKey]);
  useEffect(() => {
    if (!restored || !storageKey || savedId) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(buildIncomingPauseBrowserDraft(context, { acknowledgement, confirmation, openedAt, options })));
    } catch { setRememberError(true); }
  }, [restored, storageKey, savedId, context, acknowledgement, confirmation, openedAt, options]);
  useEffect(() => {
    if (error) { errorRef.current?.focus({ preventScroll: true }); errorRef.current?.scrollIntoView({ block: 'center' }); }
  }, [error]);
  useEffect(() => {
    if (savedId) { panelRef.current?.focus({ preventScroll: true }); panelRef.current?.scrollIntoView({ block: 'start' }); }
  }, [savedId]);
  useEffect(() => {
    if (acknowledged && !savedId) planningStepRef.current?.focus();
    else if (!confirmation && editingRef.current) { acknowledgementRef.current?.focus(); editingRef.current = false; }
  }, [acknowledged, confirmation, savedId]);

  async function createPause(_note, overrides) {
    if (pending || savedId || !acknowledged) return;
    setPendingAction('save'); setError(null);
    try {
      const response = await fetch('/api/admin/planning/incoming-pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incomingId: context.source.incomingId, snapshots: context.snapshots,
          studentId: overrides.linkedStudentId, pauseDetails: overrides.pauseDetails, acknowledgement, acknowledgementConfirmation: confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw planningSaveClientError(data, 'Pause could not be saved. Your message remains in Inbox.');
      setSavedId(data.planningId); setWarning(data.warning || '');
      try { window.sessionStorage.removeItem(storageKey); } catch { /* The linked source prevents reuse even if storage is unavailable. */ }
      onCreated(data);
    } catch (caught) { setError(caught); }
    finally { setPendingAction(''); }
  }

  async function copyAcknowledgement() {
    if (!acknowledgement.trim() || pending || confirmation) return;
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

  function confirmAcknowledgement(mode) {
    if (pending || savedId) return;
    try {
      setConfirmation(confirmIncomingPauseAcknowledgement({ mode, reply: acknowledgement, openedAt }));
      setError(null);
    } catch (caught) { setError(caught); }
  }

  function editAcknowledgement() {
    editingRef.current = true;
    setConfirmation(null); setOpenedAt(''); setError(null);
  }

  if (context.error) return <section className="rounded-2xl border border-amber-200 bg-white p-5"><p>{context.error}</p><Link className="underline" href="/admin/incoming-messages">Return to Inbox</Link></section>;
  if (context.linkedPlanningId) return <section className="rounded-2xl border border-blue-200 bg-white p-5"><p>This message already has a linked plan.</p><Link className="underline" href={`/admin/planning?view=${encodeURIComponent(savedId)}`}>View existing plan</Link></section>;

  return <section ref={panelRef} tabIndex={-1} aria-label="Pause planning from message" className="scroll-mt-44 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xl font-semibold text-slate-900">{savedId ? 'Pause plan created' : 'Reply and plan this absence'}</h3>
      <Link className="text-sm font-semibold underline" href="/admin/incoming-messages">{savedId ? 'Return to Inbox' : 'Cancel — return to Inbox'}</Link>
    </div>
    <p className="mt-2 text-sm text-slate-600">{savedId ? 'Your message has moved out of Inbox. The work and final confirmation are on the pause card.' : 'First acknowledge the message, then create the pause plan. Your message stays in Inbox until the plan is saved.'}</p>
    <p className="mt-4 text-sm font-semibold">{context.source.senderName} · {context.source.chatName}</p>
    <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{context.source.messageText}</p>
    {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"><PlanningSaveError message={error.message} duplicatePlanningId={error.duplicatePlanningId || ''} /></div> : null}
    {warning ? <p role="alert" className="mt-3 text-sm text-amber-800">{warning}</p> : null}
    {rememberError && !savedId ? <p role="status" className="mt-3 text-sm text-amber-800">This browser could not remember the draft. Stay on this screen until you save the plan.</p> : null}
    <div className={`my-4 rounded-xl border p-4 ${acknowledged ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}>
      <h4 className="font-semibold">1. Acknowledge the message {acknowledged ? '✓' : ''}</h4>
      {acknowledged ? <>
        <p role="status" className="mt-2 text-sm text-emerald-900">{confirmation.mode === 'sent' ? 'Acknowledgement confirmed sent. Continue with the pause plan below.' : 'Already acknowledged. Continue with the pause plan below.'}</p>
        {confirmation.mode === 'sent' ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{confirmation.reply}</p> : null}
        {!savedId ? <button type="button" onClick={editAcknowledgement} className="mt-2 text-sm font-semibold underline">Edit acknowledgement</button> : null}
      </> : <>
        <label className="mt-3 block text-sm font-semibold">Initial acknowledgement
          <textarea ref={acknowledgementRef} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" value={acknowledgement} maxLength={1200}
            onChange={event => { setAcknowledgement(event.target.value); setOpenedAt(''); }} rows={3} />
        </label>
        <p className="mt-2 text-sm text-slate-600">Copy the reply, choose the correct lesson chat in WhatsApp and send it. Then return here and confirm it was sent.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton onClick={copyAcknowledgement} disabled={!restored || pending || !acknowledgement.trim()} pending={pendingAction === 'copy'} pendingLabel="Copying…" variant={openedAt ? 'subtle' : 'primary'}>Copy & open WhatsApp</ActionButton>
          {openedAt ? <ActionButton onClick={() => confirmAcknowledgement('sent')} disabled={pending}>Acknowledgement sent</ActionButton> : null}
          <ActionButton onClick={() => confirmAcknowledgement('already_acknowledged')} disabled={!restored || pending} variant="subtle">Already acknowledged</ActionButton>
        </div>
        {openedAt ? <p role="status" className="mt-2 text-sm text-slate-600">Confirming keeps this screen open and unlocks step 2. It does not create a plan.</p> : null}
      </>}
    </div>
    <div className={`rounded-xl border p-4 ${acknowledged ? 'border-blue-200' : 'border-slate-200 bg-slate-50'}`}>
      <h4 ref={planningStepRef} tabIndex={-1} className="scroll-mt-44 font-semibold outline-none">2. Create the pause plan {savedId ? '✓' : ''}</h4>
      {savedId ? <>
        <p role="status" className="mt-2 text-sm text-emerald-800">Pause plan saved. Complete the work there, then send the final confirmation.</p>
        <Link className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" href={`/admin/planning?view=${encodeURIComponent(savedId)}`}>View pause plan</Link>
      </> : acknowledged ? <>
        <p className="my-3 text-sm text-slate-600">Review the student and lesson dates, then create the plan. Saving keeps this screen open and shows your saved card.</p>
        {context.suggestedDates ? <p className="mb-3 text-xs text-slate-600">Dates suggested by the message: {context.suggestedDates}. Check these against the actual lesson dates below.</p> : null}
        <QuickBrainCapture pauseOnly rawNote="" setRawNote={() => {}} options={options} setOptions={setOptions} studentOptions={studentOptions}
          expanded={false} setExpanded={() => {}} onSubmit={event => event.preventDefault()} onPauseCapture={createPause} pending={pendingAction === 'save'} />
      </> : <p className="mt-2 text-sm text-slate-500">Finish step 1 to choose the student and dates and create the pause plan.</p>}
    </div>
  </section>;
}
