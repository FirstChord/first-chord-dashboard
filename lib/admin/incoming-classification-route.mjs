/** @fileoverview Injectable admin-only HTTP handlers for explicit message checks and human review. */
import { validateClassification } from './incoming-classification-helpers.mjs';

const respond = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const validId = value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 200;
export function createIncomingClassificationHandlers({ session, configured, list, assess, review, autoCheck, readActiveInbox, now = Date.now }) {
  const recent = new Map();
  const allowed = key => {
    const current = now();
    for (const [admin, times] of recent) if (!times.some(time => current - time < 60_000)) recent.delete(admin);
    const times = (recent.get(key) || []).filter(time => current - time < 60_000);
    if (times.length >= 10) return false;
    recent.set(key, [...times, current]);
    return true;
  };
  return {
    async GET() {
      const user = (await session())?.user;
      if (!user?.isAdmin) return respond({ error: 'Unauthorized' }, 401);
      try { return respond({ success: true, ...await list() }); }
      catch { return respond({ error: 'Could not load message suggestions' }, 503); }
    },
    async POST(request) {
      const user = (await session())?.user;
      if (!user?.isAdmin) return respond({ error: 'Unauthorized' }, 401);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'Invalid request' }, 400);
      const actorEmail = user.email || '';
      if (body.mode === 'auto') {
        if (Object.keys(body).some(key => key !== 'mode')) return respond({ error: 'Invalid automatic check' }, 400);
        if (!autoCheck) return respond({ error: 'Automatic checking is unavailable' }, 503);
        if (!allowed(actorEmail || user.name || 'admin')) return respond({ error: 'Please wait before checking more messages' }, 429);
        try {
          const outcome = await autoCheck();
          const [suggestions, activeInbox] = await Promise.all([list(), readActiveInbox ? readActiveInbox() : null]);
          return respond({ success: true, ...outcome, ...suggestions, ...(activeInbox || {}) });
        }
        catch { return respond({ error: 'Automatic checking is unavailable. Messages remain in Needs attention' }, 503); }
      }
      if (body.mode === 'assess') {
        if (Object.keys(body).some(key => !['mode', 'incomingId'].includes(key)) || !validId(body.incomingId)) return respond({ error: 'Choose a message to check' }, 400);
        if (!configured()) return respond({ error: 'Message checking is not connected yet' }, 503);
        if (!allowed(actorEmail || user.name || 'admin')) return respond({ error: 'Please wait before checking more messages' }, 429);
        try { return respond({ success: true, ...await assess({ incomingId: body.incomingId, actorEmail }) }); }
        catch { return respond({ error: 'Could not check this message. Refresh before trying again' }, 503); }
      }
      if (['apply', 'discard'].includes(body.mode)) {
        const fields = body.mode === 'apply' ? ['mode', 'proposalId', 'classification'] : ['mode', 'proposalId'];
        if (Object.keys(body).some(key => !fields.includes(key)) || !validId(body.proposalId)
          || (body.mode === 'apply' && !validateClassification(body.classification))) return respond({ error: 'Choose valid message details' }, 400);
        try { return respond({ success: true, ...await review({ mode: body.mode, proposalId: body.proposalId, classification: body.classification, actorEmail }) }); }
        catch { return respond({ error: 'The suggestion is no longer open or the message changed. Refresh before reviewing it' }, 409); }
      }
      return respond({ error: 'Unknown mode' }, 400);
    },
  };
}
