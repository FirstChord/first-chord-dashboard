import test from 'node:test';
import assert from 'node:assert/strict';
import { getIncomingAbsenceNoticeCue, labelIncomingQueueCategory } from '../../lib/admin/incoming-category-presentation-helpers.mjs';

function cue(messageText, overrides = {}) {
  return getIncomingAbsenceNoticeCue({
    category: 'extended_absence',
    entries: [{ messageText, messageAt: '2026-10-01T17:59:00+01:00', capturedAt: '2026-10-20T10:00:00Z', ...overrides }],
  });
}

test('all temporary absence types share one label without changing the stored type', () => {
  for (const category of ['one_off_absence', 'extended_absence', 'summer_break', 'absence_pause']) {
    assert.equal(labelIncomingQueueCategory(category), 'Absence');
  }
  assert.equal(labelIncomingQueueCategory('payment'), 'Payment');
  assert.equal(labelIncomingQueueCategory('schedule'), 'Schedule');
  assert.equal(labelIncomingQueueCategory('unknown'), 'General');
});

test('notice uses the original message, with seven days as the boundary', () => {
  assert.equal(cue('Please cancel the lesson on 7 October').label, 'Short notice');
  assert.equal(cue('Please cancel the lesson on 8 October'), null);
  assert.equal(cue('Please pause payment for Monday 12th October. Kids are off school that week'), null);
  assert.equal(cue('Please cancel on 30 September').label, 'Check notice');
});

test('absolute and relative exact dates respect the school date across midnight', () => {
  const messageAt = '2026-07-19T23:30:00Z';
  assert.equal(cue('Cannot attend on 26 July', { messageAt }).window, 'inside_week');
  assert.equal(cue('Cannot attend on 27 July', { messageAt }), null);
  assert.equal(cue('Cannot attend today', { messageAt }).window, 'same_day');
  assert.equal(cue('Cannot attend tomorrow', { messageAt }).window, 'inside_week');
});

test('same-day cue does not promise a practice video', () => {
  const result = cue('Cannot attend today');
  assert.equal(result.label, 'Short notice');
  assert.match(result.description, /not offered for same-day/u);
});

test('unknown or ambiguous dates require review and never fall back to capture time', () => {
  for (const text of ['Cannot attend next week', 'Away until mid October', 'Cannot attend on Friday',
    'Cannot attend on the 5th', 'Cannot attend on 31 April', 'Away on 5 October and 12 October',
    'Back on 5 October',
    'Cannot attend on 5 October 2027', 'Cannot attend']) {
    assert.equal(cue(text).label, 'Check notice', text);
  }
  assert.equal(cue('Cannot attend on 5 October', { messageAt: '' }).label, 'Check notice');
  assert.equal(cue('Cannot attend on 5 October', { messageAt: 'invalid' }).label, 'Check notice');
});

test('clear start and return dates use the start without discarding the range', () => {
  assert.equal(cue('Away from 5 October, back on 12 October').window, 'inside_week');
  assert.equal(cue('Away from 12 October, back on 26 October'), null);
  assert.equal(cue('Away from 05/10/2026 to 12/10/2026').window, 'inside_week');
});

test('complete numeric/ISO dates retain their year', () => {
  assert.equal(cue('Cannot attend on 05/10/2026').window, 'inside_week');
  assert.equal(cue('Cannot attend on 2026-10-05').window, 'inside_week');
  assert.equal(cue('Cannot attend on 05/10/2027'), null);
});

test('bursts use all text and their earliest original timestamp even if lead is later', () => {
  const entries = [
    { messageText: 'on 26 July', messageAt: '2026-07-19T23:01:00Z' },
    { messageText: 'We cannot attend the lesson', messageAt: '2026-07-19T22:59:00Z' },
  ];
  assert.equal(getIncomingAbsenceNoticeCue({ category: 'absence_pause', entries }), null);
  entries[1].messageAt = '2026-07-19T23:00:00Z';
  assert.equal(getIncomingAbsenceNoticeCue({ category: 'absence_pause', entries }).window, 'inside_week');
});

test('tutor groups and unrelated topics do not use the parent absence cue', () => {
  assert.equal(cue('Cannot attend tomorrow', { groupType: 'tutor' }), null);
  assert.equal(getIncomingAbsenceNoticeCue({ category: 'payment', entries: [{ messageText: 'on 5 October' }] }), null);
  assert.equal(getIncomingAbsenceNoticeCue({ category: 'one_off_absence', entries: [] }), null);
});
