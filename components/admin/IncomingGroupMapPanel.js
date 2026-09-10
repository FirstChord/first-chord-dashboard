'use client';
import { useState } from 'react';
import TutorMessageBadge from './TutorMessageBadge';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function confidenceTone(confidence) {
  if (confidence === 'high') return 'bg-emerald-50 text-emerald-800';
  if (confidence === 'medium') return 'bg-blue-50 text-blue-800';
  if (confidence === 'low') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

function GroupRow({ group, studentOptions = [], tutorOptions = [], onReviewGroup, onAddGroupStudent, isPending }) {
  const [groupType, setGroupType] = useState(group.groupType || 'student');
  const [selectedTutorId, setSelectedTutorId] = useState(group.matchedTutorId || '');
  const [selectedMmsId, setSelectedMmsId] = useState(group.matchedMmsId || '');
  const [addMmsId, setAddMmsId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const status = group.status || 'review';

  const additionalIds = `${group.additionalMmsIds || ''}`.split(',').map((id) => id.trim()).filter(Boolean);
  const additionalNames = additionalIds.map((id) => studentOptions.find((s) => s.mmsId === id)?.fullName || id);
  const inGroup = new Set([group.matchedMmsId, ...additionalIds].filter(Boolean));

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{group.chatName || 'Unnamed WhatsApp group'} {group.groupType === 'tutor' ? <TutorMessageBadge /> : null}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confidenceTone(group.matchConfidence)}`}>
          {status === 'confirmed' ? 'confirmed' : status === 'ignored' ? 'ignored' : (group.matchConfidence || 'unmatched')}
        </span>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{group.chatId}</p>
      <p className="mt-1 text-xs text-slate-500">
        {group.groupType === 'tutor' ? group.tutorName || 'Choose tutor' : group.matchedStudentName || 'No student hint yet'}
        {additionalNames.length ? ` + ${additionalNames.join(', ')}` : ''}
        {group.instrument ? ` · ${group.instrument}` : ''}
        {group.matchedFcId ? ` · ${group.matchedFcId}` : ''}
        {group.lastMessageAt ? ` · last active ${formatDateTime(group.lastMessageAt)}` : (group.lastSeenAt ? ` · last seen ${formatDateTime(group.lastSeenAt)}` : '')}
      </p>

      {status === 'confirmed' ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {group.groupType !== 'tutor' ? <button
              type="button"
              disabled={isPending}
              onClick={() => setShowAdd((current) => !current)}
              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 disabled:opacity-60"
            >
              + Student (sibling)
            </button> : null}
            <button
              type="button"
              disabled={isPending}
              onClick={() => onReviewGroup(group.chatId, { status: 'review' })}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-60"
            >
              Re-review
            </button>
          </div>
          {showAdd ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={addMmsId}
                onChange={(event) => setAddMmsId(event.target.value)}
                className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-300"
              >
                <option value="">Add another student…</option>
                {studentOptions.filter((s) => !inGroup.has(s.mmsId)).map((student) => (
                  <option key={student.mmsId} value={student.mmsId}>
                    {student.fullName}{student.instrument ? ` · ${student.instrument}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isPending || !addMmsId}
                onClick={() => { onAddGroupStudent(group.chatId, addMmsId); setAddMmsId(''); setShowAdd(false); }}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 disabled:opacity-60"
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      ) : status === 'ignored' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => onReviewGroup(group.chatId, { status: 'review' })}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-60"
          >
            Restore
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label={`Group type for ${group.chatName}`}
            value={groupType}
            onChange={event => setGroupType(event.target.value)}
            disabled={isPending}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs"
          >
            <option value="student">Student group</option>
            <option value="tutor">Tutor group</option>
          </select>
          {groupType === 'tutor' ? (
            <select
              aria-label={`Tutor for ${group.chatName}`}
              value={selectedTutorId}
              onChange={event => setSelectedTutorId(event.target.value)}
              disabled={isPending}
              className="max-w-full rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs"
            >
              <option value="">Pick tutor…</option>
              {tutorOptions.map(tutor => <option key={tutor.shortName} value={tutor.shortName}>{tutor.fullName}</option>)}
            </select>
          ) : <select
            aria-label={`Student for ${group.chatName}`}
            disabled={isPending}
            value={selectedMmsId}
            onChange={(event) => setSelectedMmsId(event.target.value)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-300"
          >
            <option value="">Pick student…</option>
            {studentOptions.map((student) => (
              <option key={student.mmsId} value={student.mmsId}>
                {student.fullName}{student.instrument ? ` · ${student.instrument}` : ''}{student.tutor ? ` · ${student.tutor}` : ''}
              </option>
            ))}
          </select>}
          <button
            type="button"
            disabled={isPending || (groupType === 'tutor' ? !selectedTutorId : !selectedMmsId)}
            onClick={() => onReviewGroup(group.chatId, { status: 'confirmed', groupType, matchedTutorId: selectedTutorId, matchedMmsId: selectedMmsId })}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 disabled:opacity-60"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onReviewGroup(group.chatId, { status: 'ignored' })}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 disabled:opacity-60"
          >
            Not FC
          </button>
        </div>
      )}
    </div>
  );
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

