/** @fileoverview Apply reviewed substitute-tutor changes to exact saved MMS occurrences with read-back and retry. */
import { randomUUID } from 'node:crypto';
import { buildMmsCoverTargets, validateMmsCoverEvent } from './tutor-absence-mms-cover-helpers.mjs';

export function createMmsCoverApplier({
  loadState, loadTutors, readEvent, writeEvent, appendEvent, saveState,
}) {
  return async function applyMmsCover({ absenceId, expectedUpdatedAt, actorEmail }) {
    const state = await loadState(absenceId);
    if (!state || state.updatedAt !== expectedUpdatedAt) {
      throw Object.assign(new Error('This cover decision changed. Refresh the page before updating MMS.'), { status: 409 });
    }
    const tutors = await loadTutors();
    const absentTutor = tutors.find((tutor) => tutor.shortName === state.tutorShortName);
    const coverTutor = tutors.find((tutor) => tutor.shortName === state.coverTutorShortName);
    const targets = buildMmsCoverTargets({ state, absentTutor, coverTutor });

    // Preflight every occurrence so a known conflict cannot create a partial day.
    const checked = [];
    for (const target of targets) {
      const event = await readEvent(target.eventId);
      const status = validateMmsCoverEvent({ event, target, absentTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId });
      checked.push({ target, status });
    }

    const results = [];
    for (const { target, status } of checked) {
      if (status === 'already_updated') {
        results.push({ eventId: target.eventId, status });
        continue;
      }
      try {
        // Re-read immediately before each PUT; a tutor or lesson may have
        // changed while an earlier occurrence was being updated.
        const before = await readEvent(target.eventId);
        const current = validateMmsCoverEvent({ event: before, target, absentTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId });
        if (current === 'already_updated') {
          results.push({ eventId: target.eventId, status: current });
          continue;
        }
        await appendEvent({
          eventId: `evt_${randomUUID()}`,
          occurredAt: new Date().toISOString(), actorEmail,
          entityType: 'mms_calendar_event', entityId: target.eventId,
          eventType: 'tutor_absence_substitute_attempted',
          payloadJson: JSON.stringify({ absenceId, originalTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId, studentIds: target.studentIds }),
        });
        await writeEvent({ event: before, teacherId: coverTutor.teacherId });
        const after = await readEvent(target.eventId);
        if (validateMmsCoverEvent({ event: after, target, absentTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId }) !== 'already_updated') {
          throw new Error('MMS did not confirm the substitute tutor after the update.');
        }
        await appendEvent({
          eventId: `evt_${randomUUID()}`,
          occurredAt: new Date().toISOString(), actorEmail,
          entityType: 'mms_calendar_event', entityId: target.eventId,
          eventType: 'tutor_absence_substitute_applied',
          payloadJson: JSON.stringify({ absenceId, originalTeacherId: absentTutor.teacherId, coverTeacherId: coverTutor.teacherId, studentIds: target.studentIds }),
        });
        results.push({ eventId: target.eventId, status: 'updated' });
      } catch (error) {
        results.push({ eventId: target.eventId, status: 'failed', error: error.message || 'MMS update failed' });
        break;
      }
    }
    if (results.some((result) => result.status === 'failed')) {
      return { complete: false, results, total: targets.length };
    }
    // Do not overwrite a newer human save. The MMS edits still stand and a
    // retry can verify them without making another PUT.
    const latest = await loadState(absenceId);
    if (latest?.updatedAt !== expectedUpdatedAt) {
      return { complete: false, results, total: targets.length, error: 'MMS was updated, but the saved cover decision changed. Refresh and review before marking the calendar complete.' };
    }
    await saveState({
      ...latest,
      messageState: { ...latest.messageState, __workflow: { ...latest.messageState.__workflow, calendarUpdated: true } },
    }, actorEmail);
    return { complete: true, results, total: targets.length };
  };
}
