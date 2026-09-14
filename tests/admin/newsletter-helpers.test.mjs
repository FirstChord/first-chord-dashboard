// Executable coverage for the newsletter rules. The design stores facts and
// derives state, so these tests are mostly about combinations of present and
// absent fields — including the contradictory ones, which is where a status
// column would have quietly lied.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClearPriorityUpdate,
  buildConsentUpdate,
  buildEditorialUpdate,
  buildIssueReadiness,
  buildNewsletterIssueRow,
  buildNewsletterItemId,
  buildNewsletterItemRow,
  buildStandingConsentIndex,
  canSelectItem,
  countPriorDeclines,
  currentIssueMonth,
  deriveItemConsent,
  deriveItemState,
  describeDeadline,
  formatDeadlineLabel,
  formatIssueMonthLabel,
  formatNameList,
  groupPrioritiesByTutor,
  isEmptyRequestRow,
  isExtraContribution,
  isFirstArrival,
  isOutstandingRequest,
  normaliseDate,
  normaliseIssueMonth,
  summariseIssue,
  TUTOR_TEXT_MAX_LENGTH,
} from '../../lib/admin/newsletter-helpers.mjs';
import { buildConsentRequestMessage, buildTutorRequestMessage } from '../../lib/admin/newsletter-data.js';

const NOW = new Date('2026-09-12T10:00:00.000Z');
const FC_STUDENT = 'fc_std_fa157fc5';
const FC_STUDENT_B = 'fc_std_e0938e46';
const FC_TUTOR = 'fc_tut_6133f361';

function item(overrides = {}) {
  return {
    itemId: `nli_2026-09_${FC_STUDENT}`,
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    studentName: 'Hayley Adams',
    fcTutorId: FC_TUTOR,
    tutorName: 'Dean',
    mmsId: 'sdt_WFQ7Js',
    requestedAt: '',
    requestedBy: '',
    capturedAt: '',
    capturedBy: '',
    tutorText: '',
    tutorResponse: '',
    hasMedia: '',
    consentAskedAt: '',
    consentAnswer: '',
    consentRecordedAt: '',
    editorial: '',
    updatedAt: '2026-09-12T10:00:00.000Z',
    ...overrides,
  };
}

// --- normalisation ---------------------------------------------------------

test('issue months and dates reject anything malformed or impossible', () => {
  assert.equal(normaliseIssueMonth('2026-09'), '2026-09');
  for (const bad of ['2026-9', '2026-13', '2026-00', '26-09', '2026-09-01', '', null, 'September']) {
    assert.equal(normaliseIssueMonth(bad), '', `${JSON.stringify(bad)} should not be a month`);
  }

  assert.equal(normaliseDate('2026-09-30'), '2026-09-30');
  // Well-shaped but impossible. Date would roll this into March and silently
  // move a deadline, so it is refused instead.
  assert.equal(normaliseDate('2026-02-31'), '');
  assert.equal(normaliseDate('2026-13-01'), '');
  assert.equal(normaliseDate('30-09-2026'), '');
  assert.equal(normaliseDate(''), '');
});

test('labels are locale-independent and readable', () => {
  assert.equal(formatIssueMonthLabel('2026-09'), 'September 2026');
  assert.equal(formatIssueMonthLabel('2026-01'), 'January 2026');
  assert.equal(formatIssueMonthLabel('nope'), '');
  assert.equal(formatDeadlineLabel('2026-09-30'), '30 September');
  assert.equal(formatDeadlineLabel('2026-09-05'), '5 September');
  assert.equal(formatDeadlineLabel(''), '');
});

test('the current issue month is anchored to London, not the server', () => {
  // 23:30 UTC on 30 September is 00:30 BST on 1 October in London.
  assert.equal(currentIssueMonth(new Date('2026-09-30T23:30:00.000Z')), '2026-10');
  // Mid-January has no offset, so this is just a sanity anchor.
  assert.equal(currentIssueMonth(new Date('2026-01-15T12:00:00.000Z')), '2026-01');
  assert.equal(currentIssueMonth(new Date('not a date')), '');
});

// --- identity -------------------------------------------------------------

