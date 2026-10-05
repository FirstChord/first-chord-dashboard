/** @fileoverview Injectable one-shot payroll email delivery with durable pre-provider claim and manual recovery of ambiguous outcomes. */
export async function deliverPayrollEmail({ store, claim, markSending, send, markSent, markUnknown, timeoutMs = 10000 }) {
  if (store && !await store.claimEmail(claim)) return { ok: false, reason: 'delivery_unknown' };
  let timer;
  try {
    await markSending();
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('send_timeout')), timeoutMs); });
    const result = await Promise.race([send(), timeout]);
    if (!result?.id) throw new Error('provider_receipt_missing');
    await markSent(result);
    if (store) await store.finishEmail(claim.key, 'sent', result.id);
    return { ok: true, messageId: result.id };
  } catch {
    // Never release/reclaim an email key, even if audit tracking fails. A send
    // timeout does not mean Gmail rejected it, and may finish after we return.
    try { await markUnknown(); } catch { /* pre-provider claim remains blocked */ }
    if (store) {
      try { await store.finishEmail(claim.key, 'unknown'); } catch { /* immutable claim is sufficient */ }
    }
    return { ok: false, reason: 'delivery_unknown' };
  } finally { clearTimeout(timer); }
}
