/** @fileoverview Authenticated read-only drill-down into lesson-shaped mirror non-observations. */
import Link from 'next/link';

import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { formatDateTime } from '@/lib/admin/health-helpers.mjs';
import { getLessonExceptionDashboard } from '@/lib/admin/lesson-exceptions';

export const dynamic = 'force-dynamic';

const EVIDENCE_OPTIONS = [
  { value: 'all', label: 'All exceptions' },
  { value: 'same_slot', label: 'Same slot found' },
  { value: 'same_day', label: 'Elsewhere that day' },
  { value: 'nearby', label: 'Only nearby context' },
  { value: 'no_nearby', label: 'No nearby event' },
];

const EVIDENCE_STYLES = {
  same_slot: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  same_day: 'border-blue-200 bg-blue-50 text-blue-900',
  nearby: 'border-amber-200 bg-amber-50 text-amber-900',
  no_nearby: 'border-rose-200 bg-rose-50 text-rose-900',
};

function queryValue(value) {
  return Array.isArray(value) ? `${value[0] || ''}` : `${value || ''}`;
}

function dateLabel(value, options = {}) {
  if (!value) return 'Unknown date';
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

function evidenceLabel(kind) {
  return ({
    same_slot: 'Same student, slot and tutor found',
    same_day: 'Same student found elsewhere that day',
    nearby: 'Only nearby student context found',
    no_nearby: 'No student event within seven days',
  })[kind] || 'Unclassified evidence';
}

function offsetLabel(offset) {
  const days = Number(offset) || 0;
  if (days === 0) return 'same day';
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} later` : `${Math.abs(days)} day${days === -1 ? '' : 's'} earlier`;
}

function filterHref(value, tutor) {
  const params = new URLSearchParams();
  if (value && value !== 'all') params.set('evidence', value);
  if (tutor) params.set('tutor', tutor);
  const query = params.toString();
  return query ? `/admin/lessons/exceptions?${query}` : '/admin/lessons/exceptions';
}

function SummaryLink({ label, count, value, selected, tutor }) {
  return (
    <Link
      href={filterHref(value, tutor)}
      aria-current={selected ? 'page' : undefined}
      className={`rounded-2xl border p-4 shadow-sm transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white/90 text-slate-900'}`}
    >
      <span className={`block text-xs font-medium ${selected ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
      <span className="mt-1 block text-2xl font-semibold">{count}</span>
    </Link>
  );
}

function CandidateCard({ candidate, eventDate }) {
  const matchedNames = candidate.matchedStudents.map((student) => student.displayName);
  if (candidate.unmatchedStudentCount) matchedNames.push(`${candidate.unmatchedStudentCount} unmatched student`);
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">
          {dateLabel(candidate.localDate, { year: undefined })} · {candidate.localTime || 'time unknown'}
          {candidate.durationMinutes ? ` · ${candidate.durationMinutes}m` : ''}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{offsetLabel(candidate.daysOffset)}</span>
      </div>
      <p className="mt-1">
        {candidate.tutor?.shortName || 'Tutor not matched'} · {candidate.categoryName}
      </p>
      {matchedNames.length ? <p className="mt-1 font-medium text-slate-800">Matched: {matchedNames.join(', ')}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {candidate.sameSlot ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">same slot</span> : null}
        {candidate.localDate === eventDate && !candidate.sameSlot ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">same date</span> : null}
        {candidate.sameSeries ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">same First Chord series</span> : null}
        <Link className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-200" href={`/admin/lessons/calendar?week=${candidate.localDate}`}>
          Open week
        </Link>
      </div>
    </li>
  );
}

function ExceptionCard({ event }) {
  const originalTutor = event.originalTutor?.shortName;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Not re-observed</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">
            {dateLabel(event.localDate)} · {event.localTime || 'time unknown'}
            {event.durationMinutes ? ` · ${event.durationMinutes}m` : ''}
          </h3>
          <p className="mt-1 text-sm text-slate-700">
            {event.tutor?.shortName || 'Tutor not matched'}
            {originalTutor && originalTutor !== event.tutor?.shortName ? ` covering for ${originalTutor}` : ''}
            {event.locationName ? ` · ${event.locationName}` : ''}
          </p>
        </div>
        <span className={`max-w-[15rem] rounded-full border px-3 py-1 text-xs font-semibold ${EVIDENCE_STYLES[event.evidenceKind] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {evidenceLabel(event.evidenceKind)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {event.participants.map((participant, index) => (
          <span key={participant.fcParticipationId || `${participant.displayName}-${index}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800">
            {participant.displayName}{participant.student?.instrument ? ` · ${participant.student.instrument}` : ''}
            {participant.student?.isTestStudent ? ' · test' : ''}
          </span>
        ))}
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">MMS category/status</dt>
          <dd className="mt-1 font-medium text-slate-900">{event.categoryName} · {event.sourceStatus || 'no status supplied'}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">Last observed</dt>
          <dd className="mt-1 font-medium text-slate-900">{formatDateTime(event.lastObservedAt)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">Series evidence</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {event.fcSeriesId
              ? event.seriesContinuing
                ? `${event.currentSameSeriesCount} current event${event.currentSameSeriesCount === 1 ? '' : 's'} in this series`
                : 'No current event in this series'
              : 'No series reference'}
          </dd>
        </div>
      </dl>

      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3" open={event.evidenceKind === 'same_slot' || event.evidenceKind === 'same_day'}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2">
          Nearby current evidence ({event.nearbyCandidates.length})
        </summary>
        {event.nearbyCandidates.length ? (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {event.nearbyCandidates.map((candidate) => <CandidateCard key={candidate.fcEventId} candidate={candidate} eventDate={event.localDate} />)}
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-5 text-slate-600">No current event for the same student was found within seven days. This still does not prove cancellation.</p>
        )}
      </details>
    </article>
  );
}

export default async function AdminLessonExceptionsPage({ searchParams }) {
  const params = await searchParams;
  const requestedEvidence = queryValue(params?.evidence);
  const selectedEvidence = EVIDENCE_OPTIONS.some((option) => option.value === requestedEvidence)
    ? requestedEvidence
    : 'all';
  const selectedTutor = queryValue(params?.tutor);
  const dashboard = await getLessonExceptionDashboard({});
  const tutors = [...new Map(dashboard.events
    .filter((event) => event.tutor)
    .map((event) => [event.tutor.fcTutorId, event.tutor])).values()]
    .sort((left, right) => left.shortName.localeCompare(right.shortName));
  const visibleEvents = dashboard.events.filter((event) => (
    (selectedEvidence === 'all' || event.evidenceKind === selectedEvidence)
    && (!selectedTutor || event.tutor?.fcTutorId === selectedTutor)
  ));
  const seriesContinuingCount = dashboard.events.filter((event) => event.seriesContinuing).length;
  const rosterGapCount = dashboard.events.filter((event) => event.unmatchedParticipantCount > 0).length;
  const blankStatusCount = dashboard.events.filter((event) => !event.sourceStatus).length;

  return (
    <div className="space-y-7">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Schedule evidence</p>
          <ScopeBadge>Read-only · investigation</ScopeBadge>
        </div>
        <h2 className="mt-2 fc-display text-3xl text-slate-900">Lesson exceptions</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Previously observed student events that MMS did not return in the latest complete sweep, with bounded current evidence for the same student. Nothing here is automatically labelled moved or cancelled.
        </p>
        <Link href="/admin/lessons" className="mt-3 inline-block text-sm font-medium text-slate-800 underline-offset-4 hover:underline">
          Back to lesson data checks
        </Link>
      </section>

      <section className={`rounded-2xl border p-4 ${dashboard.source.verified ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="text-sm font-semibold text-slate-900">
          {dashboard.source.verified ? `${dashboard.totalCount} lesson-shaped exceptions in the verified window` : 'Exception detail unavailable'}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {dashboard.source.verified
            ? `Latest complete sweep verified ${formatDateTime(dashboard.source.lastVerifiedAt)}. Window ${dashboard.source.windowStart} to ${dashboard.source.windowEndExclusive} (end-exclusive).`
            : 'A fresh successful sweep is required. No older or partial snapshot is substituted.'}
        </p>
      </section>

      {dashboard.warnings.length ? (
        <ul className="space-y-2">
          {dashboard.warnings.map((warning) => <li key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</li>)}
        </ul>
      ) : null}

      {dashboard.source.verified ? (
        <>
          <section aria-label="Exception evidence filters" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryLink label="All" count={dashboard.displayedCount} value="all" selected={selectedEvidence === 'all'} tutor={selectedTutor} />
            <SummaryLink label="Same slot" count={dashboard.summary.same_slot} value="same_slot" selected={selectedEvidence === 'same_slot'} tutor={selectedTutor} />
            <SummaryLink label="Elsewhere that day" count={dashboard.summary.same_day} value="same_day" selected={selectedEvidence === 'same_day'} tutor={selectedTutor} />
            <SummaryLink label="Only nearby context" count={dashboard.summary.nearby} value="nearby" selected={selectedEvidence === 'nearby'} tutor={selectedTutor} />
            <SummaryLink label="No nearby event" count={dashboard.summary.no_nearby} value="no_nearby" selected={selectedEvidence === 'no_nearby'} tutor={selectedTutor} />
          </section>

          <section aria-label="Cross-cutting exception clues" className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-violet-200 bg-violet-50/80 p-4">
              <p className="text-xs font-medium text-violet-700">Series continues elsewhere</p>
              <p className="mt-1 text-2xl font-semibold text-violet-950">{seriesContinuingCount}</p>
              <p className="mt-1 text-xs leading-5 text-violet-800">The same First Chord series has current events in the verified window.</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
              <p className="text-xs font-medium text-amber-700">Historical student not in current roster</p>
              <p className="mt-1 text-2xl font-semibold text-amber-950">{rosterGapCount}</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">The old participation remains evidence, but its MMS identity no longer matches a current Students row.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-medium text-slate-600">No MMS event status</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{blankStatusCount}</p>
              <p className="mt-1 text-xs leading-5 text-slate-700">There is no provider status available to reinterpret disappearance as cancellation.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <form action="/admin/lessons/exceptions" method="get" className="flex flex-wrap items-end gap-3">
              {selectedEvidence !== 'all' ? <input type="hidden" name="evidence" value={selectedEvidence} /> : null}
              <label className="text-xs font-medium text-slate-600">
                <span className="block pb-1">Tutor</span>
                <select name="tutor" defaultValue={selectedTutor} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                  <option value="">All tutors</option>
                  {tutors.map((tutor) => <option key={tutor.fcTutorId} value={tutor.fcTutorId}>{tutor.shortName}</option>)}
                </select>
              </label>
              <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2">Apply</button>
              <p className="pb-2 text-xs text-slate-500">{visibleEvents.length} shown</p>
            </form>
          </section>

          {dashboard.totalCount > dashboard.displayedCount ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Showing the first {dashboard.displayedCount} of {dashboard.totalCount} exceptions. The reader is deliberately capped.
            </p>
          ) : null}

          <section aria-label="Lesson exception details" className="space-y-4">
            {visibleEvents.map((event) => <ExceptionCard key={event.fcEventId} event={event} />)}
            {!visibleEvents.length ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nothing matches this filter.</p> : null}
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-sm leading-6 text-blue-950">
        <span className="font-semibold">Boundary:</span> same-student and same-series evidence is a clue, not a decision. This screen cannot classify, cancel, move, restore or edit a lesson in First Chord or MMS.
      </section>
    </div>
  );
}