test('item ids are deterministic, so re-assigning or resubmitting is a no-op', () => {
  const first = buildNewsletterItemId({ issueMonth: '2026-09', fcStudentId: FC_STUDENT });
  assert.equal(first, `nli_2026-09_${FC_STUDENT}`);
  assert.equal(buildNewsletterItemId({ issueMonth: '2026-09', fcStudentId: FC_STUDENT }), first);

  // An additional contribution carries a client ticket so a retried save lands
  // on the same row rather than duplicating the story.
  const extra = buildNewsletterItemId({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    captureTicket: 'A1B2-C3D4-EEEE',
  });
  assert.equal(extra, `nli_2026-09_${FC_STUDENT}_a1b2c3d4`);
  assert.notEqual(extra, first);
});

test('item ids refuse a missing or malformed FC student id', () => {
  assert.equal(buildNewsletterItemId({ issueMonth: '2026-09', fcStudentId: '' }), '');
  assert.equal(buildNewsletterItemId({ issueMonth: '2026-09', fcStudentId: 'sdt_WFQ7Js' }), '');
  assert.equal(buildNewsletterItemId({ issueMonth: '2026-09', fcStudentId: 'fc_std_XYZ' }), '');
  assert.equal(buildNewsletterItemId({ issueMonth: 'nope', fcStudentId: FC_STUDENT }), '');
});

// --- issue rows -----------------------------------------------------------

test('opening an issue records who opened it, and a later edit never moves that', () => {
  const opened = buildNewsletterIssueRow({
    issueMonth: '2026-09',
    question: '  If your life had a theme song, what would play?  ',
    deadline: '2026-09-30',
    actorEmail: 'musiclessons@firstchord.co.uk',
    now: NOW,
  });
  assert.equal(opened.error, undefined);
  assert.equal(opened.row.question, 'If your life had a theme song, what would play?');
  assert.equal(opened.row.openedAt, NOW.toISOString());
  assert.equal(opened.row.openedBy, 'musiclessons@firstchord.co.uk');

  const later = buildNewsletterIssueRow({
    issueMonth: '2026-09',
    question: 'A different question',
    existingRow: opened.row,
    actorEmail: 'someone.else@firstchord.co.uk',
    now: new Date('2026-09-20T09:00:00.000Z'),
  });
  assert.equal(later.row.openedAt, NOW.toISOString(), 'opened_at is the first write and never moves');
  assert.equal(later.row.openedBy, 'musiclessons@firstchord.co.uk');
  assert.equal(later.row.updatedAt, '2026-09-20T09:00:00.000Z');
});

test('issue rows refuse a bad month or an impossible deadline', () => {
  assert.equal(buildNewsletterIssueRow({ issueMonth: '2026-13' }).error, 'invalid_issue_month');
  assert.equal(
    buildNewsletterIssueRow({ issueMonth: '2026-09', deadline: '2026-02-31' }).error,
    'invalid_deadline',
  );
  // A blank deadline is allowed — she may not have decided one yet.
  assert.equal(buildNewsletterIssueRow({ issueMonth: '2026-09', deadline: '' }).row.deadline, '');
});

// --- item rows ------------------------------------------------------------

test('a contribution must attach to a stored FC student id, never a name', () => {
  assert.equal(
    buildNewsletterItemRow({ issueMonth: '2026-09', fcStudentId: '', studentName: 'Hayley' }).error,
    'fc_identity_unresolved',
  );
  // An MMS id is not an FC id. Accepting one here is how provider identity
  // would quietly become the durable key.
  assert.equal(
    buildNewsletterItemRow({ issueMonth: '2026-09', fcStudentId: 'sdt_WFQ7Js' }).error,
    'fc_identity_unresolved',
  );
  assert.equal(
    buildNewsletterItemRow({ issueMonth: '2026-09', fcStudentId: FC_STUDENT, fcTutorId: 'Dean' }).error,
    'fc_tutor_unresolved',
  );
  assert.equal(
    buildNewsletterItemRow({
      issueMonth: '2026-09',
      fcStudentId: FC_STUDENT,
      tutorResponse: 'maybe_later',
    }).error,
    'invalid_tutor_response',
  );
});

