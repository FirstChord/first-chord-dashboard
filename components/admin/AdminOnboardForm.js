'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';

import CopyButton from '@/components/admin/ui/CopyButton';
import { findOnboardingCompletionBlockers } from '@/lib/admin/onboarding-helpers.mjs';
import {
  MAX_FREE_SLOT_WEEK_OFFSET,
  addDaysToCalendarDate,
  resolveFreeSlotWeekOffset,
} from '@/lib/admin/mms-helpers.mjs';
import { ONBOARDING_PAYMENT_EXPLANATION } from '@/lib/admin/onboarding-message-helpers.mjs';
import { requiresEarlyStripeTimingReview } from '@/lib/admin/planning-helpers.mjs';

// Onboarding without a Soundslice URL looks finished but leaves the student with
// no practice link, and it is only noticed later when someone goes looking for
// it. Blocking at the point of the mistake is cheaper than the follow-up.
const SOUNDSLICE_FIELD_ID = 'onboard-soundslice-url';
const PAYMENT_TERMS_CHECK_ID = 'onboard-payment-terms-explained';
const WHATSAPP_GROUP_CHECK_ID = 'onboard-lesson-whatsapp-group-ready';
const BLOCKER_FIELD_IDS = {
  soundsliceUrl: SOUNDSLICE_FIELD_ID,
  paymentTermsExplained: PAYMENT_TERMS_CHECK_ID,
  lessonWhatsappGroupReady: WHATSAPP_GROUP_CHECK_ID,
};

function deriveWeekday(dateValue) {
  if (!dateValue) return '';
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-GB', { weekday: 'long' });
}

