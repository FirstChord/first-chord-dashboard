/** @fileoverview Secret-only bounded checker for staff-approved exact payroll periods, never autonomous payment. */
import { createPayrollDeferredPostHandler } from '@/lib/admin/payroll-deferred-route.mjs';
import { payrollDeferredEnabled } from '@/lib/admin/payroll-delivery-store.mjs';
import { checkDeferredPayroll } from '@/lib/admin/payroll-deferred-delivery';

export const dynamic = 'force-dynamic';
export const POST = createPayrollDeferredPostHandler({ secret: () => process.env.SCHEDULE_REFRESH_SECRET || '',
  enabled: () => payrollDeferredEnabled(), check: () => checkDeferredPayroll() });
