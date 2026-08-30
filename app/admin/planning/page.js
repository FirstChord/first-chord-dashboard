import AdminPlanningPageClient from '@/components/admin/AdminPlanningPageClient';
import { getPlanningDashboard } from '@/lib/admin/planning';
import { getScheduleContextRows } from '@/lib/admin/sheets';
import { enrichScheduleContextsWithSharedSlots } from '@/lib/admin/schedule-context-helpers.mjs';
import { getAdminStudents } from '@/lib/admin/students';
import { getActiveTutorOptions } from '@/lib/admin/tutors';

const ALLOWED_INITIAL_FILTERS = new Set([
  'all',
  'due_now',
  'meeting',
  'school_notes',
  'learning_note',
  'strategic_note',
  'unassigned',
  'no_next_action',
  'waiting_status',
  'linked',
  'stalled',
  'moving',
  'initiative',
  'idea',
  'action',
  'done',
  'parked',
]);

export default async function AdminPlanningPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const [planning, students, scheduleRows, tutorOptions] = await Promise.all([
    getPlanningDashboard({ includeFirstLessonLoops: true }),
    getAdminStudents(),
    getScheduleContextRows(),
    getActiveTutorOptions(),
  ]);
  const scheduleByMmsId = enrichScheduleContextsWithSharedSlots(scheduleRows);
  const requestedFilter = `${resolvedSearchParams?.filter || ''}`.trim();
  const initialFilter = ALLOWED_INITIAL_FILTERS.has(requestedFilter) ? requestedFilter : 'due_now';
  const initialFocusId = `${resolvedSearchParams?.focus || ''}`.trim();
  const studentOptions = students.map((student) => ({
    mmsId: student.mmsId,
    fullName: student.fullName,
    tutor: student.tutor,
    instrument: student.instrument,
    email: student.email,
    parentFirstName: student.parentFirstName,
    parentLastName: student.parentLastName,
    stripeCustomerId: student.stripeCustomerId,
    stripeSubscriptionId: student.stripeSubscriptionId,
    paymentMode: student.paymentMode,
    paymentExpectation: student.paymentExpectation,
    scheduleContext: scheduleByMmsId.get(student.mmsId) || null,
  }));

  return (
    <AdminPlanningPageClient
      initialPlanning={planning}
      initialFilter={initialFilter}
      initialFocusId={initialFocusId}
      studentOptions={studentOptions}
      tutorOptions={tutorOptions}
    />
  );
}
