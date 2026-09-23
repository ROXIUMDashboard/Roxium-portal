/**
 * Applies supabase/migrations/*.sql against the BHFA database.
 *
 * This runs as Railway's pre-deploy step, not from a developer machine: the
 * agent environment's egress allowlist covers *.supabase.co but not the
 * connection pooler on *.supabase.com, and Supabase's Data API cannot execute
 * DDL. Railway's container can reach the pooler, so that is where migrations
 * are applied from.
 *
 * It is inert until SUPABASE_DB_URL is set — no variable, no connection, exit 0 —
 * so a deployment without it behaves exactly as it does today.
 *
 * Every migration runs inside a transaction and is recorded in bhfa_migrations,
 * so re-deploying never re-applies one that already succeeded.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBhfaTarget } from './db-target.mjs';

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.log('migrations  SUPABASE_DB_URL is not set — skipping (nothing is applied)');
  process.exit(0);
}

// Refuses a ROXIUM/ELIXIR ref, and refuses any ref the caller did not name.
const targetRef = assertBhfaTarget(url, process.env.BHFA_DB_TARGET_REF);
console.log(`migrations  target project ${targetRef}`);

/**
 * `pg` is deliberately not a package.json dependency: this environment has no
 * npm registry access, so it cannot regenerate package-lock.json, and `npm ci`
 * refuses to run when the two disagree. Railway's pre-deploy step installs it
 * with --no-save only when there is a database URL to use it with.
 */
let pg;
try {
  ({ default: pg } = await import('pg'));
} catch {
  console.error('migrations  SUPABASE_DB_URL is set but `pg` is not installed.');
  console.error('migrations  The pre-deploy step installs it; run `npm install pg@8 --no-save` first.');
  process.exit(1);
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/**
 * TLS is verified. Supabase's endpoints present publicly-trusted certificates,
 * so Node's own CA bundle is enough; SUPABASE_DB_CA is there for a deployment
 * that pins Supabase's own root instead. Verification is never switched off —
 * this connection carries every credential the database has.
 */
const ca = process.env.SUPABASE_DB_CA?.trim();
const client = new pg.Client({
  connectionString: url,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
});

async function main() {
  await client.connect();
  const { rows: who } = await client.query('select current_database() as db, current_user as usr');
  console.log(`migrations  connected to ${who[0].db} as ${who[0].usr}`);

  await client.query(`
    create table if not exists bhfa_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )`);
  // Every bhfa_* table is server-key only. Without this the public key could
  // read the ledger and rewrite it — replaying or skipping migrations.
  await client.query('alter table bhfa_migrations enable row level security');

  // 0001 created the tables that are already live. If they are there, record it
  // as applied rather than replaying it.
  const { rows: baseline } = await client.query(
    "select to_regclass('public.bhfa_sessions') is not null as present",
  );
  if (baseline[0].present) {
    await client.query('insert into bhfa_migrations(filename) values ($1) on conflict do nothing', [
      '0001_bhfa_program.sql',
    ]);
  }

  const { rows: done } = await client.query('select filename from bhfa_migrations');
  const applied = new Set(done.map((row) => row.filename));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`migrations  ${file} already applied`);
      continue;
    }
    const sql = readFileSync(resolve(dir, file), 'utf8');
    console.log(`migrations  applying ${file} …`);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into bhfa_migrations(filename) values ($1)', [file]);
      await client.query('commit');
      ran += 1;
      console.log(`migrations  ${file} applied`);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      console.error(`migrations  ${file} FAILED — rolled back, nothing from it persisted`);
      console.error(`migrations  ${error.message}`);
      throw error;
    }
  }
  console.log(`migrations  ${ran} newly applied, ${files.length - ran} already present`);
}

try {
  await main();
} finally {
  await client.end().catch(() => {});
}
