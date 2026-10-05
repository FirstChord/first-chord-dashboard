import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollPreview } from '../../lib/admin/payroll-helpers.mjs';
import { ADMIN_TUTORS } from '../../lib/admin/tutors-data.js';
import { parseTutorPay } from '../../lib/admin/cost-helpers.mjs';
import { deferredPayrollScope, deferredPayrollEligibility, decideDeferredPayroll } from '../../lib/admin/payroll-deferred-helpers.mjs';
import { runDeferredPayrollChecks, prepareDeferredPayroll, cancelDeferredPayrollApproval } from '../../lib/admin/payroll-deferred-runner.mjs';
import { createPayrollDeliveryStore, withPayrollDeliveryLock, payrollEmailClaimKey, payrollDeferredEnabled, ensurePayrollDeliveryTables } from '../../lib/admin/payroll-delivery-store.mjs';
import { deliverPayrollEmail } from '../../lib/admin/payroll-email-runner.mjs';
import { createPayrollDeferredPostHandler } from '../../lib/admin/payroll-deferred-route.mjs';
import { buildPayrollQueue } from '../../lib/admin/payroll-queue-helpers.mjs';

const now = () => new Date('2026-10-05T12:00:00Z');
const actor = 'tom@example.test';
function evidence({ status = 'Unrecorded', note = '', existing = {} } = {}) {
  existing = existing === null ? null : { records_nudge_status: 'sent', records_nudge_to: 'tutor@example.test', records_nudge_sent_at: '2026-10-05T10:00:00Z', ...existing };
  const rows = [{ ID: 'attendance-1', EventID: 'event-1', TeacherID: ADMIN_TUTORS.Robbie.teacherId,
    StudentID: 'student-1', StudentFullName: 'Fixture Student', EventStartDate: '2026-10-01T16:00:00Z',
    EventDuration: 60, AttendanceStatus: status, StudentNote: note }];
  const savedRuns = [{ payroll_id: 'paid-boundary', tutor_short_name: 'Robbie', tutor: ADMIN_TUTORS.Robbie.fullName,
    status: 'paid', period_start: '2026-09-21', period_end: '2026-09-27', final_amount: 24 }, ...(existing ? [existing] : [])];
  const tutorPay = parseTutorPay([{ tutor: 'Robbie', hourly_rate: 24, pay_model: 'hourly', invoice_cadence: 'weekly',
    contact_email: 'tutor@example.test', contact_email_verified_at: '2026-09-20T10:00:00Z' }]);
  const preview = buildPayrollPreview({ attendanceRows: rows, tutorPay, savedRuns, payDate: '2026-10-05', now: now(),
    attendanceRange: { startDate: '2026-09-28', endDate: '2026-10-04' } });
  const row = preview.rows.find((entry) => entry.tutorShortName === 'Robbie');
  assert.ok(row);
  return { row, existing, runs: savedRuns, standardWindow: row, active: true };
}
function approval(e = evidence()) {
  return { id: 'job-1', payroll_id: e.row.payrollId, tutor_short_name: 'Robbie', status: 'waiting',
    scope: deferredPayrollScope(e), approved_by: actor, expires_at: '2026-10-19T12:00:00Z' };
}
function memoryStore(initial = approval()) {
  const jobs = new Map(initial ? [[initial.id, structuredClone(initial)]] : []);
  const claims = new Map();
  return {
    jobs, claims,
    async waiting(limit) { return [...jobs.values()].filter((job) => job.status === 'waiting').slice(0, limit).map((job) => structuredClone(job)); },
    async get(id) { return structuredClone(jobs.get(id)); },
    async prepare(scope, approvedBy) {
      assert.ok(![...jobs.values()].some((job) => ['waiting', 'preparing', 'claimed'].includes(job.status)));
      const job = { ...approval(), scope, approved_by: approvedBy, status: 'preparing' };
      jobs.set(job.id, job); return job;
    },
    async transition(id, from, status, reason = '') {
      const job = jobs.get(id);
      if (job?.status !== from) return null;
      job.status = status; job.reason = reason; return structuredClone(job);
    },
    async claimEmail(claim) { if (claims.has(claim.key)) return false; claims.set(claim.key, 'claimed'); return true; },
    async finishEmail(key, status) { claims.set(key, status); },
  };
}
function run({ store = memoryStore(), fresh = evidence(), review = async () => {}, send = async () => ({ ok: true }) } = {}) {
  return runDeferredPayrollChecks({ store, lock: async (tutor, action) => action(), loadEvidence: async () => fresh, review, send, now });
}

