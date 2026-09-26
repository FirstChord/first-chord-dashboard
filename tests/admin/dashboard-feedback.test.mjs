import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDashboardFeedbackPlanningItem,
  createDashboardFeedbackPostHandler,
  normaliseDashboardFeedbackPagePath,
  readDashboardFeedbackReport,
  summariseDashboardFeedback,
} from '../../lib/admin/dashboard-feedback.mjs';

function jsonRequest(body) {
  return new Request('https://dashboard.example/api/admin/dashboard-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('dashboard feedback becomes an unassigned, non-pause Planning Inbox idea', () => {
  const item = buildDashboardFeedbackPlanningItem({
    type: 'glitch',
    message: 'The pause button shows a blank screen. I was trying to review Ada.',
    pagePath: '/admin/finance?secret=not-stored',
  });

  assert.equal(item.title, 'Glitch: The pause button shows a blank screen.');
  assert.equal(item.itemType, 'idea');
  assert.equal(item.status, 'inbox');
  assert.equal(item.owner, 'Unassigned');
  assert.equal(item.area, 'tech');
  assert.equal(item.linkedWorkflowId, 'dashboard-feedback');
  assert.equal(item.isPause, false);
  assert.match(item.notes, /Report type: Something’s broken/u);
  assert.match(item.notes, /Dashboard page: \/admin\/finance/u);
  assert.doesNotMatch(item.notes, /secret=/u);
});

test('dashboard feedback validation keeps capture small and page context safe', () => {
  assert.equal(normaliseDashboardFeedbackPagePath('https://outside.example/private'), '/admin');
  assert.equal(normaliseDashboardFeedbackPagePath('/administrator/private'), '/admin');
  assert.equal(normaliseDashboardFeedbackPagePath('/admin/students#person'), '/admin/students');
  assert.equal(summariseDashboardFeedback('One line\nwith more detail'), 'One line with more detail');
  assert.match(summariseDashboardFeedback('x'.repeat(120)), /\.\.\.$/u);
  assert.throws(
    () => buildDashboardFeedbackPlanningItem({ type: 'unknown', message: 'A thing', pagePath: '/admin' }),
    /Choose whether/u,
  );
  assert.throws(
    () => buildDashboardFeedbackPlanningItem({ type: 'improvement', message: '   ', pagePath: '/admin' }),
    /short description/u,
  );
  assert.throws(
    () => buildDashboardFeedbackPlanningItem({ type: 'glitch', message: 'x'.repeat(2_001), pagePath: '/admin' }),
    /under 2,000 characters/u,
  );
});

test('dashboard feedback route requires an admin session before writing', async () => {
  let writes = 0;
  const handler = createDashboardFeedbackPostHandler({
    getSession: async () => null,
    savePlanningItem: async () => { writes += 1; },
  });

  const response = await handler(jsonRequest({ type: 'glitch', message: 'Broken', pagePath: '/admin' }));
  assert.equal(response.status, 401);
  assert.equal(writes, 0);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('dashboard feedback route saves through the existing Planning writer with the session actor', async () => {
  let received = null;
  const handler = createDashboardFeedbackPostHandler({
    getSession: async () => ({ user: { isAdmin: true, email: 'finn@example.com' } }),
    savePlanningItem: async (input) => {
      received = input;
      return { ...input.item, planningId: 'planning_feedback_1' };
    },
  });

  const response = await handler(jsonRequest({
    type: 'improvement',
    message: 'Make the student search easier to scan',
    pagePath: '/admin/students',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.report.planningId, 'planning_feedback_1');
  assert.equal(received.actorEmail, 'finn@example.com');
  assert.equal(received.item.title, 'Could be better: Make the student search easier to scan');
  assert.equal(received.item.linkedWorkflowId, 'dashboard-feedback');
  assert.equal('progressNote' in received, false);
});

test('dashboard feedback route rejects malformed JSON and reports write failures', async () => {
  const handler = createDashboardFeedbackPostHandler({
    getSession: async () => ({ user: { isAdmin: true, email: 'admin@example.com' } }),
    savePlanningItem: async () => { throw new Error('Sheets unavailable'); },
  });
  const malformed = await handler(new Request('https://dashboard.example', { method: 'POST', body: '{' }));
  assert.equal(malformed.status, 400);

  const failed = await handler(jsonRequest({ type: 'glitch', message: 'Broken', pagePath: '/admin' }));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Sheets unavailable' });
});

test('a saved report reads back with its type, page, and full message', () => {
  const item = buildDashboardFeedbackPlanningItem({
    type: 'improvement',
    message: 'Buttons should feel pressed.\nAnd show success.',
    pagePath: '/admin/finance/payroll?tab=settings',
  });
  const report = readDashboardFeedbackReport({ ...item, planningId: 'planning_1', createdAt: '2026-09-26T11:24:00Z' });
  assert.equal(report.type, 'improvement');
  assert.equal(report.pagePath, '/admin/finance/payroll');
  assert.equal(report.message, 'Buttons should feel pressed.\nAnd show success.');
  assert.equal(report.planningId, 'planning_1');
});

test('a hand-edited report note still returns its whole text', () => {
  const report = readDashboardFeedbackReport({ notes: 'Rewritten by hand.' });
  assert.equal(report.type, '');
  assert.equal(report.pagePath, '');
  assert.equal(report.message, 'Rewritten by hand.');
});
