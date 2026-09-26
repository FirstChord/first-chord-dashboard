/** @fileoverview Pure scoring of incoming-message topics, actionability, actual capture outcomes, dates, and proposal abstention against labelled fixtures. */
// Scoring for the incoming-message classifier against a labelled fixture.
// Shared by the eval test (which pins accuracy floors) and the report script
// (scripts/eval-incoming-classifier.mjs). Pure.

// All absence categories put the message in front of the same reviewer with
// the same convert path, so a within-family miss is a wording nuance rather
// than a workflow error — scored separately from exact accuracy.
export const ABSENCE_FAMILY = new Set(['one_off_absence', 'extended_absence', 'summer_break', 'absence_pause']);

export function scoreIncomingClassifier(messages = [], classify) {
  const perLabel = {};
  const misses = [];
  let exactCorrect = 0;
  let familyCorrect = 0;

  for (const message of messages) {
    const predicted = classify(message.text).category;
    const expected = message.label;
    const exact = predicted === expected;
    const sameFamily = exact || (ABSENCE_FAMILY.has(predicted) && ABSENCE_FAMILY.has(expected));

    perLabel[expected] = perLabel[expected] || { total: 0, correct: 0 };
    perLabel[expected].total += 1;
    if (exact) {
      perLabel[expected].correct += 1;
      exactCorrect += 1;
    } else {
      misses.push({ id: message.id, expected, predicted, sameFamily, text: message.text });
    }
    if (sameFamily) familyCorrect += 1;
  }

  const total = messages.length || 1;
  return {
    total: messages.length,
    exactCorrect,
    familyCorrect,
    exactAccuracy: exactCorrect / total,
    familyAccuracy: familyCorrect / total,
    perLabel,
    misses,
  };
}

// Score the capture result itself. A general question can need a reply, and a
// specific topic can be settled; neither category is a proxy for archive state.
export function scoreIncomingCaptureOutcomes(cases = [], capture) {
  const misses = [];
  let exactCorrect = 0;
  let expectedOpen = 0;
  let expectedIgnored = 0;
  let harmfulAutoArchives = 0;
  let unnecessaryReviews = 0;
  for (const testCase of cases) {
    const predicted = capture(testCase).status;
    const expected = testCase.expectedStatus;
    if (predicted === expected) exactCorrect += 1;
    else misses.push({ id: testCase.id, expected, predicted, text: testCase.text });
    if (expected === 'ignored') {
      expectedIgnored += 1;
      if (predicted !== 'ignored') unnecessaryReviews += 1;
    } else {
      expectedOpen += 1;
      if (predicted === 'ignored') harmfulAutoArchives += 1;
    }
  }
  return {
    total: cases.length, exactCorrect, exactAccuracy: exactCorrect / (cases.length || 1),
    expectedOpen, expectedIgnored, harmfulAutoArchives, unnecessaryReviews, misses,
  };
}

export function scoreIncomingActionability(cases = [], classify) {
  const misses = [];
  let exactCorrect = 0;
  let harmfulAutoArchives = 0;
  let expectedOpen = 0;

  for (const testCase of cases) {
    const predicted = classify(testCase.text).actionability;
    const expected = testCase.expectedActionability;
    if (predicted === expected) {
      exactCorrect += 1;
    } else {
      misses.push({ id: testCase.id, expected, predicted, text: testCase.text });
    }
    if (expected !== 'no_action') {
      expectedOpen += 1;
      if (predicted === 'no_action') harmfulAutoArchives += 1;
    }
  }

  return {
    total: cases.length,
    exactCorrect,
    exactAccuracy: exactCorrect / (cases.length || 1),
    expectedOpen,
    harmfulAutoArchives,
    misses,
  };
}

export function scoreIncomingDateExtraction(messages = [], extract) {
  const cases = messages.filter((message) => message.expectedDates);
  const misses = [];
  let exactCorrect = 0;

  for (const message of cases) {
    const actual = extract(message.text, {
      referenceDate: new Date(`${message.referenceDate}T12:00:00.000Z`),
    });
    const expected = message.expectedDates;
    const exact = actual.startDate === expected.startDate
      && actual.returnDate === expected.returnDate;
    if (exact) {
      exactCorrect += 1;
    } else {
      misses.push({
        id: message.id,
        expected,
        actual: {
          startDate: actual.startDate || '',
          returnDate: actual.returnDate || '',
        },
      });
    }
  }

  return {
    total: cases.length,
    exactCorrect,
    exactAccuracy: exactCorrect / (cases.length || 1),
    misses,
  };
}

// The live proposal layer does not exist yet. This scorer lets a future model
// or deterministic baseline be measured against synthetic ambiguity cases
// without placing a provider call in CI. `propose` returns only its proposed
// abstention and ambiguity flags.
export function scoreIncomingProposalAbstention(cases = [], propose) {
  const misses = [];
  let abstentionCorrect = 0;
  let ambiguityFlagsCorrect = 0;

  for (const testCase of cases) {
    const actual = propose(testCase);
    const expected = testCase.expected || {};
    const actualFlags = new Set(actual?.ambiguityFlags || []);
    const expectedFlags = expected.ambiguityFlags || [];
    const abstentionMatches = Boolean(actual?.mustAbstain) === Boolean(expected.mustAbstain);
    const flagsMatch = expectedFlags.every((flag) => actualFlags.has(flag));

    if (abstentionMatches) abstentionCorrect += 1;
    if (flagsMatch) ambiguityFlagsCorrect += 1;
    if (!abstentionMatches || !flagsMatch) {
      misses.push({
        id: testCase.id,
        expected,
        actual: {
          mustAbstain: Boolean(actual?.mustAbstain),
          ambiguityFlags: [...actualFlags],
        },
      });
    }
  }

  return {
    total: cases.length,
    abstentionCorrect,
    ambiguityFlagsCorrect,
    abstentionAccuracy: abstentionCorrect / (cases.length || 1),
    ambiguityFlagsAccuracy: ambiguityFlagsCorrect / (cases.length || 1),
    misses,
  };
}
