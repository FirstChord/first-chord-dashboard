/** @fileoverview Validates dashboard glitch reports and turns them into safe Planning Inbox items through an injectable admin route. */

export const DASHBOARD_FEEDBACK_WORKFLOW_ID = 'dashboard-feedback';

const FEEDBACK_TYPES = new Set(['glitch', 'improvement']);
const MESSAGE_LIMIT = 2_000;
const PAGE_PATH_LIMIT = 240;
const TITLE_SUMMARY_LIMIT = 84;

const TYPE_LABELS = {
  glitch: 'Something’s broken',
  improvement: 'Could be better',
};

const TITLE_PREFIXES = {
  glitch: 'Glitch',
  improvement: 'Could be better',
};

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normaliseType(value = '') {
  const type = `${value || ''}`.trim().toLowerCase();
  if (!FEEDBACK_TYPES.has(type)) {
    throw inputError('Choose whether something is broken or could be better.');
  }
  return type;
}

function normaliseMessage(value = '') {
  const message = `${value || ''}`.replace(/\r\n?/gu, '\n').trim();
  if (!message) {
    throw inputError('Add a short description before sending.');
  }
  if (message.length > MESSAGE_LIMIT) {
    throw inputError(`Keep the report under ${MESSAGE_LIMIT.toLocaleString('en-GB')} characters.`);
  }
  return message;
}

export function normaliseDashboardFeedbackPagePath(value = '') {
  const pathname = `${value || ''}`
    .split(/[?#]/u, 1)[0]
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim();
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return '/admin';
  return pathname.slice(0, PAGE_PATH_LIMIT);
}

export function summariseDashboardFeedback(value = '', maxLength = TITLE_SUMMARY_LIMIT) {
  const oneLine = `${value || ''}`.replace(/\s+/gu, ' ').trim();
  const firstSentence = oneLine.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() || oneLine;
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function buildDashboardFeedbackPlanningItem({ type, message, pagePath } = {}) {
  const cleanType = normaliseType(type);
  const cleanMessage = normaliseMessage(message);
  const cleanPagePath = normaliseDashboardFeedbackPagePath(pagePath);
  const summary = summariseDashboardFeedback(cleanMessage);

  return {
    title: `${TITLE_PREFIXES[cleanType]}: ${summary}`,
    notes: [
      `Report type: ${TYPE_LABELS[cleanType]}`,
      `Dashboard page: ${cleanPagePath}`,
      '',
      'What was noticed:',
      cleanMessage,
    ].join('\n'),
    itemType: 'idea',
    planMode: 'task',
    owner: 'Unassigned',
    status: 'inbox',
    area: 'tech',
    linkedWorkflowId: DASHBOARD_FEEDBACK_WORKFLOW_ID,
    nextAction: '',
    targetDate: '',
    // A report may mention a broken pause screen. This explicit false prevents
    // wording-based legacy pause inference from feeding it into finance forecasts.
    isPause: false,
  };
}

const NOTE_FIELD_PATTERNS = {
  typeLabel: /^Report type: (.*)$/mu,
  pagePath: /^Dashboard page: (.*)$/mu,
};

// Reads a saved report back out of its Planning row for `npm run reports`.
// The note layout is written by buildDashboardFeedbackPlanningItem above; a
// hand-edited note still returns its whole text rather than being dropped.
export function readDashboardFeedbackReport(row = {}) {
  const notes = `${row.notes || ''}`;
  const typeLabel = notes.match(NOTE_FIELD_PATTERNS.typeLabel)?.[1]?.trim() || '';
  const [, noticed = ''] = notes.split(/^What was noticed:\n/mu);
  return {
    planningId: row.planningId || '',
    status: row.status || '',
    owner: row.owner || '',
    createdAt: row.createdAt || '',
    createdBy: row.createdBy || '',
    type: Object.keys(TYPE_LABELS).find((key) => TYPE_LABELS[key] === typeLabel) || '',
    pagePath: notes.match(NOTE_FIELD_PATTERNS.pagePath)?.[1]?.trim() || '',
    title: row.title || '',
    message: (noticed || notes).trim(),
    nextAction: row.nextAction || '',
  };
}

function noStore(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...init.headers, 'Cache-Control': 'private, no-store' },
  });
}

export function createDashboardFeedbackPostHandler({ getSession, savePlanningItem }) {
  return async function postDashboardFeedback(request) {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return noStore({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return noStore({ error: 'Invalid report' }, { status: 400 });
    }

    try {
      const item = buildDashboardFeedbackPlanningItem(body);
      const saved = await savePlanningItem({
        item,
        actorEmail: session.user.email || '',
      });
      return noStore({
        success: true,
        report: {
          planningId: saved.planningId,
          title: saved.title,
        },
      });
    } catch (error) {
      return noStore(
        { error: error.message || 'Dashboard report could not be saved' },
        { status: Number(error.status || 500) },
      );
    }
  };
}
