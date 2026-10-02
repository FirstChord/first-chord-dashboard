/** @fileoverview Server-only Sheets and Jev wiring for inbox message checks. */
import { getIncomingMessageInboxRows, getProposalRows, upsertProposalRow, patchIncomingMessageClassification } from '@/lib/admin/sheets';
import { getOperationalAdminStudents } from './students';
import { evaluateJev } from './jev-provider.mjs';
import { createIncomingClassificationService } from './incoming-classification-service.mjs';

const service = createIncomingClassificationService({ readInbox: getIncomingMessageInboxRows,
  readProposals: getProposalRows, readStudents: getOperationalAdminStudents, saveProposal: upsertProposalRow,
  patchClassification: patchIncomingMessageClassification, evaluate: evaluateJev });
export const getIncomingClassificationProposals = service.list;
export const checkIncomingMessage = service.assess;
export const reviewIncomingClassification = service.review;
export const automaticallyCheckIncomingMessages = service.autoCheck;
