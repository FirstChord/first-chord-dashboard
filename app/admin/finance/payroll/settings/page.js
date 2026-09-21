/** @fileoverview Admin surface for verified tutor payroll contact emails and payment cadence. */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { getActiveTutorOptions } from '@/lib/admin/tutors';
import {
  loadTutorPayrollPreferences,
  saveTutorPayrollAdminSettings,
} from '@/lib/admin/tutor-payroll-preferences';

export const dynamic = 'force-dynamic';

const REASONS = {
  invalid_cadence: 'Choose weekly or every two weeks.',
  invalid_email: 'Enter one valid email address.',
  reviewed_run_exists: 'This tutor has a reviewed unpaid statement. Pay or reopen it before changing cadence.',
  unknown_tutor: 'That tutor is not recognised.',
};

async function saveSettingsAction(formData) {
  'use server';
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');

  const tutorShortName = `${formData.get('tutor') || ''}`.trim();
  const result = await saveTutorPayrollAdminSettings({
    tutorShortName,
    cadence: formData.get('invoice_cadence'),
    contactEmail: formData.get('contact_email'),
    verifyContactEmail: formData.get('verify_contact_email') === 'yes',
    actorEmail: session.user.email || '',
  });
  const query = new URLSearchParams({ tutor: tutorShortName });
  if (result.ok) query.set('saved', '1');
  else query.set('error', result.reason || 'save_failed');
  revalidatePath('/admin/finance/payroll');
  revalidatePath('/admin/finance/payroll/settings');
  redirect(`/admin/finance/payroll/settings?${query}`);
}

export default async function TutorPayrollSettingsPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">Not authorised.</div>;
  }

  const params = (await searchParams) || {};
  const tutors = await getActiveTutorOptions();
  const loaded = await loadTutorPayrollPreferences({ tutorShortNames: tutors.map((tutor) => tutor.shortName) });
  const rows = loaded.filter((entry) => entry.ok);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="border-b border-slate-200 pb-6">
        <Link href="/admin/finance/payroll" className="text-sm font-medium text-blue-700">← Payroll</Link>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-slate-950">Tutor delivery settings</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Store the private address used for pay statements and carry forward the payment rhythm the tutor has already chosen. This is separate from their Wise recipient email.
        </p>
      </header>

      {params.saved === '1' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          Saved {params.tutor || 'tutor'}&apos;s payroll settings.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          {REASONS[params.error] || 'These settings could not be saved.'}
        </div>
      ) : null}

      <section className="rounded-[1.4rem] border border-blue-200 bg-blue-50/80 p-5 text-sm text-blue-950">
        <p className="font-semibold">Rollout order</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6">
          <li>Copy the tutor&apos;s existing weekly or every-two-weeks choice into the payment rhythm below.</li>
          <li>Enter and verify the private email address they want to receive pay statements at.</li>
          <li>Review each statement before sending its private confirmation link.</li>
        </ol>
        <p className="mt-2 text-xs text-blue-800">Tutors do not need to sign in or choose again. The emailed statement link lets them confirm or raise a query without a dashboard account.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ tutor, preference }) => (
          <form key={tutor.shortName} action={saveSettingsAction} className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm">
            <input type="hidden" name="tutor" value={tutor.shortName} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">{tutor.fullName}</h3>
                <p className="mt-1 text-xs text-slate-500">Tutor key: {tutor.shortName}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${preference.contactEmailVerifiedAt ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                  {preference.contactEmailVerifiedAt ? 'Email verified' : 'Email needed'}
                </span>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-semibold text-slate-600">Payroll contact email</span>
              <input
                type="email"
                name="contact_email"
                defaultValue={preference.contactEmail}
                placeholder="tutor@example.com"
                autoComplete="email"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              />
            </label>
            <label className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
              <input type="checkbox" name="verify_contact_email" value="yes" className="mt-1" />
              <span>Tick this only when you have checked the address with the tutor. An unchanged verified address stays verified; changing it clears the old verification unless you tick this.</span>
            </label>

            <label className="mt-4 block">
              <span className="text-xs font-semibold text-slate-600">Payment rhythm</span>
              <select name="invoice_cadence" defaultValue={preference.cadence} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
              </select>
            </label>
            {preference.hasReviewedUnpaidRun ? (
              <p className="mt-2 text-xs leading-5 text-amber-700">Cadence is locked while a reviewed statement is still unpaid. The contact address can still be corrected.</p>
            ) : preference.cadenceEffectiveFrom ? (
              <p className="mt-2 text-xs text-slate-500">Current choice effective from {preference.cadenceEffectiveFrom}.</p>
            ) : null}

            <button type="submit" className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              Save settings
            </button>
          </form>
        ))}
      </section>
    </div>
  );
}
