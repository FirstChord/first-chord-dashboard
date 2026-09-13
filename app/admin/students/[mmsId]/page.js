import { notFound } from 'next/navigation';
import { getAdminStudentByMmsId } from '@/lib/admin/students';
import { getActiveTutorOptions } from '@/lib/admin/tutors';
import { getPlanningDashboard } from '@/lib/admin/planning';
import { buildStudentPracticeTimeline } from '@/lib/admin/practice-timeline-helpers.mjs';
import { getStudentTimelineProjection } from '@/lib/admin/student-timeline.js';
import { formatTimeWithSchool } from '@/lib/admin/student-lifecycle.mjs';
import AdminStudentDetailClient from '@/components/admin/AdminStudentDetailClient';

export default async function AdminStudentDetailPage({ params }) {
  const resolvedParams = await params;
  const [student, planning] = await Promise.all([
    getAdminStudentByMmsId(resolvedParams.mmsId),
    getPlanningDashboard(),
  ]);

  if (!student) {
    notFound();
  }

  const [tutorOptions, history] = await Promise.all([
    getActiveTutorOptions(),
    getStudentTimelineProjection({ student }),
  ]);

  const linkedPlanningItems = (planning.items || [])
    .filter((item) => (item.linkedStudentIds || [item.linkedStudentId]).includes(student.mmsId))
    .filter((item) => !['done', 'parked'].includes(item.status))
    .map((item) => ({
      planningId: item.planningId,
      title: item.title,
      status: item.status,
      statusLabel: item.statusLabel,
      owner: item.owner,
      targetDate: item.targetDate,
      nextAction: item.nextAction,
      linkedWorkflowId: item.linkedWorkflowId,
      momentumLabel: item.momentumLabel,
    }));

  const practiceTimeline = buildStudentPracticeTimeline(history.practiceNotes);

  return (
    <AdminStudentDetailClient
      student={student}
      tutorOptions={tutorOptions}
      linkedPlanningItems={linkedPlanningItems}
      recentPracticeNotes={history.recentPracticeNotes}
      practiceTimeline={practiceTimeline}
      recentCommunications={history.recentCommunications}
      studentTimeline={history.timeline}
      timeWithSchool={formatTimeWithSchool(history.lifecycleRow || {})}
    />
  );
}
