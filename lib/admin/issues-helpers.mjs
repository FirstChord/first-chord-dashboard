/** @fileoverview Pure issue classification, record building, identity-mismatch hints, and duplicate MMS id grouping. */
import { getTutorFullNameByShortName } from './tutor-identity.mjs';
import { buildIssueContextKey, buildIssueId } from './issue-queue-helpers.mjs';

function buildPaymentReason({
  type,
  paymentMode = '',
  paymentExpectation = '',
  stripeCustomerId = '',
  stripeSubscriptionId = '',
  pauseSummary = null,
  pauseCoverageContext = null,
  detail = '',
}) {
  const currentPause = pauseSummary?.currentlyPaused ? 'The student is currently paused.' : '';
  const latestPauseWindow = pauseSummary?.latestPause
    ? `Latest pause window: ${pauseSummary.latestPause.startDate || '—'} to ${pauseSummary.latestPause.endDate || '—'}.`
    : '';
  const pauseCoverageText = pauseCoverageContext?.summary || '';

  if (type === 'PAYMENT SETUP PENDING') {
    return 'This student is still in payment setup. Keep them visible, but do not treat them as a live broken Stripe case yet.';
  }

  if (type === 'SETUP PENDING STRIPE LINKED') {
    return 'This student is still marked as payment setup pending, but both Stripe customer and subscription IDs are recorded.';
  }

  if (type === 'STRIPE SETUP INCOMPLETE') {
    return 'This student is expected to pay via Stripe, but neither the Stripe customer ID nor subscription ID is recorded yet.';
  }

  if (type === 'STRIPE CUSTOMER MISSING') {
    return 'A Stripe subscription ID is recorded, but the Stripe customer ID is missing, so the linkage is incomplete.';
  }

  if (type === 'STRIPE SUBSCRIPTION MISSING') {
    return 'This student is expected to use Stripe, but no Stripe subscription ID is recorded yet.';
  }

  if (type === 'ACTIVE_WITHOUT_SUBSCRIPTION') {
    return 'The student is expected to be actively billed via Stripe, but no live subscription could be found.';
  }

  if (type === 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY') {
    return 'The student is expected to be actively billed, but Stripe shows the subscription as ended or cancelled.';
  }

  if (type === 'SUBSCRIPTION_STATE_MISMATCH') {
    const expectationText = paymentExpectation === 'stripe_paused_expected'
      ? 'The student is expected to be paused'
      : 'The student is expected to be actively billed';
    return [expectationText, 'but the live Stripe billing state does not match that expectation.', currentPause, latestPauseWindow, pauseCoverageText]
      .filter(Boolean)
      .join(' ');
  }

  if (type === 'PAUSE EXPECTATION MISMATCH') {
    return [
      currentPause || 'Pause History indicates the student is currently paused.',
      latestPauseWindow,
      pauseCoverageText,
      pauseSummary?.matchEvidence || '',
      'The pause may be correct; the dashboard payment expectation record has not been aligned yet.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (type === 'PAUSE EXPECTATION STALE') {
    return ['The latest pause window appears to have ended, but the student is still marked as Stripe paused expected.', latestPauseWindow, pauseCoverageText]
      .filter(Boolean)
      .join(' ');
  }

  if (type === 'INACTIVE_STILL_BILLING') {
    return 'The student is marked inactive or stopped, but Stripe still appears to be actively billing.';
  }

  if (type === 'PAYMENT_FAILED') {
    return [
      'Stripe reports a real payment problem on the latest invoice or payment attempt.',
      detail ? `Live detail: ${detail}` : '',
    ].filter(Boolean).join(' ');
  }

  if (type === 'PAYMENT_RETRYING') {
    return 'Stripe has another automatic payment attempt scheduled, so no human action is needed yet.';
  }

  if (paymentMode === 'stripe' && !stripeCustomerId && !stripeSubscriptionId) {
    return 'Stripe is expected, but the core Stripe linkage fields are still missing.';
  }

  return '';
}

export function classifyIssue(flagType) {
  const type = (flagType || '').trim().toUpperCase();

  if (type === 'TUTOR CONFLICT') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Sheets', 'Registry'],
      summary: 'Tutor mismatch between canonical views',
      recommendedAction: 'Open the student record, decide which tutor assignment is authoritative, and then update the wrong side.',
      actionLabel: 'Resolve tutor mismatch',
      messageable: false,
    };
  }

  // FC student ID flags come from the brain's stored-ID resolution
  // (first-chord-brain fc_ids.assign_fc_student_ids). The ID is minted once and
  // stored; these fire only when the stored copies cannot be trusted as-is.
  if (type === 'FC ID CONFLICT') {
    return {
      severity: 'Warning',
      systemsAffected: ['Registry', 'Sheets'],
      summary: 'Registry and Students sheet hold different FC student IDs',
      recommendedAction: 'The registry value is already in use everywhere. Correct the Students sheet "FC Student ID" cell to match it; never change the registry value.',
      actionLabel: 'Align FC student ID',
      messageable: false,
    };
  }

  if (type === 'FC ID DUPLICATE') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Registry', 'FC identity'],
      summary: 'One stored FC student ID belongs to more than one student',
      recommendedAction: 'The FC tabs are using a derived ID for each affected student until this is fixed. Find which student the stored ID was minted for and correct the other entry.',
      actionLabel: 'Resolve duplicate FC ID',
      messageable: false,
    };
  }

  if (type === 'FC ID MALFORMED') {
    return {
      severity: 'Warning',
      systemsAffected: ['Registry', 'Sheets'],
      summary: 'A stored FC student ID is not in fc_std_xxxxxxxx form',
      recommendedAction: 'The FC tabs are ignoring the malformed value. Check the registry entry and Students sheet cell for a typo.',
      actionLabel: 'Fix FC student ID',
      messageable: false,
    };
  }

  if (type === 'SHEETS ONLY') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets'],
      summary: 'Student exists in Sheets but not in the registry',
      recommendedAction: 'Check whether this is a valid active student that needs a portal/config entry, or a known admin-only row.',
      actionLabel: 'Review missing registry entry',
      messageable: false,
    };
  }

  if (type === 'REGISTRY ONLY') {
    return {
      severity: 'Warning',
      systemsAffected: ['Registry'],
      summary: 'Student exists in the registry but not in Sheets',
      recommendedAction: 'Check whether this is an orphaned portal entry or a missing Sheets row that should be recreated.',
      actionLabel: 'Review missing Sheets row',
      messageable: false,
    };
  }

  if (type === 'STRIPE SETUP INCOMPLETE') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is expected to use Stripe but is missing both customer and subscription linkage',
      recommendedAction: 'Check whether this student is still pending setup or whether Stripe linkage should already exist, then populate the missing IDs or switch payment mode.',
      actionLabel: 'Review Stripe setup',
      messageable: false,
    };
  }

  if (type === 'PAYMENT SETUP PENDING') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is still marked as pending payment setup',
      recommendedAction: 'Finish Stripe setup for this student or change the payment expectation once setup is complete.',
      actionLabel: 'Finish payment setup',
      messageable: false,
    };
  }

  if (type === 'SETUP PENDING STRIPE LINKED') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Stripe linkage exists but payment expectation is still setup pending',
      recommendedAction: 'Confirm setup is complete, then move payment expectation to Stripe active expected or choose the correct non-active expectation.',
      actionLabel: 'Review stale setup state',
      messageable: false,
    };
  }

  if (type === 'STRIPE CUSTOMER MISSING') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Stripe subscription is present but Stripe customer linkage is missing',
      recommendedAction: 'Verify the canonical Stripe customer for this student and write the missing customer ID into Sheets.',
      actionLabel: 'Review Stripe customer',
      messageable: false,
    };
  }

  if (type === 'STRIPE SUBSCRIPTION MISSING') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is expected to use Stripe but has no subscription ID yet',
      recommendedAction: 'Check whether this student is still pending payment setup or whether the Stripe subscription ID should already exist.',
      actionLabel: 'Review Stripe subscription',
      messageable: false,
    };
  }

  if (type === 'ACTIVE_WITHOUT_SUBSCRIPTION') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is expected to be actively paying via Stripe, but no live subscription was found',
      recommendedAction: 'Check whether the Stripe subscription ID is missing, stale, or linked to the wrong record, then either repair linkage or correct payment expectation.',
      actionLabel: 'Review live Stripe linkage',
      messageable: false,
    };
  }

  if (type === 'SUBSCRIPTION_CANCELLED_UNEXPECTEDLY') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is expected active, but Stripe shows the subscription as cancelled or otherwise ended',
      recommendedAction: 'Confirm whether billing should still be active. If yes, restore or recreate the subscription. If no, correct the student payment expectation/state.',
      actionLabel: 'Review cancelled subscription',
      messageable: false,
    };
  }

  if (type === 'SUBSCRIPTION_STATE_MISMATCH') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Stripe pause/billing state does not match the expected payment state',
      recommendedAction: 'Compare payment expectation and Pause History against Stripe, then fix either the Stripe subscription state or the recorded expectation.',
      actionLabel: 'Review pause mismatch',
      messageable: false,
    };
  }

  if (type === 'PAUSE EXPECTATION MISMATCH') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Pause', 'Stripe'],
      summary: 'Pause History says this student is paused now; payment expectation needs confirmation',
      recommendedAction: 'Confirm the pause is correct, then set payment expectation to Stripe paused expected. A Stripe scan checks live billing state but does not update this expectation field for you.',
      actionLabel: 'Confirm pause expectation',
      messageable: false,
    };
  }

  if (type === 'PAUSE EXPECTATION STALE') {
    return {
      severity: 'Warning',
      systemsAffected: ['Sheets', 'Pause', 'Stripe'],
      summary: 'Payment expectation still says paused, but the latest pause window has ended',
      recommendedAction: 'Return payment expectation to Stripe active expected if the pause has ended, or review Pause History if the pause dates are wrong.',
      actionLabel: 'Review ended pause',
      messageable: false,
    };
  }

  if (type === 'INACTIVE_STILL_BILLING') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Sheets', 'Stripe'],
      summary: 'Student is marked inactive or stopped, but Stripe is still actively billing',
      recommendedAction: 'Confirm whether billing should be stopped immediately. If the student is inactive, cancel or pause billing and verify the operational record.',
      actionLabel: 'Stop unexpected billing',
      messageable: false,
    };
  }

  if (type === 'PAYMENT_FAILED') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Stripe'],
      summary: 'Stripe shows a real payment problem on the current subscription',
      recommendedAction: 'Check the latest invoice/payment state in Stripe, confirm whether the failure has already resolved, and follow up if billing is still broken.',
      actionLabel: 'Review payment failure',
      messageable: false,
    };
  }

  if (type === 'PAYMENT_RETRYING') {
    return {
      severity: 'Info',
      systemsAffected: ['Stripe'],
      summary: 'Stripe is retrying a recoverable payment failure',
      recommendedAction: 'No action yet. Stripe has another payment attempt scheduled.',
      actionLabel: 'Waiting for Stripe',
      messageable: false,
    };
  }

  if (type === 'PRACTICE NOTE DELIVERY FAILED') {
    return {
      severity: 'Needs action',
      systemsAffected: ['Practice Chat', 'Gmail'],
      summary: 'A parent lesson-note email failed to send and is waiting on manual follow-up',
      recommendedAction: 'Open the student record, check the failed delivery, and send the note to the parent yourself. Then mark the follow-up handled so this clears.',
      actionLabel: 'Review failed note delivery',
      messageable: false,
    };
  }

  if (type === 'FINANCE DATA GAP') {
    return {
      severity: 'Warning',
      systemsAffected: ['Finance'],
      summary: 'This student cannot be priced, so revenue, margin, and snapshots are quietly understated',
      recommendedAction: 'Fix the missing source data on the student record — lesson duration, schedule context, or tutor — so the finance estimate can price them again.',
      actionLabel: 'Fix finance data gap',
      messageable: false,
    };
  }

  return {
    severity: 'Info',
    systemsAffected: [],
    summary: 'Unclassified issue',
    recommendedAction: 'Review manually.',
    actionLabel: 'Review issue',
    messageable: false,
  };
}

