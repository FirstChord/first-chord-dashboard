import { labelIncomingCategory } from '@/lib/admin/incoming-message-helpers.mjs';

const CATEGORY_AREAS = {
  payment: 'money',
  one_off_absence: 'lessons',
  extended_absence: 'lessons',
  summer_break: 'lessons',
  schedule: 'lessons',
  absence_pause: 'participation',
  leaving: 'participation',
  concern: 'participation',
};

const AREAS = {
  money: { tone: 'bg-purple-50 text-purple-800', description: 'Money and billing · Stripe' },
  lessons: { tone: 'bg-blue-50 text-blue-800', description: 'Lessons and attendance · My Music Staff' },
  participation: { tone: 'bg-amber-50 text-amber-800', description: 'Participation and concerns' },
  general: { tone: 'bg-slate-100 text-slate-600', description: 'General conversation' },
};

export default function IncomingCategoryBadge({ category }) {
  const area = AREAS[CATEGORY_AREAS[category]] || AREAS.general;
  return (
    <span className={`rounded-full px-2 py-0.5 ${area.tone}`} title={area.description}>
      {labelIncomingCategory(category)}
    </span>
  );
}

export function IncomingCategoryKey() {
  return (
    <details className="text-[11px] text-slate-500">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
        Category colours <span aria-hidden="true">⌄</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <div className="flex flex-wrap gap-1.5 font-semibold">
          {Object.entries(AREAS).map(([key, area]) => (
            <span key={key} className={`rounded-full px-2 py-1 ${area.tone}`}>{area.description}</span>
          ))}
        </div>
        <p>Colour shows the subject, not urgency or completion.</p>
      </div>
    </details>
  );
}