test('a missing-records approval binds the exact standard period and stable IDs, not attendance or note content', () => {
  const pending = evidence();
  const completed = evidence({ status: 'Present', note: 'Practice scales' });
  assert.equal(deferredPayrollEligibility({ row: pending.row, scope: deferredPayrollScope(pending) }).ok, true);
  assert.deepEqual(deferredPayrollScope(pending), deferredPayrollScope(completed));
  // JSONB can return object properties in a different order.
  const job = approval(pending);
  job.scope = Object.fromEntries(Object.entries(job.scope).reverse());
  assert.equal(decideDeferredPayroll({ job, evidence: completed, now: now() }).action, 'send');
  assert.equal(decideDeferredPayroll({ job, evidence: pending, now: now() }).action, 'wait');
});

test('a completed checklist freezes the fresh amount, attributes approval and sends once without payment', async () => {
  const store = memoryStore();
  const existing = { payroll_id: approval().payroll_id, tutor_short_name: 'Robbie', status: 'draft',
    expected_amount: 0, final_amount: 0, updated_at: '2026-10-05T10:00:00Z' };
  const fresh = evidence({ status: 'Present', note: 'Practice scales', existing });
  const writes = [], sends = [];
  const options = { store, fresh, review: async (payload) => writes.push(payload), send: async (payload) => { sends.push(payload); return { ok: true }; } };
  const result = await run(options);
  assert.equal(result.sent, 1);
  assert.equal(writes[0].final_amount, 24); // not the old zero preview
  assert.equal(writes[0].payment_route, 'confirmation');
  assert.equal(writes[0].reviewed_by, actor);
  assert.equal(writes[0].paid_at, ''); assert.equal(writes[0].tutor_response, '');
  assert.equal(sends[0].expectedRecipient, 'tutor@example.test');
  await run(options);
  assert.equal(sends.length, 1); assert.equal(writes.length, 1);
  assert.equal(store.jobs.get('job-1').status, 'sent');
});

test('incomplete attendance or notes stays waiting without review, send, or additional checklist', async () => {
  for (const fresh of [evidence(), evidence({ status: 'Present' })]) {
    const store = memoryStore();
    const counts = await run({ store, fresh, review: () => assert.fail('review'), send: () => assert.fail('send') });
    assert.equal(counts.waiting, 1); assert.equal(store.jobs.get('job-1').status, 'waiting');
  }
});

test('every changed administrative or structural scope comes back to staff', () => {
  const changes = [
    (e) => { e.row.contactEmail = 'other@example.test'; },
    (e) => { e.row.contactEmailVerifiedAt = ''; },
    (e) => { e.row.hourlyRate = 30; },
    (e) => { e.row.adjustmentAmount = 12; },
    (e) => { e.row.invoiceCadence = 'biweekly'; },
    (e) => { e.row.periodEnd = '2026-10-03'; },
    (e) => { e.row.payDate = '2026-10-12'; },
    (e) => { e.existing = { notes: 'New school decision' }; },
    (e) => { e.existing = { record_exceptions_json: '[]' }; },
    (e) => { e.existing = { invoice_status: 'received' }; },
    (e) => { e.active = false; },
    (e) => { e.standardWindow = { periodStart: '2026-10-01', periodEnd: e.row.periodEnd }; },
    (e) => { e.row.payableSlots[0].durationMinutes = 90; },
    (e) => { e.row.payableSlots[0].teacherId = 'other-teacher'; },
    (e) => { e.row.payableSlots[0].students[0].attendanceId = 'replacement'; },
    (e) => { e.row.payableSlots[0].students[0].studentId = 'other-student'; },
    (e) => { e.row.payableSlots = []; },
  ];
  for (const change of changes) {
    const fresh = evidence({ status: 'Present', note: 'Done' }); change(fresh);
    assert.equal(decideDeferredPayroll({ job: approval(), evidence: fresh, now: now() }).action, 'hold');
  }
});

