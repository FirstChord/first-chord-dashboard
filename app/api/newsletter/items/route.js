/** @fileoverview Tutor-authorized newsletter text capture: a contribution for a student, or an explicit "nothing this month". */
import { NextResponse } from 'next/server';
import { authorizeNewsletterTutorRequest } from '@/lib/admin/newsletter-tutor-auth.mjs';
import { recordNewsletterContribution } from '@/lib/admin/newsletter';

const CLIENT_ERRORS = new Set([
  'invalid_issue_month',
  'invalid_json',
  'student_not_found',
  'item_not_found',
  'item_student_mismatch',
  'fc_identity_unresolved',
  'fc_identity_conflict',
  'fc_tutor_unresolved',
  'invalid_tutor_response',
  'media_not_supported',
]);

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'invalid_json' }, { status: 400 });
  }

  const mmsId = `${body.mmsId || ''}`.trim();
  const auth = await authorizeNewsletterTutorRequest({ token: `${body.token || ''}`, studentId: mmsId });
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  // Files go to /api/newsletter/media, which streams them to Drive. Accepting a
  // file-shaped field here and quietly dropping it is the failure mode where a
  // tutor believes a photo of a child was delivered.
  if (body.media || body.file || body.mediaJson) {
    return NextResponse.json({ success: false, code: 'media_not_supported' }, { status: 400 });
  }

  try {
    const result = await recordNewsletterContribution({
      issueMonth: body.issueMonth,
      mmsId,
      itemId: body.itemId,
      tutorText: body.tutorText,
      tutorResponse: body.tutorResponse,
      // A tutor ticking "there's a photo" without uploading one is allowed: the
      // file may still be on their phone. It sets the consent requirement either
      // way, which is the point.
      hasMedia: body.hasMedia === true,
      captureTicket: body.captureTicket,
      // Self-attested while the shared musiclessons account is the only approved
      // identity — see the tutor auth pilot. Recorded as, not by.
      actorEmail: auth.tutor,
    });

    if (result.error) {
      const status = CLIENT_ERRORS.has(result.error) ? 400 : 502;
      return NextResponse.json({ success: false, code: result.error }, { status });
    }

    return NextResponse.json({
      success: true,
      itemId: result.item.itemId,
      state: result.item.capturedAt ? 'captured' : 'recorded',
    });
  } catch (error) {
    console.error('Newsletter tutor capture failed:', error.message);
    return NextResponse.json({ success: false, code: 'write_failed' }, { status: 502 });
  }
}
