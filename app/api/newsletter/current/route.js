/** @fileoverview Tutor-authorized read of the open newsletter issue and this tutor's priority students. */
import { NextResponse } from 'next/server';
import { authorizeNewsletterTutorRequest } from '@/lib/admin/newsletter-tutor-auth.mjs';
import { getNewsletterWorkflow } from '@/lib/admin/newsletter';
import { parseItemMedia, summariseItemMedia } from '@/lib/admin/newsletter-media-helpers.mjs';
import { resolveTutorName } from '@/lib/admin/tutor-identity.mjs';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const studentId = `${searchParams.get('student') || ''}`.trim();

  const auth = await authorizeNewsletterTutorRequest({
    token: searchParams.get('token') || '',
    studentId,
  });
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  try {
    const workflow = await getNewsletterWorkflow();
    if (!workflow.issue) {
      // No open issue is the normal quiet state, not an error. The strip renders
      // nothing rather than an empty box.
      return NextResponse.json({ success: true, open: false });
    }

    const tutor = resolveTutorName(auth.tutor);
    const mine = workflow.items.filter((item) => resolveTutorName(item.tutorName) === tutor);

    // Deliberately narrow: names, the question, and this tutor's own students.
    // No other tutor's students, no consent answers, no editorial decisions, and
    // nothing about what Fenella thinks of anybody's contribution.
    return NextResponse.json({
      success: true,
      open: true,
      month: workflow.month,
      monthLabel: workflow.monthLabel,
      question: workflow.issue.question || '',
      deadline: workflow.issue.deadline || '',
      priorities: mine
        .filter((item) => item.requestedAt)
        .map((item) => ({
          mmsId: item.mmsId,
          studentName: item.studentName,
          state: item.state,
        })),
      // What this tutor has already recorded for the selected student, so the
      // panel can show it rather than looking empty after a save.
      student: (() => {
        const forStudent = mine.find((item) => item.mmsId === studentId) || null;
        if (!forStudent) return null;
        const media = parseItemMedia(forStudent.mediaJson);
        return {
          itemId: forStudent.itemId,
          state: forStudent.state,
          requested: Boolean(forStudent.requestedAt),
          tutorText: forStudent.tutorText || '',
          tutorResponse: forStudent.tutorResponse || '',
          media: media.map((entry) => ({
            driveFileId: entry.driveFileId,
            kind: entry.kind,
            fileName: entry.fileName,
          })),
          mediaSummary: summariseItemMedia(media).label,
        };
      })(),
    });
  } catch (error) {
    console.error('Newsletter tutor read failed:', error.message);
    return NextResponse.json({ success: false, code: 'read_failed' }, { status: 502 });
  }
}
