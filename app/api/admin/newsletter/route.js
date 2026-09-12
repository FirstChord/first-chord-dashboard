/** @fileoverview Admin-gated newsletter endpoints: read one month's issue view, and record the issue, its priority students, arriving contributions, media consent, and editorial selection. */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import {
  getNewsletterWorkflow,
  recordNewsletterConsent,
  recordNewsletterContribution,
  saveNewsletterIssue,
  setNewsletterEditorial,
  setNewsletterPriorities,
} from '@/lib/admin/newsletter';

// Client-visible reasons. Anything not listed is a server fault, not the
// operator's, and must not be echoed back as if it were their input.
const CLIENT_ERRORS = new Set([
  'invalid_issue_month',
  'invalid_deadline',
  'invalid_mode',
  'invalid_json',
  'student_not_found',
  'item_not_found',
  'item_student_mismatch',
  'fc_identity_unresolved',
  'fc_identity_conflict',
  'fc_tutor_unresolved',
  'invalid_tutor_response',
  'invalid_consent_answer',
  'invalid_editorial_value',
  'nothing_to_record',
  'consent_needed',
  'consent_waiting',
  'consent_blocked',
  'media_not_supported',
]);

function errorResponse(code) {
  const status = CLIENT_ERRORS.has(code) ? 400 : 502;
  return Response.json({ success: false, code }, { status });
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return null;
  return session;
}

export async function GET(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ success: false, code: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  try {
    const workflow = await getNewsletterWorkflow({
      issueMonth: `${searchParams.get('month') || ''}`.trim(),
    });
    return Response.json({ success: true, workflow });
  } catch (error) {
    console.error('Newsletter load failed:', error.message);
    return Response.json({ success: false, code: 'read_failed' }, { status: 502 });
  }
}

export async function POST(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ success: false, code: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_json');
  }

  const actorEmail = session.user.email || '';
  const mode = `${body?.mode || ''}`.trim();

  try {
    let result;
    switch (mode) {
      case 'save_issue':
        result = await saveNewsletterIssue({
          issueMonth: body.issueMonth,
          question: body.question,
          deadline: body.deadline,
          intro: body.intro,
          actorEmail,
        });
        break;

      case 'set_priorities':
        result = await setNewsletterPriorities({
          issueMonth: body.issueMonth,
          mmsIds: Array.isArray(body.mmsIds) ? body.mmsIds : [],
          actorEmail,
        });
        break;

      case 'record_contribution':
        // Slice 1 records that a picture exists; it never accepts the file. A
        // silently dropped upload is the failure mode where someone believes a
        // photo of a child was delivered, so an attempt is refused outright.
        if (body.media || body.file || body.mediaJson) {
          return errorResponse('media_not_supported');
        }
        result = await recordNewsletterContribution({
          issueMonth: body.issueMonth,
          mmsId: body.mmsId,
          itemId: body.itemId,
          tutorText: body.tutorText,
          tutorResponse: body.tutorResponse,
          hasMedia: body.hasMedia === true,
          captureTicket: body.captureTicket,
          actorEmail,
        });
        break;

      case 'record_consent':
        result = await recordNewsletterConsent({
          itemId: body.itemId,
          asked: body.asked === true,
          answer: body.answer,
          actorEmail,
        });
        break;

      case 'set_editorial':
        result = await setNewsletterEditorial({
          itemId: body.itemId,
          editorial: body.editorial,
        });
        break;

      default:
        return errorResponse('invalid_mode');
    }

    if (result?.error) {
      return errorResponse(result.error);
    }

    // Return the refreshed view so the page re-renders from server truth rather
    // than patching its own optimistic copy — the consent guard in particular
    // must never be evaluated only on the client.
    const workflow = await getNewsletterWorkflow({
      issueMonth: body.issueMonth || result?.item?.issueMonth || '',
    });
    return Response.json({ success: true, result, workflow });
  } catch (error) {
    console.error(`Newsletter ${mode} failed:`, error.message);
    return Response.json({ success: false, code: 'write_failed' }, { status: 502 });
  }
}
