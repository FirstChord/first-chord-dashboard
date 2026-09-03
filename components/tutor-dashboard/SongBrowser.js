'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Music,
  Plus,
  RotateCcw,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  getSongsForInstrument,
  levelsForSeries,
  seriesForSongs,
  seriesOf,
  songMatchesInstrument,
  syllabusLabelForSong,
} from '@/lib/songs/catalogue-helpers.mjs';
import {
  buildPathProgress,
  inferStudentLevel,
  inferStudentSeries,
} from '@/lib/songs/shelf-helpers.mjs';
import { skillLabelsForSong } from '@/lib/songs/skills-helpers.mjs';
import { summariseTeachingHistory } from '@/lib/songs/teaching-history.mjs';
import { PATH_TEMPLATES } from '@/lib/config/path-templates.mjs';

// The chip tracks progress *through* a song; the two ways out of it (done,
// parked) each get their own one-tap control. `done` used to be the fourth
// step of this cycle and the school recorded none in a month of use, while
// park — one tap, right there — collected eight songs a tutor had actually
// finished. A four-tap exit that wraps back to `assigned` is not an exit.
const STATUS_CYCLE = ['assigned', 'working', 'ready'];
// The tutor's own words for the outcome chips, kept human on the way back out.
const OUTCOME_LABELS = {
  cruised: 'Cruised it',
  about_right: 'About right',
  battle: 'A battle',
};
const STATUS_STYLES = {
  assigned: 'bg-gray-100 text-gray-600',
  working: 'bg-amber-100 text-amber-800',
  ready: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  parked: 'bg-gray-100 text-gray-400',
};

