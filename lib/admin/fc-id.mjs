/** @fileoverview Deterministic First Chord student id generation. Kept apart from fc-helpers.mjs because it needs node:crypto, and those normalisation helpers are imported by client components. */
import { createHash } from 'node:crypto';

export function generateFcStudentId(forename, surname, email) {
  const seed = `${(forename || '').trim().toLowerCase()}:${(surname || '').trim().toLowerCase()}:${(email || '').trim().toLowerCase()}`;
  return `fc_std_${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`;
}
