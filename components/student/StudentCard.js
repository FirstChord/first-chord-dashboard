import { Newspaper } from 'lucide-react';
import InstrumentIcon from './InstrumentIcon';

// `newsletter` is 'waiting' for a priority student nothing has arrived for yet,
// 'in' once something has, and empty otherwise. A marker, not a task: there is
// nothing on the card to tick.
function NewsletterMark({ state }) {
  if (!state) return null;
  const waiting = state === 'waiting';
  const label = waiting ? 'Newsletter priority — nothing sent yet' : 'Newsletter item added';
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
        waiting ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-[#2F6B3D]'
      }`}
    >
      <Newspaper aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}

export default function StudentCard({ student, onClick, isSelected, showTutor = true, todayTime = '', showCheckbox = false, isChecked = false, onToggleCheck, newsletter = '' }) {
  return (
    <button
      onClick={() => onClick(student)}
      aria-pressed={isSelected}
      className={`w-full p-4 rounded-lg border-2 text-left transition-all duration-150 relative ${
        isSelected
          ? 'border-[#2F6B3D] bg-green-50 shadow-sm'
          : 'border-[#2F6B3D]/20 bg-white/60 hover:border-[#2F6B3D]/45 hover:bg-white hover:shadow-md'
      }`}
    >
      {showCheckbox && (
        <div
          className="absolute top-2 right-2"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck?.(student.mms_id);
          }}
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => {}} // Controlled by parent
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 font-semibold text-lg">{student.name}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <NewsletterMark state={newsletter} />
          <InstrumentIcon instrument={student.instrument} />
        </div>
      </div>
      {todayTime && (
        <p className="mt-1">
          <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-[#2F6B3D]">
            {todayTime} today
          </span>
        </p>
      )}
      {showTutor && (
        <p className="text-sm text-gray-600">Tutor: {student.current_tutor}</p>
      )}
      {showCheckbox && (
        <p className="text-xs text-gray-500 mt-1">Click checkbox to mark as your student</p>
      )}
    </button>
  );
}
