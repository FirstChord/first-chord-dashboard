/** @fileoverview Postgres coordination for scoped payroll approvals and immutable email claims, not payroll or lesson truth. */
import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';

let pool, lockPool;
export const payrollDeferredEnabled = (env = process.env) => env.PAYROLL_DEFERRED_SEND_ENABLED === 'true';
function getPool(env = process.env, forLock = false) {
  if (!env.DATABASE_URL) throw new Error('Payroll delivery database is not configured');
  const config = { connectionString: env.DATABASE_URL, max: forLock ? 2 : 4, connectionTimeoutMillis: 5000, query_timeout: 10000,
    ssl: env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined };
  // Reserved advisory-lock sessions cannot consume every query connection and
  // deadlock concurrent operators waiting on their own store queries.
  if (forLock) { lockPool ||= new Pool(config); return lockPool; }
  pool ||= new Pool(config);
  return pool;
}

export async function ensurePayrollDeliveryTables({ query, env = process.env } = {}) {
  const execute = query || ((sql, params) => getPool(env).query(sql, params));
  await execute(`CREATE TABLE IF NOT EXISTS payroll_deferred_deliveries (
    id UUID PRIMARY KEY, payroll_id TEXT NOT NULL, tutor_short_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('preparing','waiting','claimed','sent','held','cancelled','unknown')),
    scope JSONB NOT NULL, approved_by TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await execute(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_deferred_active_period
    ON payroll_deferred_deliveries (payroll_id) WHERE status IN ('preparing','waiting','claimed')`);
  await execute(`CREATE TABLE IF NOT EXISTS payroll_email_delivery_claims (
    delivery_key TEXT PRIMARY KEY, payroll_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('statement','records')),
    actor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('claimed','sent','unknown')),
    message_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

export function createPayrollDeliveryStore({ query, env = process.env } = {}) {
  const execute = query || ((sql, params) => getPool(env).query(sql, params));
  return {
    async parkInterrupted() {
      // A process may have died after Gmail accepted a message. Never resume
      // these jobs automatically; clearing the active slot is manual follow-up.
      await execute(`UPDATE payroll_deferred_deliveries SET status = 'unknown',
        reason = 'Delivery was interrupted. Check the statement and Gmail Sent.', updated_at = NOW()
        WHERE status IN ('preparing','claimed') AND updated_at < NOW() - INTERVAL '15 minutes'`);
    },
    async jobs() {
      return (await execute(`SELECT * FROM (SELECT DISTINCT ON (payroll_id) * FROM payroll_deferred_deliveries
        ORDER BY payroll_id, created_at DESC) latest WHERE status NOT IN ('sent','cancelled')
        ORDER BY created_at DESC LIMIT 100`)).rows;
    },
    async waiting(limit = 3) {
      // Round-robin waiting periods so an unresponsive tutor cannot starve others.
      return (await execute(`SELECT * FROM payroll_deferred_deliveries WHERE status = 'waiting'
        ORDER BY updated_at, created_at LIMIT $1`, [Math.min(3, Math.max(1, limit))])).rows;
    },
    async get(id) { return (await execute('SELECT * FROM payroll_deferred_deliveries WHERE id = $1', [id])).rows[0]; },
    async assertManual(payrollId) {
      const { rows } = await execute(`SELECT id FROM payroll_deferred_deliveries
        WHERE payroll_id = $1 AND status IN ('preparing','waiting','claimed') LIMIT 1`, [payrollId]);
      if (rows.length) throw new Error('Cancel the automatic statement send before changing this period.');
    },
    async prepare(scope, actor) {
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const { rows } = await execute(`INSERT INTO payroll_deferred_deliveries
        (id, payroll_id, tutor_short_name, status, scope, approved_by, expires_at)
        VALUES ($1,$2,$3,'preparing',$4::jsonb,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
      [id, scope.payrollId, scope.tutorShortName, JSON.stringify(scope), actor, expiresAt]);
      if (!rows[0]) throw new Error('This period already has an automatic send approval. Refresh payroll.');
      return rows[0];
    },
    async transition(id, from, status, reason = '') {
      const { rows } = await execute(`UPDATE payroll_deferred_deliveries SET status = $3, reason = $4, updated_at = NOW()
        WHERE id = $1 AND status = $2 RETURNING *`, [id, from, status, reason]);
      return rows[0] || null;
    },
    async claimEmail({ key, payrollId, kind, actor }) {
      const { rows } = await execute(`INSERT INTO payroll_email_delivery_claims (delivery_key,payroll_id,kind,actor,status)
        VALUES ($1,$2,$3,$4,'claimed') ON CONFLICT DO NOTHING RETURNING delivery_key`, [key, payrollId, kind, actor]);
      return Boolean(rows[0]);
    },
    async finishEmail(key, status, messageId = '') {
      await execute(`UPDATE payroll_email_delivery_claims SET status = $2, message_id = $3, updated_at = NOW()
        WHERE delivery_key = $1 AND status = 'claimed'`, [key, status, messageId]);
    },
  };
}

export function payrollEmailClaimKey(kind, payrollId, revision) {
  return `${kind}:${createHash('sha256').update(JSON.stringify([payrollId, revision])).digest('hex')}`;
}

export async function withPayrollDeliveryLock(tutorShortName, operation, { env = process.env, connect } = {}) {
  if (!payrollDeferredEnabled(env)) return operation();
  if (!tutorShortName) throw new Error('A recognised tutor is required');
  const client = await (connect ? connect() : getPool(env, true).connect());
  const key = `payroll-delivery:${tutorShortName}`;
  let locked = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
    locked = rows[0]?.locked === true;
    if (!locked) throw new Error('Payroll is being checked. Wait a moment, then refresh.');
    return await operation();
  } finally {
    // Destroy the connection if unlock fails: a pooled session must not retain
    // a lock whose owner has finished or thrown.
    let destroy = false;
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
      catch { destroy = true; }
    }
    client.release(destroy);
  }
}
