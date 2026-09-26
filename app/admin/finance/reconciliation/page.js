import ScopeBadge from '@/components/admin/ui/ScopeBadge';
import { SubmitButton } from '@/components/admin/ui/SubmitButton';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { getTutorAbsenceStateRows, getPauseHistoryRows, getTutorPayRows, updateStudentSheetRow, appendEventLogRow, getPlanningItemRows } from '@/lib/admin/sheets';
import { getOperationalAdminStudents } from '@/lib/admin/students';
import { savePlanningItem } from '@/lib/admin/planning.js';
import { parseTutorAbsenceStateRow, selectRedundantTutorAbsencePauseCards } from '@/lib/admin/tutor-absence-helpers.mjs';
import { parseTutorPay } from '@/lib/admin/cost-helpers.mjs';
import { buildReconciliationInputs } from '@/lib/admin/reconciliation-adapter.mjs';
import { reconcileEpisode } from '@/lib/admin/reconciliation-helpers.mjs';
import { formatMoney } from '@/lib/admin/finance-helpers.mjs';
import { authOptions } from '@/lib/admin/auth';

export const dynamic = 'force-dynamic';

// Loop-closing: resolve a conflict by correcting the live flag to paused (the common
// case — the pause is real, the flag was stale). Reuses the existing payment_expectation
// write + Event_Log audit; next recompute then agrees and the conflict clears. The
// opposite case (pause record is stale, student really active) is a Pause History data
// issue owned by Payment Pause — surfaced as guidance, not auto-written here.
async function confirmPausedAction(formData) {
  'use server';
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');
  const mmsId = `${formData.get('mms_id') || ''}`.trim();
  if (!mmsId) throw new Error('Missing student');
  const name = `${formData.get('student_name') || ''}`.trim();

  await updateStudentSheetRow(mmsId, { payment_expectation: 'stripe_paused_expected' });
  await appendEventLogRow({
    event_id: `recon_${Date.now()}_${mmsId}`,
    occurred_at: new Date().toISOString(),
    actor_email: session.user.email || '',
    entity_type: 'student',
    entity_id: mmsId,
    event_type: 'reconciliation_confirmed_paused',
    mms_id: mmsId,
    student_name: name,
    issue_id: '',
    payload_json: JSON.stringify({ source: 'absence_reconciliation', set: 'stripe_paused_expected', reason: 'pause record confirmed over absence dates' }),
  });
  revalidatePath('/admin/finance/reconciliation');
}

// Cross-lane card retirement: park the now-redundant tutor-absence pause card(s) for a
// student whose own pause covers those dates. Guarded server-side — only ever parks an
// OPEN card whose id is a tutor-absence pause card (never trusts the form blindly).
async function closeRedundantAbsenceCardAction(formData) {
  'use server';
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) throw new Error('Not authorised');
  const ids = `${formData.get('planning_ids') || ''}`.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return;

  const rows = await getPlanningItemRows();
  const byId = new Map(rows.map((r) => [r.planningId, r]));
  for (const id of ids) {
    const existing = byId.get(id);
    if (!existing) continue;
    if (!`${existing.planningId}`.startsWith('planning_tutor_absence_pause')) continue;
    if (['parked', 'done', 'resolved'].includes(`${existing.status || ''}`.trim().toLowerCase())) continue;
    await savePlanningItem({
      planningId: id,
      item: { ...existing, status: 'parked', nextAction: "Superseded — the student's own pause covers these absence dates." },
      actorEmail: session.user.email || '',
      progressNote: 'Parked from absence reconciliation: the student’s own pause now covers these tutor-absence dates.',
    });
  }
  revalidatePath('/admin/finance/reconciliation');
}

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function FamilyRow({ ep, name, action = null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <span className="text-slate-800">{name || ep.studentMmsId}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">
          {fmtDate(ep.window.start)}–{fmtDate(ep.window.end)} · {ep.affectedDates.length} lesson(s)
          {ep.netNewDates.length ? ` · ${ep.netNewDates.length} net-new` : ''}
          {ep.remainingActions.length ? ` · ${ep.remainingActions.join(', ')}` : ''}
        </span>
        {action}
      </div>
    </div>
  );
}

