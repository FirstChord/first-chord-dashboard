'use client';

import { useState } from 'react';
import { Loader2, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  PLANNING_PRIMARY_ITEM_TYPES,
  PLANNING_OWNERS,
  PLANNING_PRIMARY_AREAS,
  PLANNING_STATUSES,
  labelPlanningType,
  labelPlanningArea,
  labelPlanningStatus,
  parseLinkedStudentIds,
  inferPlanningTargetDateFromText,
  detectTutorAbsenceCapture,
  buildPauseLessonDateSuggestions,
  buildStructuredPausePlanningDraft,
} from '@/lib/admin/planning-helpers.mjs';
import {
  inferQuickCapture,
  isPauseCaptureText,
  CLIENT_TUTOR_OPTIONS,
  inferStudentFromText,
  findStudentById,
  formatTargetDate,
  applySmartDefaults,
} from '@/lib/admin/planning-client-helpers.mjs';
import { SelectField, TextField, DateField, StudentSearchField } from './fields';

// The quick "brain capture" box: a free-text note that auto-infers area/type/student,
// plus inline builders for a structured pause and a tutor absence. Controlled by the
// orchestrator via `rawNote`/`options` + their setters; submits/captures via callbacks.
export default function QuickBrainCapture({
  rawNote,
  setRawNote,
  options,
  setOptions,
  studentOptions = [],
  tutorOptions = CLIENT_TUTOR_OPTIONS,
  expanded,
  setExpanded,
  onSubmit,
  onTutorAbsenceCapture,
  onPauseCapture,
  pending = false,
  pauseOnly = false,
}) {
  // Live schedule refreshes done from this builder, keyed by MMS id. These take
  // precedence over the cached scheduleContext (which can be stale or missing).
  const [refreshedSchedules, setRefreshedSchedules] = useState({});
  const [scheduleRefreshState, setScheduleRefreshState] = useState({ pendingId: '', error: '' });
  const [absencePreview, setAbsencePreview] = useState({ pending: false, error: '', days: [], teachingDates: [] });
  const inferred = inferQuickCapture(rawNote);
  const inferredTargetDate = inferPlanningTargetDateFromText(rawNote);
  // Both an explicit pick ('manual') and an explicit clear ('cleared') suppress
  // auto-inference — otherwise clearing would immediately re-detect the student
  // mentioned in the note text and the name would never go away.
  const hasManualStudentOverride = options.studentSelectionSource === 'manual'
    || options.studentSelectionSource === 'cleared';
  const inferredStudent = hasManualStudentOverride ? null : inferStudentFromText(studentOptions, rawNote);
  // The full linked-student list (group lessons can have several); when nothing
  // is manually set we seed it from the single inferred student. The primary
  // (first) student drives the single-student pause/schedule flows below.
  const effectiveStudentIds = hasManualStudentOverride
    ? parseLinkedStudentIds(options.linkedStudentIds)
    : (inferredStudent ? [inferredStudent.mmsId] : []);
  const effectiveOptions = {
    ...inferred,
    targetDate: inferredTargetDate,
    ...options,
    linkedStudentId: effectiveStudentIds[0] || '',
    linkedStudentIds: effectiveStudentIds,
  };
  const tutorAbsenceDetection = detectTutorAbsenceCapture(rawNote, tutorOptions);
  const tutorAbsenceBuilderVisible = !effectiveOptions.hideTutorAbsenceBuilder
    && (tutorAbsenceDetection.isTutorAbsence || effectiveOptions.showTutorAbsenceBuilder);
  const effectiveTutorShortName = effectiveOptions.tutorAbsenceShortName
    || tutorAbsenceDetection.tutor?.shortName
    || '';
  const effectiveTutorDates = Array.isArray(effectiveOptions.tutorAbsenceDates) && effectiveOptions.tutorAbsenceDates.length
    ? effectiveOptions.tutorAbsenceDates
    : tutorAbsenceDetection.inferredDates;
  const cleanTutorDates = [...new Set(effectiveTutorDates.filter(Boolean))];
  const tutorAbsenceFullName = tutorOptions.find((tutor) => tutor.shortName === effectiveTutorShortName)?.fullName
    || effectiveTutorShortName;
  // A tutor-absence capture takes precedence over the single-student pause builder
  // (e.g. "pause tutor robbie"), unless the pause builder was explicitly opened.
  const pauseBuilderVisible = !effectiveOptions.hidePauseBuilder
    && (effectiveOptions.showPauseBuilder
      || (isPauseCaptureText(rawNote) && !tutorAbsenceDetection.isTutorAbsence));
  const pauseType = effectiveOptions.pauseType === 'range' ? 'range' : 'single';
  const pauseStudent = findStudentById(studentOptions, effectiveOptions.linkedStudentId);
  // Prefer a just-fetched live schedule over the cached one (cache can be a month
  // stale or absent), so the suggested dates reflect MMS right now.
  const pauseStudentSchedule = refreshedSchedules[effectiveOptions.linkedStudentId]
    || pauseStudent?.scheduleContext
    || null;
  const pauseDateSuggestions = buildPauseLessonDateSuggestions(pauseStudentSchedule, {
    count: 6,
    startDate: pauseType === 'range' ? effectiveOptions.pauseFirstPauseDate || '' : '',
  });
  const pauseDraft = buildStructuredPausePlanningDraft({
    studentName: pauseStudent?.fullName || '',
    pauseType,
    lessonDate: effectiveOptions.pauseLessonDate || '',
    firstPauseDate: effectiveOptions.pauseFirstPauseDate || '',
    returnDate: effectiveOptions.pauseReturnDate || '',
    extraNote: effectiveOptions.pauseExtraNote || '',
  });

  function setOption(key, value) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  function setItemType(value) {
    const next = applySmartDefaults({ ...effectiveOptions, itemType: value });
    setOptions((current) => ({
      ...current,
      itemType: next.itemType,
      planMode: next.planMode,
      status: next.status,
      targetDate: value === 'idea' ? '' : (current.targetDate || effectiveOptions.targetDate || ''),
    }));
  }

  function setTargetDate(value) {
    setOptions((current) => {
      const itemType = current.itemType || effectiveOptions.itemType;
      const status = current.status || effectiveOptions.status;
      return {
        ...current,
        targetDate: value,
        status: itemType === 'action'
          ? (value && status === 'inbox' ? 'active' : (!value && status === 'active' ? 'inbox' : status))
          : status,
      };
    });
  }

  function setTutorAbsenceOption(key, value) {
    setAbsencePreview({ pending: false, error: '', days: [], teachingDates: [] });
    setOptions((current) => ({ ...current, [key]: value }));
  }

  // The full linked-student list (group lessons). Marks the selection explicit so
  // auto-inference stops re-detecting names from the note text.
  function setStudentIds(ids) {
    const list = parseLinkedStudentIds(ids);
    setOptions((current) => ({
      ...current,
      linkedStudentIds: list,
      linkedStudentId: list[0] || '',
      studentSelectionSource: list.length ? 'manual' : 'cleared',
    }));
  }

  // Single-student picker used by the pause builder (pause stays bound to one
  // student); picking replaces the list with just that student.
  function setStudentOption(value) {
    setStudentIds(value ? [value] : []);
  }

  // Pull this student's schedule live from MMS (and refresh the cache) so the
  // suggested lesson dates are current even if the cached row is stale/missing.
  async function refreshPauseSchedule() {
    const mmsId = effectiveOptions.linkedStudentId;
    if (!mmsId) return;
    setScheduleRefreshState({ pendingId: mmsId, error: '' });
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(mmsId)}/schedule`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Schedule refresh failed');
      }
      setRefreshedSchedules((current) => ({ ...current, [mmsId]: data.scheduleContext }));
      setScheduleRefreshState({ pendingId: '', error: '' });
    } catch (error) {
      setScheduleRefreshState({ pendingId: '', error: error.message || 'Schedule refresh failed' });
    }
  }

  function setTutorDate(index, value) {
    setAbsencePreview({ pending: false, error: '', days: [], teachingDates: [] });
    setOptions((current) => {
      const base = Array.isArray(current.tutorAbsenceDates)
        ? [...current.tutorAbsenceDates]
        : [...effectiveTutorDates];
      base[index] = value;
      return { ...current, tutorAbsenceDates: base };
    });
  }

  function removeTutorDate(date) {
    setOptions((current) => {
      const base = Array.isArray(current.tutorAbsenceDates)
        ? current.tutorAbsenceDates
        : effectiveTutorDates;
      return {
        ...current,
        tutorAbsenceDates: base.filter((value) => value !== date),
      };
    });
  }

  async function previewTutorAbsencePeriod() {
    if (!effectiveTutorShortName || !effectiveOptions.tutorAbsencePeriodStart || !effectiveOptions.tutorAbsencePeriodEnd) {
      return;
    }
    setAbsencePreview({ pending: true, error: '', days: [], teachingDates: [] });
    try {
      const response = await fetch('/api/admin/planning/tutor-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preview_period',
          tutorShortName: effectiveTutorShortName,
          startDate: effectiveOptions.tutorAbsencePeriodStart,
          endDate: effectiveOptions.tutorAbsencePeriodEnd,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Tutor absence preview failed');
      }
      setAbsencePreview({
        pending: false,
        error: '',
        days: data.preview || [],
        teachingDates: data.teachingDates || [],
      });
      setOptions((current) => ({
        ...current,
        tutorAbsenceDates: data.teachingDates || [],
      }));
    } catch (error) {
      setAbsencePreview({ pending: false, error: error.message || 'Tutor absence preview failed', days: [], teachingDates: [] });
    }
  }

  async function handleTutorAbsenceCapture() {
    if (!effectiveTutorShortName || !cleanTutorDates.length || !onTutorAbsenceCapture) {
      return;
    }
    await onTutorAbsenceCapture(effectiveTutorShortName, cleanTutorDates);
  }

  async function captureStructuredPause() {
    if (!pauseDraft.isComplete || !onPauseCapture) {
      return;
    }
    await onPauseCapture(pauseDraft.title, {
      pauseDetails: { pauseType, lessonDate: effectiveOptions.pauseLessonDate || '', firstPauseDate: effectiveOptions.pauseFirstPauseDate || '', returnDate: effectiveOptions.pauseReturnDate || '', extraNote: effectiveOptions.pauseExtraNote || '' },
      structuredCapture: 'pause',
      title: pauseDraft.title,
      notes: pauseDraft.notes,
      itemType: 'action',
      status: 'active',
      area: 'admin',
      targetDate: pauseDraft.targetDate,
      nextAction: pauseDraft.nextAction,
      progressNote: pauseDraft.progressNote,
      linkedStudentId: effectiveOptions.linkedStudentId || '',
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label hidden={pauseOnly} className="block">
        <span className="sr-only">Brain capture note</span>
        <textarea
          value={rawNote}
          onChange={(event) => setRawNote(event.target.value)}
          rows={5}
          autoFocus={!pauseOnly}
          placeholder="Whatcha got for me"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium leading-7 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
      </label>

      {pauseBuilderVisible ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Structured pause</p>
              <p className="mt-1 text-sm text-violet-950">
                Use this when a pause covers one lesson or an away period. For away periods, “returning from” means the first lesson/date they are expected back.
              </p>
            </div>
            <button
              hidden={pauseOnly}
              type="button"
              onClick={() => {
                setOption('showPauseBuilder', false);
                setOption('hidePauseBuilder', true);
              }}
              className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100"
            >
              Hide
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SelectField
              label="Pause type"
              value={pauseType}
              onChange={(value) => setOption('pauseType', value)}
              options={[
                { value: 'single', label: 'One lesson' },
                { value: 'range', label: 'Away period' },
              ]}
            />
            <div>
              <StudentSearchField
                label="Student"
                value={effectiveOptions.linkedStudentId}
                onChange={setStudentOption}
                studentOptions={studentOptions}
              />
            </div>
          </div>

          {pauseStudentSchedule?.status === 'found' ? (
            <div className="mt-4 rounded-xl border border-violet-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
                  Suggested lesson dates
                </p>
                <button
                  type="button"
                  onClick={refreshPauseSchedule}
                  disabled={scheduleRefreshState.pendingId === effectiveOptions.linkedStudentId}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {scheduleRefreshState.pendingId === effectiveOptions.linkedStudentId
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Search className="h-3.5 w-3.5" />}
                  Refresh from MMS
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                Usual lesson: {[
                  pauseStudentSchedule.usualWeekday,
                  pauseStudentSchedule.usualTime,
                  pauseStudentSchedule.teacherName ? `with ${pauseStudentSchedule.teacherName}` : '',
                ].filter(Boolean).join(' ') || 'cached schedule found'}
              </p>
              {scheduleRefreshState.error ? (
                <p className="mt-1 text-sm text-rose-700">{scheduleRefreshState.error}</p>
              ) : null}
              {pauseDateSuggestions.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {pauseDateSuggestions.map((suggestion) => (
                    <div key={suggestion.date} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                      <p className="text-sm font-semibold text-slate-900">{suggestion.lessonLabel}</p>
                      {pauseType === 'single' ? (
                        <button
                          type="button"
                          onClick={() => setOption('pauseLessonDate', suggestion.date)}
                          className="mt-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-50"
                        >
                          Use this lesson
                        </button>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setOption('pauseFirstPauseDate', suggestion.date)}
                            className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-50"
                          >
                            First missed
                          </button>
                          <button
                            type="button"
                            onClick={() => setOption('pauseReturnDate', suggestion.date)}
                            className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                          >
                            Returning
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No upcoming cached lesson dates available.</p>
              )}
            </div>
          ) : effectiveOptions.linkedStudentId ? (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>No cached lesson schedule for this student yet. Pull it live from MMS to get suggested dates, or fill the date fields manually.</p>
              <button
                type="button"
                onClick={refreshPauseSchedule}
                disabled={scheduleRefreshState.pendingId === effectiveOptions.linkedStudentId}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scheduleRefreshState.pendingId === effectiveOptions.linkedStudentId
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Search className="h-3.5 w-3.5" />}
                Refresh from MMS
              </button>
              {scheduleRefreshState.error ? (
                <p className="mt-1 text-rose-700">{scheduleRefreshState.error}</p>
              ) : null}
            </div>
          ) : null}

          {pauseType === 'single' ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <DateField
                label="Lesson to pause"
                value={effectiveOptions.pauseLessonDate || ''}
                onChange={(value) => setOption('pauseLessonDate', value)}
              />
              <TextField
                label="Extra note"
                value={effectiveOptions.pauseExtraNote || ''}
                onChange={(value) => setOption('pauseExtraNote', value)}
                placeholder="Optional reason or context"
              />
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <DateField
                label="First lesson to pause"
                value={effectiveOptions.pauseFirstPauseDate || ''}
                onChange={(value) => setOption('pauseFirstPauseDate', value)}
              />
              <DateField
                label="Returning from"
                value={effectiveOptions.pauseReturnDate || ''}
                onChange={(value) => setOption('pauseReturnDate', value)}
              />
              <TextField
                label="Extra note"
                value={effectiveOptions.pauseExtraNote || ''}
                onChange={(value) => setOption('pauseExtraNote', value)}
                placeholder="Summer holiday, illness, etc."
              />
            </div>
          )}

          <div className="mt-4 rounded-xl border border-violet-100 bg-white p-3 text-sm text-slate-700">
            {pauseDraft.isComplete ? (
              <>
                <p className="font-semibold text-slate-900">{pauseDraft.title}</p>
                <p className="mt-1 whitespace-pre-line">{pauseDraft.notes}</p>
                {pauseDraft.targetDate ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">Do by {formatTargetDate(pauseDraft.targetDate)}</p>
                ) : null}
              </>
            ) : (
              <p>
                Add {pauseDraft.missingFields.join(' and ')} to generate a clear pause task.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={captureStructuredPause}
            disabled={pending || !pauseDraft.isComplete || (pauseOnly && !effectiveOptions.linkedStudentId)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-violet-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {pauseOnly ? 'Create pause plan' : 'Capture pause'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOption('showPauseBuilder', true);
            setOption('hidePauseBuilder', false);
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50"
        >
          Structure a pause
        </button>
      )}

      <div hidden={pauseOnly}>
      {tutorAbsenceBuilderVisible ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Tutor absence</p>
              <p className="mt-1 text-sm text-orange-950">
                Creates one planning card per day, snapshotting the affected students and linking to the tutor absence workflow.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOption('showTutorAbsenceBuilder', false);
                setOption('hideTutorAbsenceBuilder', true);
              }}
              className="rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100"
            >
              Hide
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SelectField
              label="Tutor"
              value={effectiveTutorShortName}
              onChange={(value) => setTutorAbsenceOption('tutorAbsenceShortName', value)}
              options={[
                { value: '', label: 'Select tutor…' },
                ...tutorOptions.map((tutor) => ({ value: tutor.shortName, label: tutor.fullName })),
              ]}
            />
            <div className="grid gap-2">
              <DateField
                label="Absence date"
                value={effectiveTutorDates[0] || ''}
                onChange={(value) => setTutorDate(0, value)}
              />
              <DateField
                label="Date 2 (optional)"
                value={effectiveTutorDates[1] || ''}
                onChange={(value) => setTutorDate(1, value)}
              />
              <DateField
                label="Date 3 (optional)"
                value={effectiveTutorDates[2] || ''}
                onChange={(value) => setTutorDate(2, value)}
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-orange-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">Away period</p>
            <p className="mt-1 text-sm text-slate-600">
              For a clean block away, choose the first and last date away. The dashboard checks MMS and keeps only days with lessons.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <DateField
                label="First date away"
                value={effectiveOptions.tutorAbsencePeriodStart || ''}
                onChange={(value) => setTutorAbsenceOption('tutorAbsencePeriodStart', value)}
              />
              <DateField
                label="Last date away"
                value={effectiveOptions.tutorAbsencePeriodEnd || ''}
                onChange={(value) => setTutorAbsenceOption('tutorAbsencePeriodEnd', value)}
              />
              <button
                type="button"
                onClick={previewTutorAbsencePeriod}
                disabled={pending || absencePreview.pending || !effectiveTutorShortName || !effectiveOptions.tutorAbsencePeriodStart || !effectiveOptions.tutorAbsencePeriodEnd}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {absencePreview.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Find teaching dates
              </button>
            </div>
            {absencePreview.error ? <p className="mt-2 text-sm font-semibold text-red-700">{absencePreview.error}</p> : null}
            {absencePreview.days.length ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-semibold text-slate-900">
                  Found {absencePreview.teachingDates.length} teaching date{absencePreview.teachingDates.length === 1 ? '' : 's'} in this period.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {absencePreview.days.filter((day) => day.hasLessons).map((day) => (
                    <div key={day.date} className="rounded-lg border border-orange-100 bg-orange-50/70 px-3 py-2 text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">{formatTargetDate(day.date)}</span>
                      <span className="ml-2 text-slate-500">{day.lessonCount} lesson{day.lessonCount === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                </div>
                {!absencePreview.teachingDates.length ? (
                  <p className="text-sm text-amber-800">No MMS lessons found for this tutor in that range.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-orange-100 bg-white p-3 text-sm text-slate-700">
            {effectiveTutorShortName && cleanTutorDates.length ? (
              <div className="space-y-3">
                <p className="font-semibold text-slate-900">
                  Will create {cleanTutorDates.length} planning card{cleanTutorDates.length === 1 ? '' : 's'} for {tutorAbsenceFullName}. Affected students load from MMS.
                </p>
                <div className="flex flex-wrap gap-2">
                  {cleanTutorDates.map((date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => removeTutorDate(date)}
                      className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-900 hover:bg-orange-100"
                      title="Remove this date"
                    >
                      {formatTargetDate(date)}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p>Select a tutor and at least one absence date.</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleTutorAbsenceCapture}
            disabled={pending || !effectiveTutorShortName || !cleanTutorDates.length}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-orange-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Capture absence
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOption('showTutorAbsenceBuilder', true);
            setOption('hideTutorAbsenceBuilder', false);
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-50"
        >
          Structure a tutor absence
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">{labelPlanningType(effectiveOptions.itemType)}</span>
          {effectiveOptions.area !== 'other' ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1">{labelPlanningArea(effectiveOptions.area)}</span>
          ) : null}
          {effectiveOptions.linkedWorkflowId ? (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">{effectiveOptions.linkedWorkflowId}</span>
          ) : null}
          {effectiveOptions.targetDate ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
              {effectiveOptions.itemType === 'initiative' ? 'Review next' : 'Do on'} {formatTargetDate(effectiveOptions.targetDate)}
            </span>
          ) : null}
          {effectiveOptions.linkedStudentIds.map((id) => (
            <span key={id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
              Student: {findStudentById(studentOptions, id)?.fullName || id}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {effectiveOptions.itemType !== 'initiative' ? (
            <button
              type="button"
              onClick={() => {
                setItemType('initiative');
                setExpanded(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-100"
            >
              Plan a project
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {expanded ? 'Fewer options' : 'More options'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-5">
          <SelectField
            label="Kind"
            value={effectiveOptions.itemType}
            onChange={setItemType}
            options={PLANNING_PRIMARY_ITEM_TYPES.map((value) => ({ value, label: labelPlanningType(value) }))}
          />
          <SelectField
            label="Owner"
            value={effectiveOptions.owner}
            onChange={(value) => setOption('owner', value)}
            options={PLANNING_OWNERS}
          />
          <SelectField
            label="Area (optional)"
            value={effectiveOptions.area}
            onChange={(value) => setOption('area', value)}
            options={PLANNING_PRIMARY_AREAS.map((value) => ({ value, label: labelPlanningArea(value) }))}
          />
          {effectiveOptions.itemType !== 'idea' ? (
            <DateField
              label={effectiveOptions.itemType === 'initiative' ? 'Review next (optional)' : 'Do on'}
              value={effectiveOptions.targetDate}
              onChange={setTargetDate}
            />
          ) : <div />}
          <SelectField
            label="Status"
            value={effectiveOptions.status}
            onChange={(value) => setOption('status', value)}
            options={PLANNING_STATUSES.map((value) => ({ value, label: labelPlanningStatus(value) }))}
          />
          {effectiveOptions.itemType === 'initiative' ? (
            <>
              <div className="md:col-span-2">
                <TextField
                  label="Done when"
                  value={effectiveOptions.outcome || ''}
                  onChange={(value) => setOption('outcome', value)}
                  placeholder="What will be true when this project is complete?"
                />
              </div>
            </>
          ) : null}
          {effectiveOptions.itemType === 'action'
            && ['active', 'waiting'].includes(effectiveOptions.status)
            && !effectiveOptions.targetDate ? (
              <p className="md:col-span-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                Choose a Do on date for an active Action, or leave it in Inbox until you are ready to schedule it.
              </p>
            ) : null}
          <div className="md:col-span-5">
            <StudentSearchField
              label="Linked Students"
              multiple
              value={effectiveOptions.linkedStudentIds}
              onChange={setStudentIds}
              studentOptions={studentOptions}
            />
          </div>
        </div>
      ) : null}

      {pauseBuilderVisible ? null : (
        <button
          type="submit"
          disabled={pending || !rawNote.trim() || (
            effectiveOptions.itemType === 'action'
            && ['active', 'waiting'].includes(effectiveOptions.status)
            && !effectiveOptions.targetDate
          )}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {effectiveOptions.itemType === 'initiative' ? 'Create project' : 'Capture'}
        </button>
      )}
      </div>
    </form>
  );
}
