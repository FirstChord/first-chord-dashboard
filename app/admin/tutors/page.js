import AdminTutorLifecycleClient from '@/components/admin/AdminTutorLifecycleClient';
import { getTutorLifecycleDashboard } from '@/lib/admin/tutor-lifecycle.mjs';

export default async function AdminTutorsPage() {
  const dashboard = await getTutorLifecycleDashboard();
  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Tutor context</p>
        <h2 className="mt-2 fc-display text-3xl text-slate-900">Tutors</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">See each tutor’s current teaching relationships, then manage departures and handovers without losing their history.</p>
      </section>
      <AdminTutorLifecycleClient
        initialTutors={dashboard.tutors}
        initialCoverEpisodes={dashboard.coverEpisodes}
        relationshipSummary={dashboard.summary}
        derivedAt={dashboard.derivedAt}
      />
    </div>
  );
}
