/** @fileoverview Injectable secret-gated scheduled payroll checker returning only counts, disabled before any source access. */
import { timingSafeEqual } from 'node:crypto';

export function createPayrollDeferredPostHandler({ secret, enabled, check }) {
  return async function POST(request) {
    const expected = secret();
    if (!expected) return Response.json({ error: 'Payroll checking is not configured' }, { status: 503 });
    const supplied = request.headers.get('x-firstchord-schedule-secret') || '';
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!enabled()) return Response.json({ success: true, disabled: true, checked: 0, sent: 0 });
    try { return Response.json({ success: true, ...await check() }, { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Payroll checking is unavailable' }, { status: 503 }); }
  };
}
