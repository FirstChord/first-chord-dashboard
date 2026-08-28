import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_PLANNING_ID,
  buildBackupPlanningItem,
  buildBackupProgressNote,
  calculateNextBackupDate,
} from '../../lib/admin/backup-helpers.mjs';

test('calculateNextBackupDate covers the widest gap the backup schedule can leave', () => {
  // 17 days, not 14: the agent runs on the 1st and 15th, so the card must not
  // read as overdue during the longest legitimate gap between two runs.
  assert.equal(calculateNextBackupDate(new Date('2026-06-11T10:00:00Z')), '2026-06-28');
});

test('buildBackupPlanningItem preserves creation metadata and moves target date forward', () => {
  const item = buildBackupPlanningItem({
    completedAt: new Date('2026-06-11T10:00:00Z'),
    existingItem: {
      createdAt: '2026-06-01T09:00:00Z',
      createdBy: 'Finn',
    },
  });

  assert.equal(item.planningId, BACKUP_PLANNING_ID);
  assert.equal(item.status, 'waiting');
  assert.equal(item.area, 'admin');
  assert.equal(item.targetDate, '2026-06-28');
  assert.equal(item.createdAt, '2026-06-01T09:00:00Z');
  assert.equal(item.createdBy, 'Finn');
});

test('buildBackupProgressNote summarises backup manifest without row data', () => {
  const note = buildBackupProgressNote({
    tabs: [{ tabName: 'Students' }, { tabName: 'Issue_Queue' }],
    failedTabs: [],
    skippedTabs: [{ tabName: 'Students_Archive' }],
    outputDir: '/private/backup/path',
  });

  assert.match(note, /2 tabs backed up, 0 failed/);
  assert.match(note, /Skipped optional tabs: Students_Archive/);
  assert.match(note, /Backup folder: \/private\/backup\/path/);
});
