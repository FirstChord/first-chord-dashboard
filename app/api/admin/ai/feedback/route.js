/** @fileoverview Admin-gated endpoint recording helpful/not-helpful ratings and reason codes against an AI request id. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';

const RATINGS = new Set(['helpful', 'not_helpful']);
const REASONS = new Set([
  '',
  'incorrect_or_unsupported',
  'missed_uncertainty',
  'confusing',
  'no_added_value',
  'evidence_wrong',
  'diagnosis_wrong',
  'proposed_fix_wrong',
  'missing_context',
  'not_an_issue',
]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function noStore(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...init.headers, 'Cache-Control': 'no-store' },
  });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return noStore({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: 'Invalid feedback' }, { status: 400 });
  }

  const requestId = `${body?.requestId || ''}`.trim();
  const rating = `${body?.rating || ''}`.trim();
  const reason = `${body?.reason || ''}`.trim();
  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || !RATINGS.has(rating)
    || !REASONS.has(reason)
    || (rating === 'helpful' && reason)
    || (rating === 'not_helpful' && !reason)
  ) {
    return noStore({ error: 'Invalid feedback' }, { status: 400 });
  }

  // Pilot telemetry only: requestId joins this enum feedback to the matching
  // provider-call metadata. No student identifier, prompt, context or model
  // output is accepted or logged here, and issue/workflow state is untouched.
  console.info(JSON.stringify({
    event: 'admin_ai_issue_feedback',
    requestId,
    rating,
    reason,
    recordedAt: new Date().toISOString(),
  }));

  return noStore({ recorded: true });
}
