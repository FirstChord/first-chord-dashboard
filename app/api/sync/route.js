/** @fileoverview Tutor-authorized MMS resync attaching Soundslice, explicit Theta access, and per-student notes tokens. */
import mmsClient from '@/lib/mms-client-cached';
import { enhanceStudentsWithSoundslice } from '@/lib/soundslice-mappings';
import { enhanceStudentsWithThetaAccess } from '@/lib/theta-access.mjs';
import { addStudentNotesTokens } from '@/lib/tutor-surface-token.mjs';
import { getActiveTutorOptions } from '@/lib/admin/tutors';
import { requireTutorDashboardAccess, tutorAuthErrorBody } from '@/lib/tutor-auth';

// BYPASS DATABASE - JUST USE MMS DATA DIRECTLY WITH HARDCODED SOUNDSLICE
export async function POST(request) {
  try {
    const { tutor, forceSync = false } = await request.json();
    const tutorAuth = await requireTutorDashboardAccess({ requestedTutor: tutor });
    if (!tutorAuth.ok) {
      return Response.json(tutorAuthErrorBody(tutorAuth), { status: tutorAuth.status });
    }
    const activeTutors = await getActiveTutorOptions();
    if (!activeTutors.some((entry) => entry.shortName === tutor)) {
      return Response.json({ success: false, students: [], count: 0, source: 'error', message: 'Tutor is not available on the live dashboard' }, { status: 404 });
    }
    
    console.log('=== MMS Student Sync Started ===');
    console.log('Tutor:', tutor);
    console.log('Force sync:', forceSync);
    
    // Get students directly from MMS (no database involved)
    console.log('Calling mmsClient.getStudentsForTeacher with tutor:', tutor);
    const mmsResult = await mmsClient.getStudentsForTeacher(tutor);
    
    console.log('MMS result:', JSON.stringify({
      success: mmsResult.success,
      message: mmsResult.message || 'No message',
      error: mmsResult.error,
      studentsCount: mmsResult.students ? mmsResult.students.length : 0
    }));
    
    if (mmsResult.success && mmsResult.students) {
      // Enhance MMS data with hardcoded Soundslice courses
      const enhancedStudents = enhanceStudentsWithThetaAccess(
        enhanceStudentsWithSoundslice(mmsResult.students),
      );
      const studentsWithNoteTokens = addStudentNotesTokens(enhancedStudents, { tutor });
      console.log('Enhanced students with Soundslice courses');
      
      // Return enhanced data directly - no database saving
      return Response.json({
        success: true,
        students: studentsWithNoteTokens,
        count: studentsWithNoteTokens.length,
        source: 'mms',
        message: `Successfully fetched ${studentsWithNoteTokens.length} students from MMS with Soundslice courses`
      });
    } else {
      console.log('MMS fetch failed:', mmsResult.message);
      // Return empty array instead of trying database fallback
      return Response.json({
        success: false,
        students: [],
        count: 0,
        source: 'error',
        message: mmsResult.message || 'Failed to fetch from MMS'
      });
    }
  } catch (error) {
    console.error('Sync API error:', error);
    return Response.json({
      success: false,
      students: [],
      count: 0,
      source: 'error',
      message: error.message
    }, { status: 500 });
  }
}