test('assigning a priority twice produces an identical row', () => {
  const first = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    studentName: 'Hayley Adams',
    fcTutorId: FC_TUTOR,
    tutorName: 'Dean',
    mmsId: 'sdt_WFQ7Js',
    requested: true,
    actorEmail: 'musiclessons@firstchord.co.uk',
    now: NOW,
  }).row;

  const again = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    studentName: 'Hayley Adams',
    fcTutorId: FC_TUTOR,
    tutorName: 'Dean',
    mmsId: 'sdt_WFQ7Js',
    requested: true,
    existingRow: first,
    actorEmail: 'musiclessons@firstchord.co.uk',
    now: new Date('2026-09-14T11:00:00.000Z'),
  }).row;

  assert.equal(again.itemId, first.itemId);
  assert.equal(again.requestedAt, first.requestedAt, 'the original ask keeps its date');
  assert.deepEqual(
    { ...again, updatedAt: null },
    { ...first, updatedAt: null },
    'only updated_at moves',
  );
});

test('a "nothing this month" reply closes uncertainty without counting as material', () => {
  const declined = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    requested: true,
    tutorResponse: 'nothing_this_month',
    now: NOW,
  }).row;

  assert.equal(declined.tutorResponse, 'nothing_this_month');
  assert.equal(declined.capturedAt, '', 'a decline is a closure, not a contribution');
  assert.equal(deriveItemState(declined), 'declined');
  assert.equal(isOutstandingRequest(declined), false, 'the uncertainty is closed');
});

test('material supersedes an earlier decline', () => {
  const declined = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    requested: true,
    tutorResponse: 'nothing_this_month',
    now: NOW,
  }).row;

  const remembered = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    tutorText: 'Hayley passed Grade 3 with distinction.',
    existingRow: declined,
    actorEmail: 'musiclessons@firstchord.co.uk',
    now: new Date('2026-09-15T10:00:00.000Z'),
  }).row;

  assert.equal(remembered.tutorResponse, '', 'the stale decline is cleared, not kept alongside');
  assert.equal(remembered.capturedAt, '2026-09-15T10:00:00.000Z');
  assert.equal(deriveItemState(remembered), 'captured');
});

test('the first capture keeps its timestamp when the text is later corrected', () => {
  const captured = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    tutorText: 'Passed Grade 3',
    actorEmail: 'dean@example.com',
    now: NOW,
  }).row;

  const fixed = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    tutorText: 'Passed Grade 3 with distinction',
    existingRow: captured,
    actorEmail: 'dean@example.com',
    now: new Date('2026-09-13T10:00:00.000Z'),
  }).row;

  assert.equal(fixed.capturedAt, NOW.toISOString(), 'a typo fix is not a new arrival');
  assert.equal(fixed.tutorText, 'Passed Grade 3 with distinction');
});

test('tutor text is capped', () => {
  const row = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    tutorText: 'x'.repeat(TUTOR_TEXT_MAX_LENGTH + 500),
    now: NOW,
  }).row;
  assert.equal(row.tutorText.length, TUTOR_TEXT_MAX_LENGTH);
});

// --- derived state --------------------------------------------------------

test('every item state comes from an observable fact', () => {
  assert.equal(deriveItemState(item({ requestedAt: NOW.toISOString() })), 'requested');
  assert.equal(deriveItemState(item({ capturedAt: NOW.toISOString(), tutorText: 'x' })), 'captured');
  assert.equal(deriveItemState(item({ tutorResponse: 'nothing_this_month' })), 'declined');
  assert.equal(
    deriveItemState(item({ capturedAt: NOW.toISOString(), editorial: 'selected' })),
    'selected',
  );
  assert.equal(
    deriveItemState(item({ capturedAt: NOW.toISOString(), editorial: 'not_selected' })),
    'not_selected',
  );
});

test('a contradictory item reads as needs_review rather than picking a winner', () => {
  // Marked selected, but nothing was ever captured.
  assert.equal(deriveItemState(item({ editorial: 'selected' })), 'needs_review');
  // A row with no request, no material and no reply should not exist. It must
  // not derive to a state that hides it from every count.
  assert.equal(deriveItemState(item()), 'needs_review');
});

