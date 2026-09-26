import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const inboxClientUrl = new URL('../../components/admin/AdminIncomingMessagesPageClient.js', import.meta.url);
const inboxRouteUrl = new URL('../../app/api/admin/incoming-messages/route.js', import.meta.url);
const inboxServiceUrl = new URL('../../lib/admin/incoming-messages.js', import.meta.url);

test('AI reply drafting is invoked by one card Reply press and has a standard fallback', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.match(source, /async function openReply\(\)/u);
  assert.match(source, /const drafted = await onDraftReply\(entry\)/u);
  assert.match(source, /if \(drafted\) return/u);
  assert.match(source, /setIsReplyOpen\(true\)/u);
  // The Reply button may wrap it to scope its pending label, but it stays the
  // only caller.
  assert.match(source, /onClick=\{(?:press\('reply', )?openReply\)?\}/u);
});

test('the inbox has no bulk or background reply-drafting control', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.doesNotMatch(source, /Draft all open|handleDraftAllOpen/u);
  assert.doesNotMatch(source, /useEffect\([^)]*onDraftReply|setInterval\([^)]*onDraftReply/u);
});

test('Reply + Plan copies one reviewed draft, persists it, and stays in the inbox', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');
  const copyIndex = source.indexOf('await navigator.clipboard.writeText(reply)');
  const convertIndex = source.indexOf("await onConvert(entry, correctionPayload('converted'))");

  assert.match(source, /Reply \+ Plan/u);
  assert.match(source, /replyTemplate: replyDraft\.trim\(\)/u);
  assert.ok(copyIndex >= 0 && convertIndex > copyIndex);
  assert.doesNotMatch(source, /window\.location\.assign\(`\/admin\/planning\?focus=/u);
  assert.match(source, /alreadyResolved: true/u);
  assert.match(source, /Reply for \$\{label\} is ready/u);
  assert.match(source, /Open plan/u);
  assert.match(source, /advanceAfter\(entry\.incomingId\)/u);
});

test('reply handoff keeps the inbox open and requires a human sent confirmation', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.match(source, /window\.open\(url, '_blank'/u);
  assert.match(source, /Sent — finish & next/u);
  assert.match(source, /The inbox will only finish this message when you confirm it was sent/u);
  assert.match(source, /await handleReview\(entries, 'converted', 'Reply marked sent'\)/u);
  assert.match(source, /window\.sessionStorage\.setItem\(HANDOFF_STORAGE_KEY/u);
});

test('conversation context and queue continuity are lazy and locally remembered', async () => {
  const [source, routeSource] = await Promise.all([
    readFile(inboxClientUrl, 'utf8'),
    readFile(inboxRouteUrl, 'utf8'),
  ]);

  assert.match(source, /scope=context&incomingId=/u);
  assert.match(source, /Earlier in this chat/u);
  assert.match(source, /QUEUE_SELECTION_KEY/u);
  assert.match(source, /QUEUE_SCROLL_KEY/u);
  assert.match(routeSource, /scope === 'context'/u);
});

test('handled and Later outcomes offer optimistic-concurrency Undo', async () => {
  const [source, routeSource, serviceSource] = await Promise.all([
    readFile(inboxClientUrl, 'utf8'),
    readFile(inboxRouteUrl, 'utf8'),
    readFile(inboxServiceUrl, 'utf8'),
  ]);

  assert.match(source, /buildIncomingUndoSnapshot/u);
  assert.match(source, /mode: 'restore_batch'/u);
  assert.match(source, /expectedReviewedAt/u);
  assert.match(routeSource, /restoreIncomingMessageReviews/u);
  assert.match(serviceSource, /row\.reviewedAt !== snapshot\.expectedReviewedAt/u);
  assert.match(serviceSource, /error\.status = 409/u);
});

test('an unhealthy bridge prevents a misleading all-caught-up empty state', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.match(source, /No captured messages are waiting, but WhatsApp capture needs attention above/u);
  assert.match(source, /Until the green tick returns, paste anything urgent manually/u);
});

test('the inbox uses one selected-message workspace with a mobile return path', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.match(source, /function MessageQueueItem/u);
  assert.match(source, /aria-label="Message queue"/u);
  assert.match(source, /aria-label="Selected message"/u);
  assert.match(source, /Back to \{visibleClusters\.length\} message/u);
  assert.match(source, /selectedCluster \? \(/u);
});

test('burst outcomes use compact batched mutations', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');

  assert.match(source, /mode: 'review_batch'/u);
  assert.match(source, /mode: 'snooze_batch'/u);
  assert.match(source, /relatedIncomingIds: burst\.map/u);
  assert.match(source, /mergeIncomingInboxMutation\(current, data\)/u);
});

test('completed history is lazy, bounded, and keeps the full count visible', async () => {
  const [clientSource, routeSource] = await Promise.all([
    readFile(inboxClientUrl, 'utf8'),
    readFile(inboxRouteUrl, 'utf8'),
  ]);

  assert.match(routeSource, /getIncomingMessageInboxPage\(\{ statusScope: 'resolved', limit: 100 \}\)/u);
  assert.match(clientSource, /Showing the \{visibleInbox\.length\} most recent of \{completedTotal\}/u);
  assert.match(clientSource, /setDoneTotalCount\(Number\(data\.totalCount\) \|\| 0\)/u);
});

// The panel offers Student group / Tutor group plus a person selector, but the
// server decides. A handler that drops either field silently confirms against
// `existing.groupType` with an empty id, which fails closed on a tutor group
// ("A tutor from the roster is required...") and, worse, would let a Student
// group choice be overridden by the sync's guess. Both must reach the route.
test('group review sends the chosen group type and tutor, not just the student', async () => {
  const source = await readFile(inboxClientUrl, 'utf8');
  const handler = source.slice(
    source.indexOf('async function handleReviewGroup'),
    source.indexOf('async function handleAddGroupStudent'),
  );

  assert.ok(handler, 'handleReviewGroup should exist');
  assert.match(handler, /matchedTutorId/u);
  assert.match(handler, /groupType/u);
  assert.match(handler, /mode: 'review_group'/u);
});