test('queries, unknown statuses, overlaps, stale zero evidence, legacy, open or not-due periods never auto-send', () => {
  for (const [field, value] of Object.entries({ tutorResponse: 'disputed', priorRunPending: {}, overlapsPaid: {},
    overlapsOutstanding: {}, overlapsNoPaymentDue: {}, noPaymentDueConflict: {}, periodOpen: true,
    cadenceDue: false, legacyNeedsReconciliation: true, isCutover: true, windowCapped: true, status: 'paid',
    statementDeliveryStatus: 'unknown', statementSentAt: '2026-10-05' })) {
    const fresh = evidence({ status: 'Present', note: 'Done' }); fresh.row[field] = value;
    assert.equal(decideDeferredPayroll({ job: approval(), evidence: fresh, now: now() }).action, 'hold', field);
  }
  const unknown = evidence({ status: 'UnrecognisedProviderStatus' });
  assert.equal(decideDeferredPayroll({ job: approval(), evidence: unknown, now: now() }).action, 'hold');
  const missingId = evidence(); missingId.row.reviewSlots[0].students[0].attendanceId = '';
  assert.equal(deferredPayrollEligibility({ row: missingId.row, scope: deferredPayrollScope(missingId) }).ok, false);
  for (const status of ['', 'sending', 'unknown']) {
    const fresh = evidence({ status: 'Present', note: 'Done', existing: { records_nudge_status: status } });
    assert.equal(decideDeferredPayroll({ job: approval(), evidence: fresh, now: now() }).action, 'hold');
  }
  assert.equal(decideDeferredPayroll({ job: approval(), evidence: evidence({ status: 'Present', note: 'Done', existing: null }), now: now() }).action, 'hold');
});

test('tutor absence resolving the checklist to zero holds for the explicit zero close-out', async () => {
  const store = memoryStore();
  const counts = await run({ store, fresh: evidence({ status: 'TeacherAbsentNoMakeup' }), send: () => assert.fail('send'), review: () => assert.fail('review') });
  assert.equal(counts.held, 1); assert.match(store.jobs.get('job-1').reason, /£0/);
});

test('two overlapping workers share one atomic approval claim', async () => {
  const store = memoryStore(); let writes = 0, sends = 0;
  const options = { store, fresh: evidence({ status: 'Present', note: 'Done' }),
    review: async () => { writes++; }, send: async () => { sends++; return { ok: true }; } };
  await Promise.all([run(options), run(options)]);
  assert.equal(writes, 1); assert.equal(sends, 1);
});

test('cancelled, expired, interrupted, or unavailable periods cannot accidentally send', async () => {
  const store = memoryStore();
  await cancelDeferredPayrollApproval({ store, id: 'job-1', actor });
  await run({ store, send: () => assert.fail('send') });
  assert.match(store.jobs.get('job-1').reason, /Cancelled by tom/);
  for (const status of ['claimed', 'unknown', 'sent']) {
    const store = memoryStore({ ...approval(), status });
    await assert.rejects(cancelDeferredPayrollApproval({ store, id: 'job-1', actor }));
    await run({ store, send: () => assert.fail('send') });
  }
  const expired = memoryStore({ ...approval(), expires_at: '2026-10-05T11:00:00Z' });
  const expiredResult = await runDeferredPayrollChecks({ store: expired, lock: async (t, action) => action(),
    loadEvidence: () => assert.fail('source should not load for expired approval'), review: () => assert.fail(), send: () => assert.fail(), now });
  assert.equal(expiredResult.held, 1);
  const unavailable = memoryStore();
  const result = await runDeferredPayrollChecks({ store: unavailable, lock: async (t, action) => action(),
    loadEvidence: async () => { throw new Error('MMS unavailable'); }, review: () => assert.fail(), send: () => assert.fail(), now });
  assert.equal(result.unavailable, 1); assert.equal(unavailable.jobs.get('job-1').status, 'waiting');
});

