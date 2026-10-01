/** @fileoverview Admin-only, manual Jev inbox assessment and feedback; never changes review state or sends messages. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { isIncomingResolutionConfigured } from '@/lib/admin/incoming-resolution-service.mjs';
import { getIncomingResolutionProposals, assessIncomingResolution, reviewIncomingResolution } from '@/lib/admin/incoming-resolution-proposals';

const recentChecks = new Map();
function noStore(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
function limited(key) {
  const now = Date.now();
  for (const [admin, times] of recentChecks) {
    if (!times.some(time => now - time < 60_000)) recentChecks.delete(admin);
  }
  const times = (recentChecks.get(key) || []).filter(time => now - time < 60_000);
  if (times.length >= 10) return true;
  recentChecks.set(key, [...times, now]);
  return false;
}
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return noStore({ error: 'Unauthorized' }, 401);
  try { return noStore({ success: true, ...await getIncomingResolutionProposals() }); }
  catch { return noStore({ error: 'Could not load reply assessments' }, 503); }
}
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return noStore({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return noStore({ error: 'Invalid request' }, 400);
  const actorEmail = session.user.email || '';
  if (body.mode === 'assess') {
    if (!isIncomingResolutionConfigured()) return noStore({ error: 'Reply checking is not connected yet' }, 503);
    if (Object.keys(body).some(key => !['mode', 'incomingId'].includes(key))
      || typeof body.incomingId !== 'string' || !body.incomingId || body.incomingId.length > 200) return noStore({ error: 'Choose a message to check' }, 400);
    if (limited(actorEmail || session.user.name || 'admin')) return noStore({ error: 'Please wait before checking more replies' }, 429);
    try {
      const result = await assessIncomingResolution({ incomingId: body.incomingId, actorEmail });
      console.info(JSON.stringify({ event: 'admin_jev_inbox_resolution', outcome: 'proposed', label: result.proposal.label, guard: result.proposal.guard }));
      return noStore({ success: true, ...result });
    } catch (error) {
      // Never expose a provider body, source text or arbitrary internal error to the browser/log.
      const code = ['timeout', 'rate_limited', 'invalid_response', 'provider_error', 'provider_unavailable'].includes(error?.code) ? error.code : 'assessment_unavailable';
      console.warn(JSON.stringify({ event: 'admin_jev_inbox_resolution', outcome: 'failed', code }));
      return noStore({ error: 'Could not check these replies. Refresh and try again if still useful' }, 503);
    }
  }
  if (body.mode === 'feedback') {
    if (Object.keys(body).some(key => !['mode', 'proposalId', 'label'].includes(key))
      || typeof body.proposalId !== 'string' || body.proposalId.length > 200 || typeof body.label !== 'string') return noStore({ error: 'Invalid assessment feedback' }, 400);
    try { return noStore({ success: true, ...await reviewIncomingResolution({ proposalId: body.proposalId, label: body.label, actorEmail }) }); }
    catch { return noStore({ error: 'This assessment is no longer open or the conversation changed. Refresh before reviewing it' }, 409); }
  }
  return noStore({ error: 'Unknown mode' }, 400);
}
