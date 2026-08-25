import Link from 'next/link';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import {
  buildStripeCustomerDashboardUrl,
  DEFAULT_STRIPE_DASHBOARD_BASE_URL,
} from '@/lib/admin/stripe-dashboard-helpers.mjs';

const STRIPE_DASHBOARD_BASE = process.env.NEXT_PUBLIC_STRIPE_DASHBOARD_BASE_URL
  || DEFAULT_STRIPE_DASHBOARD_BASE_URL;

function normaliseSearch(value = '') {
  return value.toString().trim().toLowerCase();
}

function getSearchQuery(searchParams = {}) {
  const value = searchParams.q;
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function getPaymentExpectationFilter(searchParams = {}) {
  const value = searchParams.paymentExpectation;
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function studentMatchesSearch(student, query) {
  if (!query) return true;

  return [
    student.fullName,
    student.firstName,
    student.lastName,
    student.tutor,
    student.instrument,
    student.email,
    student.parentEmail,
    student.contactNumber,
    student.mmsId,
  ].some((value) => normaliseSearch(value).includes(query));
}

function studentMatchesPaymentExpectation(student, paymentExpectation) {
  if (!paymentExpectation) return true;
  return student.paymentExpectation === paymentExpectation;
}

function getPaymentExpectationLabel(value = '') {
  const labels = {
    setup_pending: 'payment setup pending',
    stripe_active_expected: 'Stripe active expected',
    stripe_paused_expected: 'Stripe paused expected',
    inactive_or_stopped: 'inactive / stopped',
  };

  return labels[value] || value;
}

function StripeLinkageSummary({ student }) {
  const hasCustomer = Boolean(student.stripeCustomerId);
  const hasSubscription = Boolean(student.stripeSubscriptionId);
  const stripeCustomerUrl = buildStripeCustomerDashboardUrl(
    student.stripeCustomerId,
    STRIPE_DASHBOARD_BASE,
  );

  return (
    <div className="space-y-1 text-xs text-slate-600">
      <p className="font-medium text-slate-800">{getPaymentExpectationLabel(student.paymentExpectation) || 'No expectation'}</p>
      <p>
        Customer {hasCustomer ? 'linked' : 'missing'} · Subscription {hasSubscription ? 'linked' : 'missing'}
      </p>
      {stripeCustomerUrl ? (
        <a
          href={stripeCustomerUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${student.fullName || student.mmsId}'s Stripe customer page`}
          className="inline-flex font-medium text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline"
        >
          Stripe customer ↗
        </a>
      ) : null}
    </div>
  );
}

export default async function AdminStudentsPage({ searchParams }) {
  const students = await getOperationalAdminStudents();
  const resolvedSearchParams = await searchParams;
  const rawQuery = getSearchQuery(resolvedSearchParams);
  const paymentExpectationFilter = getPaymentExpectationFilter(resolvedSearchParams);
  const query = normaliseSearch(rawQuery);
  const filteredStudents = paymentExpectationFilter
    ? students.filter((student) => studentMatchesPaymentExpectation(student, paymentExpectationFilter))
    : students;
  const visibleStudents = query
    ? filteredStudents.filter((student) => studentMatchesSearch(student, query))
    : filteredStudents;
  const isSetupQueue = paymentExpectationFilter === 'setup_pending';

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Operational records</p>
        <h2
          className="mt-2 fc-display text-3xl text-slate-900"
        >
          Students
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Read-only merged list from the Sheets identity lane plus registry portal lane. Use this as a lookup surface and lightweight setup queue.
        </p>
      </div>

      <form action="/admin/students" className="rounded-[1.2rem] border border-blue-100 bg-white/85 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
        <label htmlFor="student-search" className="text-sm font-medium text-slate-700">Find student</label>
        {paymentExpectationFilter ? (
          <input type="hidden" name="paymentExpectation" value={paymentExpectationFilter} />
        ) : null}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="student-search"
            type="search"
            name="q"
            defaultValue={rawQuery}
            placeholder="Name, tutor, email, instrument, or MMS ID"
            className="h-10 flex-1 rounded-full border border-blue-200/70 bg-white px-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300"
          />
          <button
            type="submit"
            className="h-10 rounded-full border border-blue-200/70 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-slate-900"
          >
            Search
          </button>
        </div>
        {paymentExpectationFilter ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">
              Filter: {getPaymentExpectationLabel(paymentExpectationFilter)}
            </span>
            <Link href="/admin/students" className="font-medium text-slate-700 underline-offset-4 hover:underline">
              Clear filter
            </Link>
          </div>
        ) : null}
        {query ? (
          <p className="mt-3 text-sm text-slate-600">
            Showing {visibleStudents.length} of {filteredStudents.length} records for "{rawQuery}".
          </p>
        ) : null}
      </form>

      {isSetupQueue ? (
        <section className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-950 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
          <p className="font-semibold">Payment setup queue</p>
          <p className="mt-1">
            These students are intentionally marked as setup pending. Missing Stripe IDs usually means setup work is still open; both IDs present usually means the expectation should be reviewed and marked complete.
          </p>
        </section>
      ) : null}

      <div className="overflow-hidden rounded-[1.6rem] border border-blue-100 bg-white/90 shadow-[0_12px_36px_rgba(15,23,42,0.06)] backdrop-blur-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-blue-50/70">
            <tr>
              {['Name', 'Tutor', 'Instrument', 'Email', 'Contact', 'Payment', 'MMS ID', 'Flags'].map((header) => (
                <th
                  key={header}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleStudents.map((student, index) => (
              <tr key={`${student.mmsId}-${student.tutor || 'no-tutor'}-${index}`} className="transition hover:bg-blue-50/60">
                <td className="px-4 py-3">
                  <Link href={`/admin/students/${student.mmsId}`} className="font-medium text-slate-900 hover:underline">
                    {student.fullName || student.mmsId}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{student.tutor || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{student.instrument || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{student.email || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{student.contactNumber || '—'}</td>
                <td className="px-4 py-3"><StripeLinkageSummary student={student} /></td>
                <td className="px-4 py-3 text-sm text-slate-700">{student.mmsId}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {student.hasFlags ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                      {student.flags.length} flag{student.flags.length === 1 ? '' : 's'}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {!visibleStudents.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-sm text-slate-600">
                  No matching student records found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
