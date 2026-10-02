/** @fileoverview Injectable secret-only background inbox proposal sweep; returns counts without message data. */
import { timingSafeEqual } from 'node:crypto';

export function createIncomingAutoCheckPostHandler({ secret, autoCheck }) {
  return async function POST(request) {
    const expected = secret();
    if (!expected) return Response.json({ error: 'Background checking is not configured' }, { status: 503 });
    const supplied = request.headers.get('x-firstchord-schedule-secret') || '';
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    try { return Response.json({ success: true, ...await autoCheck() }, { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Background checking is unavailable' }, { status: 503 }); }
  };
}
