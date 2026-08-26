import AdminOnboardForm from '@/components/admin/AdminOnboardForm';
import { normaliseExperienceLevel, parseInstrumentList } from '@/lib/admin/fc';
import { resolveOnboardingInstrument, tutorTeachesInstrument } from '@/lib/admin/onboarding-helpers.mjs';
import { getStudentDetails, getWaitingStudents } from '@/lib/admin/mms';
import { getOnboardingDuplicateState } from '@/lib/admin/onboarding';
import { getActiveTutorOptions } from '@/lib/admin/tutors';

const VALID_LESSON_LENGTHS = new Set(['30', '45', '60']);

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function normaliseQueryValue(value) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function getRequestedTutor(tutorOptions = [], { teacherId = '', tutorName = '' } = {}) {
  const normalisedName = tutorName.trim().toLowerCase();
  return tutorOptions.find((tutor) => (
    teacherId && tutor.teacherId === teacherId
  )) || tutorOptions.find((tutor) => (
    normalisedName && tutor.fullName.trim().toLowerCase() === normalisedName
  )) || null;
}

function getInitialLessonLength(value) {
  const lessonLength = `${value || ''}`;
  return VALID_LESSON_LENGTHS.has(lessonLength) ? lessonLength : '30';
}

export default async function AdminOnboardPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const mmsId = normaliseQueryValue(resolvedSearchParams?.mmsId);
  const requestedLessonDate = normaliseQueryValue(resolvedSearchParams?.lessonDate);
  const requestedFreeEventId = normaliseQueryValue(resolvedSearchParams?.freeEventId);
  const requestedLessonTime = normaliseQueryValue(resolvedSearchParams?.lessonTime);
  const requestedLessonLength = normaliseQueryValue(resolvedSearchParams?.lessonLength);
  const requestedTeacherId = normaliseQueryValue(resolvedSearchParams?.teacherId);
  const requestedTutorName = normaliseQueryValue(resolvedSearchParams?.tutorName);
  const requestedInstrument = normaliseQueryValue(resolvedSearchParams?.instrument);
  const waitingStudents = await getWaitingStudents();
  const selectedStudent = waitingStudents.find((student) => student.mmsId === mmsId) || null;
  const details = mmsId ? await getStudentDetails(mmsId) : null;
  const parsed = details?.parsed || {};
  const noteInstruments = parseInstrumentList(parsed.instrument || '');
  // The whole active roster, not the slice for one instrument: the form's
  // instrument dropdown re-filters it, so pre-filtering here would leave the
  // tutor list empty the moment the instrument is corrected.
  const tutorOptions = await getActiveTutorOptions();
  const requestedTutor = getRequestedTutor(tutorOptions, {
    teacherId: requestedTeacherId,
    tutorName: requestedTutorName,
  });
  const instrument = resolveOnboardingInstrument({ requestedInstrument, noteInstruments, requestedTutor });
  const initialTutor = requestedTutor
    || tutorOptions.find((tutor) => tutorTeachesInstrument(tutor, instrument))
    || null;
  const duplicateState = mmsId && initialTutor
    ? await getOnboardingDuplicateState({
        mmsId,
        tutorFullName: initialTutor.fullName,
        tutorShortName: initialTutor.shortName,
      })
    : null;
  const initialData = details
    ? {
        mmsId,
        studentFirstName: details.firstName || selectedStudent?.firstName || '',
        studentLastName: details.lastName || selectedStudent?.lastName || '',
        parentFirstName: details.parentFirstName || selectedStudent?.parentFirstName || '',
        parentLastName: details.parentLastName || selectedStudent?.parentLastName || '',
        parentEmail: details.parentEmail || selectedStudent?.parentEmail || '',
        studentEmail: details.studentEmail || '',
        contactNumber: details.studentTelephone || details.parentTelephone || '',
        isAdult: Number(parsed.age || 0) >= 19,
        age: parsed.age || '',
        instrument,
        // What the sign-up note actually asked for, so a multi-instrument note is
        // visible at the point the instrument is chosen.
        noteInstruments,
        lessonLength: getInitialLessonLength(requestedLessonLength),
        lessonType: 'individual',
        secondStudentMmsId: '',
        lessonDay: '',
        lessonTime: requestedLessonTime,
        lessonDate: requestedLessonDate,
        freeEventId: requestedFreeEventId,
        // The pinned Free event is one occurrence of a weekly slot, so the date it
        // arrived with is the anchor every week bump is measured from.
        freeEventDate: requestedFreeEventId ? requestedLessonDate : '',
        isRecurring: true,
        tutorShortName: initialTutor?.shortName || '',
        thetaUsername: `${(details.firstName || '').toLowerCase()}${(details.lastName || '').toLowerCase()}fc`.replace(/[^a-z0-9]/g, ''),
        soundsliceUrl: '',
        soundsliceCode: '',
        experienceLevel:
          normaliseExperienceLevel(parsed.experience) === 'at an intermediate level'
            ? '3'
            : normaliseExperienceLevel(parsed.experience) === 'has some experience'
              ? '2'
              : '1',
        interests: [parsed.genres, parsed.songs].filter(Boolean).join(' / '),
        rawNote: details.note || '',
        humanChecks: {
          paymentTermsExplained: false,
          lessonWhatsappGroupReady: false,
        },
      }
    : null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-2xl font-semibold text-slate-900">Onboarding</h2>
        <p className="mt-2 text-sm text-slate-600">
          Complete the student record, MMS setup, first lesson, and waiting-list closeout in one recoverable flow.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Selected waiting-list student</h3>
        {selectedStudent ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Student</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{selectedStudent.fullName}</p>
              <p className="mt-1 text-xs text-slate-500">{selectedStudent.mmsId}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Parent</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{selectedStudent.parentName || '—'}</p>
              <p className="mt-1 text-xs text-slate-500">{selectedStudent.parentEmail || '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Date added</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{formatDate(selectedStudent.dateStarted)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Waiting age</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {selectedStudent.ageInDays == null ? '—' : `${selectedStudent.ageInDays} days`}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            No waiting-list student selected yet. Start from <code>/admin/waiting</code> and click <strong>Onboard</strong>.
          </p>
        )}
      </section>

      {initialData ? (
        <AdminOnboardForm
          initialData={initialData}
          tutorOptions={tutorOptions}
          initialDuplicateState={duplicateState}
          waitingStudents={waitingStudents}
        />
      ) : null}
    </div>
  );
}
