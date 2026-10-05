/** @fileoverview Separates the immediate inbox acknowledgement from later Planning confirmation, with progress-only payloads for human-recorded sending. */
export const INITIAL_ACKNOWLEDGEMENT_MARKER = 'Initial acknowledgement (send now in WhatsApp):';
export const PLANNING_FOLLOW_UP_MARKER = 'Planning follow-up:';

export function isPlanningAcknowledgement(handoff = {}) {
  return Boolean(handoff?.alreadyResolved && handoff?.planningId);
}

export function buildAcknowledgementProgressPayload(handoff = {}) {
  if (!isPlanningAcknowledgement(handoff) || !handoff.openedAt || !handoff.reply?.trim()) return null;
  return {
    mode: 'progress',
    planningId: handoff.planningId,
    progressType: 'note',
    progressNote: 'Initial acknowledgement sent manually in WhatsApp from Message Inbox. The work and final confirmation remain on this plan.',
  };
}
