'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export default function PaymentSetupCompletionButton({
  mmsId,
  studentName,
  expectedPaymentMode,
  expectedPaymentExpectation,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState({ error: '', complete: false });

  function handleComplete() {
    const confirmed = window.confirm(
      `Verify ${studentName}'s live Stripe setup and mark payment setup complete?\n\n`
        + 'This changes the dashboard expectation to payments active. It does not change Stripe.',
    );

    if (!confirmed) return;

    setState({ error: '', complete: false });
    startTransition(async () => {
      try {
        const stripeResponse = await fetch(
          `/api/admin/students/${encodeURIComponent(mmsId)}/stripe?reviewSetup=1`,
          { cache: 'no-store' },
        );
        const stripeData = await stripeResponse.json();

        if (!stripeResponse.ok) {
          setState({ error: stripeData.error || 'Live Stripe check failed.', complete: false });
          return;
        }

        if (!stripeData.setupCompletion?.ready) {
          setState({
            error: stripeData.setupCompletion?.reason || 'Stripe setup is not ready to complete.',
            complete: false,
          });
          return;
        }

        const updateResponse = await fetch(`/api/admin/students/${encodeURIComponent(mmsId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentExpectation: 'stripe_active_expected',
            expectedPaymentMode,
            expectedPaymentExpectation,
            auditContext: {
              source: 'admin_payment_setup_queue_action',
              actionLabel: 'Verify and mark payment setup complete',
              note: stripeData.setupCompletion.reason,
            },
          }),
        });
        const updateData = await updateResponse.json();

        if (!updateResponse.ok) {
          setState({ error: updateData.error || 'Could not complete payment setup.', complete: false });
          return;
        }

        setState({ error: '', complete: true });
        router.refresh();
      } catch (error) {
        setState({ error: error.message || 'Could not complete payment setup.', complete: false });
      }
    });
  }

  if (state.complete) {
    return <p className="mt-2 font-medium text-emerald-700">Setup complete — removing from queue…</p>;
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleComplete}
        disabled={isPending}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Checking Stripe…' : 'Verify and mark complete'}
      </button>
      {state.error ? <p className="mt-2 max-w-xs text-xs text-red-700">{state.error}</p> : null}
    </div>
  );
}