function formatHumanDate(dateValue) {
  if (!dateValue) return '';
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function describeFreeSlotBump({ anchorDate, anchorWeekday, weekOffset, reason }, lessonDate) {
  if (reason === 'ok' && weekOffset === 0) {
    return 'Starting on the first free week. This slot and every week after it are removed once the first lesson is confirmed.';
  }

  if (reason === 'ok') {
    const weeks = `${weekOffset} week${weekOffset === 1 ? '' : 's'}`;
    return `Starting ${formatHumanDate(lessonDate)} — ${weeks} later. The ${weeks} free before it go with the slot, so nobody else is offered this time.`;
  }

  if (reason === 'before_slot') {
    return `${formatHumanDate(lessonDate)} is before the slot's first free week. Use the week buttons to move forward from ${formatHumanDate(anchorDate)}.`;
  }

  if (reason === 'too_far') {
    return `That is more than ${MAX_FREE_SLOT_WEEK_OFFSET} weeks after the slot. Onboard without the slot and remove it in MMS instead.`;
  }

  return `${formatHumanDate(lessonDate) || 'That date'} is not a ${anchorWeekday}. The first lesson has to be a whole number of weeks after ${formatHumanDate(anchorDate)} — use the week buttons.`;
}

function normalizeTimeValue(value) {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return trimmed;
  }

  const [, hours, minutes] = match;
  return `${hours}:${minutes}`;
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Input({ invalid = false, ...props }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition ${
        invalid
          ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-200'
          : 'border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200'
      }`}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
    />
  );
}

function Checkbox({ checked, onChange, ...props }) {
  return (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
    />
  );
}

function statusClasses(status) {
  if (status === 'complete') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (status === 'pending') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-red-200 bg-red-50 text-red-900';
}

function stepResultClasses(status) {
  if (status === 'succeeded' || status === 'skipped') return 'border-emerald-200 bg-emerald-50';
  if (status === 'failed') return 'border-red-200 bg-red-50';
  return 'border-slate-200 bg-slate-50';
}

function onboardingStepIsReady(step) {
  return step?.status === 'succeeded' || step?.status === 'skipped';
}

function OutcomeTick({ children, detail = '' }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white"
      >
        ✓
      </span>
      <div>
        <p className="font-semibold text-slate-900">{children}</p>
        {detail ? <p className="mt-0.5 text-sm text-slate-600">{detail}</p> : null}
      </div>
    </li>
  );
}

export default function AdminOnboardForm({ initialData, tutorOptions, initialDuplicateState = null, waitingStudents = [] }) {
  const [form, setForm] = useState(initialData);
  const [result, setResult] = useState(null);
  const [errorState, setErrorState] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [validationField, setValidationField] = useState('');
  const [isPending, startTransition] = useTransition();

  const filteredTutors = useMemo(() => {
    const instrument = (form.instrument || '').toLowerCase();
    return tutorOptions.filter((tutor) => !instrument || tutor.instruments.includes(instrument));
  }, [form.instrument, tutorOptions]);
  const siblingCandidates = useMemo(() => {
    const primaryEmail = `${form.parentEmail || ''}`.trim().toLowerCase();
    return waitingStudents
      .filter((student) => student.mmsId !== form.mmsId)
      .sort((a, b) => {
        const aMatch = primaryEmail && `${a.parentEmail || ''}`.trim().toLowerCase() === primaryEmail ? 0 : 1;
        const bMatch = primaryEmail && `${b.parentEmail || ''}`.trim().toLowerCase() === primaryEmail ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [form.mmsId, form.parentEmail, waitingStudents]);
  const selectedSibling = useMemo(
    () => siblingCandidates.find((student) => student.mmsId === form.secondStudentMmsId) || null,
    [form.secondStudentMmsId, siblingCandidates],
  );
  const selectedTutor = useMemo(
    () => tutorOptions.find((tutor) => tutor.shortName === form.tutorShortName) || null,
    [form.tutorShortName, tutorOptions],
  );
  const completionBlockers = useMemo(() => findOnboardingCompletionBlockers(form), [form]);
  const needsEarlyStripeReview = useMemo(
    () => requiresEarlyStripeTimingReview(form.lessonDate),
    [form.lessonDate],
  );
  const contactLabel = form.isAdult
    ? `${form.studentFirstName || ''} ${form.studentLastName || ''}`.trim() || 'the student'
    : `${form.parentFirstName || ''} ${form.parentLastName || ''}`.trim() || 'the parent/student contact';
  const tutorLabel = selectedTutor?.fullName || 'the assigned tutor';

  const derivedWeekday = useMemo(() => deriveWeekday(form.lessonDate), [form.lessonDate]);
  const freeSlotBump = useMemo(() => {
    if (!form.freeEventId || !form.freeEventDate) return null;

    const { weekOffset, reason } = resolveFreeSlotWeekOffset({
      slotDate: form.freeEventDate,
      lessonDate: form.lessonDate,
    });

    return {
      anchorDate: form.freeEventDate,
      anchorWeekday: deriveWeekday(form.freeEventDate),
      weekOffset,
      reason,
    };
  }, [form.freeEventDate, form.freeEventId, form.lessonDate]);
  const initialWarnings = initialDuplicateState?.warnings || [];
  const resultCoreIsComplete = result?.completionStatus?.canonicalRecord?.status === 'complete'
    && onboardingStepIsReady(result?.steps?.mmsActivation)
    && onboardingStepIsReady(result?.steps?.mmsBillingProfile)
    && onboardingStepIsReady(result?.steps?.mmsFirstLesson);
  const resultAttentionItems = result ? [
    result.lessonWarning ? {
      key: 'lesson',
      title: 'Finish the MMS setup',
      detail: 'The First Chord record is saved, but the MMS lesson setup did not finish.',
    } : null,
    result.freeSlotWarning ? {
      key: 'free-slot',
      title: 'Remove the old Free slot in MMS',
      detail: 'The new lesson is already booked. Remove only the old Free slot — do not recreate the lesson.',
    } : null,
    result.waitingCloseoutWarning ? {
      key: 'waiting',
      title: 'Check the waiting list',
      detail: 'The waiting record could not be closed automatically.',
    } : null,
    result.firstLessonCheckinWarning ? {
      key: 'check-in',
      title: 'Add the first-lesson check-in',
      detail: 'The Planning reminder could not be added automatically.',
    } : null,
    result.earlyStripeTimingReviewWarning ? {
      key: 'stripe-timing',
      title: 'Add the early Stripe timing check',
      detail: 'The Planning review could not be added automatically.',
    } : null,
    result.notesPrivacyFollowUpWarning ? {
      key: 'notes-privacy',
      title: 'Queue the notes-privacy follow-up',
      detail: 'The notes-privacy follow-up could not be prepared automatically.',
    } : null,
  ].filter(Boolean) : [];
  const resultHasAttention = resultAttentionItems.length > 0 || Boolean(result?.duplicateWarnings?.length);

  function updateField(key, value) {
    setForm((current) => ({
      ...current,
      [key]: key === 'lessonTime' ? normalizeTimeValue(value) : value,
      humanChecks: {
        ...current.humanChecks,
        ...([
          'studentFirstName',
          'studentLastName',
          'parentFirstName',
          'parentLastName',
          'isAdult',
          'secondStudentMmsId',
          'tutorShortName',
        ].includes(key) ? { lessonWhatsappGroupReady: false } : {}),
        ...(key === 'lessonDate' ? { paymentTermsExplained: false } : {}),
      },
    }));
  }

  function updateHumanCheck(key, checked) {
    setValidationError('');
    setValidationField('');
    setForm((current) => ({
      ...current,
      humanChecks: {
        ...current.humanChecks,
        [key]: checked,
      },
    }));
  }

  function bumpFreeSlotWeeks(delta) {
    setForm((current) => {
      if (!current.freeEventDate) return current;

      const { weekOffset } = resolveFreeSlotWeekOffset({
        slotDate: current.freeEventDate,
        lessonDate: current.lessonDate,
      });
      // An off-grid date has no offset, so a bump snaps back onto the slot's own
      // weekly grid rather than leaving the form in a state the server refuses.
      const nextOffset = Math.min(
        Math.max((weekOffset ?? 0) + delta, 0),
        MAX_FREE_SLOT_WEEK_OFFSET,
      );

      return {
        ...current,
        lessonDate: addDaysToCalendarDate(current.freeEventDate, nextOffset * 7),
      };
    });
  }

  function clearFreeSlot() {
    setForm((current) => ({ ...current, freeEventId: '', freeEventDate: '' }));
  }

  function updateLessonType(value) {
    setForm((current) => ({
      ...current,
      lessonType: value,
      lessonLength: value === 'sibling_group' ? '45' : current.lessonLength,
      secondStudentMmsId: value === 'sibling_group' ? current.secondStudentMmsId : '',
      humanChecks: {
        ...current.humanChecks,
        lessonWhatsappGroupReady: false,
      },
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setErrorState(null);
    setValidationError('');
    setValidationField('');

    const blockers = findOnboardingCompletionBlockers(form);
    if (blockers.length) {
      setValidationError(blockers[0].message);
      setValidationField(blockers[0].field);
      const field = document.getElementById(BLOCKER_FIELD_IDS[blockers[0].field]);
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field?.focus({ preventScroll: true });
      return;
    }

    setResult(null);

    startTransition(async () => {
      const response = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const payload = await response.json();
      if (!response.ok) {
        setErrorState({
          message: payload.error || 'Onboarding failed',
          steps: payload.steps || null,
          recoveryGuidance: payload.recoveryGuidance || [],
          duplicateWarnings: payload.duplicateWarnings || [],
        });
        return;
      }

      setResult(payload);
    });
  }

  return (
    <div className="space-y-8">
      <form className="space-y-8" onSubmit={handleSubmit}>
        {initialWarnings.length > 0 ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Existing record warning</p>
            <ul className="mt-2 list-disc pl-5">
              {initialWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {form.freeEventId && freeSlotBump ? (
          <section
            className={`rounded-2xl border p-4 text-sm ${
              freeSlotBump.reason === 'ok'
                ? 'border-sky-200 bg-sky-50 text-sky-950'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold">
                  Free slot: {freeSlotBump.anchorWeekday} {normalizeTimeValue(form.lessonTime)} · first free{' '}
                  {formatHumanDate(freeSlotBump.anchorDate)}
                </p>
                <p className="mt-1">{describeFreeSlotBump(freeSlotBump, form.lessonDate)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => bumpFreeSlotWeeks(-1)}
                  disabled={freeSlotBump.weekOffset === 0}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  − week
                </button>
                <button
                  type="button"
                  onClick={() => bumpFreeSlotWeeks(1)}
                  disabled={freeSlotBump.weekOffset === MAX_FREE_SLOT_WEEK_OFFSET}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  + week
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={clearFreeSlot}
              className="mt-3 text-xs underline underline-offset-2 hover:no-underline"
            >
              Onboard without this slot
            </button>
          </section>
        ) : form.freeEventId ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            The selected MMS Free event will be checked again and removed only after the first lesson is confirmed.
          </section>
        ) : null}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Student + parent details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="MMS ID">
                <Input value={form.mmsId} readOnly />
              </Field>
              <Field label="Lesson type" hint="Two student records, one shared group lesson, one family payment message.">
                <Select value={form.lessonType || 'individual'} onChange={(e) => updateLessonType(e.target.value)}>
                  <option value="individual">Individual</option>
                  <option value="sibling_group">Sibling group</option>
                </Select>
              </Field>
              <Field label="Is adult?">
                <Select value={form.isAdult ? 'yes' : 'no'} onChange={(e) => updateField('isAdult', e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </Select>
              </Field>
              <Field label="Student first name">
                <Input value={form.studentFirstName} onChange={(e) => updateField('studentFirstName', e.target.value)} />
              </Field>
              <Field label="Student last name">
                <Input value={form.studentLastName} onChange={(e) => updateField('studentLastName', e.target.value)} />
              </Field>
              <Field label="Parent first name">
                <Input value={form.parentFirstName} onChange={(e) => updateField('parentFirstName', e.target.value)} />
              </Field>
              <Field label="Parent last name">
                <Input value={form.parentLastName} onChange={(e) => updateField('parentLastName', e.target.value)} />
              </Field>
              <Field label="Parent / contact email">
                <Input value={form.parentEmail} onChange={(e) => updateField('parentEmail', e.target.value)} />
              </Field>
              <Field label="Student email">
                <Input value={form.studentEmail} onChange={(e) => updateField('studentEmail', e.target.value)} />
              </Field>
              <Field label="Contact number" hint="Prefilled from student phone, else parent phone">
                <Input value={form.contactNumber} onChange={(e) => updateField('contactNumber', e.target.value)} />
              </Field>
              <Field label="Age">
                <Input value={form.age} onChange={(e) => updateField('age', e.target.value)} />
              </Field>
              {form.lessonType === 'sibling_group' ? (
                <div className="sm:col-span-2">
                  <Field label="Second student from MMS" hint="Pick the sibling. Two records, one shared lesson, one family billing flow.">
                    <Select required value={form.secondStudentMmsId || ''} onChange={(e) => updateField('secondStudentMmsId', e.target.value)}>
                      <option value="">Select second student</option>
                      {siblingCandidates.map((student) => (
                        <option key={student.mmsId} value={student.mmsId}>
                          {student.fullName} ({student.parentName || student.parentEmail || student.mmsId})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : null}
            </div>
            {form.lessonType === 'sibling_group' && selectedSibling ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Second student summary</p>
                <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>Name: {selectedSibling.fullName}</p>
                  <p>MMS ID: {selectedSibling.mmsId}</p>
                  <p>Parent: {selectedSibling.parentName || '—'}</p>
                  <p>Parent email: {selectedSibling.parentEmail || '—'}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Lesson + portal setup</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instrument">
                <Input value={form.instrument} onChange={(e) => updateField('instrument', e.target.value)} />
              </Field>
              <Field label="Lesson length">
                <Select value={form.lessonLength} onChange={(e) => updateField('lessonLength', e.target.value)}>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </Select>
              </Field>
              <Field label="Lesson day" hint="Derived automatically from the selected date">
                <Input value={derivedWeekday} readOnly />
              </Field>
              <Field label="Lesson time">
                <Input
                  type="time"
                  step="60"
                  required
                  value={normalizeTimeValue(form.lessonTime)}
                  onChange={(e) => updateField('lessonTime', e.target.value)}
                />
              </Field>
              <Field label="First lesson date">
                <Input type="date" required value={form.lessonDate} onChange={(e) => updateField('lessonDate', e.target.value)} />
              </Field>
              <Field label="Recurring lesson">
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Checkbox checked={Boolean(form.isRecurring)} onChange={(e) => updateField('isRecurring', e.target.checked)} />
                  <span className="text-sm text-slate-700">Create an ongoing weekly lesson series</span>
                </div>
              </Field>
              <Field label="Tutor">
                <Select required value={form.tutorShortName} onChange={(e) => updateField('tutorShortName', e.target.value)}>
                  <option value="">Select tutor</option>
                  {filteredTutors.map((tutor) => (
                    <option key={tutor.shortName} value={tutor.shortName}>
                      {tutor.shortName} ({tutor.fullName})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Theta username">
                <Input value={form.thetaUsername} onChange={(e) => updateField('thetaUsername', e.target.value)} />
              </Field>
              <Field label="Soundslice URL" hint="Required to complete onboarding.">
                <Input
                  id={SOUNDSLICE_FIELD_ID}
                  invalid={validationField === 'soundsliceUrl'}
                  value={form.soundsliceUrl}
                  onChange={(e) => {
                    if (validationField === 'soundsliceUrl') {
                      setValidationError('');
                      setValidationField('');
                    }
                    updateField('soundsliceUrl', e.target.value);
                  }}
                />
              </Field>
              <Field label="Soundslice code">
                <Input value={form.soundsliceCode} onChange={(e) => updateField('soundsliceCode', e.target.value)} />
              </Field>
              <Field label="Experience level">
                <Select value={form.experienceLevel} onChange={(e) => updateField('experienceLevel', e.target.value)}>
                  <option value="1">1 - Beginner</option>
                  <option value="2">2 - Some experience</option>
                  <option value="3">3 - Intermediate</option>
                </Select>
              </Field>
            </div>
            <Field label="Interests / genres / songs">
              <TextArea value={form.interests} onChange={(e) => updateField('interests', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-lg font-semibold text-slate-900">MMS sign-up note</h3>
            {form.rawNote ? <CopyButton text={form.rawNote} title="Copy the MMS sign-up note" /> : null}
          </div>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {form.rawNote || 'No MMS note available'}
          </pre>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-emerald-950">Ready to onboard?</h3>
          <p className="mt-1 text-sm text-emerald-900">
            Two quick human checks before the system writes begin.
          </p>
          <div className="mt-4 space-y-3">
            <label htmlFor={PAYMENT_TERMS_CHECK_ID} className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-slate-800">
              <Checkbox
                id={PAYMENT_TERMS_CHECK_ID}
                checked={form.humanChecks?.paymentTermsExplained === true}
                onChange={(event) => updateHumanCheck('paymentTermsExplained', event.target.checked)}
              />
              <span>
                <span className="font-semibold">Payment terms explained on the welcome call</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">{ONBOARDING_PAYMENT_EXPLANATION}</span>
              </span>
            </label>
            <label htmlFor={WHATSAPP_GROUP_CHECK_ID} className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-slate-800">
              <Checkbox
                id={WHATSAPP_GROUP_CHECK_ID}
                checked={form.humanChecks?.lessonWhatsappGroupReady === true}
                onChange={(event) => updateHumanCheck('lessonWhatsappGroupReady', event.target.checked)}
              />
              <span>
                <span className="font-semibold">Lesson WhatsApp group is ready</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">
                  Includes {contactLabel}, assigned tutor {tutorLabel}, Finn, Tom and Fennella. One person may cover two roles.
                </span>
              </span>
            </label>
          </div>
          {needsEarlyStripeReview ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              This first lesson is at least a week away. The Stripe link starts weekly billing when it is used, so an early-timing check will be added to Planning before the first renewal.
            </p>
          ) : null}
        </section>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending || completionBlockers.length > 0}
            title={completionBlockers.map((blocker) => blocker.message).join(' ')}
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isPending
              ? 'Onboarding…'
              : completionBlockers.length > 0
                ? 'Finish setup checks first'
                : 'Complete onboarding'}
          </button>
          {!isPending && completionBlockers.length > 0 ? (
            <p className="text-sm text-slate-600">
              {completionBlockers.length} item{completionBlockers.length === 1 ? '' : 's'} left.
            </p>
          ) : null}
          {validationError ? (
            <p role="alert" className="text-sm font-medium text-red-700">{validationError}</p>
          ) : null}
          {errorState ? <p className="text-sm text-red-700">{errorState.message}</p> : null}
        </div>
      </form>

      {errorState ? (
        <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50 p-6">
          <h3 className="text-lg font-semibold text-red-900">Onboarding needs attention</h3>
          {errorState.duplicateWarnings?.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Duplicate warnings</p>
              <ul className="mt-2 list-disc pl-5">
                {errorState.duplicateWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {errorState.steps ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(errorState.steps).map(([key, step]) => (
                <div key={key} className="rounded-xl border border-red-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{key}</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{step.status}</p>
                  {step.detail ? <p className="mt-2 text-sm text-slate-700">{step.detail}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          {errorState.recoveryGuidance?.length ? (
            <div className="rounded-xl border border-red-200 bg-white p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Recovery guidance</p>
              <ul className="mt-2 list-disc pl-5">
                {errorState.recoveryGuidance.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className={`space-y-4 rounded-2xl border p-6 ${
          resultCoreIsComplete
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-200 bg-amber-50'
        }`}>
          <div>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 items-center justify-center rounded-full text-lg font-bold text-white ${
                  resultCoreIsComplete ? 'bg-emerald-700' : 'bg-amber-600'
                }`}
              >
                {resultCoreIsComplete ? '✓' : '!'}
              </span>
              <h3 className={`text-xl font-semibold ${resultCoreIsComplete ? 'text-emerald-950' : 'text-amber-950'}`}>
                {resultCoreIsComplete ? 'System setup complete' : 'Onboarding needs attention'}
              </h3>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              {resultCoreIsComplete
                ? resultHasAttention
                  ? 'The student is set up. Check the follow-up below, then send the two messages.'
                  : 'The student is set up. Send the two messages below.'
                : 'The finished steps have been saved. Complete the item below rather than starting again.'}
            </p>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-white px-4 py-1">
            <ul className="divide-y divide-slate-100">
              {result.completionStatus?.canonicalRecord?.status === 'complete' ? (
                <OutcomeTick detail={`The First Chord ${result.siblingGroup ? 'student records are' : 'student record is'} ready.`}>
                  {result.siblingGroup ? 'Students added' : 'Student added'}
                </OutcomeTick>
              ) : null}
              {onboardingStepIsReady(result.steps?.mmsActivation) && onboardingStepIsReady(result.steps?.mmsBillingProfile) ? (
                <OutcomeTick detail="The student is active and their billing profile is ready.">MMS setup ready</OutcomeTick>
              ) : null}
              {onboardingStepIsReady(result.steps?.mmsFirstLesson) ? (
                <OutcomeTick detail={`${derivedWeekday || 'Lesson day'} at ${form.lessonTime || 'the agreed time'}.`}>
                  First lesson booked
                </OutcomeTick>
              ) : null}
              {form.freeEventId && result.freeSlot ? (
                <OutcomeTick
                  detail={
                    result.freeSlot.alreadyAbsent
                      ? 'The old slot was already clear.'
                      : result.freeSlot.weekOffset
                        ? `The old slot and its future placeholders were removed, including the ${result.freeSlot.weekOffset} free week${result.freeSlot.weekOffset === 1 ? '' : 's'} before the first lesson.`
                        : 'The old slot and its future placeholders were removed.'
                  }
                >
                  Free slot cleared
                </OutcomeTick>
              ) : null}
              {result.waitingCloseout?.length ? (
                <OutcomeTick>Waiting list closed</OutcomeTick>
              ) : null}
              {result.firstLessonCheckin ? (
                <OutcomeTick detail={result.firstLessonCheckin.targetDate ? `Added to Planning for ${formatHumanDate(result.firstLessonCheckin.targetDate)}.` : 'Added to Planning.'}>
                  First-lesson check-in added
                </OutcomeTick>
              ) : null}
              {result.earlyStripeTimingReview ? (
                <OutcomeTick detail={result.earlyStripeTimingReview.targetDate ? `Added to Planning for ${formatHumanDate(result.earlyStripeTimingReview.targetDate)}.` : 'Added to Planning.'}>
                  Early Stripe timing check added
                </OutcomeTick>
              ) : null}
              {result.notesPrivacyFollowUp?.length ? (
                <OutcomeTick>Notes-privacy follow-up ready</OutcomeTick>
              ) : null}
            </ul>
          </div>

          {resultHasAttention ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <p className="font-semibold">Needs a quick check</p>
              {resultAttentionItems.length ? (
                <ul className="mt-3 space-y-3">
                  {resultAttentionItems.map((item) => (
                    <li key={item.key} className="flex gap-3">
                      <span aria-hidden="true" className="font-bold">!</span>
                      <div>
                        <p className="font-semibold">{item.title}</p>
                        <p className="mt-0.5 text-sm text-amber-900">{item.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.duplicateWarnings?.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {result.duplicateWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result.notesPrivacyFollowUp?.length ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              <p className="font-semibold">Student notes privacy is ready as a follow-up</p>
              <p className="mt-2">
                Onboarding is complete. Add the memorable code to WhatsApp and explain the change before activating the notes lock.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.notesPrivacyFollowUp.map((item) => (
                  <Link
                    key={item.studentMmsId}
                    href={`/admin/workflows/student-notes-access?student=${encodeURIComponent(item.studentMmsId)}`}
                    className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Set up {item.studentName || 'student'}’s notes privacy
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
              Technical details
            </summary>
            <div className="space-y-4 border-t border-slate-200 p-4">
              {result.steps ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(result.steps).map(([key, step]) => (
                    <div key={key} className={`rounded-xl border p-4 ${stepResultClasses(step.status)}`}>
                      <p className="text-xs uppercase tracking-wide text-slate-500">{key}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{step.status}</p>
                      {step.detail ? <p className="mt-2 text-sm text-slate-700">{step.detail}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {result.completionStatus ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-900">System status</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(result.completionStatus).map(([key, item]) => (
                      <div key={key} className={`rounded-xl border p-4 ${statusClasses(item.status)}`}>
                        <p className="text-xs uppercase tracking-wide opacity-70">{key}</p>
                        <p className="mt-2 text-sm font-semibold">{item.label}</p>
                        <p className="mt-2 text-sm">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">FC Student ID</p>
                  <p className="mt-2 break-words text-sm font-medium text-slate-900">{result.fcStudentId}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Friendly URL</p>
                  <p className="mt-2 break-words text-sm font-medium text-slate-900">/{result.friendlyUrl}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Registry action</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{result.registryAction || 'Appended new entry'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Lesson</p>
                  <p className="mt-2 break-words text-sm font-medium text-slate-900">{result.lessonId ? `Created (${result.lessonId})` : 'Not created automatically'}</p>
                </div>
              </div>
              {resultAttentionItems.length ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Provider messages</p>
                  <ul className="mt-2 space-y-2 font-mono text-xs break-words">
                    {result.lessonWarning ? <li>{result.lessonWarning}</li> : null}
                    {result.freeSlotWarning ? <li>{result.freeSlotWarning}</li> : null}
                    {result.waitingCloseoutWarning ? <li>{result.waitingCloseoutWarning}</li> : null}
                    {result.firstLessonCheckinWarning ? <li>{result.firstLessonCheckinWarning}</li> : null}
                    {result.earlyStripeTimingReviewWarning ? <li>{result.earlyStripeTimingReviewWarning}</li> : null}
                    {result.notesPrivacyFollowUpWarning ? <li>{result.notesPrivacyFollowUpWarning}</li> : null}
                  </ul>
                </div>
              ) : null}
              {result.recoveryGuidance?.length ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Recovery guidance</p>
                  <ul className="mt-2 list-disc pl-5">
                    {result.recoveryGuidance.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900">Send these now</p>
            <p className="mt-1 text-sm text-slate-700">Copy each message into the lesson WhatsApp group.</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-slate-900">Welcome message</p>
              <CopyButton text={result.messages.welcomeMessage} title="Copy the welcome message" />
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{result.messages.welcomeMessage}</pre>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-slate-900">Soundslice follow-up</p>
              <CopyButton text={result.messages.soundsliceFollowup} title="Copy the Soundslice follow-up" />
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{result.messages.soundsliceFollowup}</pre>
          </div>
        </section>
      ) : null}
    </div>
  );
}
