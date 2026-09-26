import Link from 'next/link';
import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { buildPracticeChatEvaluation, DEFAULT_WINDOW_DAYS } from '@/lib/admin/practice-chat-eval-helpers.mjs';
import { searchAttendanceForPayroll } from '@/lib/admin/mms';
import {
  getPracticeChatSessionRows,
  getPracticeNoteLogRows,
  prefetchSheetValues,
  PRACTICE_CHAT_SESSIONS_SHEET,
  PRACTICE_NOTES_LOG_SHEET,
} from '@/lib/admin/sheets';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatMs(value) {
  if (!Number.isFinite(value)) return '—';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${`${seconds % 60}`.padStart(2, '0')}s`;
}

// A rate is never shown without the counts it came from. Six weeks of a small
// school is not much data, and a bare "42%" invites a confidence nobody earned.
function formatRate({ pct } = {}) {
  if (pct === null || pct === undefined) return '—';
  return `${pct}%`;
}

function rateDetail({ count, total } = {}, noun = '') {
  return `${count} of ${total}${noun ? ` ${noun}` : ''}`;
}

/**
 * The three evidence classes are bands on the page, not adjectives in a
 * caption. A reader who cannot tell a measurement from a text heuristic will
 * treat them as equally solid, which is the specific way a report like this
 * misleads.
 */
const BAND_STYLES = {
  observed: {
    kicker: 'Observed',
    blurb: 'The system watched these happen. No one was asked anything.',
    ring: 'border-slate-200 bg-white/90',
    chip: 'bg-slate-100 text-slate-700',
  },
  rated: {
    kicker: 'Rated by tutors',
    blurb: 'Self-reported by the tutor who taught the lesson. Always shown with how many answers it rests on.',
    ring: 'border-amber-200 bg-amber-50/60',
    chip: 'bg-amber-100 text-amber-900',
  },
  derived: {
    kicker: 'Derived',
    blurb: 'Inferred by a rule, not observed. Treat as a hint about where to look, never as a measurement.',
    ring: 'border-violet-200 bg-violet-50/50',
    chip: 'bg-violet-100 text-violet-900',
  },
};

function Band({ tone = 'observed', title, children }) {
  const style = BAND_STYLES[tone];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${style.chip}`}>
          {style.kicker}
        </span>
        <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-slate-600">{style.blurb}</p>
      <div className={`rounded-2xl border p-5 shadow-sm ${style.ring}`}>{children}</div>
    </section>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="rounded-xl bg-white/80 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {detail ? <p className="mt-1 text-sm leading-6 text-slate-600">{detail}</p> : null}
    </div>
  );
}