test('extra and outstanding are derived, not stored', () => {
  const extra = item({ capturedAt: NOW.toISOString(), tutorText: 'Unprompted good news' });
  assert.equal(isExtraContribution(extra), true);
  assert.equal(isOutstandingRequest(extra), false);

  const waiting = item({ requestedAt: NOW.toISOString() });
  assert.equal(isExtraContribution(waiting), false);
  assert.equal(isOutstandingRequest(waiting), true);

  const arrived = item({ requestedAt: NOW.toISOString(), capturedAt: NOW.toISOString(), tutorText: 'x' });
  assert.equal(isExtraContribution(arrived), false, 'a requested contribution is not an extra');
  assert.equal(isOutstandingRequest(arrived), false);
});

// --- consent --------------------------------------------------------------

test('consent is only required when a picture is involved', () => {
  assert.deepEqual(
    deriveItemConsent(item({ tutorText: 'Just a written win' })),
    { required: false, status: 'not_required', standing: null },
  );
  assert.equal(deriveItemConsent(item({ hasMedia: 'true' })).status, 'needed');
});

test('the consent ask moves needed -> waiting -> cleared', () => {
  const needed = item({ hasMedia: 'true' });
  assert.equal(deriveItemConsent(needed).status, 'needed');

  const asked = buildConsentUpdate({ existingRow: needed, asked: true, now: NOW }).row;
  assert.equal(deriveItemConsent(asked).status, 'waiting');
  assert.equal(asked.consentAskedAt, NOW.toISOString());

  const answered = buildConsentUpdate({
    existingRow: asked,
    answer: 'yes_once',
    now: new Date('2026-09-13T09:00:00.000Z'),
  }).row;
  assert.equal(deriveItemConsent(answered).status, 'cleared');
  assert.equal(answered.consentAskedAt, NOW.toISOString(), 'the original ask date is preserved');
  assert.equal(answered.consentRecordedAt, '2026-09-13T09:00:00.000Z');
});

test('a "no" blocks the picture and is not treated as a standing refusal', () => {
  const refused = buildConsentUpdate({
    existingRow: item({ hasMedia: 'true', consentAskedAt: NOW.toISOString() }),
    answer: 'no',
    now: NOW,
  }).row;

  assert.equal(deriveItemConsent(refused).status, 'blocked');
  // Next month starts clean: the school asks again rather than assuming.
  assert.equal(buildStandingConsentIndex([refused]).has(FC_STUDENT), false);
});

test('"yes and future" becomes standing consent, derived from the real answer', () => {
  const ongoing = item({
    hasMedia: 'true',
    consentAnswer: 'yes_ongoing',
    consentRecordedAt: '2026-09-13T09:00:00.000Z',
  });
  const standing = buildStandingConsentIndex([ongoing]);
  assert.equal(standing.get(FC_STUDENT).recordedAt, '2026-09-13T09:00:00.000Z');
  assert.equal(standing.get(FC_STUDENT).issueMonth, '2026-09');

  // A later month's picture for the same student needs no fresh ask.
  const nextMonth = item({ itemId: 'x', issueMonth: '2026-10', hasMedia: 'true' });
  assert.equal(deriveItemConsent(nextMonth, { standingConsent: standing.get(FC_STUDENT) }).status, 'cleared');
  // But a different student still does.
  assert.equal(
    deriveItemConsent(item({ fcStudentId: FC_STUDENT_B, hasMedia: 'true' }), {
      standingConsent: standing.get(FC_STUDENT_B) || null,
    }).status,
    'needed',
  );
});

test('standing consent keeps the earliest date — when permission was actually given', () => {
  const standing = buildStandingConsentIndex([
    item({ itemId: 'a', issueMonth: '2026-09', consentAnswer: 'yes_ongoing', consentRecordedAt: '2026-09-13T09:00:00.000Z' }),
    item({ itemId: 'b', issueMonth: '2026-11', consentAnswer: 'yes_ongoing', consentRecordedAt: '2026-11-02T09:00:00.000Z' }),
  ]);
  assert.equal(standing.get(FC_STUDENT).recordedAt, '2026-09-13T09:00:00.000Z');
  assert.equal(standing.get(FC_STUDENT).issueMonth, '2026-09');
});

