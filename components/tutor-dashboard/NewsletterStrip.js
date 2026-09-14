'use client';

// A quiet reminder, not a task list.
//
// The priority names are links, not tick boxes. A student nobody has heard from
// already reads as "nothing yet" on Fenella's side, so a tick would ask a tutor to
// confirm something the school already knows and add a chore to teaching time.
// Tapping a name selects that student, which is the only thing a tutor would
// actually want from a list of names.
//
// Presentational: the dashboard does the one newsletter read and passes it in, so
// this strip and the marks on the student cards always agree.
export default function NewsletterStrip({ issue = null, students = [], onSelectStudent }) {
  if (!issue) return null;

  const priorities = issue.priorities || [];
  const outstanding = priorities.filter((entry) => entry.state === 'requested');

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

      {priorities.length ? (
        <p className="mt-2 text-sm text-slate-700">
          <span className="text-slate-500">Priority: </span>
          {priorities.map((entry, index) => (
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

      {priorities.length && !outstanding.length ? (
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
