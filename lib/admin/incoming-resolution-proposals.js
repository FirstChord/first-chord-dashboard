/** @fileoverview Server-only Sheets wiring for Jev inbox resolution suggestions. */
import { getIncomingMessageInboxRows, getProposalRows, upsertProposalRow } from '@/lib/admin/sheets';
import { getOperationalAdminStudents } from './students';
import { evaluateJev } from './jev-provider.mjs';
import { createIncomingResolutionService } from './incoming-resolution-service.mjs';

const service = createIncomingResolutionService({ readInbox: getIncomingMessageInboxRows,
  readProposals: getProposalRows, readStudents: getOperationalAdminStudents,
  saveProposal: upsertProposalRow, evaluate: evaluateJev });
export const getIncomingResolutionProposals = service.list;
export const assessIncomingResolution = service.assess;
export const reviewIncomingResolution = service.feedback;
