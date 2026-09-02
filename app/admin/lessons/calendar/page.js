/** @fileoverview Authenticated read-only weekly calendar over the latest verified MMS lesson-mirror sweep. */
import Link from 'next/link';

import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { getLessonCalendarDashboard } from '@/lib/admin/lesson-calendar';
import { shiftLessonCalendarDate } from '@/lib/admin/lesson-calendar-helpers.mjs';
import { formatDateTime } from '@/lib/admin/health-helpers.mjs';

export const dynamic = 'force-dynamic';

const KIND_OPTIONS = [
  { value: 'lesson', label: 'Lessons' },
  { value: 'all', label: 'Everything' },
  { value: 'availability', label: 'Free capacity' },
  { value: 'potential', label: 'Potential holds' },
  { value: 'break', label: 'Breaks' },
  { value: 'other', label: 'Other' },
];

const KIND_STYLES = {
  lesson: 'border-blue-200 bg-blue-50/90',
  availability: 'border-emerald-200 bg-emerald-50/90',
  potential: 'border-amber-200 bg-amber-50/90',
  break: 'border-slate-300 bg-slate-100',
  other: 'border-violet-200 bg-violet-50/90',
};

function queryValue(value) {
  return Array.isArray(value) ? `${value[0] || ''}` : `${value || ''}`;
}

function dateLabel(value, options = {}) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    ...options,
  });
}