test('a failed review or ambiguous send parks the claimed job instead of retrying', async () => {
  for (const stage of ['review', 'send']) {
    const store = memoryStore(); let sendCount = 0;
    const options = { store, fresh: evidence({ status: 'Present', note: 'Done' }),
      review: async () => { if (stage === 'review') throw new Error('Tracking failed'); },
      send: async () => { sendCount++; return { ok: false, reason: 'delivery_unknown' }; } };
    await run(options); await run(options);
    assert.equal(store.jobs.get('job-1').status, 'unknown');
    assert.equal(sendCount, stage === 'review' ? 0 : 1);
  }
});

test('arming requires a named human, exact missing records and a definitely delivered checklist', async () => {
  await assert.rejects(prepareDeferredPayroll({ store: memoryStore(null), evidence: evidence(), actor: '', nudge: () => assert.fail() }));
  for (const outcome of [{ ok: true }, { ok: false, reason: 'already_sent' }, { ok: false, reason: 'check_gmail' }]) {
    const store = memoryStore(null);
    const result = await prepareDeferredPayroll({ store, evidence: evidence(), actor, nudge: async () => outcome });
    const delivered = outcome.ok || outcome.reason === 'already_sent';
    assert.equal(result.ok, delivered); assert.equal(store.jobs.get('job-1').status, delivered ? 'waiting' : 'held');
    assert.equal(store.jobs.get('job-1').approved_by, actor);
  }
  const complete = await prepareDeferredPayroll({ store: memoryStore(null), evidence: evidence({ status: 'Present', note: 'Done' }), actor, nudge: () => assert.fail('no email') });
  assert.equal(complete.reason, 'nothing_missing');
  const store = memoryStore(null);
  await assert.rejects(prepareDeferredPayroll({ store, evidence: evidence(), actor, nudge: async () => { throw new Error('Timeout'); } }));
  assert.equal(store.jobs.get('job-1').status, 'held');
});

test('manual and automatic email callers share an immutable revision claim', async () => {
  const store = memoryStore(null); const order = []; let sends = 0;
  const claim = { key: payrollEmailClaimKey('statement', 'payroll-1', ['revision-1', 24]), payrollId: 'payroll-1', kind: 'statement', actor };
  const options = { store, claim, markSending: async () => order.push('audit'),
    send: async () => { assert.equal(store.claims.get(claim.key), 'claimed'); sends++; order.push('gmail'); return { id: 'receipt-1' }; },
    markSent: async () => order.push('sent'), markUnknown: () => assert.fail() };
  const results = await Promise.all([deliverPayrollEmail(options), deliverPayrollEmail(options)]);
  assert.equal(results.filter((result) => result.ok).length, 1); assert.equal(sends, 1);
  assert.deepEqual(order, ['audit', 'gmail', 'sent']);
  assert.notEqual(claim.key, payrollEmailClaimKey('statement', 'payroll-1', ['revision-2', 30]));
  assert.equal((await deliverPayrollEmail(options)).ok, false);
});

test('provider timeout, missing receipt and any audit failure keep claims blocked permanently', async () => {
  for (const failure of ['audit-before', 'provider', 'receipt', 'audit-after', 'unknown-tracking', 'timeout']) {
    const store = memoryStore(null); let sends = 0;
    const claim = { key: failure, payrollId: 'period-1', kind: 'statement', actor };
    const options = { store, claim, timeoutMs: 1,
      markSending: async () => { if (failure === 'audit-before') throw new Error('Sheet failed'); },
      send: async () => { sends++; if (failure === 'provider' || failure === 'unknown-tracking') throw new Error('Lost response'); if (failure === 'timeout') return new Promise(() => {}); return { id: failure === 'receipt' ? '' : 'gmail-receipt' }; },
      markSent: async () => { if (failure === 'audit-after') throw new Error('Sheet failed'); },
      markUnknown: async () => { if (failure === 'unknown-tracking') throw new Error('Sheet failed'); } };
    assert.equal((await deliverPayrollEmail(options)).ok, false, failure);
    assert.equal((await deliverPayrollEmail(options)).ok, false, failure);
    assert.equal(sends, failure === 'audit-before' ? 0 : 1, failure);
  }
});

