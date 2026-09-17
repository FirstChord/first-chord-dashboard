/** @fileoverview Tutor-authorized MMS student list enriched with Soundslice, explicit Theta access, and per-student notes tokens. */
import mmsClient from '@/lib/mms-client-cached';
import { enhanceStudentsWithSoundslice } from '@/lib/soundslice-mappings';
import { enhanceStudentsWithThetaAccess } from '@/lib/theta-access.mjs';
import { addStudentNotesTokens } from '@/lib/tutor-surface-token.mjs';
import { getActiveTutorOptions } from '@/lib/admin/tutors';
import { requireTutorDashboardAccess, tutorAuthErrorBody } from '@/lib/tutor-auth';

// BYPASS DATABASE - JUST USE MMS DATA DIRECTLY WITH SOUNDSLICE
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tutor = searchParams.get('tutor');
  
  console.log('=== Students API called ===');
  console.log('Requested tutor:', JSON.stringify(tutor));
  
  try {
    if (tutor) {
      const tutorAuth = await requireTutorDashboardAccess({ requestedTutor: tutor });
      if (!tutorAuth.ok) {
        return Response.json(tutorAuthErrorBody(tutorAuth), { status: tutorAuth.status });
      }
      const activeTutors = await getActiveTutorOptions();
      if (!activeTutors.some((entry) => entry.shortName === tutor)) {
        return Response.json({ students: [] }, { status: 404 });
      }
      console.log('Fetching students for tutor from MMS:', tutor);
      const mmsResult = await mmsClient.getStudentsForTeacher(tutor);
      
      if (mmsResult.success && mmsResult.students) {
        console.log('Found students from MMS:', mmsResult.students.length);
        // Enhance with Soundslice courses
        const enhancedStudents = enhanceStudentsWithThetaAccess(
          enhanceStudentsWithSoundslice(mmsResult.students),
        );
        return Response.json({
          students: addStudentNotesTokens(enhancedStudents, { tutor }),
        });
      } else {
        console.log('MMS fetch failed, returning empty array');
        return Response.json({ students: [] });
      }
    } else {
      // No tutor specified, return empty array
      return Response.json({ students: [] });
    }
  } catch (error) {
    console.error('Students API error:', error);
    return Response.json({ error: error.message, students: [] }, { status: 500 });
  }
}
