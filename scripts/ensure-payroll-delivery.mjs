import fs from 'node:fs';
import { ensurePayrollDeliveryTables } from '../lib/admin/payroll-delivery-store.mjs';

for (const envFile of ['.env.local', '.env']) {
  if (!process.env.DATABASE_URL && fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
}
await ensurePayrollDeliveryTables();
console.log('Payroll delivery coordination tables are ready.');
process.exit(0);
