/** @fileoverview Admin-only explicit Jev message checking and human-approved message details. */
import { getServerSession } from 'next-auth';
import { getIncomingMessageInboxPage } from '@/lib/admin/incoming-messages';
import { authOptions } from '@/lib/admin/auth';
import { createIncomingClassificationHandlers } from '@/lib/admin/incoming-classification-route.mjs';
import { isIncomingClassificationConfigured } from '@/lib/admin/incoming-classification-service.mjs';
import { getIncomingClassificationProposals, checkIncomingMessage, reviewIncomingClassification, automaticallyCheckIncomingMessages } from '@/lib/admin/incoming-classification-proposals';

const handlers = createIncomingClassificationHandlers({ session: () => getServerSession(authOptions),
  configured: isIncomingClassificationConfigured, list: getIncomingClassificationProposals,
  assess: checkIncomingMessage, review: reviewIncomingClassification, autoCheck: automaticallyCheckIncomingMessages,
  readActiveInbox: () => getIncomingMessageInboxPage({ statusScope: 'active', limit: 0 }) });
export const GET = handlers.GET;
export const POST = handlers.POST;
