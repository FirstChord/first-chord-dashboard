/** @fileoverview Pure Stripe Dashboard URL construction shared by admin review surfaces. */

export const DEFAULT_STRIPE_DASHBOARD_BASE_URL = 'https://dashboard.stripe.com';

export function buildStripeCustomerDashboardUrl(
  customerId,
  baseUrl = DEFAULT_STRIPE_DASHBOARD_BASE_URL,
) {
  const normalisedCustomerId = `${customerId || ''}`.trim();
  if (!normalisedCustomerId) return '';

  const normalisedBaseUrl = `${baseUrl || DEFAULT_STRIPE_DASHBOARD_BASE_URL}`
    .trim()
    .replace(/\/+$/u, '');

  return `${normalisedBaseUrl}/customers/${encodeURIComponent(normalisedCustomerId)}`;
}
