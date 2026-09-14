/** @fileoverview Tutor-authorized newsletter media upload: streams one file to First Chord's Google Drive and records only its stable file ID. */
import { NextResponse } from 'next/server';
import { authorizeNewsletterTutorRequest } from '@/lib/admin/newsletter-tutor-auth.mjs';
import { attachNewsletterMedia, getNewsletterItemMedia } from '@/lib/admin/newsletter';
import { notifyNewsletterArrival } from '@/lib/admin/newsletter-notify';
import {
  buildMediaFileName,
  validateMediaUpload,
} from '@/lib/admin/newsletter-media-helpers.mjs';
import {
  isNewsletterDriveConfigured,
  uploadNewsletterMedia,
} from '@/lib/admin/newsletter-drive';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import { resolveNewsletterIdentity } from '@/lib/admin/newsletter-helpers.mjs';

// The body is the raw file, not multipart: a single stream can be piped straight
// to Drive, where a multipart parser would want the whole thing in memory first.
// Metadata travels in the query string and Content-Type.
export const dynamic = 'force-dynamic';

const CLIENT_ERRORS = new Set([
  'invalid_issue_month',
  'fc_identity_unresolved',
  'fc_identity_conflict',
  'fc_tutor_unresolved',
  'student_not_found',
  'item_not_found',
  'item_student_mismatch',
  'unsupported_media_type',
  'media_too_large',
  'media_empty',
  'too_many_media_items',
  'missing_body',
]);

function fail(code, extra = {}) {
  const status = CLIENT_ERRORS.has(code) ? 400 : 502;
  return NextResponse.json({ success: false, code, ...extra }, { status });
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const mmsId = `${searchParams.get('student') || ''}`.trim();
  const issueMonth = `${searchParams.get('issueMonth') || ''}`.trim();
  const itemId = `${searchParams.get('itemId') || ''}`.trim();
  const uploadTicket = `${searchParams.get('ticket') || ''}`.trim();

  const auth = await authorizeNewsletterTutorRequest({
    token: searchParams.get('token') || '',
    studentId: mmsId,
  });
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  // Fail before reading a byte if the credential is absent, so a tutor is told
  // the feature is not switched on rather than watching an upload die at the end.
  if (!isNewsletterDriveConfigured()) {
    return NextResponse.json({ success: false, code: 'drive_not_configured' }, { status: 503 });
  }

  if (!request.body) {
    return fail('missing_body');
  }

  try {
    const students = await getOperationalAdminStudents();
    const student = students.find((candidate) => candidate.mmsId === mmsId);
    if (!student) return fail('student_not_found');

    const identity = resolveNewsletterIdentity(student);
    if (identity.error) return fail(identity.error);

    // Read what is already attached, so the per-item cap is checked against the
    // row rather than against a list the client could simply omit.
    const current = await getNewsletterItemMedia({
      issueMonth,
      fcStudentId: identity.fcStudentId,
      itemId,
      captureTicket: uploadTicket,
    });
    if (current.error) return fail(current.error);

    const validation = validateMediaUpload({
      contentType: request.headers.get('content-type') || '',
      contentLength: request.headers.get('content-length'),
      issueMonth,
      fcStudentId: identity.fcStudentId,
      existingMedia: current.media,
    });
    if (validation.error) {
      return fail(validation.error, { cap: validation.cap });
    }

    const fileName = buildMediaFileName({
      issueMonth,
      studentName: identity.studentName,
      fcStudentId: identity.fcStudentId,
      ext: validation.ext,
      uploadTicket,
    });

    // Drive first, then state. An orphaned Drive file is recoverable garbage a
    // human can re-attach or delete; a row pointing at a file that does not
    // exist is a broken page. reconcileNewsletterMedia finds the orphans.
    const uploaded = await uploadNewsletterMedia({
      issueMonth,
      fileName,
      mimeType: validation.mimeType,
      body: request.body,
      cap: validation.cap,
    });

    const attached = await attachNewsletterMedia({
      issueMonth,
      mmsId,
      itemId,
      captureTicket: uploadTicket,
      entry: {
        driveFileId: uploaded.driveFileId,
        fileName: uploaded.fileName,
        kind: validation.kind,
        mimeType: uploaded.mimeType,
        bytes: uploaded.bytes,
        uploadedAt: new Date().toISOString(),
        uploadedBy: auth.tutor,
        uploadTicket,
      },
    });

    if (attached.error) {
      // The bytes are safely in Drive but nothing references them. Say so
      // explicitly rather than reporting a plain failure, which would invite a
      // retry that uploads the file a second time.
      console.error(
        `Newsletter media orphaned in Drive: file ${uploaded.driveFileId} (${fileName}) `
        + `could not be attached — ${attached.error}`,
      );
      return NextResponse.json({
        success: false,
        code: 'attached_failed',
        driveFileId: uploaded.driveFileId,
        fileName: uploaded.fileName,
        message: 'The file reached First Chord’s Drive but could not be linked to the student. '
          + 'Do not re-upload; tell Finn so it can be linked by hand.',
      }, { status: 502 });
    }

    // Fenella hears once per item, and only after the save has landed. Awaited so
    // it is not cut off, but it cannot fail the request: notifyNewsletterArrival
    // never throws, and the contribution is already safe.
    if (attached.firstArrival) {
      const notification = await notifyNewsletterArrival({ item: attached.item });
      if (!notification.sent) {
        console.warn(`Newsletter arrival not emailed for ${attached.item.itemId}: ${notification.reason}`);
      }
    }

    return NextResponse.json({
      success: true,
      itemId: attached.item.itemId,
      kind: validation.kind,
      fileName: uploaded.fileName,
      bytes: uploaded.bytes,
      mediaCount: attached.media.length,
    });
  } catch (error) {
    if (error?.code === 'media_too_large' || error?.message === 'media_too_large') {
      // The streaming counter aborted mid-body: the declared Content-Length was
      // a lie, or absent.
      return fail('media_too_large');
    }
    console.error('Newsletter media upload failed:', error.message);
    return NextResponse.json({ success: false, code: 'upload_failed' }, { status: 502 });
  }
}
