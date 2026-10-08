'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { ButtonLink } from '@/components/admin/ui/ButtonLink';
import { buildStripeStudentDashboardLink } from '@/lib/admin/stripe-dashboard-helpers.mjs';
import { paymentExpectationLabel } from '@/lib/admin/student-detail-helpers.mjs';
import { studentHref, formatDateTime } from '@/lib/admin/planning-client-helpers.mjs';

export default function StudentPlanningPanel({ mmsId, initialStudent, onClose, onUpdated }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [record, setRecord] = useState({ student: initialStudent, loading: true, error: '' });
  const [fullRecord, setFullRecord] = useState(false);
  const [stripe, setStripe] = useState({ loading: false, error: '', result: null });
  const student = record.student;
  const link = buildStripeStudentDashboardLink(student || {});

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/students/${encodeURIComponent(mmsId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.student) throw new Error(data.error || 'Student record could not be loaded.');
        if (data.student.mmsId !== mmsId) throw new Error('Student record did not match this follow-up.');
        setRecord({ student: data.student, loading: false, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRecord((current) => ({ ...current, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, [mmsId]);

  async function refreshRecord() {
    setRecord((current) => ({ ...current, loading: true, error: '' }));
    setStripe({ loading: false, error: '', result: null });
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(mmsId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.student) throw new Error(data.error || 'Student record could not be loaded.');
      if (data.student.mmsId !== mmsId) throw new Error('Student record did not match this follow-up.');
      setRecord({ student: data.student, loading: false, error: '' });
      if (await onUpdated?.() === false) throw new Error('Record refreshed, but the follow-up could not reload. Try Refresh checks on the card.');
    } catch (error) {
      setRecord((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  async function checkStripe() {
    setStripe({ loading: true, error: '', result: null });
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(mmsId)}/stripe?reviewSetup=1`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Live Stripe check failed.');
      setStripe({ loading: false, error: '', result });
    } catch (error) {
      setStripe({ loading: false, error: error.message, result: null });
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl border-0 border-l border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/30"
    >
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Student details</p>
            <h2 id={titleId} className="mt-1 break-words text-base font-semibold">{student?.fullName || 'Student record'}</h2>
          </div>
          <ActionButton variant="quiet" size="compact" onClick={onClose}>Close ✕</ActionButton>
        </header>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-3">
          <ButtonLink href={link.href} target="_blank" rel="noreferrer" size="compact">{link.label}</ButtonLink>
          <ActionButton variant="secondary" size="compact" onClick={() => setFullRecord((current) => !current)}>{fullRecord ? 'Back to summary' : 'Full student record'}</ActionButton>
          <ActionButton variant="quiet" size="compact" pending={record.loading} pendingLabel="Refreshing…" disabled={record.loading} onClick={refreshRecord}>Refresh record</ActionButton>
        </div>
        {fullRecord ? (
          <iframe src={studentHref(mmsId)} title="Full student record" className="min-h-0 w-full flex-1 border-0" />
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            {record.loading ? <p role="status" className="mb-4 text-sm text-slate-600">Loading the current student record…</p> : null}
            {record.error ? <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{record.error}{student ? ' The details below are from the last successful load.' : ''}</p> : null}
            {student ? (
              <>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {[
                    ['Tutor', student.tutor], ['Instrument', student.instrument],
                    ['Parent / contact', [student.parentFirstName, student.parentLastName].filter(Boolean).join(' ')],
                    ['Email', student.email], ['Payment expectation', paymentExpectationLabel(student.paymentExpectation)],
                    ['Recorded Stripe subscription', /^sub_[a-zA-Z0-9]+$/.test(`${student.stripeSubscriptionId || ''}`.trim()) ? student.stripeSubscriptionId : 'Not recorded'],
                  ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{value || 'Not recorded'}</dd></div>)}
                </dl>
                {link.kind === 'lookup' ? <p className="mt-4 text-xs text-slate-600">No valid Stripe link is recorded yet. Use the contact email to find the customer in Stripe.</p> : null}
                <section className="mt-6 border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Live Stripe status</h3>
                    <ActionButton variant="secondary" size="compact" disabled={record.loading || stripe.loading || student.paymentMode !== 'stripe'} pending={stripe.loading} pendingLabel="Checking…" onClick={checkStripe}>Check Stripe</ActionButton>
                  </div>
                  {stripe.error ? <p role="alert" className="mt-3 text-sm text-red-700">{stripe.error}</p> : null}
                  {stripe.result ? (
                    <div className="mt-3 space-y-2 text-sm text-slate-700" role="status">
                      <p>{stripe.result.skippedReason || (stripe.result.snapshot?.subscriptionFound ? `Subscription exists · ${stripe.result.snapshot.subscriptionStatus || 'Status unknown'}` : 'No live subscription found')}</p>
                      {stripe.result.snapshot?.trialEndsAt ? <p>Trial ends {formatDateTime(stripe.result.snapshot.trialEndsAt)}.</p> : null}
                      {stripe.result.snapshot?.lastCheckedAt ? <p className="text-xs text-slate-500">Checked {formatDateTime(stripe.result.snapshot.lastCheckedAt)}</p> : null}
                      {stripe.result.issues?.length ? <p className="text-amber-800">Needs review: {stripe.result.issues.join(', ')}</p> : null}
                    </div>
                  ) : <p className="mt-3 text-xs text-slate-600">Check whether a subscription already exists or is still waiting for setup. A recorded link alone does not confirm live billing.</p>}
                </section>
              </>
            ) : !record.loading ? <p className="text-sm text-slate-600">Student details are unavailable. Refresh the record to try again.</p> : null}
          </div>
        )}
      </div>
    </dialog>
  );
}
