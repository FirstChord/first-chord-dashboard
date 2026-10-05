/** @fileoverview Injectable bounded payroll checker: fresh evidence, atomic approval claim, review then one existing email send. */
import { decideDeferredPayroll, buildDeferredReviewedRun, deferredPayrollScope, deferredPayrollEligibility } from './payroll-deferred-helpers.mjs';

export async function prepareDeferredPayroll({ store, evidence, actor, nudge }) {
  if (!actor) throw new Error('Sign in again before approving an automatic statement send.');
  const scope = deferredPayrollScope(evidence);
  const allowed = deferredPayrollEligibility({ row: evidence.row, scope });
  if (!allowed.ok) return allowed;
  if (allowed.readiness.ready) return { ok: false, reason: 'nothing_missing' };
  const job = await store.prepare(scope, actor);
  try {
    const result = await nudge();
    const delivered = result.ok || result.reason === 'already_sent';
    if (!await store.transition(job.id, 'preparing', delivered ? 'waiting' : 'held', delivered ? '' : 'Checklist delivery needs a manual check.')) throw new Error('Approval tracking changed. Refresh payroll.');
    return delivered ? { ok: true, recipient: scope.email, deferred: true } : result;
  } catch (error) {
    await store.transition(job.id, 'preparing', 'held', 'Checklist delivery was interrupted. Check Gmail Sent before trying again.');
    throw error;
  }
}

export async function cancelDeferredPayrollApproval({ store, id, actor }) {
  if (!actor) throw new Error('Sign in again before cancelling an automatic statement send.');
  const latest = await store.get(id);
  if (!latest) throw new Error('Approval not found. Refresh payroll.');
  if (latest.status === 'claimed' || latest.status === 'unknown') throw new Error('Check the statement and Gmail Sent before handling an interrupted delivery.');
  if (!['waiting', 'preparing', 'held'].includes(latest.status)) throw new Error('This approval is no longer waiting. Refresh payroll.');
  if (!await store.transition(id, latest.status, 'cancelled', `Cancelled by ${actor}`)) throw new Error('Approval changed. Refresh payroll.');
  return { ok: true };
}

export async function runDeferredPayrollChecks({ store, lock, loadEvidence, review, send, now = () => new Date() }) {
  const counts = { checked: 0, waiting: 0, sent: 0, held: 0, unavailable: 0 };
  for (const candidate of await store.waiting(3)) {
    try {
      await lock(candidate.tutor_short_name, async () => {
        const job = await store.get(candidate.id);
        if (job?.status !== 'waiting') return;
        counts.checked++;
        if (!Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at) <= now().getTime()) {
          await store.transition(job.id, 'waiting', 'held', 'Approval expired. Review this period manually.'); counts.held++; return;
        }
        const evidence = await loadEvidence(job.scope);
        const decision = decideDeferredPayroll({ job, evidence, now: now() });
        if (decision.action === 'wait') {
          await store.transition(job.id, 'waiting', 'waiting'); counts.waiting++; return;
        }
        if (decision.action === 'hold') {
          await store.transition(job.id, 'waiting', 'held', decision.reason); counts.held++; return;
        }
        if (decision.action !== 'send') return;
        // Never reclaim a interrupted claim. Sheets/provider work may already
        // have happened and must be inspected manually before any retry.
        if (!await store.transition(job.id, 'waiting', 'claimed')) return;
        try {
          await review(buildDeferredReviewedRun(evidence, job.approved_by, now()), evidence, job);
          const result = await send({ payrollId: job.payroll_id, actorEmail: job.approved_by,
            expectedRecipient: job.scope.email, expectedVerifiedAt: job.scope.verifiedAt, deliveryLockHeld: true });
          await store.transition(job.id, 'claimed', result.ok ? 'sent' : 'unknown',
            result.ok ? '' : 'Check the statement and Gmail Sent before sending anything else.');
          if (result.ok) counts.sent++; else counts.held++;
        } catch {
          await store.transition(job.id, 'claimed', 'unknown', 'Delivery was interrupted. Check the statement and Gmail Sent.');
          counts.held++;
        }
      });
    } catch {
      counts.unavailable++;
      // Keep transient provider failures retryable, but rotate them behind other
      // periods. The conditional update cannot resurrect cancelled/claimed work.
      try { await store.transition(candidate.id, 'waiting', 'waiting'); } catch { /* next sweep can retry */ }
    }
  }
  return counts;
}