function weekLabel(startDate, endDateExclusive) {
  const endDate = shiftLessonCalendarDate(endDateExclusive, -1);
  return `${dateLabel(startDate, { day: 'numeric', month: 'short' })} – ${dateLabel(endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function calendarHref({ week, tutor, kind }) {
  const params = new URLSearchParams();
  if (week) params.set('week', week);
  if (tutor) params.set('tutor', tutor);
  if (kind && kind !== 'lesson') params.set('kind', kind);
  const query = params.toString();
  return query ? `/admin/lessons/calendar?${query}` : '/admin/lessons/calendar';
}

function attendanceText(event) {
  if (!event.attendanceStatuses.length) return '';
  return event.attendanceStatuses.map((row) => (
    row.count > 1 ? `${row.status} ×${row.count}` : row.status
  )).join(' · ');
}

function EventCard({ event }) {
  const tutor = event.tutor?.shortName || (event.kind === 'lesson' ? 'Tutor not matched' : 'No tutor');
  const originalTutor = event.originalTutor?.shortName;
  return (
    <article className={`rounded-xl border p-2.5 shadow-sm ${KIND_STYLES[event.kind] || KIND_STYLES.other}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-950">
          {event.localTime || 'All day'}
          {event.durationMinutes ? <span className="ml-1 font-normal text-slate-500">· {event.durationMinutes}m</span> : null}
        </p>
        <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          {event.kind}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-800">{tutor}</p>
      {originalTutor && originalTutor !== event.tutor?.shortName ? (
        <p className="mt-0.5 text-xs text-slate-600">Covering for {originalTutor}</p>
      ) : null}
      {event.participants.length ? (
        <ul className="mt-2 space-y-0.5 text-xs font-medium text-slate-900">
          {event.participants.map((participant, index) => (
            <li key={participant.fcParticipationId || `${participant.displayName}-${index}`}>
              {participant.displayName}
              {participant.student?.instrument ? <span className="font-normal text-slate-500"> · {participant.student.instrument}</span> : null}
              {participant.student?.isTestStudent ? <span className="font-normal text-amber-700"> · test</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          {event.kind === 'availability' ? 'Available slot' : event.kind === 'potential' ? 'No student attached' : 'No participation attached'}
        </p>
      )}
      {attendanceText(event) ? <p className="mt-2 text-[11px] leading-4 text-slate-600">{attendanceText(event)}</p> : null}
      <p className="mt-2 text-[11px] leading-4 text-slate-500">
        {event.categoryName}{event.locationName ? ` · ${event.locationName}` : ''}
      </p>
      {event.categoryConflict ? (
        <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-[11px] leading-4 text-amber-900">
          Student attached to an availability/hold label—review the MMS category.
        </p>
      ) : null}
    </article>
  );
}

export default async function AdminLessonCalendarPage({ searchParams }) {
  const params = await searchParams;
  const requestedWeek = queryValue(params?.week);
  const selectedTutor = queryValue(params?.tutor);
  const requestedKind = queryValue(params?.kind);
  const selectedKind = KIND_OPTIONS.some((option) => option.value === requestedKind)
    ? requestedKind
    : 'lesson';
  const dashboard = await getLessonCalendarDashboard({ requestedWeek });
  const visibleEvents = dashboard.events.filter((event) => (
    (selectedKind === 'all' || event.kind === selectedKind)
    && (!selectedTutor || event.tutor?.fcTutorId === selectedTutor)
  ));
  const visibleIds = new Set(visibleEvents.map((event) => event.fcEventId));
  const days = dashboard.days.map((day) => ({
    ...day,
    events: day.events.filter((event) => visibleIds.has(event.fcEventId)),
  }));
  const tutors = [...new Map(dashboard.events
    .filter((event) => event.tutor)
    .map((event) => [event.tutor.fcTutorId, event.tutor])).values()]
    .sort((left, right) => left.shortName.localeCompare(right.shortName));
  const sourceStart = dashboard.source.windowStart;
  const sourceEnd = dashboard.source.windowEndExclusive;
  const weekCovered = (weekStart) => Boolean(
    sourceStart
    && sourceEnd
    && weekStart >= sourceStart
    && shiftLessonCalendarDate(weekStart, 7) <= sourceEnd
  );

  return (
    <div className="space-y-7">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Schedule evidence</p>
          <ScopeBadge>Read-only · MMS-backed</ScopeBadge>
        </div>
        <h2 className="mt-2 fc-display text-3xl text-slate-900">Lesson calendar</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          A First Chord view of events re-seen in the latest complete MMS sweep. Names are joined server-side; MMS and student provider IDs are not sent to this page.
        </p>
        <Link href="/admin/lessons" className="mt-3 inline-block text-sm font-medium text-slate-800 underline-offset-4 hover:underline">
          Back to lesson data checks
        </Link>
      </section>

      <section className={`rounded-2xl border p-4 ${dashboard.source.verified ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="text-sm font-semibold text-slate-900">
          {dashboard.source.verified ? 'Verified mirror window' : 'Calendar unavailable for this week'}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {dashboard.source.verified
            ? `Last verified ${formatDateTime(dashboard.source.lastVerifiedAt)}. Showing only rows re-observed in that run.`
            : `The latest verified mirror covers ${sourceStart || '—'} to ${sourceEnd || '—'} (end-exclusive), or the latest run is not fresh.`}
        </p>
      </section>

      {dashboard.warnings.length ? (
        <ul className="space-y-2">
          {dashboard.warnings.map((warning) => (
            <li key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</li>
          ))}
        </ul>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {weekCovered(dashboard.window.previousWeek) ? (
              <Link className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50" href={calendarHref({ week: dashboard.window.previousWeek, tutor: selectedTutor, kind: selectedKind })}>Previous</Link>
            ) : <span className="rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-300">Previous</span>}
            <Link className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50" href={calendarHref({ week: dashboard.window.todayWeek, tutor: selectedTutor, kind: selectedKind })}>This week</Link>
            {weekCovered(dashboard.window.nextWeek) ? (
              <Link className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50" href={calendarHref({ week: dashboard.window.nextWeek, tutor: selectedTutor, kind: selectedKind })}>Next</Link>
            ) : <span className="rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-300">Next</span>}
          </div>
          <p className="text-lg font-semibold text-slate-900">{weekLabel(dashboard.window.weekStart, dashboard.window.endDateExclusive)}</p>
          <form className="flex flex-wrap items-end gap-2" action="/admin/lessons/calendar" method="get">
            <input type="hidden" name="week" value={dashboard.window.weekStart} />
            <label className="text-xs font-medium text-slate-600">
              <span className="block pb-1">Tutor</span>
              <select name="tutor" defaultValue={selectedTutor} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">All tutors</option>
                {tutors.map((tutor) => <option key={tutor.fcTutorId} value={tutor.fcTutorId}>{tutor.shortName}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              <span className="block pb-1">Show</span>
              <select name="kind" defaultValue={selectedKind} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">Apply</button>
          </form>
        </div>
      </section>

      <section aria-label="Weekly lesson calendar" className="overflow-x-auto pb-2">
        <div className="grid min-w-[1120px] grid-cols-7 gap-3">
          {days.map((day) => (
            <section key={day.date} className="min-w-0 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
              <div className="border-b border-slate-100 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{dateLabel(day.date, { weekday: 'short' })}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{dateLabel(day.date, { day: 'numeric', month: 'short' })}</p>
                <p className="mt-1 text-xs text-slate-500">{day.events.length} shown</p>
              </div>
              <div className="mt-3 space-y-2">
                {day.events.map((event) => <EventCard key={event.fcEventId} event={event} />)}
                {!day.events.length ? <p className="py-5 text-center text-xs text-slate-400">Nothing in this filter</p> : null}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-sm leading-6 text-blue-950">
        <span className="font-semibold">Boundary:</span> this calendar cannot edit, cancel, move or mark a lesson. A missing event means only that MMS did not return it in the latest verified sweep.
      </section>
    </div>
  );
}
