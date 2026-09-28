import assert from 'node:assert/strict';
import test from 'node:test';
import { getGoToDestinations, getGoToSuggestions } from '../../lib/admin/admin-go-to-helpers.mjs';

test('workflow searches prioritise the named destination', () => {
  assert.equal(getGoToDestinations('payroll')[0]?.href, '/admin/finance/payroll');
  assert.equal(getGoToDestinations('pay tutors')[0]?.href, '/admin/finance/payroll');
  assert.equal(getGoToDestinations('whatsapp')[0]?.href, '/admin/incoming-messages');
  assert.equal(getGoToDestinations('mailchimp')[0]?.href, '/admin/newsletter');
});

test('every query retains an explicit student search and unknown names lead there', () => {
  const query = 'Alice & Bob';
  assert.deepEqual(getGoToSuggestions(query), [{
    href: '/admin/students?q=Alice%20%26%20Bob',
    title: 'Search students for “Alice & Bob”',
    kind: 'student-search',
  }]);
  assert.equal(getGoToSuggestions('payroll').at(-1).kind, 'student-search');
  assert.equal(getGoToSuggestions('students')[0].href, '/admin/students');
});

test('empty Go to suggestions provide a few routes and the student directory', () => {
  const items = getGoToSuggestions('');
  assert.equal(items.length, 4);
  assert.equal(items.at(-1).href, '/admin/students');
});