test('prior declines are counted for Fenella, never turned into a rule', () => {
  const history = [
    item({ itemId: 'a', issueMonth: '2026-07', consentAnswer: 'no' }),
    item({ itemId: 'b', issueMonth: '2026-08', consentAnswer: 'no' }),
    item({ itemId: 'c', issueMonth: '2026-08', fcStudentId: FC_STUDENT_B, consentAnswer: 'no' }),
  ];
  assert.equal(countPriorDeclines(history, FC_STUDENT), 2);
  assert.equal(countPriorDeclines(history, FC_STUDENT_B), 1);
  assert.equal(countPriorDeclines(history, ''), 0);

  // Two declines do not silently become a standing refusal — a fresh month's
  // item is still `needed`, and the decision to ask again stays hers.
  assert.equal(deriveItemConsent(item({ itemId: 'd', issueMonth: '2026-09', hasMedia: 'true' })).status, 'needed');
});

test('consent updates refuse nonsense', () => {
  assert.equal(buildConsentUpdate({ existingRow: null, asked: true }).error, 'item_not_found');
  assert.equal(
    buildConsentUpdate({ existingRow: item(), answer: 'probably' }).error,
    'invalid_consent_answer',
  );
  assert.equal(buildConsentUpdate({ existingRow: item() }).error, 'nothing_to_record');
});

// --- the guard ------------------------------------------------------------

test('a picture cannot be selected until permission is recorded', () => {
  const needsAsking = item({ hasMedia: 'true', capturedAt: NOW.toISOString(), tutorText: 'photo story' });
  assert.deepEqual(canSelectItem(needsAsking), { ok: false, reason: 'consent_needed' });
  assert.equal(buildEditorialUpdate({ existingRow: needsAsking, editorial: 'selected' }).error, 'consent_needed');

  const waiting = { ...needsAsking, consentAskedAt: NOW.toISOString() };
  assert.equal(buildEditorialUpdate({ existingRow: waiting, editorial: 'selected' }).error, 'consent_waiting');

  const refused = { ...needsAsking, consentAnswer: 'no' };
  assert.equal(buildEditorialUpdate({ existingRow: refused, editorial: 'selected' }).error, 'consent_blocked');

  const cleared = { ...needsAsking, consentAnswer: 'yes_once' };
  assert.equal(buildEditorialUpdate({ existingRow: cleared, editorial: 'selected' }).error, undefined);
  assert.equal(buildEditorialUpdate({ existingRow: cleared, editorial: 'selected' }).row.editorial, 'selected');
});

test('the guard applies to selecting only — not to rejecting or un-deciding', () => {
  const blocked = item({ hasMedia: 'true', capturedAt: NOW.toISOString(), tutorText: 'x', consentAnswer: 'no' });
  assert.equal(buildEditorialUpdate({ existingRow: blocked, editorial: 'not_selected' }).error, undefined);
  assert.equal(buildEditorialUpdate({ existingRow: blocked, editorial: '' }).row.editorial, '');
  assert.equal(buildEditorialUpdate({ existingRow: blocked, editorial: 'maybe' }).error, 'invalid_editorial_value');
});

test('standing consent satisfies the guard without a fresh ask', () => {
  const picture = item({ hasMedia: 'true', capturedAt: NOW.toISOString(), tutorText: 'x' });
  const standing = { recordedAt: '2026-08-01T09:00:00.000Z', issueMonth: '2026-08' };
  assert.deepEqual(canSelectItem(picture, { standingConsent: standing }), { ok: true });
  assert.equal(
    buildEditorialUpdate({ existingRow: picture, editorial: 'selected', standingConsent: standing }).error,
    undefined,
  );
});

test('text-only items are never gated', () => {
  const text = item({ capturedAt: NOW.toISOString(), tutorText: 'A written win' });
  assert.deepEqual(canSelectItem(text), { ok: true });
});

