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

export function buildStripeStudentDashboardLink(student = {}, baseUrl = DEFAULT_STRIPE_DASHBOARD_BASE_URL) {
  const base = `${baseUrl || DEFAULT_STRIPE_DASHBOARD_BASE_URL}`.trim().replace(/\/+$/u, '');
  const subscriptionId = `${student.stripeSubscriptionId || ''}`.trim();
  const customerId = `${student.stripeCustomerId || ''}`.trim();
  if (/^sub_[a-zA-Z0-9]+$/.test(subscriptionId)) {
    return { href: `${base}/subscriptions/${subscriptionId}`, label: 'Open Stripe subscription ↗', kind: 'subscription' };
  }
  if (/^cus_[a-zA-Z0-9]+$/.test(customerId)) {
    return { href: `${base}/customers/${customerId}`, label: 'Open Stripe customer ↗', kind: 'customer' };
  }
  return { href: `${base}/customers`, label: 'Find in Stripe ↗', kind: 'lookup' };
}