function normaliseName(value) {
  return (value || '').trim().toLowerCase();
}

function normaliseIdentityName(value) {
  return `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function registryEntryName(entry = {}) {
  return [entry.firstName, entry.lastName].filter(Boolean).join(' ').trim() || entry.name || '';
}

export function buildIdentityMismatchHint({
  issueType = '',
  mmsId = '',
  studentName = '',
  sheetStudents = [],
  registryEntries = [],
} = {}) {
  const type = `${issueType || ''}`.trim().toUpperCase();
  if (!['SHEETS ONLY', 'REGISTRY ONLY'].includes(type)) {
    return null;
  }

  const targetName = normaliseIdentityName(studentName);
  if (!targetName) {
    return null;
  }

  const candidates = type === 'SHEETS ONLY'
    ? registryEntries.map((entry) => ({
      system: 'Registry',
      mmsId: entry.mmsId || '',
      studentName: registryEntryName(entry),
      tutor: entry.tutor || '',
    }))
    : sheetStudents.map((student) => ({
      system: 'Sheets',
      mmsId: student.mmsId || '',
      studentName: student.fullName || '',
      tutor: student.tutor || '',
    }));

  const match = candidates.find((candidate) => (
    candidate.mmsId
    && candidate.mmsId !== mmsId
    && normaliseIdentityName(candidate.studentName) === targetName
  ));

  if (!match) {
    return null;
  }

  return {
    ...match,
    description: `Possible same-name match in ${match.system}: ${match.studentName} (${match.mmsId})${match.tutor ? `, tutor ${match.tutor}` : ''}.`,
  };
}

function buildIssueReason({ type, sheetStudent = null, registryEntry = null, detail = '' }) {
  if (type === 'SHEETS ONLY') {
    return 'This student exists in the operational Sheets data, but no matching registry entry was found for the portal/dashboard layer.';
  }

  if (type === 'REGISTRY ONLY') {
    return 'This student exists in the portal/dashboard registry, but no matching operational Sheets row was found.';
  }

  if (type === 'PAUSE EXPECTATION MISMATCH') {
    return 'Pause History indicates this student is currently paused. The pause may be correct; the dashboard payment expectation just needs confirming and aligning.';
  }

  if (type === 'PAUSE EXPECTATION STALE') {
    return 'The latest pause window appears to be over, but the student is still marked as paused in the payment expectation field.';
  }

  if (type === 'TUTOR CONFLICT') {
    const sheetTutor = sheetStudent?.tutor || 'unknown';
    const registryTutor = registryEntry?.tutor || 'unknown';
    return `Sheets and registry disagree on tutor assignment. Sheets currently says ${sheetTutor}; registry currently says ${registryTutor}.`;
  }

  return detail ? `Source detail: ${detail}` : '';
}

export function isIssueActive({ flagType, sheetStudent = null, registryEntry = null }) {
  const type = (flagType || '').trim().toUpperCase();

  if (type === 'SHEETS ONLY') {
    return Boolean(sheetStudent) && !registryEntry;
  }

  if (type === 'REGISTRY ONLY') {
    return !sheetStudent && Boolean(registryEntry);
  }

  if (type === 'TUTOR CONFLICT') {
    if (!sheetStudent || !registryEntry) {
      return false;
    }

    const registryTutorFullName = getTutorFullNameByShortName(registryEntry.tutor);
    return normaliseName(sheetStudent.tutor) !== normaliseName(registryTutorFullName);
  }

  return true;
}

export function buildIssueRecord({ flag, sheetStudent = null, registryEntry = null, identityMismatchHint = null }) {
  const type = flag.flag_type || flag.category || '';
  const classification = classifyIssue(type);
  const source = 'review_flags';
  const contextKey = buildIssueContextKey({ type, stripeSubscriptionId: sheetStudent?.stripeSubscriptionId || '' });
  const issueId = buildIssueId({
    source,
    issueType: type,
    mmsId: flag.mms_id || '',
    contextKey,
  });

  return {
    id: issueId,
    issueId,
    source,
    contextKey,
    type,
    mmsId: flag.mms_id || '',
    studentName: flag.student_name || '',
    detail: flag.detail || '',
    generatedDate: flag.generated_date || '',
    severity: classification.severity,
    systemsAffected: classification.systemsAffected,
    summary: classification.summary,
    recommendedAction: classification.recommendedAction,
    actionLabel: classification.actionLabel,
    messageable: classification.messageable,
    hasSheetRow: Boolean(sheetStudent),
    hasRegistryEntry: Boolean(registryEntry),
    sheetTutor: sheetStudent?.tutor || '',
    instrument: sheetStudent?.instrument || registryEntry?.instrument || '',
    registryTutor: registryEntry?.tutor || '',
    email: sheetStudent?.email || '',
    paymentMode: sheetStudent?.paymentMode || '',
    stripeCustomerId: sheetStudent?.stripeCustomerId || '',
    stripeSubscriptionId: sheetStudent?.stripeSubscriptionId || '',
    paymentExpectation: sheetStudent?.paymentExpectation || '',
    pauseSummary: sheetStudent?.pauseSummary || null,
    pauseCoverageContext: sheetStudent?.pauseCoverageContext || null,
    lifecycleStatus: sheetStudent?.lifecycleStatus || '',
    lifecycleLabel: sheetStudent?.lifecycleLabel || '',
    lifecycleConfidence: sheetStudent?.lifecycleConfidence || '',
    lifecycleReasons: sheetStudent?.lifecycleReasons || [],
    lifecycleWarnings: sheetStudent?.lifecycleWarnings || [],
    paymentValueContext: sheetStudent?.paymentValueContext || null,
    identityMismatchHint,
    issueReason: buildIssueReason({
      type,
      sheetStudent,
      registryEntry,
      detail: flag.detail || '',
    }),
    paymentReason: buildPaymentReason({
      type,
      paymentMode: sheetStudent?.paymentMode || '',
      paymentExpectation: sheetStudent?.paymentExpectation || '',
      stripeCustomerId: sheetStudent?.stripeCustomerId || '',
      stripeSubscriptionId: sheetStudent?.stripeSubscriptionId || '',
      pauseSummary: sheetStudent?.pauseSummary || null,
      pauseCoverageContext: sheetStudent?.pauseCoverageContext || null,
      detail: flag.detail || '',
    }),
    active: isIssueActive({ flagType: type, sheetStudent, registryEntry }),
    adminStudentPath: sheetStudent ? `/admin/students/${flag.mms_id}` : '',
  };
}

// Read-only data-integrity check: group students by MMS ID and return any ID
// shared by 2+ rows. A shared MMS ID makes student profiles resolve to the first
// matching row only, silently showing the wrong student.
export function buildDuplicateMmsIdGroups(students = []) {
  const byId = new Map();
  for (const student of students) {
    const mmsId = `${student?.mmsId || ''}`.trim();
    if (!mmsId) continue;
    const names = byId.get(mmsId) || [];
    names.push(`${student?.fullName || ''}`.trim() || '(no name)');
    byId.set(mmsId, names);
  }
  return [...byId.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([mmsId, names]) => ({ mmsId, students: names }))
    .sort((a, b) => a.mmsId.localeCompare(b.mmsId));
}

export function buildPaymentIssueRecord({ type, student, detail = '', stripeSnapshot = null }) {
  const classification = classifyIssue(type);
  const source = (
    type.startsWith('STRIPE ')
    || type === 'PAYMENT SETUP PENDING'
    || type === 'SETUP PENDING STRIPE LINKED'
    || type === 'PAUSE EXPECTATION MISMATCH'
    || type === 'PAUSE EXPECTATION STALE'
  )
    ? 'payment_static'
    : 'stripe_live';
  const contextKey = buildIssueContextKey({
    type,
    stripeSubscriptionId: student.stripeSubscriptionId || '',
  });
  const issueId = buildIssueId({
    source,
    issueType: type,
    mmsId: student.mmsId,
    contextKey,
  });

  return {
    id: issueId,
    issueId,
    source,
    contextKey,
    type,
    mmsId: student.mmsId,
    studentName: student.fullName || student.mmsId,
    detail: detail || `payment_mode=${student.paymentMode || '—'}, stripe_customer_id=${student.stripeCustomerId || '—'}, stripe_subscription_id=${student.stripeSubscriptionId || '—'}`,
    generatedDate: '',
    severity: classification.severity,
    systemsAffected: classification.systemsAffected,
    summary: classification.summary,
    recommendedAction: classification.recommendedAction,
    actionLabel: classification.actionLabel,
    messageable: classification.messageable,
    hasSheetRow: true,
    hasRegistryEntry: Boolean(student.registryEntry),
    sheetTutor: student.tutor || '',
    instrument: student.instrument || '',
    registryTutor: student.registryTutor || '',
    email: student.email || '',
    paymentMode: student.paymentMode || '',
    stripeCustomerId: student.stripeCustomerId || '',
    stripeSubscriptionId: student.stripeSubscriptionId || '',
    paymentExpectation: student.paymentExpectation || '',
    pauseSummary: student.pauseSummary || null,
    pauseCoverageContext: student.pauseCoverageContext || null,
    lifecycleStatus: student.lifecycleStatus || '',
    lifecycleLabel: student.lifecycleLabel || '',
    lifecycleConfidence: student.lifecycleConfidence || '',
    lifecycleReasons: student.lifecycleReasons || [],
    lifecycleWarnings: student.lifecycleWarnings || [],
    paymentValueContext: student.paymentValueContext || null,
    stripeSnapshot,
    paymentReason: buildPaymentReason({
      type,
      paymentMode: student.paymentMode || '',
      paymentExpectation: student.paymentExpectation || '',
      stripeCustomerId: student.stripeCustomerId || '',
      stripeSubscriptionId: student.stripeSubscriptionId || '',
      pauseSummary: student.pauseSummary || null,
      pauseCoverageContext: student.pauseCoverageContext || null,
      detail,
    }),
    active: true,
    adminStudentPath: `/admin/students/${student.mmsId}`,
  };
}