// --- clearing a priority --------------------------------------------------

test('removing a priority demotes it to an extra rather than losing the arrival', () => {
  const arrived = item({
    requestedAt: NOW.toISOString(),
    requestedBy: 'musiclessons@firstchord.co.uk',
    capturedAt: NOW.toISOString(),
    tutorText: 'Something good',
  });
  assert.equal(isEmptyRequestRow(arrived), false);

  const cleared = buildClearPriorityUpdate({ existingRow: arrived, now: NOW }).row;
  assert.equal(cleared.requestedAt, '');
  assert.equal(cleared.tutorText, 'Something good', 'the contribution survives');
  assert.equal(isExtraContribution(cleared), true);
});

test('an untouched priority row can be removed outright', () => {
  assert.equal(isEmptyRequestRow(item({ requestedAt: NOW.toISOString() })), true);
  assert.equal(isEmptyRequestRow(item({ requestedAt: NOW.toISOString(), consentAskedAt: NOW.toISOString() })), false);
  assert.equal(isEmptyRequestRow(item({ requestedAt: NOW.toISOString(), editorial: 'not_selected' })), false);
  assert.equal(isEmptyRequestRow(item()), false, 'a row that was never requested is not a request row');
});

// --- readiness ------------------------------------------------------------

test('readiness answers "what is still missing" without anyone remembering', () => {
  const summary = summariseIssue([
    item({ itemId: 'a', requestedAt: NOW.toISOString(), studentName: 'Hayley' }),
    item({ itemId: 'b', fcStudentId: FC_STUDENT_B, requestedAt: NOW.toISOString(), studentName: 'Jo' }),
    item({
      itemId: 'c',
      fcStudentId: 'fc_std_750843c2',
      studentName: 'Joel',
      requestedAt: NOW.toISOString(),
      capturedAt: NOW.toISOString(),
      tutorText: 'Joel finished his first book',
    }),
  ], { issue: { issueMonth: '2026-09', deadline: '2026-09-30' }, currentDate: NOW });

  assert.equal(summary.counts.asked, 3);
  assert.equal(summary.counts.arrived, 1);
  assert.equal(summary.counts.outstanding, 2);
  assert.equal(summary.counts.extra, 0);

  const codes = summary.blockers.map((blocker) => blocker.code);
  assert.ok(codes.includes('outstanding_requests'));
  assert.ok(!codes.includes('nothing_arrived'), 'something did arrive');
  const outstanding = summary.blockers.find((blocker) => blocker.code === 'outstanding_requests');
  assert.equal(outstanding.detail, 'Nothing yet from Hayley and Jo.');
  assert.ok(summary.blockers.some((blocker) => blocker.detail === 'Deadline in 18 days.'));
});

test('an issue with everything settled has no blockers', () => {
  const summary = summariseIssue([
    item({
      itemId: 'a',
      requestedAt: NOW.toISOString(),
      capturedAt: NOW.toISOString(),
      tutorText: 'A win',
      editorial: 'selected',
    }),
    item({
      itemId: 'b',
      fcStudentId: FC_STUDENT_B,
      requestedAt: NOW.toISOString(),
      tutorResponse: 'nothing_this_month',
    }),
  ], { issue: { issueMonth: '2026-09', deadline: '2026-09-30' }, currentDate: NOW });

  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.counts.declined, 1);
  assert.equal(summary.counts.selected, 1);
});

test('readiness surfaces outstanding consent and contradictory items', () => {
  const summary = summariseIssue([
    item({ itemId: 'a', capturedAt: NOW.toISOString(), tutorText: 'x', hasMedia: 'true' }),
    item({
      itemId: 'b',
      fcStudentId: FC_STUDENT_B,
      capturedAt: NOW.toISOString(),
      tutorText: 'y',
      hasMedia: 'true',
      consentAskedAt: NOW.toISOString(),
    }),
    item({ itemId: 'c', fcStudentId: 'fc_std_750843c2', editorial: 'selected' }),
  ], { issue: { issueMonth: '2026-09' }, currentDate: NOW });

  assert.equal(summary.counts.consentNeeded, 1);
  assert.equal(summary.counts.consentWaiting, 1);
  assert.equal(summary.counts.needsReview, 1);
  const codes = summary.blockers.map((blocker) => blocker.code);
  assert.ok(codes.includes('consent_needed'));
  assert.ok(codes.includes('consent_waiting'));
  assert.ok(codes.includes('needs_review'));
});

