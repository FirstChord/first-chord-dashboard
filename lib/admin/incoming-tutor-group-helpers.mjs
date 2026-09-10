/** @fileoverview Pure tutor-group discovery and confirmation rules for the incoming WhatsApp inbox. */
function normalise(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Exact name before "First Chord"; emoji disappear during normalisation.
// Shared first names remain proposals with no selected tutor.
export function matchWhatsappTutorGroup(chatName = '', tutors = []) {
  const name = normalise(chatName).match(/^(.+?) first chord$/u)?.[1] || '';
  if (!name) return null;
  const candidates = tutors.filter(tutor => [
    tutor.shortName, tutor.fullName, String(tutor.fullName || '').split(' ')[0],
  ].some(alias => normalise(alias) === name));
  if (!candidates.length) return null;
  const tutor = candidates.length === 1 ? candidates[0] : null;
  return {
    groupType: 'tutor',
    matchedTutorId: tutor?.shortName || '',
    tutorName: tutor?.fullName || '',
    matchConfidence: tutor ? 'high' : 'none',
    matchReasons: tutor
      ? 'group title matches a tutor and First Chord — confirm before capture'
      : 'group title matches more than one tutor — select the tutor manually',
  };
}

export function buildConfirmedTutorGroupFields(matchedTutorId = '', tutors = []) {
  const tutor = tutors.find(entry => entry.shortName === String(matchedTutorId || '').trim());
  if (!tutor) throw new Error('A tutor from the roster is required to confirm a tutor group');
  return {
    groupType: 'tutor',
    matchedTutorId: tutor.shortName,
    tutorName: tutor.fullName,
    matchedMmsId: '', matchedFcId: '', matchedStudentName: '',
    additionalMmsIds: '', parentName: '', parentPhone: '',
    instrument: (tutor.instruments || []).join(', '),
  };
}

// Legacy groups have no type and retain student-group behaviour.
export function isConfirmedCaptureGroup(group = {}) {
  return group.status === 'confirmed' && Boolean(group.chatId)
    && (group.groupType === 'tutor' ? Boolean(group.matchedTutorId)
      : !group.groupType || group.groupType === 'student');
}
