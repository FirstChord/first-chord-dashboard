import PayrollReminder from '@/components/finance/PayrollReminder';
import { payrollStatementFingerprint } from '@/lib/admin/payroll-batch-helpers.mjs';
import { getPayrollRunRows } from '@/lib/admin/sheets';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
import { loadTutorStatement } from '@/lib/admin/tutor-statement';
import { renderTutorStatementText, buildStatementToken } from '@/lib/admin/tutor-statement-helpers.mjs';
import TutorStatementView from '@/components/finance/TutorStatementView';
import CopyStatementButton from '@/components/finance/CopyStatementButton';
import StatementRecordActions from '@/components/finance/StatementRecordActions';
import SendStatementEmailButton from '@/components/finance/SendStatementEmailButton';
import { loadTutorPayrollPreference } from '@/lib/admin/tutor-payroll-preferences';

export const dynamic = 'force-dynamic';

async function buildShareLink({ payrollId, tutorShortName }) {
  const secret = process.env.NEXTAUTH_SECRET || '';
  if (!secret) return '';
  const token = buildStatementToken({ payrollId, tutorShortName, secret });
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || '';
  const proto = headerList.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const origin = process.env.NEXTAUTH_URL || (host ? `${proto}://${host}` : '');
  return origin ? `${origin.replace(/\/$/, '')}/pay/statement/${token}` : `/pay/statement/${token}`;
}

export default async function TutorStatementAdminPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">Not authorised.</div>;
  }

  const params = (await searchParams) || {};
  const payrollId = `${params.pid || ''}`.trim();
  const result = await loadTutorStatement({ payrollId });

  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin/finance/payroll" className="text-sm font-medium text-blue-700">← Payroll</Link>
        <h2 className="mt-3 text-2xl font-bold text-slate-800">Tutor statement</h2>
      </header>

      {result.notFound ? (
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 text-sm text-slate-500">
          No payroll row found for this link.
        </div>
      ) : result.notReady ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          This tutor’s pay isn’t reviewed yet — mark them <strong>reviewed</strong> on the payroll page to lock the figure, then generate the statement.
        </div>
      ) : (
        <StatementReady statement={result.statement} savedRow={result.savedRow} payrollId={payrollId} />
      )}
    </div>
  );
}

async function StatementReady({ statement, savedRow, payrollId }) {
  const text = renderTutorStatementText(statement);
  const shareLink = await buildShareLink({ payrollId, tutorShortName: statement.tutorShortName });
  const payrollPreference = await loadTutorPayrollPreference({ tutorShortName: statement.tutorShortName });
  const preference = payrollPreference.ok ? payrollPreference.preference : {};
  const raw = (await getPayrollRunRows()).find((row) => row.payroll_id === payrollId);

  return (
    <>
      <TutorStatementView statement={statement} />
      <StatementRecordActions reference={statement.reference} isReceipt={statement.documentType === 'receipt'} />

      {statement.documentType === 'statement' ? (
        <section className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Email to tutor</p>
          <div className="mt-3">
            <SendStatementEmailButton
              payrollId={payrollId}
              recipient={preference.contactEmail || ''}
              verified={Boolean(preference.contactEmailVerifiedAt)}
              deliveryStatus={savedRow.statementDeliveryStatus || ''}
              sentAt={savedRow.statementSentAt || ''}
            />
          </div>
        </section>
      ) : null}

      {statement.documentType === 'statement' && shareLink && raw && savedRow.tutorResponse !== 'disputed' && !statement.attendanceChanged && !statement.hasUnrecorded ? (
        <PayrollReminder payrollId={payrollId} fingerprint={payrollStatementFingerprint(raw)} tutor={statement.tutor} periodStart={statement.periodStart} periodEnd={statement.periodEnd} statementUrl={shareLink} alreadySent={Boolean(savedRow.statementSentAt)} />
      ) : null}
      {savedRow.tutorResponse === 'disputed' ? <p className="text-sm text-amber-800">Resolve the query and save any correction in Payroll before sharing a revised statement.</p> : null}
      <details className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
        <summary className="cursor-pointer text-sm text-slate-600">Other sharing options</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyStatementButton text={text} label="Copy statement text" />
          {shareLink ? <CopyStatementButton text={shareLink} label="Copy private link" markSentPayrollId={savedRow.statementSentAt ? '' : payrollId} /> : null}
        </div>
        {shareLink ? (
          <p className="mt-3 break-all rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {shareLink}
          </p>
        ) : (
          <p className="mt-3 text-xs text-amber-700">Share link unavailable (NEXTAUTH_SECRET not set) — copy the text instead.</p>
        )}
        <p className="mt-2 text-[0.7rem] leading-4 text-slate-400">
          The private link lets this tutor confirm or query their statement without a login. Copy it, share it in a private one-to-one conversation, then mark it sent. Use this only when email is unavailable or after checking an uncertain Gmail result.
        </p>
      </details>
    </>
  );
}