test('an empty issue says nothing has arrived', () => {
  const summary = summariseIssue([], { issue: { issueMonth: '2026-09' }, currentDate: NOW });
  assert.deepEqual(summary.blockers.map((blocker) => blocker.code), ['nothing_arrived']);
});

test('the summary only counts the issue it was asked about', () => {
  const summary = summariseIssue([
    item({ itemId: 'a', issueMonth: '2026-08', capturedAt: NOW.toISOString(), tutorText: 'old' }),
    item({ itemId: 'b', issueMonth: '2026-09', capturedAt: NOW.toISOString(), tutorText: 'new' }),
  ], { issue: { issueMonth: '2026-09' }, currentDate: NOW });

  assert.equal(summary.counts.arrived, 1);
  assert.equal(summary.items.length, 1);
});

test('standing consent from an earlier issue still applies in the current one', () => {
  // The August row is out of scope for the counts but must still inform consent,
  // otherwise the school would re-ask a family that already said yes to future.
  const summary = summariseIssue([
    item({ itemId: 'a', issueMonth: '2026-08', consentAnswer: 'yes_ongoing', consentRecordedAt: '2026-08-02T09:00:00.000Z' }),
    item({ itemId: 'b', issueMonth: '2026-09', capturedAt: NOW.toISOString(), tutorText: 'x', hasMedia: 'true' }),
  ], { issue: { issueMonth: '2026-09' }, currentDate: NOW });

  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].consent.status, 'cleared');
  assert.equal(summary.counts.consentNeeded, 0);
});

test('deadline wording covers past, today and future', () => {
  assert.equal(describeDeadline('2026-09-30', NOW), 'Deadline in 18 days.');
  assert.equal(describeDeadline('2026-09-12', NOW), 'Deadline is today.');
  assert.equal(describeDeadline('2026-09-11', NOW), 'Deadline passed 1 day ago.');
  assert.equal(describeDeadline('2026-09-05', NOW), 'Deadline passed 7 days ago.');
  assert.equal(describeDeadline('', NOW), '');
  assert.equal(describeDeadline('2026-02-31', NOW), '');
});

test('name lists read like a sentence', () => {
  assert.equal(formatNameList([]), '');
  assert.equal(formatNameList(['Hayley']), 'Hayley');
  assert.equal(formatNameList(['Hayley', 'Jo']), 'Hayley and Jo');
  assert.equal(formatNameList(['Hayley', 'Jo', 'Joel']), 'Hayley, Jo and Joel');
});

// --- per-tutor grouping and copy ------------------------------------------

test('priorities group by tutor so one message covers each tutor', () => {
  const groups = groupPrioritiesByTutor([
    item({ itemId: 'a', requestedAt: NOW.toISOString(), studentName: 'Jo', tutorName: 'Dean' }),
    item({ itemId: 'b', fcStudentId: FC_STUDENT_B, requestedAt: NOW.toISOString(), studentName: 'Hayley', tutorName: 'Dean' }),
    item({ itemId: 'c', fcStudentId: 'fc_std_750843c2', requestedAt: NOW.toISOString(), studentName: 'Joel', tutorName: 'Calum' }),
    // Captured but never requested: an extra, so it is not part of the ask.
    item({ itemId: 'd', fcStudentId: 'fc_std_9b89f4c9', capturedAt: NOW.toISOString(), tutorText: 'x', tutorName: 'Dean' }),
  ], { issueMonth: '2026-09' });

  assert.deepEqual(groups.map((group) => group.tutorName), ['Calum', 'Dean']);
  assert.deepEqual(groups[1].students.map((student) => student.studentName), ['Hayley', 'Jo']);
  assert.equal(groups[1].students.length, 2, 'the extra is not part of the ask');
});

