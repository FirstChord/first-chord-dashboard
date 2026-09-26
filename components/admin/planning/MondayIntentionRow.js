'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ActionButton } from '@/components/admin/ui/ActionButton';
import { usePressedAction } from '@/components/admin/ui/usePressedAction';
import { PLANNING_OWNERS } from '@/lib/admin/planning-helpers.mjs';
import { SelectField, TextField, TextAreaField, DateField } from './fields';

// One "next improvement" from Friday's reflection, surfaced on the Monday panel.
// Click to expand into a small editor and add it to the board as an owned action.
export default function MondayIntentionRow({ intention, defaultDueDate, onSchedule, onDismiss, pending }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(intention);
  const [notes, setNotes] = useState('');
  const [owner, setOwner] = useState('Unassigned');
  const [targetDate, setTargetDate] = useState(defaultDueDate);
  // `pending` is page-wide; only the row that was pressed shows it.
  const { press, pendingFor } = usePressedAction(pending);

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-800">{intention}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-50"
          >
            {expanded ? 'Cancel' : <><Plus className="h-3.5 w-3.5" /> Schedule</>}
          </button>
          <ActionButton
            variant="subtle"
            size="compact"
            onClick={press('dismiss', () => onDismiss(intention))}
            disabled={pending}
            pending={pendingFor('dismiss')}
            pendingLabel="Dismissing…"
            title="Remove this suggestion from the Monday scheduling list"
            icon={<X className="h-3.5 w-3.5" />}
          >
            Dismiss
          </ActionButton>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <TextField label="Title" value={title} onChange={setTitle} placeholder="Shorten into a clear task" />
          <TextAreaField label="Description (optional)" value={notes} onChange={setNotes} rows={2} placeholder="Any extra context" />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Owner" value={owner} onChange={setOwner} options={PLANNING_OWNERS} />
            <DateField label="Do by" value={targetDate} onChange={setTargetDate} />
          </div>
          <ActionButton
            onClick={press('schedule', () => onSchedule({ title, notes, owner, targetDate }))}
            disabled={pending || !title.trim()}
            pending={pendingFor('schedule')}
            pendingLabel="Adding…"
            icon={<Plus className="h-4 w-4" />}
          >
            Add to board
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
