/** @fileoverview Deterministic First Chord student id generation. Kept apart from fc-helpers.mjs because it needs node:crypto, and those normalisation helpers are imported by client components. */
import { createHash } from 'node:crypto';

// Mints an FC student ID from the MMS student ID — the same formula as the
// brain's fc_ids.make_fc_id("std", mms_id). Neither repo can import the other,
// so both pin sdt_WFQ7Js -> fc_std_fa157fc5 in their tests.
//
// Mint once, then store: once a student has an ID in the registry or Students
// sheet, that stored value is authoritative and must never be recomputed. The
// brain reads it rather than deriving its own. Until 2026-09 this minted from
// forename:surname:email, which drifted whenever a name or email changed and
// disagreed with the brain for 63 students
// (docs/plans/active/fc-student-id-convergence.md).
//
// There is deliberately no name/email fallback: every onboarding path starts
// from an MMS student, and a silent fallback is how the second formula survived.
export function generateFcStudentId(mmsId) {
  const seed = `${mmsId || ''}`.trim();
  if (!/^sdt_[A-Za-z0-9]+$/u.test(seed)) {
    throw new Error(`An MMS student ID (sdt_...) is required to mint an FC student ID; got "${seed}"`);
  }
  return `fc_std_${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`;
}
