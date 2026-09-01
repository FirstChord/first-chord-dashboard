import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('../../app/api/admin/issues/[mmsId]/ai-explanation/route.js', import.meta.url);
const feedbackRouteUrl = new URL('../../app/api/admin/ai/feedback/route.js', import.meta.url);
const panelUrl = new URL('../../components/admin/issues/IssueExplanationPanel.js', import.meta.url);

test('AI issue route is admin-only, on-demand, narrow and non-mutating', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');

  assert.match(source, /getServerSession\(authOptions\)/u);
  assert.match(source, /session\?\.user\?\.isAdmin/u);
  assert.match(source, /export async function POST/u);
  assert.match(source, /assistantContextService\.getIssueContext/u);
  assert.match(source, /buildIssueExplanation/u);
  assert.match(source, /generateIssueAiBriefing/u);
  assert.match(source, /Only source and issue type are accepted/u);
  assert.match(source, /Cache-Control['"]?:?\s*['"]no-store/u);
  assert.doesNotMatch(source, /getAdminIssues|scanLiveStripe|getLiveStripe|upsert|appendRow|sendMail|resolveIssue|updateStudent/u);
});

test('feedback records enums only and cannot receive issue context or mutate workflow state', async () => {
  const source = await readFile(feedbackRouteUrl, 'utf8');

  assert.match(source, /getServerSession\(authOptions\)/u);
  assert.match(source, /REQUEST_ID_PATTERN/u);
  assert.match(source, /evidence_wrong/u);
  assert.match(source, /proposed_fix_wrong/u);
  assert.match(source, /No student identifier, prompt, context or model/u);
  assert.doesNotMatch(source, /body\?*\.?(?:mmsId|issueType|prompt|output)|getAdminIssues|upsert|appendRow|resolveIssue|acknowledgeIssue/u);
});

test('client calls the model only after an explicit detective click and keeps the checked evidence', async () => {
  const source = await readFile(panelUrl, 'utf8');

  assert.match(source, /Ask the detective/u);
  assert.match(source, /onClick=\{toggle\}/u);
  assert.match(source, /if \(aiBriefingAvailable\) loadAiBriefing\(\)/u);
  assert.match(source, /method: 'POST'/u);
  assert.match(source, /source: issue\.source/u);
  assert.match(source, /issueType: issue\.type/u);
  assert.match(source, /Evidence and case rules/u);
  assert.match(source, /No, reconsider/u);
  assert.match(source, /current\.feedback === 'held' \? 'choose_reason'/u);
  assert.doesNotMatch(source, /OPENAI|API_KEY/u);
});
