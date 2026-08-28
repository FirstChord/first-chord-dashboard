import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ONBOARDING_PAYMENT_EXPLANATION,
  WELCOME_CALL_PROMPTS,
  buildOnboardingWelcomeMessage,
} from '../../lib/admin/onboarding-message-helpers.mjs';

const baseInput = {
  studentName: 'Ada Lovelace',
  parentName: 'Grace Lovelace',
  lessonTime: '4:30pm',
  lessonDay: 'Monday',
  lessonDate: '15th of June',
  tutorFullName: 'Finn Le Marinel',
  age: '12',
  experienceLevel: 'a beginner',
  interests: 'pop and songwriting',
  paymentLink: 'https://example.test/individual',
  groupPaymentLink: 'https://example.test/group',
  handbookUrl: 'https://example.test/handbook',
};

test('welcome-call prompts keep the agreed payment explanation at the point of use', () => {
  assert.equal(WELCOME_CALL_PROMPTS.length, 4);
  assert.equal(WELCOME_CALL_PROMPTS[2], ONBOARDING_PAYMENT_EXPLANATION);
  assert.match(ONBOARDING_PAYMENT_EXPLANATION, /first payment pays for lesson one/u);
  assert.match(ONBOARDING_PAYMENT_EXPLANATION, /cancel it so no further weekly payments are taken/u);
  assert.doesNotMatch(ONBOARDING_PAYMENT_EXPLANATION, /refund/iu);
});

test('parent welcome message explains weekly continuation without promising a refund', () => {
  const message = buildOnboardingWelcomeMessage(baseInput);
  assert.match(message, /Hey Grace/u);
  assert.match(message, /4:30pm on Monday 15th of June with Finn/u);
  assert.match(message, /weekly Stripe subscription/u);
  assert.match(message, /first payment pays for lesson one/u);
  assert.match(message, /if not, we’ll cancel it so no further weekly payments are taken/u);
  assert.match(message, /Payment Link 🔗: https:\/\/example\.test\/individual/u);
  assert.doesNotMatch(message, /refund/iu);
});

test('welcome message does not repeat a weekday already included in the formatted date', () => {
  const message = buildOnboardingWelcomeMessage({
    ...baseInput,
    studentName: 'Nina Simone',
    lessonDay: 'Monday',
    lessonDate: 'Monday 31st of August',
  });

  assert.match(message, /we've got Nina down for 4:30pm on Monday 31st of August with Finn/u);
  assert.doesNotMatch(message, /Monday Monday/u);
});

test('adult and sibling welcome messages retain the correct recipient and payment link', () => {
  const adult = buildOnboardingWelcomeMessage({ ...baseInput, isAdult: true });
  assert.match(adult, /Hey Ada/u);
  assert.match(adult, /we've got you down/u);

  const sibling = buildOnboardingWelcomeMessage({
    ...baseInput,
    lessonType: 'sibling_group',
    studentFirstNamesLabel: 'Ada and Charles',
  });
  assert.match(sibling, /we've got Ada and Charles down/u);
  assert.match(sibling, /Payment Link 🔗: https:\/\/example\.test\/group/u);
});