test('advisory lock denies a second process and releases on thrown operations; flag off touches no database', async () => {
  let locked = false, released = 0;
  const connect = async () => ({ query: async (sql) => {
    if (sql.includes('try_advisory_lock')) { if (locked) return { rows: [{ locked: false }] }; locked = true; return { rows: [{ locked: true }] }; }
    locked = false; return { rows: [] };
  }, release: () => { released++; } });
  const env = { PAYROLL_DEFERRED_SEND_ENABLED: 'true' };
  await assert.rejects(withPayrollDeliveryLock('Robbie', async () => {
    await assert.rejects(withPayrollDeliveryLock('Robbie', () => assert.fail('second owner'), { env, connect }), /being checked/);
    throw new Error('operation failed');
  }, { env, connect }), /operation failed/);
  assert.equal(locked, false); assert.equal(released, 2);
  assert.equal(await withPayrollDeliveryLock('Robbie', async () => 'manual', { env: {}, connect: () => assert.fail('database') }), 'manual');
  assert.equal(payrollDeferredEnabled({ PAYROLL_DEFERRED_SEND_ENABLED: 'false' }), false);
});

test('secret-only cron rejects unauthorized calls and a disabled feature cannot access any source', async () => {
  let checks = 0;
  const make = (enabled, secret = 'expected') => createPayrollDeferredPostHandler({ secret: () => secret, enabled: () => enabled,
    check: async () => { checks++; return { checked: 1, sent: 1 }; } });
  const req = (secret) => new Request('https://example.test/api/cron/payroll-records', { method: 'POST', headers: { 'x-firstchord-schedule-secret': secret } });
  assert.equal((await make(true)(req('wrong'))).status, 401);
  assert.equal((await make(true, '')(req('expected'))).status, 503);
  assert.equal((await (await make(false)(req('expected'))).json()).disabled, true);
  assert.equal(checks, 0);
  assert.deepEqual(await (await make(true)(req('expected'))).json(), { success: true, checked: 1, sent: 1 });
  assert.equal(checks, 1);
});

test('waiting records are quiet in the queue; held or interrupted delivery is actionable, never payable', () => {
  const row = evidence().row;
  const waiting = buildPayrollQueue([{ ...row, deferredDelivery: approval() }], { now: now() })[0];
  assert.equal(waiting.group, 'waiting'); assert.equal(waiting.workflow.readyForPayment, false);
  const held = buildPayrollQueue([{ ...row, deferredDelivery: { ...approval(), status: 'held' } }], { now: now() })[0];
  assert.equal(held.group, 'handle'); assert.equal(held.workflow.readyForPayment, false);
});

test('Postgres email claims persist across store instances and cannot be re-acquired', async () => {
  const claims = new Map();
  const query = async (sql, params = []) => {
    if (sql.includes('CREATE')) return { rows: [] };
    if (sql.includes('INSERT INTO payroll_email_delivery_claims')) {
      if (claims.has(params[0])) return { rows: [] };
      claims.set(params[0], { status: 'claimed', actor: params[3] }); return { rows: [{ delivery_key: params[0] }] };
    }
    if (sql.includes('UPDATE payroll_email_delivery_claims')) {
      const row = claims.get(params[0]); if (row?.status === 'claimed') row.status = params[1]; return { rows: [] };
    }
    throw new Error(`Unexpected query ${sql}`);
  };
  await ensurePayrollDeliveryTables({ query });
  const first = createPayrollDeliveryStore({ query }), second = createPayrollDeliveryStore({ query });
  const claim = { key: 'statement:revision', payrollId: 'payroll-1', kind: 'statement', actor };
  const owners = await Promise.all([first.claimEmail(claim), second.claimEmail(claim)]);
  assert.equal(owners.filter(Boolean).length, 1);
  await first.finishEmail(claim.key, 'unknown');
  assert.equal(await second.claimEmail(claim), false);
  assert.equal(claims.get(claim.key).actor, actor);
});