// Student-centred song panel: a Now strip (current song + path progress, tap
// to manage the sequence) above the RSL bookcase — a rail of grade tiles with
// the student's grade preselected and that grade's songs as cards. Assigned
// cards stay on the shelf with a tick. Renders nothing when the catalogue has
// no songs for the student's instrument.
export default function SongBrowser({ student }) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState(null); // null = student's series
  const [selectedLevel, setSelectedLevel] = useState(null); // null = student's level
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [techOpen, setTechOpen] = useState(false);
  const [assignments, setAssignments] = useState(null); // null = not loaded
  const [pendingId, setPendingId] = useState(null);
  const [assignError, setAssignError] = useState(null);
  // One-tap "how did it go?" after a song hits done/parked. Optional — a chip
  // tap saves, the X skips; either way the status change already happened.
  const [outcomePrompt, setOutcomePrompt] = useState(null); // { songId, status }
  const [outcomeNote, setOutcomeNote] = useState('');
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  // "Request this song" on a search miss → Song_Requests curation queue.
  const [requestedTerm, setRequestedTerm] = useState(null);
  const [requesting, setRequesting] = useState(false);
  // What colleagues know about each song. School-wide and student-free, so it
  // is fetched once per panel open rather than per student.
  const [history, setHistory] = useState(null); // null = not loaded
  const [historyOpenFor, setHistoryOpenFor] = useState(null); // songId

  const studentId = student?.mms_id || student?.ID || '';
  const token = student?.noteAccessToken || student?.note_access_token || '';

  const songs = useMemo(
    () => getSongsForInstrument(student?.instrument),
    [student?.instrument]
  );

  useEffect(() => {
    setAssignments(null);
    setPendingId(null);
    setAssignError(null);
    setManageOpen(false);
    setSelectedSeries(null);
    setSelectedLevel(null);
    setSearchOpen(false);
    setSearch('');
    setOutcomePrompt(null);
    setOutcomeNote('');
    setHistoryOpenFor(null);
  }, [studentId]);

  useEffect(() => {
    if (!open || assignments !== null || !studentId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/song-assignments?student=${encodeURIComponent(studentId)}&token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!cancelled) setAssignments(data.assignments || []);
      } catch {
        if (!cancelled) setAssignments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, assignments, studentId, token]);

  // Teaching history is about songs, not this student, so it survives a
  // student switch: fetch once and keep it.
  useEffect(() => {
    if (!open || history !== null || !studentId || !token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/song-history?student=${encodeURIComponent(studentId)}&token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!cancelled) setHistory(data.history || {});
      } catch {
        // Enrichment only — a song with no history reads the same as a failed
        // fetch, and neither is worth an error message on the shelf.
        if (!cancelled) setHistory({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, history, studentId, token]);

  const canAssign = Boolean(studentId && token);
  const loaded = assignments !== null;

  const assignedSongIds = useMemo(
    () => new Set((assignments || []).map((a) => a.songId)),
    [assignments]
  );

  const orderedAssignments = useMemo(
    () =>
      [...(assignments || [])].sort(
        (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
      ),
    [assignments]
  );

  const activeAssignments = orderedAssignments.filter((a) => a.status !== 'parked');
  const nowAssignment =
    activeAssignments.find((a) => a.status === 'working') || activeAssignments[0] || null;
  const nowSong = nowAssignment ? songs.find((s) => s.songId === nowAssignment.songId) : null;
  const pathProgress = loaded ? buildPathProgress(assignments) : null;

  // A series (RSL grades, John Thompson books) is a tab; its levels are the rail.
  const availableSeries = seriesForSongs(songs);
  const studentSeries = inferStudentSeries(assignments || [], songs);
  const shelfSeries = selectedSeries || studentSeries || availableSeries[0]?.id || null;

  const railLevels = levelsForSeries(shelfSeries, songs);
  const studentLevel = inferStudentLevel(assignments || [], songs, shelfSeries);
  const shelfLevel = selectedLevel || studentLevel || railLevels[0];

  const pathTemplates = Object.entries(PATH_TEMPLATES)
    .filter(([, template]) =>
      songMatchesInstrument({ instruments: [template.instrument] }, student?.instrument)
    )
    .map(([pathId, template]) => ({ pathId, ...template }))
    // A fully assigned path has nothing left to offer — hide it.
    .filter((template) => !template.steps.every((songId) => assignedSongIds.has(songId)));

  if (songs.length === 0) return null;

  const callApi = async (id, options) => {
    setPendingId(id);
    setAssignError(null);
    let saved = false;
    try {
      const res = await fetch('/api/song-assignments', {
        method: options.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mmsId: studentId, token, ...options.body }),
      });
      const data = await res.json();
      if (data.success) {
        saved = true;
        if (data.assignments) {
          setAssignments(data.assignments);
        } else if (data.assignment) {
          setAssignments((prev) => [
            ...(prev || []).filter((a) => a.songId !== data.assignment.songId),
            data.assignment,
          ]);
        }
      } else {
        setAssignError(`Couldn't save that (${data.code || res.status}). Try again.`);
      }
    } catch {
      setAssignError("Couldn't save that — network error. Try again.");
    }
    setPendingId(null);
    return saved;
  };

  const assignSong = (songId) => callApi(songId, { method: 'POST', body: { songId } });
  const assignPath = (pathId) => callApi(pathId, { method: 'POST', body: { pathId } });
  const setStatus = async (songId, status) => {
    const saved = await callApi(songId, { method: 'PATCH', body: { songId, status } });
    if (saved && (status === 'done' || status === 'parked')) {
      setOutcomePrompt({ songId, status });
      setOutcomeNote('');
    } else if (saved && outcomePrompt?.songId === songId) {
      setOutcomePrompt(null);
    }
    return saved;
  };

  const requestSong = async () => {
    const queryText = search.trim();
    if (!queryText) return;
    setRequesting(true);
    try {
      const res = await fetch('/api/song-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mmsId: studentId,
          token,
          queryText,
          instrument: student?.instrument || '',
        }),
      });
      const data = await res.json();
      if (data.success) setRequestedTerm(queryText);
    } catch {
      // Quiet failure — the tutor can just try again.
    }
    setRequesting(false);
  };

  const sendOutcome = async (outcome) => {
    if (!outcomePrompt) return;
    setOutcomeSaving(true);
    try {
      await fetch('/api/song-outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mmsId: studentId,
          token,
          songId: outcomePrompt.songId,
          outcome,
          note: outcomeNote.trim(),
        }),
      });
    } catch {
      // Optional telemetry — a lost outcome never blocks the tutor.
    }
    setOutcomeSaving(false);
    setOutcomePrompt(null);
    setOutcomeNote('');
  };
  const move = (songId, direction) =>
    callApi(songId, { method: 'PATCH', body: { songId, direction } });
  const cycleStatus = (assignment) => {
    const index = STATUS_CYCLE.indexOf(assignment.status);
    const next = STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length] || 'assigned';
    setStatus(assignment.songId, next);
  };

  const searchTerm = search.trim().toLowerCase();
  // Search reaches across every series; otherwise the shelf is one series' level.
  const shelfItems = searchTerm
    ? songs.filter(
        (song) =>
          song.title.toLowerCase().includes(searchTerm) ||
          (song.artist || '').toLowerCase().includes(searchTerm)
      )
    : songs.filter((song) => seriesOf(song) === shelfSeries && song.level === shelfLevel);
  // Songs are the shelf; scales/exercises sit in a quiet row below it.
  // A search shows everything as cards so nothing is unfindable.
  const shelfSongs = searchTerm
    ? shelfItems
    : shelfItems.filter((song) => (song.contentType || 'song') === 'song');
  const shelfTechnical = searchTerm
    ? []
    : shelfItems.filter((song) => (song.contentType || 'song') !== 'song');

  const titleFor = (assignment) =>
    songs.find((s) => s.songId === assignment.songId)?.title ||
    assignment.songTitle ||
    assignment.songId;

  return (
    <div className="bg-white rounded-xl shadow-md border border-[#2F6B3D]/25 mt-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 sm:p-5 text-left"
      >
        <span className="flex items-center gap-3">
          <Music className="h-5 w-5 text-[#2F6B3D]" />
          <span className="text-lg font-bold text-gray-800">Songs</span>
          {nowSong && !open && (
            <span className="hidden truncate text-sm text-gray-500 sm:inline">
              {nowSong.title}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-5 w-5 text-[#2F6B3D]" />
        ) : (
          <ChevronRight className="h-5 w-5 text-[#2F6B3D]" />
        )}
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
          {assignError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{assignError}</p>
          )}

          {/* Now: current song + path progress. Tap to manage the sequence. */}
          {nowAssignment && (
            <div className="rounded-lg border border-[#2F6B3D]/20 bg-green-50/50">
              <button
                type="button"
                onClick={() => setManageOpen(!manageOpen)}
                className="flex w-full max-w-2xl items-center justify-between gap-3 p-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-gray-800">
                    {titleFor(nowAssignment)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[nowAssignment.status] || STATUS_STYLES.assigned}`}
                  >
                    {nowAssignment.status}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-gray-500">
                  {pathProgress && (
                    <>
                      <span className="hidden sm:inline">{pathProgress.name}</span>
                      <span className="flex items-center gap-0.5">
                        {pathProgress.steps.map((step) => (
                          <span
                            key={step.songId}
                            className={`h-2 w-2 rounded-full ${
                              step.status === 'done'
                                ? 'bg-[#2F6B3D]'
                                : step.status === 'working'
                                  ? 'bg-amber-400'
                                  : 'border border-[#2F6B3D]/40'
                            }`}
                          />
                        ))}
                      </span>
                      <span>
                        {pathProgress.position} of {pathProgress.steps.length}
                      </span>
                    </>
                  )}
                  {manageOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              </button>

              {manageOpen && (
                <ul className="max-w-2xl space-y-1.5 border-t border-[#2F6B3D]/10 p-3">
                  {orderedAssignments.map((assignment, index) => {
                    const isParked = assignment.status === 'parked';
                    const isDone = assignment.status === 'done';
                    const busy = pendingId === assignment.songId;
                    const prompting = outcomePrompt?.songId === assignment.songId;
                    return (
                      <li key={assignment.songId}>
                      <div
                        className={`flex items-center gap-2 ${isParked ? 'opacity-50' : ''}`}
                      >
                        <span className="w-5 shrink-0 text-right text-sm text-gray-400">
                          {isParked ? '·' : `${index + 1}.`}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                          {titleFor(assignment)}
                        </span>
                        <button
                          type="button"
                          disabled={busy || isParked || isDone}
                          onClick={() => cycleStatus(assignment)}
                          title="Tap to change status"
                          className={`rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${STATUS_STYLES[assignment.status] || STATUS_STYLES.assigned}`}
                        >
                          {assignment.status || 'assigned'}
                        </button>
                        <button
                          type="button"
                          disabled={busy || isParked}
                          onClick={() => move(assignment.songId, 'up')}
                          className="rounded p-1 text-[#2F6B3D] hover:bg-green-100 disabled:opacity-30"
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || isParked}
                          onClick={() => move(assignment.songId, 'down')}
                          className="rounded p-1 text-[#2F6B3D] hover:bg-green-100 disabled:opacity-30"
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        {/* Finishing a song is its own act, one tap, next to
                            parking — and it opens the same "how was it?" prompt,
                            which is what feeds every other tutor's view of it. */}
                        <button
                          type="button"
                          disabled={busy || isParked}
                          onClick={() =>
                            setStatus(assignment.songId, isDone ? 'assigned' : 'done')
                          }
                          className={`rounded p-1 disabled:opacity-30 ${
                            isDone
                              ? 'text-[#2F6B3D] hover:bg-green-100'
                              : 'text-gray-400 hover:bg-green-100 hover:text-[#2F6B3D]'
                          }`}
                          aria-label={isDone ? 'Reopen' : 'Mark done'}
                          title={isDone ? 'Reopen' : 'Mark done'}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setStatus(assignment.songId, isParked ? 'assigned' : 'parked')
                          }
                          className="rounded p-1 text-gray-400 hover:bg-gray-100"
                          aria-label={isParked ? 'Bring back' : 'Park'}
                          title={isParked ? 'Bring back' : 'Park (hidden from student)'}
                        >
                          {isParked ? (
                            <RotateCcw className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      {/* One-tap outcome capture — a chip saves (with any note
                          typed), the X skips. The status change is already in. */}
                      {prompting && (
                        <div className="ml-7 mt-1.5 rounded-lg border border-[#2F6B3D]/20 bg-white p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-700">
                              {outcomePrompt.status === 'parked'
                                ? 'Why the park?'
                                : 'How was it for them?'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOutcomePrompt(null)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100"
                              aria-label="Skip"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                disabled={outcomeSaving}
                                onClick={() => sendOutcome(value)}
                                className="rounded-full border border-[#2F6B3D]/40 px-2.5 py-0.5 text-xs font-medium text-[#2F6B3D] hover:bg-green-50 disabled:opacity-40"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <input
                              type="text"
                              value={outcomeNote}
                              maxLength={300}
                              onChange={(e) => setOutcomeNote(e.target.value)}
                              placeholder="What tripped them up? (optional)"
                              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs outline-none focus:border-[#2F6B3D]/50"
                            />
                            {outcomeNote.trim() && (
                              <button
                                type="button"
                                disabled={outcomeSaving}
                                onClick={() => sendOutcome('')}
                                className="rounded-full bg-[#2F6B3D] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* The bookcase: series tabs (only when more than one), then that
              series' level rail, then the selected level's songs as cards. */}
          <div>
            {availableSeries.length > 1 && (
              <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-gray-100">
                {availableSeries.map((series) => {
                  const isShelf = series.id === shelfSeries;
                  return (
                    <button
                      key={series.id}
                      type="button"
                      onClick={() => {
                        setSelectedSeries(series.id);
                        setSelectedLevel(null);
                        setSearch('');
                        setSearchOpen(false);
                      }}
                      className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                        isShelf
                          ? 'border-[#2F6B3D] font-semibold text-[#2F6B3D]'
                          : 'border-transparent text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {series.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {availableSeries.length === 1 && (
                <span className="text-xs font-bold uppercase tracking-wide text-[#2F6B3D]">
                  {availableSeries[0].name}
                </span>
              )}
              <div className="flex flex-wrap items-center gap-1">
                {railLevels.map((level) => {
                  const isShelf = !searchTerm && level === shelfLevel;
                  const isStudentLevel = level === studentLevel;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        setSelectedLevel(level);
                        setSearch('');
                        setSearchOpen(false);
                      }}
                      className={`rounded-full px-3 py-1 text-sm transition-colors ${
                        isShelf
                          ? 'bg-[#2F6B3D] font-semibold text-white'
                          : isStudentLevel
                            ? 'font-semibold text-[#2F6B3D] hover:bg-green-50'
                            : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  setSearch('');
                }}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-[#2F6B3D]"
                aria-label={searchOpen ? 'Close search' : 'Search songs'}
              >
                {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </button>
              {searchOpen && (
                <input
                  type="search"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title or artist"
                  className="min-w-40 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#2F6B3D]/50"
                />
              )}
            </div>

            <div className="grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {shelfSongs.map((song) => {
                const isAssigned = assignedSongIds.has(song.songId);
                const busy = pendingId === song.songId;
                const songHistory = history?.[song.songId] || null;
                const historyLine = summariseTeachingHistory(songHistory);
                const historyOpen = historyOpenFor === song.songId;
                // What the song teaches, from the tags it already carries.
                // Absent on a song nobody has tagged yet, which is honest.
                const skillLabels = skillLabelsForSong(song);
                const syllabusLabel = syllabusLabelForSong(song);
                return (
                  <div
                    key={song.songId}
                    className={`relative rounded-lg border p-3 transition-colors ${
                      isAssigned
                        ? 'border-[#2F6B3D]/30 bg-green-50/60'
                        : 'border-gray-200 hover:border-[#2F6B3D]/50'
                    }`}
                  >
                    <a
                      href={song.soundsliceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute right-2 top-2 rounded p-1 text-gray-300 hover:bg-green-50 hover:text-[#2F6B3D]"
                      aria-label={`Open ${song.title} in Soundslice`}
                      title="Open in Soundslice"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <p
                      className="pr-6 text-sm font-semibold leading-snug text-gray-800"
                      title={song.tutorNote || undefined}
                    >
                      {song.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <p className="truncate text-xs text-gray-500">{song.artist}</p>
                      {/* A grade can hold pieces from two different RSL syllabuses at once
                          (Rock School and Classical). Only the Classical ones are marked —
                          badging both would just be noise on every card. */}
                      {(song.tags || []).includes('classical') && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">
                          Classical
                        </span>
                      )}
                    </div>
                    {syllabusLabel && (
                      <p className="mt-0.5 text-[10px] text-gray-400">{syllabusLabel}</p>
                    )}
                    {searchTerm && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        {song.level}
                        {(song.contentType || 'song') !== 'song' ? ` · ${song.contentType}` : ''}
                      </p>
                    )}
                    {skillLabels.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {skillLabels.map((label) => (
                          <span
                            key={label}
                            className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                          >
                            {label}
                          </span>
                        ))}
                      </p>
                    )}

                    {/* What colleagues know. Only appears when someone has
                        actually taught it, so a quiet card means "no history
                        yet" rather than "history not offered here". */}
                    {historyLine && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryOpenFor(historyOpen ? null : song.songId)
                          }
                          className="inline-flex items-start gap-1 text-left text-xs text-gray-500 hover:text-[#2F6B3D]"
                          aria-expanded={historyOpen}
                        >
                          <Users className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{historyLine}</span>
                        </button>
                        {historyOpen && (
                          <div className="mt-1.5 space-y-1.5 rounded border border-gray-100 bg-gray-50/80 p-2">
                            {songHistory.outcomes.length === 0 && (
                              <p className="text-xs text-gray-400">
                                No one has recorded how it went yet.
                              </p>
                            )}
                            {songHistory.outcomes.map((entry) => (
                              <p key={entry.recordedAt + entry.tutor} className="text-xs leading-snug text-gray-600">
                                {entry.outcome && (
                                  <span className="font-medium text-gray-700">
                                    {OUTCOME_LABELS[entry.outcome] || entry.outcome}
                                    {entry.note ? ' · ' : ''}
                                  </span>
                                )}
                                {entry.note}
                                {entry.tutor && (
                                  <span className="text-gray-400"> — {entry.tutor}</span>
                                )}
                              </p>
                            ))}
                            {songHistory.noteMentions > 0 && (
                              <p className="text-xs text-gray-400">
                                In {songHistory.noteMentions} practice note
                                {songHistory.noteMentions === 1 ? '' : 's'}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2">
                      {isAssigned ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#2F6B3D]">
                          <Check className="h-3.5 w-3.5" /> Assigned
                        </span>
                      ) : (
                        canAssign && (
                          <button
                            type="button"
                            disabled={busy || !loaded}
                            onClick={() => assignSong(song.songId)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#2F6B3D] hover:underline disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {busy ? 'Assigning…' : 'Assign'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
              {shelfSongs.length === 0 && (
                <div className="col-span-full flex flex-wrap items-center gap-2 text-sm text-gray-500">
                  <span>
                    {searchTerm ? `Nothing matches “${search}”.` : 'No songs at this grade yet.'}
                  </span>
                  {searchTerm && canAssign && (
                    search.trim() === requestedTerm ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#2F6B3D]">
                        <Check className="h-3.5 w-3.5" /> Requested
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={requesting}
                        onClick={requestSong}
                        className="font-medium text-[#2F6B3D] hover:underline disabled:opacity-40"
                      >
                        {requesting ? 'Requesting…' : `Request “${search.trim()}”`}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {shelfTechnical.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setTechOpen(!techOpen)}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-[#2F6B3D]"
                >
                  {techOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Technical exercises · {shelfTechnical.length}
                </button>
                {techOpen && (
                  <ul className="mt-2 flex max-w-4xl flex-wrap gap-1.5">
                    {shelfTechnical.map((item) => {
                      const isAssigned = assignedSongIds.has(item.songId);
                      const busy = pendingId === item.songId;
                      return (
                        <li
                          key={item.songId}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                            isAssigned
                              ? 'border-[#2F6B3D]/30 bg-green-50 text-[#2F6B3D]'
                              : 'border-gray-200 text-gray-600'
                          }`}
                        >
                          {canAssign && !isAssigned ? (
                            <button
                              type="button"
                              disabled={busy || !loaded}
                              onClick={() => assignSong(item.songId)}
                              className="inline-flex items-center gap-1 hover:text-[#2F6B3D] disabled:opacity-40"
                              title="Assign"
                            >
                              <Plus className="h-3 w-3" />
                              {item.title}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {isAssigned && <Check className="h-3 w-3" />}
                              {item.title}
                            </span>
                          )}
                          <a
                            href={item.soundsliceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-[#2F6B3D]"
                            aria-label={`Open ${item.title} in Soundslice`}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Paths with something left to offer. */}
          {canAssign && loaded && pathTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Paths
              </span>
              {pathTemplates.map((template) => (
                <button
                  key={template.pathId}
                  type="button"
                  disabled={pendingId === template.pathId}
                  onClick={() => assignPath(template.pathId)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#2F6B3D]/40 px-3 py-1 text-sm font-medium text-[#2F6B3D] transition-colors hover:bg-green-50 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {template.name} ({template.steps.length})
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
