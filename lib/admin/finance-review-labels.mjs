/** @fileoverview Evidence-based labels shared by finance server and client views. */
export const FINANCE_DIFFERENCE_LABELS = {
  paused_expected_but_collected: 'Paused in the forecast, but paid invoices recorded',
  inactive_but_collected: 'Not expected to bill, but paid invoices recorded',
  invoice_occurrence_timing: 'Whole lesson-price difference — cause unverified',
  no_paid_invoice: 'Predicted, but no paid invoice recorded',
  post_lock_onboarding: 'Joined after the prediction locked',
  unmatched_collection: 'Invoice money not linked to a student',
  price_difference: 'Small monthly-price difference',
  unforecast_collection: 'Paid invoices without a forecast item',
  unpriced_forecast: 'Dashboard could not price',
  amount_mismatch: 'Other amount difference',
};

