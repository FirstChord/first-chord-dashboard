/** @fileoverview Bounded WhatsApp reply receipts, replay-safe association, and burst-level review cues. */
export const SCHOOL_REPLY_LIMIT = 4;
export const SCHOOL_REPLY_TEXT_LIMIT = 1200;
const UNQUOTED_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const time = (value) => new Date(value || '').getTime();
const open = (row) => ['inbox', 'needs_review'].includes(row.status);

export function normaliseSchoolReplies(value = []) {
  let replies = value;
  if (typeof value === 'string') {
    try { replies = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(replies)) return [];
  const byId = new Map();
  for (const item of replies) {
    if (!item || !clean(item.externalMessageId) || !Number.isFinite(time(item.repliedAt))) continue;
    const text = clean(item.text);
    byId.set(clean(item.externalMessageId), {
      externalMessageId: clean(item.externalMessageId).slice(0, 200),
      repliedAt: new Date(item.repliedAt).toISOString(),
      repliedBy: clean(item.repliedBy).slice(0, 100) || 'School',
      role: item.role === 'tutor' ? 'tutor' : 'admin',
      association: item.association === 'quoted' ? 'quoted' : 'nearest',
      text: text.slice(0, SCHOOL_REPLY_TEXT_LIMIT),
      truncated: Boolean(item.truncated || text.length > SCHOOL_REPLY_TEXT_LIMIT),
    });
  }
  return [...byId.values()].sort((a, b) => time(a.repliedAt) - time(b.repliedAt)).slice(-SCHOOL_REPLY_LIMIT);
}

export function serialiseSchoolReplies(value) {
  const replies = normaliseSchoolReplies(value);
  return replies.length ? JSON.stringify(replies) : '';
}

export function findCapturedSchoolReply(rows, { chatId, externalMessageId } = {}) {
  if (!externalMessageId) return null;
  return rows.find((row) => row.chatId === chatId
    && normaliseSchoolReplies(row.schoolReplyEvidence).some((reply) => reply.externalMessageId === externalMessageId)) || null;
}

// A quote identifies one request (or a stored reply on that request). Unknown
// quotes never fall back to a different request. Without a quote, the nearest
// captured inbound message is a boundary, even when it is already closed.
export function selectSchoolReplyTarget(rows = [], { chatId = '', repliedAt = '', repliedToExternalMessageId = '' } = {}) {
  const replyTime = time(repliedAt);
  if (!chatId || !Number.isFinite(replyTime)) return null;
  const preceding = rows.filter((row) => row.chatId === chatId
    && Number.isFinite(time(row.messageAt || row.capturedAt))
    && time(row.messageAt || row.capturedAt) <= replyTime);
  if (repliedToExternalMessageId) {
    const direct = preceding.find((row) => row.externalMessageId === repliedToExternalMessageId);
    const target = direct || findCapturedSchoolReply(preceding, { chatId, externalMessageId: repliedToExternalMessageId });
    return target && open(target) ? target : null;
  }
  const target = preceding.sort((a, b) => time(b.messageAt || b.capturedAt) - time(a.messageAt || a.capturedAt))[0];
  return target && open(target)
    && replyTime - time(target.messageAt || target.capturedAt) <= UNQUOTED_REPLY_WINDOW_MS ? target : null;
}

export function appendSchoolReply(row, reply) {
  const replies = normaliseSchoolReplies([...normaliseSchoolReplies(row.schoolReplyEvidence), reply]);
  const latest = replies[replies.length - 1];
  // An out-of-order replay must not move an existing legacy receipt backwards.
  const keepLegacy = time(row.schoolRepliedAt) > time(latest?.repliedAt);
  return {
    ...row,
    schoolReplyEvidence: replies,
    schoolRepliedAt: keepLegacy ? row.schoolRepliedAt : latest?.repliedAt || row.schoolRepliedAt || '',
    schoolRepliedBy: keepLegacy ? row.schoolRepliedBy : latest?.repliedBy || row.schoolRepliedBy || '',
  };
}

export function collectSchoolReplies(entries = []) {
  return normaliseSchoolReplies(entries.flatMap((entry) => normaliseSchoolReplies(entry.schoolReplyEvidence)));
}

// A reply before a newer message in the same burst must not give that new
// arrival a "replied" cue. Legacy timestamp-only receipts remain useful.
export function getClusterReplyReceipt(entries = []) {
  const newestIncoming = Math.max(...entries.map((entry) => time(entry.messageAt || entry.capturedAt)));
  const receipts = entries.filter((entry) => Number.isFinite(time(entry.schoolRepliedAt)))
    .map((entry) => ({ repliedAt: entry.schoolRepliedAt, repliedBy: entry.schoolRepliedBy || 'School' }));
  const latest = receipts.sort((a, b) => time(b.repliedAt) - time(a.repliedAt))[0];
  return latest && Number.isFinite(newestIncoming) && time(latest.repliedAt) >= newestIncoming ? latest : null;
}

export function schoolReplierLabel(value = '') {
  const name = clean(value);
  return name && name !== 'me' ? name : 'School';
}
