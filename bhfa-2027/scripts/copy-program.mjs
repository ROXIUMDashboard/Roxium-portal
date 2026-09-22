/**
 * One-time copy of the BHFA programme into a freshly migrated database.
 *
 * Runs on Railway, after apply-migrations.mjs has created the schema. It reads
 * the old project through its Data API (read-only — the old database is never
 * written to) and inserts every row verbatim into the new one, preserving ids,
 * timestamps, the workspace token hash and every foreign-key relationship. The
 * collaboration link therefore keeps working after cutover: the hash it is
 * checked against travels with it, and COLLAB_TOKEN_PEPPER does not change.
 *
 * It is inert unless all three of these are set:
 *   SUPABASE_DB_URL        the new database (already migrated)
 *   BHFA_COPY_SOURCE_URL   the old project's URL
 *   BHFA_COPY_SOURCE_KEY   the old project's secret key
 *
 * It refuses to run if the destination already holds sessions, so a redeploy
 * can never double-insert or overwrite live data.
 */
import { assertBhfaTarget } from './db-target.mjs';

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
const sourceUrl = process.env.BHFA_COPY_SOURCE_URL?.trim().replace(/\/+$/, '');
const sourceKey = process.env.BHFA_COPY_SOURCE_KEY?.trim();

if (!dbUrl || !sourceUrl || !sourceKey) {
  console.log('copy        source or destination not configured — skipping');
  process.exit(0);
}

const targetRef = assertBhfaTarget(dbUrl, process.env.BHFA_DB_TARGET_REF);

let pg;
try {
  ({ default: pg } = await import('pg'));
} catch {
  console.error('copy        `pg` is not installed; the pre-deploy step installs it.');
  process.exit(1);
}

/** Parent tables first: every child references something already inserted. */
const TABLES = [
  'bhfa_programs',
  'bhfa_days',
  'bhfa_faculty',
  'bhfa_sessions',
  'bhfa_session_speakers',
  'bhfa_workspaces',
  'bhfa_change_history',
];

async function readSource(table) {
  const response = await fetch(`${sourceUrl}/rest/v1/${table}?select=*`, {
    headers: { apikey: sourceKey, Authorization: `Bearer ${sourceKey}` },
  });
  if (!response.ok) {
    throw new Error(`could not read ${table} from the source project (HTTP ${response.status})`);
  }
  return response.json();
}

const ca = process.env.SUPABASE_DB_CA?.trim();
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
});

async function main() {
  await client.connect();
  console.log(`copy        destination ${targetRef}`);

  const { rows: existing } = await client.query('select count(*)::int as n from bhfa_sessions');
  if (existing[0].n > 0) {
    console.log(`copy        destination already holds ${existing[0].n} sessions — nothing copied`);
    return;
  }

  const data = {};
  for (const table of TABLES) data[table] = await readSource(table);
  console.log(
    'copy        read from source: ' +
      TABLES.map((t) => `${t.replace('bhfa_', '')}=${data[t].length}`).join(' '),
  );

  await client.query('begin');
  try {
    for (const table of TABLES) {
      const rows = data[table];
      if (!rows.length) continue;
      // Union of keys: PostgREST omits nothing, but stay defensive about nulls.
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      for (const row of rows) {
        const values = columns.map((c) => (row[c] === undefined ? null : row[c]));
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `insert into ${table} (${columns.map((c) => `"${c}"`).join(', ')}) ` +
            `values (${placeholders}) on conflict do nothing`,
          values,
        );
      }
      console.log(`copy        ${table}: ${rows.length} rows inserted`);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error(`copy        FAILED — rolled back, destination unchanged: ${error.message}`);
    throw error;
  }

  // Prove the destination matches the source before anything is repointed.
  const problems = [];
  for (const table of TABLES) {
    const { rows } = await client.query(`select count(*)::int as n from ${table}`);
    if (rows[0].n !== data[table].length) {
      problems.push(`${table}: copied ${rows[0].n}, source has ${data[table].length}`);
    }
  }
  const { rows: perDay } = await client.query(
    `select d.sort_order, count(s.id)::int as n
       from bhfa_days d left join bhfa_sessions s on s.day_id = d.id
      group by d.sort_order order by d.sort_order`,
  );
  const counts = perDay.map((r) => r.n).join(' / ');
  console.log(`copy        per-day sessions: ${counts}`);
  if (counts !== '15 / 16 / 14 / 13') problems.push(`per-day counts are ${counts}, expected 15 / 16 / 14 / 13`);

  const { rows: ws } = await client.query(
    'select count(*)::int as n from bhfa_workspaces where token_hash is not null and revoked_at is null',
  );
  if (ws[0].n !== 1) problems.push(`expected 1 live workspace token, found ${ws[0].n}`);

  if (problems.length) {
    console.error('copy        VERIFICATION FAILED:');
    for (const problem of problems) console.error(`copy          - ${problem}`);
    throw new Error('destination does not match the source');
  }
  console.log('copy        verified: every table matches the source, token row intact');
}

try {
  await main();
} finally {
  await client.end().catch(() => {});
}