export default async function ReconciliationPreviewPage({ searchParams }) {
  const params = (await searchParams) || {};
  const tutorFilter = `${params.tutor || ''}`.trim();

  const [absenceRaw, pauseRows, tutorPayRows, students, planningRows] = await Promise.all([
    getTutorAbsenceStateRows(),
    getPauseHistoryRows(),
    getTutorPayRows(),
    getOperationalAdminStudents(),
    getPlanningItemRows(),
  ]);
  const absenceRows = absenceRaw.map(parseTutorAbsenceStateRow);
  const tutorPay = parseTutorPay(tutorPayRows);
  const studentsByMmsId = new Map(students.map((s) => [s.mmsId, s]));

  const tutors = [...new Set(
    absenceRows.filter((r) => r.decision === 'cancel_day' || r.decision === 'cover').map((r) => r.tutorShortName).filter(Boolean),
  )].sort();

  let result = null;
  let nameByMmsId = new Map();
  if (tutorFilter) {
    const inputs = buildReconciliationInputs({ absenceRows, pauseRows, tutorPay, studentsByMmsId, tutorFilter });
    nameByMmsId = new Map(inputs.lessonInstances.map((i) => [i.studentMmsId, i.studentName]));
    result = reconcileEpisode(inputs);
  }

  const conflicts = result ? result.familyEpisodes.filter((e) => e.needsClarification) : [];
  const suppressed = result ? result.familyEpisodes.filter((e) => !e.needsClarification && e.netNewDates.length === 0 && e.affectedDates.length > 0) : [];
  const netNew = result ? result.familyEpisodes.filter((e) => !e.needsClarification && e.netNewDates.length > 0) : [];

  // Covered students may have a lingering "pause them for the absence" card the absence
  // workflow created before they paused themselves — offer to close it (it's subsumed).
  const redundantByStudent = new Map(
    selectRedundantTutorAbsencePauseCards({
      planningItems: planningRows,
      coveredStudentMmsIds: suppressed.map((e) => e.studentMmsId),
      tutorShortName: tutorFilter,
    }).map((entry) => [entry.studentMmsId, entry.planningIds]),
  );

  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin/finance" className="text-xs font-medium text-slate-500 hover:text-slate-800">
          ← Finance
        </Link>
        <p className="mt-2 text-xs uppercase tracking-[0.25em] text-slate-500">Internal</p>
        <h2 className="mt-2 flex items-center gap-3 fc-display text-2xl text-slate-900">
          Absence reconciliation
          <ScopeBadge>Shadow view — changes nothing</ScopeBadge>
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          The net-new effect of a tutor absence after each student&apos;s own pauses. Conflicts wait for your confirmation.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold uppercase tracking-[0.14em] text-slate-500">Tutor:</span>
        {tutors.length ? tutors.map((t) => (
          <Link
            key={t}
            href={`/admin/finance/reconciliation?tutor=${encodeURIComponent(t)}`}
            className={`rounded-full border px-3 py-1 ${tutorFilter === t ? 'border-blue-300 bg-blue-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {t}
          </Link>
        )) : <span className="text-slate-500">No tutor-absence cancellations recorded.</span>}
      </div>

      {!tutorFilter ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Pick a tutor to preview their absence reconciliation.</p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-blue-100 bg-white/90 p-4">
              <p className="text-xs text-slate-500">Net-new revenue effect</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">−{formatMoney(result.finance.netNewRevenueLost)}</p>
              <p className="mt-1 text-xs text-slate-600">{result.finance.netNewNotBillingStudentWeeks} student-week(s) newly not billing</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
              <p className="text-xs text-slate-500">Tutor pay effect</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{formatMoney(result.finance.netNewOriginalPaySaved - result.finance.netNewCoverPayAdded)}</p>
              <p className="mt-1 text-xs text-slate-600">£0 if the absent tutor is salaried</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs text-slate-500">Families</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{netNew.length} new · {suppressed.length} covered</p>
              <p className="mt-1 text-xs text-slate-600">{conflicts.length} need confirming</p>
            </div>
          </section>

          {conflicts.length ? (
            <section className="rounded-[1.6rem] border border-rose-200 bg-rose-50 p-5">
              <h3 className="text-base font-semibold text-slate-900">Confirm these ({conflicts.length})</h3>
              <p className="mt-1 text-sm text-rose-900">
                A pause record covers these dates, but the student is flagged active. Either the pause is real (suppress) or
                the flag is right and the pause record is stale. Check before relying on the numbers.
              </p>
              <div className="mt-2 divide-y divide-rose-100">
                {conflicts.map((ep) => (
                  <FamilyRow
                    key={ep.studentMmsId}
                    ep={ep}
                    name={nameByMmsId.get(ep.studentMmsId)}
                    action={(
                      <form action={confirmPausedAction}>
                        <input type="hidden" name="mms_id" value={ep.studentMmsId} />
                        <input type="hidden" name="student_name" value={nameByMmsId.get(ep.studentMmsId) || ''} />
                        <SubmitButton variant="danger" size="compact" pendingLabel="Confirming…">
                          Confirm paused (fix flag)
                        </SubmitButton>
                      </form>
                    )}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-rose-900">
                If instead the student is genuinely active (the pause record is stale), leave the flag and clean up that
                pause in Payment Pause — don&apos;t confirm here.
              </p>
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.6rem] border border-blue-100 bg-white/90 p-5">
              <h3 className="text-base font-semibold text-slate-900">Net-new — need a pause + message ({netNew.length})</h3>
              <div className="mt-2 divide-y divide-slate-100">
                {netNew.length ? netNew.map((ep) => <FamilyRow key={ep.studentMmsId} ep={ep} name={nameByMmsId.get(ep.studentMmsId)} />)
                  : <p className="px-3 py-2 text-sm text-slate-500">None.</p>}
              </div>
            </div>
            <div className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/50 p-5">
              <h3 className="text-base font-semibold text-slate-900">Already covered by their own pause ({suppressed.length})</h3>
              <p className="mt-1 text-xs text-slate-600">No new finance effect, no message needed.</p>
              <div className="mt-2 divide-y divide-emerald-100">
                {suppressed.length ? suppressed.map((ep) => {
                  const cardIds = redundantByStudent.get(ep.studentMmsId) || [];
                  return (
                    <FamilyRow
                      key={ep.studentMmsId}
                      ep={ep}
                      name={nameByMmsId.get(ep.studentMmsId)}
                      action={cardIds.length ? (
                        <form action={closeRedundantAbsenceCardAction}>
                          <input type="hidden" name="planning_ids" value={cardIds.join(',')} />
                          <SubmitButton variant="green" size="compact" pendingLabel="Closing…">
                            Close redundant card{cardIds.length > 1 ? ` (${cardIds.length})` : ''}
                          </SubmitButton>
                        </form>
                      ) : null}
                    />
                  );
                }) : <p className="px-3 py-2 text-sm text-slate-500">None.</p>}
              </div>
            </div>
          </section>

          <p className="text-xs text-slate-500">
            Read-only shadow over the absence facts + Pause History. Estimate (standard lesson pricing). Nothing here is
            written, sent, or fed into finance — it&apos;s for confirming the real net effect of an absence.
          </p>
        </>
      )}
    </div>
  );
}