test('the tutor request message keeps the permissive tone and the house opener', () => {
  const message = buildTutorRequestMessage({
    tutorFirstName: 'Dean',
    studentNames: ['Hayley', 'Jo', 'Joel'],
    question: 'If your life had a theme song, what would play?',
    deadlineLabel: '30 September',
  });

  assert.ok(message.startsWith('Hi Dean,'));
  assert.ok(!/Heya/u.test(message));
  assert.ok(message.includes('By 30 September'));
  assert.ok(message.includes('Hayley\nJo\nJoel'));
  assert.ok(
    message.includes('these students are just the priority'),
    'the "anything else is welcome" culture must survive',
  );
  assert.ok(message.includes('It does not have to be a performance video.'));
  assert.ok(message.includes('a voice note or video'));
  assert.ok(message.includes('If your life had a theme song'));
});

test('the tutor message still works with no priorities and no deadline', () => {
  const message = buildTutorRequestMessage({ tutorFirstName: '', studentNames: [], question: '' });
  assert.ok(message.startsWith('Hi,'));
  assert.ok(message.includes('would be very welcome'));
  assert.ok(!message.includes('Question of the month'));
});

test('the consent ask offers exactly the three answers and does not lean on the parent', () => {
  const message = buildConsentRequestMessage({
    parentFirstName: 'Sarah',
    studentFirstName: 'Amelia',
    monthLabel: 'September 2026',
    mediaDescription: 'a photo',
  });

  assert.ok(message.startsWith('Hi Sarah,'));
  assert.ok(!/Heya/u.test(message));
  assert.ok(message.includes('a photo of Amelia'));
  assert.ok(message.includes('September 2026 newsletter'));
  assert.ok(message.includes('1. No thanks'));
  assert.ok(message.includes('2. Yes, this one is fine'));
  assert.ok(message.includes('3. Yes, and future newsletters too'));
  assert.ok(message.includes('Happy either way'));
});

test('the consent ask degrades gracefully with nothing known', () => {
  const message = buildConsentRequestMessage({});
  assert.ok(message.startsWith('Hi,'));
  assert.ok(message.includes('a photo of your child'));
  assert.ok(message.includes('our newsletter'));
});

// --- first arrival (what triggers Fenella's email) -------------------------

test('only the move from "nothing yet" to "arrived" is a first arrival', () => {
  const before = item({ requestedAt: NOW.toISOString() });
  const after = item({ requestedAt: NOW.toISOString(), capturedAt: NOW.toISOString(), tutorText: 'x' });
  assert.equal(isFirstArrival({ before, after }), true);
  assert.equal(isFirstArrival({ before: null, after }), true, 'a brand-new extra is a first arrival');

  // An edit, a retried save, or a second photo: already arrived, so not news.
  assert.equal(isFirstArrival({ before: after, after }), false);
  // A "nothing this month" reply never sets captured_at, so it never notifies.
  const declined = item({ requestedAt: NOW.toISOString(), tutorResponse: 'nothing_this_month' });
  assert.equal(isFirstArrival({ before, after: declined }), false);
});

test('a photo-only contribution keeps its arrival when the row is rewritten', () => {
  // The bug: captured_at counted only text, so rewriting a photo-only row cleared
  // it — the item read as "nothing yet" and a second photo looked like news.
  const photoOnly = item({
    capturedAt: NOW.toISOString(),
    hasMedia: 'true',
    mediaJson: '[{"driveFileId":"A","kind":"photo","uploadTicket":"t1"}]',
  });
  const rewritten = buildNewsletterItemRow({
    issueMonth: '2026-09',
    fcStudentId: FC_STUDENT,
    hasMedia: true,
    existingRow: photoOnly,
    now: new Date('2026-09-15T10:00:00.000Z'),
  }).row;

  assert.equal(rewritten.capturedAt, NOW.toISOString(), 'the original arrival survives');
  assert.equal(rewritten.mediaJson, photoOnly.mediaJson);
  assert.equal(deriveItemState(rewritten), 'captured');
  assert.equal(isFirstArrival({ before: photoOnly, after: rewritten }), false);
});
