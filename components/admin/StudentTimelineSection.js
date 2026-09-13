import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/student-detail-helpers.mjs';

function formatCalendarDate(value = '', options = {}) {
  const day = `${value || ''}`.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

function timelineDateLabel(date = {}) {
  if (!date.value) return 'Date unknown';
  if (date.precision === 'month') {
    return new Date(`${date.value}-15T12:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'Europe/London',
      month: 'long',
      year: 'numeric',
    });
  }
  if (date.precision === 'day') return formatCalendarDate(date.value);
  if (date.precision === 'minute') {
    const time = date.value.slice(11, 16);
    return `${formatCalendarDate(date.value)}, ${time}`;
  }
  return formatDateTime(date.value);
}

function certaintyLabel(event = {}) {
  if (event.date?.certainty === 'approximate') return 'Approximate date';
  if (event.date?.certainty === 'unknown') return 'Date unknown';
  if (event.certainty === 'uncertain') return 'Uncertain match';
  if (event.certainty === 'derived') return 'Derived observation';
  if (event.certainty === 'observed') return 'Observed';
  return '';
}

function sourceLabel(source = {}) {
  return source.provider ? `${source.label} · ${source.provider}` : source.label;
}

// Compact read-only projection. Every row links back to its owner when there is
// a useful workflow/detail surface; this component never changes source state.
export default function StudentTimelineSection({ timeline = null }) {
  if (!timeline) return null;
  const unavailableSources = (timeline.sourceStates || []).filter((entry) => entry.status !== 'available');

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="recent-activity-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 id="recent-activity-heading" className="text-sm font-semibold text-slate-900">Recent activity</h3>
          <p className="mt-1 text-sm text-slate-600">
            Meaningful dated records from existing systems, combined read-only. Newest first.
          </p>
        </div>
        {timeline.totalCount ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
            {timeline.hasMore ? `Latest ${timeline.events.length} of ${timeline.totalCount}` : `${timeline.totalCount} recorded`}
          </span>
        ) : null}
      </div>

      {timeline.events?.length ? (
        <ol className="mt-5 border-l border-slate-200 pl-4">
          {timeline.events.map((entry) => {
            const uncertainty = certaintyLabel(entry);
            return (
              <li key={entry.id} className="relative pb-5 last:pb-0">
                <span className="absolute -left-[1.19rem] top-1.5 h-2 w-2 rounded-full bg-slate-400 ring-4 ring-white" aria-hidden="true" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                  <time className="text-xs text-slate-500" dateTime={entry.date?.value || undefined}>
                    {timelineDateLabel(entry.date)}
                  </time>
                </div>
                {entry.summary ? <p className="mt-1 text-sm leading-5 text-slate-700">{entry.summary}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>{sourceLabel(entry.source)}</span>
                  {uncertainty ? <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">{uncertainty}</span> : null}
                  {entry.link ? (
                    <Link href={entry.link.href} className="font-medium text-slate-700 underline-offset-4 hover:underline">
                      {entry.link.label}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          No dated activity is available from the included sources yet.
        </p>
      )}

      {unavailableSources.length ? (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-amber-800">
          Incomplete view: {unavailableSources.map((entry) => entry.label).join(', ')} {unavailableSources.length === 1 ? 'is' : 'are'} currently unavailable or unverified. Nothing was inferred in its place.
        </p>
      ) : null}
    </section>
  );
}
