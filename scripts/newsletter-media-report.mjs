#!/usr/bin/env node
/**
 * Read-only reconciliation between newsletter media references and Google Drive.
 *
 *   node scripts/newsletter-media-report.mjs            # current month
 *   node scripts/newsletter-media-report.mjs 2026-09    # a specific month
 *
 * Answers two questions the upload path can leave open:
 *
 *  - **Orphans:** bytes sitting in Drive that no `Newsletter_Items` row points at.
 *    This is the expected residue when Drive accepted a file and the Sheets write
 *    then failed — the route reports that explicitly, but the file stays.
 *  - **Missing:** references with no file behind them. Treat with care: a Drive
 *    read can fail, and a human can move a file out of the month folder. This is
 *    never proof that a file was deleted.
 *
 * It deletes nothing and changes nothing. Removing a child's photograph is a
 * deliberate human act — see docs/policies/data-protection.md, which does not
 * authorise automated deletion.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './script-env.mjs';
import { currentIssueMonth, normaliseIssueMonth } from '../lib/admin/newsletter-helpers.mjs';
import { reconcileNewsletterMedia } from '../lib/admin/newsletter-media-reconcile.mjs';
import { getNewsletterDriveConfig, isNewsletterDriveConfigured } from '../lib/admin/newsletter-drive.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await loadLocalEnv(repoRoot);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function main() {
  const requested = process.argv[2] || '';
  const month = normaliseIssueMonth(requested) || currentIssueMonth();

  if (requested && !normaliseIssueMonth(requested)) {
    console.error(`"${requested}" is not a YYYY-MM month.`);
    process.exit(1);
  }

  if (!isNewsletterDriveConfigured()) {
    const { missing } = getNewsletterDriveConfig();
    console.error(`Drive is not configured here: missing ${missing.join(', ')}.`);
    console.error('Set DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET / DRIVE_REFRESH_TOKEN, or run this where they are set.');
    console.error('Mint a token with: node scripts/mint-drive-token.mjs');
    process.exit(1);
  }

  console.log(`\nFirst Chord — newsletter media reconciliation for ${month}\n`);

  const report = await reconcileNewsletterMedia({ issueMonth: month });
  if (report.error) {
    console.error(`Could not build the report: ${report.error}`);
    process.exit(1);
  }

  console.log(`Drive folder:        ${report.folderId}`);
  console.log(`Files in Drive:      ${report.driveCount}`);
  console.log(`Referenced by items: ${report.referencedCount}`);

  if (report.orphans.length) {
    console.log(`\n⚠ ${report.orphans.length} file(s) in Drive that no newsletter item references:\n`);
    for (const file of report.orphans) {
      console.log(`  ${file.fileName}`);
      console.log(`    id ${file.driveFileId} · ${formatBytes(file.bytes)} · created ${file.createdTime}`);
    }
    console.log('\n  These are usually an upload whose Sheets write failed. Re-attach or delete by hand.');
    console.log('  The file name carries the month, student name and FC student ID, so it can be traced.');
  } else {
    console.log('\n✓ No unreferenced files in Drive.');
  }

  if (report.missing.length) {
    console.log(`\n⚠ ${report.missing.length} reference(s) with no file in this month's folder:\n`);
    for (const id of report.missing) console.log(`  ${id}`);
    console.log('\n  NOT proof of deletion. Check whether the file was moved, or the Drive read failed,');
    console.log('  before changing anything. Never remove a reference to tidy this list.');
  } else {
    console.log('✓ Every reference has a file behind it.');
  }

  console.log('\nRead-only: nothing was changed or deleted.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
