#!/usr/bin/env node
/**
 * build-staging-bootstrap.mjs — assemble the one-file bootstrap for a BRAND-NEW
 * staging database, deterministically, from the repository.
 *
 *   node scripts/build-staging-bootstrap.mjs [--out build/staging-bootstrap.sql]
 *
 * WHY GENERATE IT rather than commit it
 *   A committed bundle goes stale the moment someone adds a migration. Generating
 *   it at run time means the bootstrap is always exactly "schema.sql + every
 *   migration, in the proven order" with no file to maintain.
 *
 * THE ORDER IS THE SAFETY PROPERTY
 *   1. schema.sql first — every early migration ALTERs tables it creates.
 *   2. then migrations in filename order, which is chronological order.
 * Verified previously: schema.sql is byte-identical to Part B of
 * 2026-07-07_catchup_reconcile.sql, so catchup re-applies content already present
 * and cannot regress anything; and every function it replaces with an older body
 * is replaced again by a later migration. That reasoning holds ONLY for an empty
 * database applied in order — never reuse this against production.
 *
 * EXCLUDED
 *   2026-06-22_diagnose_demo_kpi.sql — 0 DDL statements. A read-only diagnostic
 *   that queries a production practice UUID. Running it is pointless noise.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const _out = args.out || 'build/staging-bootstrap.sql';
const OUT = isAbsolute(_out) ? _out : join(ROOT, _out);

/** Files deliberately left out of the bootstrap, with the reason. */
export const EXCLUDED = {
  '2026-06-22_diagnose_demo_kpi.sql': 'read-only diagnostic, 0 DDL, references a production practice id',
};

/** The ordered file list: schema.sql, then migrations in filename order. */
export function bootstrapFiles(root = ROOT) {
  const migrations = readdirSync(join(root, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !EXCLUDED[f]);
  return ['schema.sql', ...migrations.map((f) => join('migrations', f))];
}

/**
 * schema.sql USES is_team() in a policy at line ~259 but only DEFINES it at
 * line ~304. Applying it top-to-bottom to a genuinely empty database therefore
 * fails with `function is_team() does not exist` — the documented "paste
 * schema.sql into a fresh project" path has never worked on an empty DB.
 * Production never hit it because production was built up incrementally.
 *
 * Rather than edit schema.sql — whose byte-identity with Part B of
 * 2026-07-07_catchup_reconcile.sql is what makes the bootstrap order provably
 * safe — hoist the five SECURITY DEFINER helper definitions to just before the
 * first CREATE POLICY. By that point every table they read already exists, and
 * schema.sql re-creating them later is a no-op (they are CREATE OR REPLACE).
 */
export function hoistSecurityHelpers(schemaSql) {
  const startMarker = '-- security definer: these helpers read profiles directly';
  const endMarker = '  select is_team() or is_practice_owner(p_practice);\n$$;';
  const start = schemaSql.indexOf(startMarker);
  const end = schemaSql.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error('could not locate the SECURITY DEFINER helper block in schema.sql — refusing to emit a bootstrap that may fail mid-apply');
  }
  const block = schemaSql.slice(start, end + endMarker.length);
  const without = schemaSql.slice(0, start) + schemaSql.slice(start + block.length);

  const firstPolicy = without.indexOf('create policy ');
  if (firstPolicy === -1) throw new Error('no CREATE POLICY found in schema.sql');
  // Rewind to the start of the statement's line, and past any drop-policy guard.
  let insertAt = without.lastIndexOf('\n', firstPolicy) + 1;
  const dropGuard = without.lastIndexOf('drop policy if exists', firstPolicy);
  if (dropGuard !== -1 && dropGuard > firstPolicy - 400) {
    insertAt = without.lastIndexOf('\n', dropGuard) + 1;
  }
  const banner = '-- ── hoisted by scripts/build-staging-bootstrap.mjs: these helpers are used by\n' +
                 '-- ── the policies below but defined further down in schema.sql.\n';
  return without.slice(0, insertAt) + banner + block + '\n\n' + without.slice(insertAt);
}

export function buildBootstrapSql(root = ROOT) {
  const files = bootstrapFiles(root);
  const parts = [
    '-- ============================================================',
    '-- ROXIUM STAGING BOOTSTRAP — GENERATED, DO NOT EDIT',
    `-- sources  : schema.sql + ${files.length - 1} migrations, in filename order`,
    '--',
    '-- FOR AN EMPTY STAGING DATABASE ONLY. Never run against production:',
    '-- production has evolved past the 2026-07-07 snapshot embedded in',
    '-- catchup_reconcile, which would revert later work there.',
    '-- ============================================================',
    '',
    '\\set ON_ERROR_STOP on',
    '',
  ];
  for (const rel of files) {
    let sql = readFileSync(join(root, rel), 'utf8');
    if (rel === 'schema.sql') sql = hoistSecurityHelpers(sql);
    parts.push(
      `-- ────────────────────────────────────────────────────────────`,
      `-- ${rel}`,
      `-- ────────────────────────────────────────────────────────────`,
      sql.trimEnd(),
      '',
    );
  }
  const body = parts.join('\n');
  // Deterministic: the same repository contents always produce the same bytes,
  // so a bootstrap can be diffed and re-generated reproducibly.
  const digest = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const sql = body.replace('DO NOT EDIT', `DO NOT EDIT  (sources sha256:${digest})`);
  return { sql, files, digest };
}

// Run directly (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith('build-staging-bootstrap.mjs')) {
  const { sql, files } = buildBootstrapSql();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, sql, 'utf8');
  console.log(`Bootstrap assembled: ${files.length} files -> ${OUT}`);
  console.log(`  1. ${files[0]}`);
  console.log(`  2..${files.length}. migrations/ in filename order`);
  for (const [f, why] of Object.entries(EXCLUDED)) console.log(`  excluded: ${f}  (${why})`);
  console.log(`  ${(sql.length / 1024).toFixed(0)} KB`);
}
