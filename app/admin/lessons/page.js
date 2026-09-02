import Link from 'next/link';

import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { formatDateTime } from '@/lib/admin/health-helpers.mjs';
import { buildLessonMirrorHealth } from '@/lib/admin/lesson-mirror-parity.mjs';
import {
  getLessonMirrorExceptionInvestigation,
  getLessonMirrorParityReport,
} from '@/lib/admin/lesson-mirror-store.mjs';

export const dynamic = 'force-dynamic';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tone(status) {
  if (status === 'Healthy' || status === 'succeeded') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (status === 'Running' || status === 'running') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (status === 'Failing' || status === 'Stale' || status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function MetricCard({ label, value, detail = '', warning = false }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${warning ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-white/90'}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      {detail ? <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p> : null}
    </div>
  );
}

function FieldRow({ label, value, explanation }) {
  return (
    <li className="flex items-start justify-between gap-5 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{explanation}</span>
      </span>
      <span className="shrink-0 text-lg font-semibold text-slate-900">{number(value)}</span>
    </li>
  );
}

function runChangeTotal(run = {}) {
  return ['series_created', 'series_changed', 'events_created', 'events_changed', 'participations_created', 'participations_changed']
    .reduce((sum, key) => sum + number(run[key]), 0);
}

async function loadReport() {
  try {
    const [report, investigationResult] = await Promise.all([
      getLessonMirrorParityReport(),
      getLessonMirrorExceptionInvestigation()
        .then((investigation) => ({ investigation, error: false }))
        .catch(() => ({ investigation: null, error: true })),
    ]);
    return {
      report,
      investigation: investigationResult.investigation,
      investigationError: investigationResult.error,
      error: false,
    };
  } catch (error) {
    console.warn('Lesson mirror parity page unavailable', { category: error?.code || 'read_failed' });
    return { report: null, investigation: null, investigationError: false, error: true };
  }
}

function exceptionKindLabel(value = '') {
  return ({
    lesson: 'Lessons / student events',
    availability: 'Free capacity',
    potential: 'Potential holds',
    break: 'Breaks',
    other: 'Other calendar rows',
  })[value] || value || 'Other';
}

export default async function AdminLessonsPage() {
  const { report, investigation, investigationError, error } = await loadReport();
  if (error || !report) {
    return (
      <div className="space-y-6">
        <section>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Schedule evidence</p>
          <h2 className="mt-2 flex items-center gap-3 fc-display text-3xl text-slate-900">
            Lesson parity
            <ScopeBadge>Read-only</ScopeBadge>
          </h2>
        </section>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          The lesson mirror is unavailable. No MMS or database write was attempted by this page.
        </div>
      </div>
    );
  }

  const health = buildLessonMirrorHealth(report.latest);
  const latest = report.latestSuccessful || {};
  const hasVerifiedSnapshot = Boolean(latest.sync_run_id);
  const metrics = report.metrics || {};
  const latestRun = report.runs?.find((run) => run.sync_run_id === latest.sync_run_id) || null;
  const missedEvents = number(metrics.events_not_observed_latest);
  const missedParticipations = number(metrics.participations_not_observed_latest);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Schedule evidence</p>
        <h2 className="mt-2 flex items-center gap-3 fc-display text-3xl text-slate-900">
          Lesson parity
          <ScopeBadge>Read-only</ScopeBadge>
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          First Chord’s observed copy of MMS. This page measures completeness and change; MMS still owns the timetable and attendance truth.
        </p>
        <Link href="/admin/lessons/calendar" className="mt-3 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          Open read-only calendar
        </Link>
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${tone(health.status)}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Mirror health: {health.status}</p>
            <p className="mt-1 text-sm">{health.detail}</p>
          </div>
          <div className="text-right text-xs">
            <p>Last completed: {formatDateTime(health.updatedAt)}</p>
            {latest.window_start ? <p className="mt-1">Window: {latest.window_start} to {latest.window_end_exclusive} (end-exclusive)</p> : null}
          </div>
        </div>
      </section>

      {!hasVerifiedSnapshot ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          No successful mirror sweep exists yet, so no parity or field-coverage conclusion can be drawn.
        </section>
      ) : null}

      <section className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Latest verified sweep</h3>
          <p className="mt-1 text-sm text-slate-600">The last successful sweep remains visible if a later attempt fails. Both MMS totals must match before SQL accepts it.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Calendar parity" value={hasVerifiedSnapshot ? `${number(latest.calendar_received_count)} / ${number(latest.calendar_expected_count)}` : '—'} detail="Received / MMS-reported events" />
          <MetricCard label="Attendance parity" value={hasVerifiedSnapshot ? `${number(latest.attendance_received_count)} / ${number(latest.attendance_expected_count)}` : '—'} detail="Received / MMS-reported participations" />
          <MetricCard label="Events in this window" value={hasVerifiedSnapshot ? number(latest.event_count) : '—'} detail={hasVerifiedSnapshot ? `${number(latest.series_count)} recurring series observed` : 'Awaiting a verified sweep'} />
          <MetricCard label="Student participations" value={hasVerifiedSnapshot ? number(latest.participation_count) : '—'} detail={hasVerifiedSnapshot ? `${number(metrics.group_events)} group events` : 'Awaiting a verified sweep'} />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">What changed</h3>
          <p className="mt-1 text-sm text-slate-600">Append-only revisions from the latest run. Zero is useful: the observed record stayed stable.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Series added" value={latestRun ? number(latestRun.series_created) : '—'} />
          <MetricCard label="Series changed" value={latestRun ? number(latestRun.series_changed) : '—'} />
          <MetricCard label="Events added" value={latestRun ? number(latestRun.events_created) : '—'} />
          <MetricCard label="Events changed" value={latestRun ? number(latestRun.events_changed) : '—'} />
          <MetricCard label="Participations added" value={latestRun ? number(latestRun.participations_created) : '—'} />
          <MetricCard label="Participations changed" value={latestRun ? number(latestRun.participations_changed) : '—'} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Parity questions</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">Coverage gaps are evidence to investigate, not inferred cancellations or errors.</p>
          <ul className="mt-4 space-y-3">
            <FieldRow label="Events not observed in latest sweep" value={missedEvents} explanation="Previously stored events inside this run’s window that MMS did not return this time." />
            <FieldRow label="Participations not observed" value={missedParticipations} explanation="Previously stored student-event links inside the window that were absent this time." />
            <FieldRow label="Attendance-only events" value={metrics.attendance_only_events} explanation="Attendance referenced an event that the calendar endpoint did not return." />
            <FieldRow label="Substitute-tutor observations" value={metrics.substitute_events} explanation="Current tutor and original tutor IDs differ." />
          </ul>
          {(missedEvents > 0 || missedParticipations > 0) ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              Absence from a sweep is deliberately not labelled cancelled. Phase 2 must learn the MMS exception contract first.
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Field coverage</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">Missing values may be legitimate one-offs or online lessons; this is a classification queue, not an issue count.</p>
          <ul className="mt-4 space-y-3">
            <FieldRow label="No series reference" value={metrics.events_without_series} explanation="Often a one-off lesson; verify the pattern before classifying it." />
            <FieldRow label="No tutor reference" value={metrics.events_without_tutor} explanation="Cannot yet reconstruct tutor ownership independently." />
            <FieldRow label="No duration" value={metrics.events_without_duration} explanation="Cannot yet reconstruct lesson length independently." />
            <FieldRow label="No location" value={metrics.events_without_location} explanation="May be an online or deliberately unlocated lesson." />
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Exception investigation</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            The broad warnings are split into lesson-shaped evidence and known non-lesson calendar rows. These counts help choose what to investigate; they never infer cancellation or repair MMS.
          </p>
        </div>
        {investigationError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The bounded exception breakdown could not be loaded. The verified parity evidence above is unchanged.
          </div>
        ) : null}
        {investigation?.source?.verified ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Lesson-shaped rows not re-observed"
                value={investigation.metrics.notObservedLessons}
                detail={`${number(investigation.metrics.notObservedEvents)} total calendar rows were not re-observed, including capacity and holds.`}
                warning={number(investigation.metrics.notObservedLessons) > 0}
              />
              <MetricCard
                label="Same-student replacements"
                value={number(investigation.metrics.replacementSameSlot) + number(investigation.metrics.replacementChangedSlot)}
                detail={`${number(investigation.metrics.replacementSameSlot)} at the same slot · ${number(investigation.metrics.replacementChangedSlot)} elsewhere on the same date · ${number(investigation.metrics.noSameDateReplacement)} with no same-date event.`}
                warning={number(investigation.metrics.noSameDateReplacement) > 0}
              />
              <MetricCard
                label="Tutor gaps on lessons"
                value={investigation.metrics.lessonEventsWithoutTutor}
                detail={`${number(investigation.metrics.nonLessonEventsWithoutTutor)} tutor gaps belong to non-lesson rows and are kept out of this headline.`}
                warning={number(investigation.metrics.lessonEventsWithoutTutor) > 0}
              />
              <MetricCard
                label="Current availability-label conflicts"
                value={investigation.metrics.availabilityLabelsWithStudents}
                detail={`${number(investigation.metrics.availabilityLabelsWithRetainedStudents)} current Free/Potential rows retain only an older student link; the calendar does not show that student as current.`}
                warning={number(investigation.metrics.availabilityLabelsWithStudents) > 0}
              />
              <MetricCard
                label="Late attendance changes"
                value={investigation.metrics.attendanceChangesDays8To14}
                detail={investigation.metrics.latestAttendanceChangeDays === null
                  ? 'No non-future attendance change lag was observed in the last 30 days.'
                  : `Changes observed 8–14 days after the lesson; latest observed lag ${number(investigation.metrics.latestAttendanceChangeDays)} days.`}
                warning={number(investigation.metrics.attendanceChangesDays8To14) > 0}
              />
              <MetricCard
                label="Rows without MMS status"
                value={investigation.metrics.eventsWithoutSourceStatus}
                detail="Current rows where MMS supplied no event status, so disappearance cannot be re-labelled as cancellation."
                warning={number(investigation.metrics.eventsWithoutSourceStatus) > 0}
              />
            </div>

            {number(investigation.metrics.notObservedLessons) > 0 ? (
              <Link
                href="/admin/lessons/exceptions"
                className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
              >
                Review {number(investigation.metrics.notObservedLessons)} lesson exceptions
              </Link>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
              <div className="p-5">
                <h4 className="text-base font-semibold text-slate-900">Current versus not re-observed</h4>
                <p className="mt-1 text-sm text-slate-600">Rows are classified by their student participation and MMS category, without exposing student or provider identifiers.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Evidence type</th>
                      <th className="px-5 py-3 font-medium">Current</th>
                      <th className="px-5 py-3 font-medium">Not re-observed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {['lesson', 'availability', 'potential', 'break', 'other'].map((kind) => {
                      const current = investigation.groups.find((group) => group.observation === 'current' && group.eventKind === kind);
                      const notObserved = investigation.groups.find((group) => group.observation === 'not_observed' && group.eventKind === kind);
                      return (
                        <tr key={kind}>
                          <td className="px-5 py-3 font-medium text-slate-900">{exceptionKindLabel(kind)}</td>
                          <td className="px-5 py-3 text-slate-700">{number(current?.eventCount)}</td>
                          <td className="px-5 py-3 text-slate-700">{number(notObserved?.eventCount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : !investigationError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Exception classification waits for a fresh successful mirror run; an older snapshot is not substituted.
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Raw attendance states</h3>
          <p className="mt-1 text-sm text-slate-600">Literal MMS values from participations observed in the latest sweep.</p>
          {report.attendanceStatuses.length ? (
            <ul className="mt-4 space-y-2">
              {report.attendanceStatuses.map((row) => (
                <li key={row.status} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2 text-sm">
                  <span className="text-slate-700">{row.status}</span>
                  <span className="font-semibold text-slate-900">{number(row.count)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-slate-500">No attendance states observed yet.</p>}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="p-5">
            <h3 className="text-lg font-semibold text-slate-900">Recent runs</h3>
            <p className="mt-1 text-sm text-slate-600">Manual and scheduled history, newest first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Completed</th>
                  <th className="px-5 py-3 font-medium">Trigger</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Calendar</th>
                  <th className="px-5 py-3 font-medium">Attendance</th>
                  <th className="px-5 py-3 font-medium">Revisions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.runs.length ? report.runs.map((run) => (
                  <tr key={run.sync_run_id}>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">{formatDateTime(run.completed_at || run.started_at)}</td>
                    <td className="px-5 py-3 text-slate-700">{run.trigger_kind}</td>
                    <td className="px-5 py-3"><span className={`rounded-full border px-2 py-1 text-xs ${tone(run.status)}`}>{run.status}</span></td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">{number(run.calendar_received_count)} / {number(run.calendar_expected_count)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">{number(run.attendance_received_count)} / {number(run.attendance_expected_count)}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{runChangeTotal(run)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-slate-500">No mirror runs recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-sm leading-6 text-blue-950">
        <span className="font-semibold">Boundary:</span> this surface cannot edit lessons, attendance, students or MMS. A green result proves a complete observation, not that First Chord has become schedule authority.
      </section>
    </div>
  );
}