function byConfidence(a, b) {
  return (CONFIDENCE_ORDER[a.matchConfidence] ?? 3) - (CONFIDENCE_ORDER[b.matchConfidence] ?? 3);
}

export default function GroupMapPanel({ groups = [], studentOptions = [], tutorOptions = [], onReviewGroup, onAddGroupStudent, pendingChatId }) {
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // Matched a current student → review (surfaced, sorted best-match first).
  // Matched nothing → unmatched (old students / non-lesson groups, hidden by default).
  const reviewGroups = groups.filter((group) => (group.status || 'review') === 'review').sort(byConfidence);
  const unmatchedGroups = groups.filter((group) => group.status === 'unmatched').sort(byConfidence);
  const resolvedGroups = groups.filter((group) => ['confirmed', 'ignored'].includes(group.status));

  const renderRow = (group) => (
    <GroupRow
      key={`${group.chatId}:${group.groupType}:${group.matchedTutorId}:${group.matchedMmsId}`}
      group={group}
      studentOptions={studentOptions}
      tutorOptions={tutorOptions}
      onReviewGroup={onReviewGroup}
      onAddGroupStudent={onAddGroupStudent}
      isPending={pendingChatId === group.chatId}
    />
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">WhatsApp groups</h3>
          <p className="mt-1 text-xs text-slate-500">Confirm a student or tutor to capture new messages from their group. New links start capturing after the bridge refreshes its group list (normally within ten minutes).</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {reviewGroups.length} to review
        </span>
      </div>

      {!reviewGroups.length ? (
        <p className="mt-3 text-sm text-slate-500">
          {groups.length ? 'No matched groups need review.' : 'No WhatsApp groups captured yet.'}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {reviewGroups.map(renderRow)}
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {unmatchedGroups.length ? (
          <button
            type="button"
            onClick={() => setShowUnmatched((current) => !current)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm"
          >
            {showUnmatched ? 'Hide unmatched' : `Show unmatched (${unmatchedGroups.length})`}
          </button>
        ) : null}
        {resolvedGroups.length ? (
          <button
            type="button"
            onClick={() => setShowResolved((current) => !current)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm"
          >
            {showResolved ? 'Hide resolved' : `Show confirmed/ignored (${resolvedGroups.length})`}
          </button>
        ) : null}
      </div>

      {showUnmatched && unmatchedGroups.length ? (
        <div className="mt-2">
          <p className="mb-2 text-xs font-semibold text-slate-500">Unmatched groups — choose Student group or Tutor group, then select the person to connect.</p>
          <div className="space-y-2">
            {unmatchedGroups.map(renderRow)}
          </div>
        </div>
      ) : null}

      {showResolved && resolvedGroups.length ? (
        <div className="mt-2 space-y-2">
          {resolvedGroups.map(renderRow)}
        </div>
      ) : null}
    </section>
  );
}

