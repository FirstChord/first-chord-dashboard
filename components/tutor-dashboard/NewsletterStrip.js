'use client';

import { useEffect, useState } from 'react';

// A quiet reminder, not a task list.
//
// The priority names are links, not tick boxes. A student nobody has heard from
// already reads as "nothing yet" on Fenella's side, so a tick would ask a tutor
// to confirm something the school already knows and add a chore to teaching time.
// Tapping a name selects that student, which is the only thing a tutor would
// actually want from a list of names.
export default function NewsletterStrip({ students = [], onSelectStudent }) {
  const [issue, setIssue] = useState(null);

  // Any of the tutor's students carries a usable capability token; the strip is
  // not about one student, so the first one will do.
  const token = students.find((student) => student.noteAccessToken)?.noteAccessToken || '';
  const anyStudentId = students.find((student) => student.noteAccessToken)?.mms_id || '';

  useEffect(() => {
    if (!token || !anyStudentId) {
      setIssue(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/newsletter/current?${new URLSearchParams({ student: anyStudentId, token })}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        // A closed month, a service without tutor auth, or any failure all mean
        // the same thing here: show nothing. This is a reminder, so being absent
        // is a perfectly good state — far better than an error box above the
        // schedule.
        setIssue(data.success && data.open ? data : null);
      })
      .catch(() => { if (!cancelled) setIssue(null); });
    return () => { cancelled = true; };
  }, [token, anyStudentId]);

  if (!issue) return null;

  const outstanding = issue.priorities.filter((entry) => entry.state === 'requested');

  return (
    <section
      aria-label="Newsletter this month"
      className="w-full rounded-2xl border border-green-200/70 bg-white/75 px-4 py-3 text-left shadow-sm backdrop-blur"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-bold text-[#2F6B3D]">
          Newsletter · {issue.monthLabel}
        </p>
        {issue.deadline ? (
          <p className="text-xs text-slate-600">by {formatDeadline(issue.deadline)}</p>
        ) : null}
      </div>

      {issue.question ? (
        <p className="mt-1.5 text-sm italic leading-6 text-slate-700">“{issue.question}”</p>
      ) : null}

      {issue.priorities.length ? (
        <p className="mt-2 text-sm text-slate-700">
          <span className="text-slate-500">Priority: </span>
          {issue.priorities.map((entry, index) => (
            <span key={entry.mmsId}>
              {index > 0 ? <span className="text-slate-400"> · </span> : null}
              <button
                type="button"
                onClick={() => {
                  const student = students.find((candidate) => candidate.mms_id === entry.mmsId);
                  if (student) onSelectStudent?.(student);
                }}
                className={`rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B3D]/45 ${
                  entry.state === 'requested' ? 'text-slate-900' : 'text-slate-400 line-through'
                }`}
              >
                {firstNameOf(entry.studentName)}
              </button>
            </span>
          ))}
        </p>
      ) : null}

      {issue.priorities.length && !outstanding.length ? (
        <p className="mt-1 text-xs font-semibold text-emerald-800">All yours are in — thank you.</p>
      ) : null}
    </section>
  );
}

function firstNameOf(name = '') {
  return `${name}`.trim().split(/\s+/u)[0] || name;
}

function formatDeadline(value = '') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]}`;
}
