/** @fileoverview Read-only comparison of newsletter media references against the files actually in Google Drive, for orphan and missing-file recovery. */
// Separate from newsletter.js on purpose. That module reaches student context
// through `@/lib/admin/...` aliases, which Next resolves but plain `node` does
// not — so importing it from a terminal script fails. This module's whole import
// chain is relative, which is what lets `npm run newsletter:media-report` run
// outside the app.
//
// It deletes nothing. Removing a child's photograph is a deliberate human act;
// docs/policies/data-protection.md does not authorise automated deletion.
import { getNewsletterItemRows } from './sheets.js';
import { listNewsletterMediaFiles } from './newsletter-drive.js';
import { parseItemMedia } from './newsletter-media-helpers.mjs';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

export async function reconcileNewsletterMedia({ issueMonth = '', env = process.env } = {}) {
  const month = `${issueMonth || ''}`.trim();
  if (!MONTH_PATTERN.test(month)) {
    return { error: 'invalid_issue_month' };
  }

  const [items, drive] = await Promise.all([
    getNewsletterItemRows(month),
    listNewsletterMediaFiles({ issueMonth: month, env }),
  ]);

  const referenced = new Map();
  for (const item of items) {
    for (const entry of parseItemMedia(item.mediaJson)) {
      referenced.set(entry.driveFileId, {
        itemId: item.itemId,
        studentName: item.studentName,
        fileName: entry.fileName,
      });
    }
  }

  const driveIds = new Set(drive.files.map((file) => file.driveFileId));

  return {
    issueMonth: month,
    folderId: drive.folderId,
    driveCount: drive.files.length,
    referencedCount: referenced.size,
    // Bytes in Drive nothing points at — the expected residue when Drive accepted
    // a file and the Sheets write then failed. Re-attach or delete by hand.
    orphans: drive.files.filter((file) => !referenced.has(file.driveFileId)),
    // References with no file behind them. NOT proof of deletion: a Drive read can
    // fail, and a human can move a file out of the month folder.
    missing: [...referenced.entries()]
      .filter(([id]) => !driveIds.has(id))
      .map(([driveFileId, context]) => ({ driveFileId, ...context })),
  };
}
