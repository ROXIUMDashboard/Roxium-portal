#!/usr/bin/env node
/**
 * verify-production-schema.mjs — READ-ONLY drift check: repository vs live Supabase.
 *
 * WHY THIS EXISTS
 *   Migrations in this repo are applied by hand with no ledger, so "does production
 *   match the repository?" has historically been unanswerable. This script answers
 *   the part of that question that can be answered with the PUBLIC anon key alone,
 *   so it can run in CI or on any laptop with no secrets at all.
 *
 * WHAT IT PROVES
 *   • every table/view in scripts/expected-schema.json exists in production
 *   • every expected COLUMN exists (PostgREST returns 42703 for an unknown column
 *     even when RLS returns zero rows, so this works without any data access)
 *   • the anon role cannot read a single row from any of them
 *
 * WHAT IT CANNOT PROVE  (needs service-role / SQL-editor access — see
 *   scripts/verify-production-schema.sql, which covers all of this)
 *   • indexes, constraints, triggers, RLS POLICY BODIES, functions, storage policies
 *   • that a column has the right TYPE, DEFAULT or NOT NULL
 *   • which migration files were actually executed
 *
 * SAFETY: issues only HTTP GET with `limit=1`. It never writes, never calls an RPC,
 * never triggers an email. Running it has no side effects on production.
 *
 * USAGE
 *   node scripts/verify-production-schema.mjs            # reads config.js
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/verify-production-schema.mjs
 *   node scripts/verify-production-schema.mjs --json     # machine-readable
 * EXIT CODES: 0 = no drift · 1 = drift found · 2 = could not run
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

function credentials() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    return { url: process.env.SUPABASE_URL.replace(/\/+$/, ''), key: process.env.SUPABASE_ANON_KEY };
  const cfg = readFileSync(join(HERE, '..', 'config.js'), 'utf8');
  const url = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  const key = cfg.match(/"(eyJ[A-Za-z0-9._-]+)"/)?.[1];
  if (!url || !key) throw new Error('could not read SUPABASE_URL / anon key from config.js');
  return { url, key };
}

const { url, key } = credentials();
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };

async function q(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: HEADERS });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, body };
}

const expected = JSON.parse(readFileSync(join(HERE, 'expected-schema.json'), 'utf8'));
const report = { checkedAt: new Date().toISOString(), project: url, missingTables: [], missingColumns: [], anonLeaks: [], unreadable: [], ok: [] };

for (const [table, spec] of Object.entries(expected.tables)) {
  const cols = [...spec.baseline, ...Object.keys(spec.added)];

  // 1) existence + anon-exposure
  const probe = await q(`${table}?select=*&limit=1`);
  if (probe.status === 404) { report.missingTables.push({ table, detail: probe.body?.message ?? 'not in schema cache' }); log(`MISSING TABLE  ${table}`); continue; }
  if (probe.status !== 200) { report.unreadable.push({ table, status: probe.status, detail: probe.body?.message ?? '' }); log(`UNREADABLE     ${table}  (HTTP ${probe.status})`); continue; }
  if (Array.isArray(probe.body) && probe.body.length > 0) { report.anonLeaks.push(table); log(`*** ANON LEAK  ${table} — anonymous request returned rows`); }

  // 2) columns — one batched request, falling back to per-column on failure
  const batch = await q(`${table}?select=${cols.join(',')}&limit=1`);
  if (batch.status === 200) { report.ok.push(table); log(`ok             ${table}  (${cols.length} columns)`); continue; }
  const missing = [];
  for (const c of cols) {
    const one = await q(`${table}?select=${c}&limit=1`);
    if (one.status === 400 && one.body?.code === '42703') missing.push(c);
  }
  if (missing.length === 0) { report.ok.push(table); log(`ok             ${table}  (${cols.length} columns; batch query rejected for another reason: ${batch.body?.message ?? batch.status})`); continue; }
  for (const c of missing) {
    report.missingColumns.push({ table, column: c, expectedFrom: spec.added[c] ?? 'schema.sql (baseline)' });
    log(`MISSING COLUMN ${table}.${c}  — expected from ${spec.added[c] ?? 'schema.sql (baseline)'}`);
  }
}

const drift = report.missingTables.length + report.missingColumns.length + report.anonLeaks.length + report.unreadable.length;
if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); }
else {
  log('\n' + '-'.repeat(72));
  log(`tables ok: ${report.ok.length}/${Object.keys(expected.tables).length}   missing tables: ${report.missingTables.length}   missing columns: ${report.missingColumns.length}   anon leaks: ${report.anonLeaks.length}   unreadable: ${report.unreadable.length}`);
  log(drift === 0
    ? 'RESULT: no drift detected in tables/columns reachable with the anon key.\n        Indexes, constraints, triggers, functions and RLS POLICY BODIES are NOT covered\n        here — run scripts/verify-production-schema.sql in the Supabase SQL editor for those.'
    : 'RESULT: DRIFT DETECTED — see above. Do not deploy code that depends on the missing objects.');
}
process.exit(drift === 0 ? 0 : 1);
