/** @fileoverview Sheets adapter reading and upserting Proposals rows. */
import {
  ensureManagedSheet,
  getSheetValues,
  getSheetsClient,
  getSheetsEnv,
  mapRowsToObjectsWithRowNumbers,
  PROPOSALS_HEADERS,
  PROPOSALS_SHEET,
  upsertManagedSheetRow,
} from './core.mjs';

export async function getProposalRows({ force = false } = {}) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    return [];
  }

  await ensureManagedSheet({
    sheets,
    spreadsheetId,
    sheetName: PROPOSALS_SHEET,
    requiredHeaders: PROPOSALS_HEADERS,
  });

  const values = await getSheetValues(PROPOSALS_SHEET, { force });

  return mapRowsToObjectsWithRowNumbers(values).map((row) => ({
    rowNumber: row.__rowNumber,
    proposalId: row.proposal_id || '',
    lane: row.lane || '',
    createdAt: row.created_at || '',
    createdBy: row.created_by || '',
    status: row.status || '',
    linkedId: row.linked_id || '',
    mmsId: row.mms_id || '',
    evidenceJson: row.evidence_json || '',
    proposalBody: row.proposal_body || '',
    appliedBody: row.applied_body || '',
    decidedBy: row.decided_by || '',
    decidedAt: row.decided_at || '',
    rejectionReason: row.rejection_reason || '',
    appliedAt: row.applied_at || '',
  }));
}

export function buildProposalSheetRow(row) {
  return {
    proposal_id: row.proposalId || '',
    lane: row.lane || '',
    created_at: row.createdAt || '',
    created_by: row.createdBy || '',
    status: row.status || '',
    linked_id: row.linkedId || '',
    mms_id: row.mmsId || '',
    evidence_json: row.evidenceJson || '',
    proposal_body: row.proposalBody || '',
    applied_body: row.appliedBody || '',
    decided_by: row.decidedBy || '',
    decided_at: row.decidedAt || '',
    rejection_reason: row.rejectionReason || '',
    applied_at: row.appliedAt || '',
  };
}

export async function upsertProposalRow(row) {
  const { spreadsheetId } = getSheetsEnv();
  const sheets = await getSheetsClient();

  if (!sheets || !spreadsheetId) {
    throw new Error('Google Sheets admin credentials are not configured');
  }

  const valuesByHeader = buildProposalSheetRow(row);
  await upsertManagedSheetRow({
    sheets,
    spreadsheetId,
    sheetName: PROPOSALS_SHEET,
    requiredHeaders: PROPOSALS_HEADERS,
    valuesByHeader,
    matchesRow: (entry, headers) => `${entry[headers.indexOf('proposal_id')] || ''}`.trim() === row.proposalId,
  });
}
