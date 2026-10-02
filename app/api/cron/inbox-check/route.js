/** @fileoverview Secret-gated bounded automatic inbox classification sweep; no handling or reply actions. */
import { createIncomingAutoCheckPostHandler } from '@/lib/admin/incoming-auto-check-route.mjs';
import { automaticallyCheckIncomingMessages } from '@/lib/admin/incoming-classification-proposals';

export const POST = createIncomingAutoCheckPostHandler({ secret: () => process.env.SCHEDULE_REFRESH_SECRET,
  autoCheck: automaticallyCheckIncomingMessages });