function StatGrid({ children }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function WeeklyTable({ weekly = [] }) {
  if (!weekly.length) return <p className="text-sm text-slate-500">No weeks in this window yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="mt-4 w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-4 font-semibold">Week of</th>
            <th className="pb-2 pr-4 font-semibold">Lessons taught</th>
            <th className="pb-2 pr-4 font-semibold">Rituals started</th>
            <th className="pb-2 pr-4 font-semibold">Completed</th>
            <th className="pb-2 font-semibold">Abandoned</th>
          </tr>
        </thead>
        <tbody className="text-slate-800">
          {weekly.map((week) => (
            <tr key={week.weekStart} className="border-t border-slate-200/70">
              <td className="py-2 pr-4 font-medium">{week.weekStart}</td>
              <td className="py-2 pr-4">{week.eligible}</td>
              <td className="py-2 pr-4">{week.started}</td>
              <td className="py-2 pr-4">{week.completed}</td>
              <td className="py-2">{week.abandoned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountList({ rows = [], empty }) {
  if (!rows.length) return <p className="mt-3 text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-4 rounded-xl bg-white/70 px-3 py-2 text-sm">
          <span className="text-slate-700">{row.label.replaceAll('_', ' ')}</span>
          <span className="font-semibold text-slate-900">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

async function loadEligibleLessons({ windowDays, now }) {
  // A deliberately separate cache entry from the payroll lane. The payroll page
  // and tutor statement share one query shape on purpose (state-tabs.md), and
  // widening that shape to fit a six-week read-only report would risk the money
  // surface to save this page one cold fetch.
  try {
    const result = await searchAttendanceForPayroll({
      startDate: isoDate(new Date(now.getTime() - windowDays * DAY_MS)),
      endDate: isoDate(now), // inclusive; searchAttendanceForPayroll shifts MMS's exclusive bound itself
      allowExpired: true,
    });
    return { rows: result?.rows || [], error: '' };
  } catch (error) {
    // No denominator is a degraded report, not a broken page. Everything that
    // does not divide by eligible lessons still works.
    return { rows: [], error: error.message || 'MMS attendance unavailable' };
  }
}

export default async function PracticeChatEvaluationPage() {
  const now = new Date();
  const windowDays = DEFAULT_WINDOW_DAYS;

  await prefetchSheetValues([
    PRACTICE_CHAT_SESSIONS_SHEET,
    PRACTICE_NOTES_LOG_SHEET,
  ]).catch(() => {});

  const [sessions, notes, attendance] = await Promise.all([
    getPracticeChatSessionRows().catch(() => []),
    getPracticeNoteLogRows().catch(() => []),
    loadEligibleLessons({ windowDays, now }),
  ]);

  const report = buildPracticeChatEvaluation({
    sessions,
    notes,
    attendanceRows: attendance.rows,
    now,
    windowDays,
  });

  const { adoption, friction, reliability, editing, cost, timeSaved, learningCurve } = report.observed;
  const { accuracy, usefulness } = report.rated;
  const { continuity, reflection, compounding } = report.derived;

  return (
    <div className="space-y-10">
      <section>
        <Link href="/admin/insights" className="text-xs font-medium text-slate-500 hover:text-slate-800">
          ← Signals
        </Link>
        <p className="mt-2 text-xs uppercase tracking-[0.25em] text-slate-500">Signals</p>
        <h2 className="mt-2 flex flex-wrap items-center gap-3 fc-display text-3xl text-slate-900">
          Practice Chat evaluation
          <ScopeBadge>Read-only</ScopeBadge>
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          The last {report.windowDays} days. Built to answer whether the end-of-lesson ritual is
          worth keeping — not to compare tutors. Per-tutor adoption is deliberately absent from this
          page and lives in{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">npm run eval:practice-chat</code>{' '}
          instead. See also the{' '}
          <Link href="/admin/insights" className="font-semibold text-blue-700 underline">
            general signals page
          </Link>.
        </p>
        {attendance.error ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            MMS attendance is unavailable, so there is no eligible-lesson denominator right now and
            every adoption figure below reads “—”. Everything else on this page is unaffected.
            <span className="mt-1 block text-xs opacity-80">{attendance.error}</span>
          </p>
        ) : null}
      </section>

      <Band tone="observed" title="Adoption">
        <StatGrid>
          <Stat
            label="Rituals completed"
            value={adoption.ritualsCompleted}
            detail={`${adoption.ritualsStarted} started · ${adoption.inFlight} may still be in progress`}
          />
          <Stat
            label="Of lessons taught"
            value={formatRate(adoption.adoptionRate)}
            detail={rateDetail(adoption.adoptionRate, 'taught lessons')}
          />
          <Stat
            label="Finished once started"
            value={formatRate(adoption.completionRate)}
            detail={`${rateDetail(adoption.completionRate, 'settled')} · in-progress sessions excluded from both sides`}
          />
          <Stat
            label="Denominator gap"
            value={adoption.unrecordedLessons}
            detail={`lessons not yet marked in MMS · ${adoption.absentLessons} absences excluded as not eligible`}
          />
        </StatGrid>
        <WeeklyTable weekly={adoption.weekly} />
      </Band>

      <Band tone="observed" title="Friction">
        <StatGrid>
          <Stat
            label="Median time"
            value={formatMs(friction.medianActiveMs)}
            detail={`first recording to finished · ${friction.timedSessions} completed sessions`}
          />
          <Stat
            label="p90 time"
            value={formatMs(friction.p90ActiveMs)}
            detail="the slow tail, not the typical case"
          />
          <Stat
            label="Abandoned"
            value={formatRate(friction.abandonmentRate)}
            detail={rateDetail(friction.abandonmentRate, 'settled sessions')}
          />
          <Stat
            label="Typed instead of spoken"
            value={friction.typedNotSpoken}
            detail="fell back to the typed-notes path"
          />
        </StatGrid>
        <div className="mt-4">
          <h4 className="text-base font-semibold text-slate-900">Where people stopped</h4>
          <CountList rows={friction.abandonedByStep} empty="No abandoned sessions in this window." />
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Wall-clock time from opening to finishing is deliberately not shown as friction: a tutor
          who opens the panel at the start of a lesson and finishes at the end would be measuring
          the lesson. Median open-to-finish was {formatMs(friction.medianSessionTotalMs)}.
        </p>
      </Band>

      <Band tone="observed" title="Reliability">
        <StatGrid>
          <Stat
            label="Sessions hitting a transcription error"
            value={formatRate(reliability.asrErrorSessions)}
            detail={`${rateDetail(reliability.asrErrorSessions, 'sessions')} · ${reliability.totalAsrErrors} errors total`}
          />
          <Stat
            label="Sessions with a re-record"
            value={formatRate(reliability.reRecordSessions)}
            detail={`${reliability.totalReRecords} re-records · a correction, not a failure`}
          />
          <Stat
            label="Delivery confirmed"
            value={reliability.deliverySent}
            detail={`${reliability.deliveryFailed} failed · ${reliability.deliveryAbsentOnly} attendance-only · ${reliability.deliveryUntracked} untracked (legacy copy path, not a failure)`}
          />
          <Stat
            label="Needs manual follow-up"
            value={reliability.manualFollowUp}
            detail="notes whose parent email needs a human"
          />
        </StatGrid>
        <div className="mt-4">
          <h4 className="text-base font-semibold text-slate-900">Reliability needs attention</h4>
          <p className="mt-1 text-sm text-slate-600">
            A name appears here only when something is broken and fixable — go and help them. This
            is not a completion rate and not a ranking.
          </p>
          {reliability.needsAttention.length ? (
            <ul className="mt-3 space-y-2">
              {reliability.needsAttention.map((entry) => (
                <li key={entry.tutor} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-800">
                  <span className="font-semibold">{entry.tutor}</span>
                  {' · '}
                  {[
                    entry.asrErrors ? `${entry.asrErrors} transcription failure${entry.asrErrors === 1 ? '' : 's'}` : '',
                    entry.deliveryFailures ? `${entry.deliveryFailures} delivery failure${entry.deliveryFailures === 1 ? '' : 's'}` : '',
                    entry.manualFollowUp ? `${entry.manualFollowUp} awaiting manual follow-up` : '',
                  ].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Nothing broken in this window.</p>
          )}
        </div>
      </Band>

      <Band tone="observed" title="Quality, without asking anyone">
        <StatGrid>
          <Stat
            label="Notes edited before saving"
            value={formatRate(editing.editRate)}
            detail={`${rateDetail(editing.editRate, 'generated notes')} · median ${editing.medianEditChars ?? '—'} characters changed`}
          />
          <Stat
            label="Wording flagged for a check"
            value={editing.safetyFlagged}
            detail={`${editing.safetyAcknowledged} confirmed correct by the tutor`}
          />
        </StatGrid>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Edit rate measures dissatisfaction, not accuracy: a tutor may edit a perfectly accurate
          note to add something the three questions never asked about. It is the strongest quality
          signal available without interrupting anyone, which is why it sits here rather than beside
          the ratings.
        </p>
      </Band>

      <Band tone="observed" title="What it costs, and what it replaces">
        <StatGrid>
          <Stat
            label="Cost per note"
            value={cost.perNoteUsd === null ? '—' : `$${cost.perNoteUsd.toFixed(3)}`}
            detail={cost.unpricedSessions
              ? `${cost.pricedSessions} priced · ${cost.unpricedSessions} on a model with no published per-minute rate`
              : `${cost.pricedSessions} sessions · ${cost.audioMinutes} minutes of audio`}
          />
          <Stat
            label="Total transcription spend"
            value={cost.totalUsd === null ? '—' : `$${cost.totalUsd.toFixed(2)}`}
            detail={`over ${report.windowDays} days`}
          />
          <Stat
            label="Time saved per note"
            value={timeSaved.savedPerNoteMs === null ? '—' : formatMs(Math.abs(timeSaved.savedPerNoteMs))}
            detail={timeSaved.savedPerNoteMs === null
              ? 'No manual baseline recorded — see lib/config/practice-chat-baseline.mjs'
              : `${timeSaved.savedPerNoteMs < 0 ? 'SLOWER than' : 'against'} ${Math.round(timeSaved.baselineSeconds)}s by hand · median ritual ${formatMs(timeSaved.medianRitualMs)}`}
          />
          <Stat
            label="Hours saved in window"
            value={timeSaved.savedTotalHours === null ? '—' : `${timeSaved.savedTotalHours}`}
            detail={timeSaved.savedTotalHours === null
              ? 'needs a baseline before this means anything'
              : `across ${timeSaved.notesCompared} completed notes`}
          />
        </StatGrid>
        {timeSaved.savedPerNoteMs === null ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>No baseline recorded.</strong> Until roughly ten lesson notes are hand-timed the
            old way and pasted into <code>lib/config/practice-chat-baseline.mjs</code>, the ritual&rsquo;s
            duration is a fact about the tool and not a saving. This cannot be measured
            retrospectively — once the ritual is habitual there is no clean way back to how long the
            old way took.
          </p>
        ) : (
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Baseline: {timeSaved.baselineNote || 'hand-measured, provenance not recorded'}.
          </p>
        )}
        {learningCurve.length > 1 ? (
          <div className="mt-5">
            <h4 className="text-base font-semibold text-slate-900">Does it get faster?</h4>
            <p className="mt-1 text-sm text-slate-600">
              Median time by each tutor&rsquo;s own week, not the calendar — tutors join at different
              points, and calendar weeks would mix one person&rsquo;s first attempt with
              another&rsquo;s twentieth.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-3 w-full min-w-[26rem] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4 font-semibold">Tutor&rsquo;s week</th>
                    <th className="pb-2 pr-4 font-semibold">Median time</th>
                    <th className="pb-2 pr-4 font-semibold">Sessions</th>
                    <th className="pb-2 font-semibold">Tutors</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
                  {learningCurve.map((entry) => (
                    <tr key={entry.week} className="border-t border-slate-200/70">
                      <td className="py-2 pr-4 font-medium">Week {entry.week}</td>
                      <td className="py-2 pr-4">{formatMs(entry.medianActiveMs)}</td>
                      <td className="py-2 pr-4">{entry.sessions}</td>
                      <td className="py-2">{entry.tutors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Band>

      <Band tone="rated" title="What tutors said">
        <StatGrid>
          <Stat
            label="Accuracy"
            value={accuracy.mean ?? '—'}
            detail={`mean of ${accuracy.n} answer${accuracy.n === 1 ? '' : 's'} out of 5 · ${rateDetail(accuracy.responseRate, 'prompts answered')}`}
          />
          <Stat
            label="Useful next lesson"
            value={usefulness.mean ?? '—'}
            detail={`mean of ${usefulness.n} answer${usefulness.n === 1 ? '' : 's'} out of 5`}
          />
        </StatGrid>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Accuracy answers</h4>
            <CountList rows={accuracy.distribution} empty="No answers yet." />
          </div>
          <div>
            <h4 className="text-base font-semibold text-slate-900">Comments</h4>
            {accuracy.comments.length ? (
              <ul className="mt-3 space-y-2">
                {accuracy.comments.map((entry) => (
                  <li key={`${entry.answeredAt}-${entry.comment}`} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-800">
                    “{entry.comment}”
                    <span className="mt-1 block text-xs text-slate-500">{entry.answeredAt?.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No comments left yet.</p>
            )}
          </div>
        </div>
      </Band>

      <Band tone="derived" title="Continuity and compounding value">
        <StatGrid>
          <Stat
            label="Had a previous note"
            value={formatRate(continuity.priorNoteAvailable)}
            detail={rateDetail(continuity.priorNoteAvailable, 'sessions')}
          />
          <Stat
            label="Looked up earlier lessons"
            value={formatRate(continuity.historyOpened)}
            detail={`${rateDetail(continuity.historyOpened, 'sessions that had one')} · the deliberate click only`}
          />
          <Stat
            label="Median days between rituals"
            value={continuity.medianDaysBetweenRituals ?? '—'}
            detail="per student, across consecutive notes"
          />
          <Stat
            label="Students with 6+ rituals"
            value={compounding.studentsWith6Plus}
            detail={`${compounding.studentsWith2Plus} with 2+ · ${compounding.studentsWith4Plus} with 4+ · ${compounding.studentsWithAny} with any`}
          />
        </StatGrid>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Stat
            label="Captured a next practice action"
            value={formatRate(reflection.nextActionCaptured)}
            detail={`${rateDetail(reflection.nextActionCaptured, 'notes')} · Practice Goals non-empty`}
          />
          <Stat
            label="Captured progress or challenges"
            value={formatRate(reflection.challengesCaptured)}
            detail={rateDetail(reflection.challengesCaptured, 'notes')}
          />
          <Stat
            label="Named a song"
            value={formatRate(reflection.songEvidence)}
            detail={rateDetail(reflection.songEvidence, 'notes')}
          />
        </div>
        <div className="mt-5 space-y-2 text-xs leading-5 text-slate-600">
          <p>
            <strong>“Looked up earlier lessons” is not “read the previous note”.</strong> The tutor
            dashboard renders the previous note and the Lesson Focus summary automatically whenever a
            student is selected, so it is always on screen and a passive view proves nothing. Only
            the deliberate “Show earlier lessons” click is counted here.
          </p>
          <p>
            <strong>“Captured a next practice action” is a text rule</strong> — the Practice Goals
            section being non-empty. It cannot tell a clear, specific action from a sentence that
            merely occupies the space.
          </p>
          <p>
            <strong>Speaker attribution and “did the student’s voice appear” are not measured</strong>,
            because nothing in the pipeline can see them: transcription sends one undifferentiated
            blob per question and reads back a single string. These are not zero — they are
            unmeasurable until diarisation exists.
          </p>
          <p>
            <strong>The 6+ bucket is structurally limited by the rollout.</strong> Only students whose
            tutor ran the ritual from week one can reach it.
          </p>
        </div>
      </Band>
    </div>
  );
}
