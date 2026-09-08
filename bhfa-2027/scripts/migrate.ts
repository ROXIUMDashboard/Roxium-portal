/**
 * Applies supabase/migrations/*.sql in order.
 *
 * Supabase's REST API cannot run arbitrary DDL, so this script prints the SQL
 * with instructions when it cannot execute it directly. Running the file in the
 * Supabase SQL editor is the supported path and takes about ten seconds.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from './env';

loadEnv();

const dir = resolve(process.cwd(), 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

console.log('\nBHFA 2027 — database migrations\n');
console.log('Run each file below in the Supabase SQL editor (SQL → New query → paste → Run).');
console.log('Every statement is idempotent, so re-running a file is safe.\n');

for (const file of files) {
  const path = resolve(dir, file);
  const sql = readFileSync(path, 'utf8');
  console.log(`--- ${file} (${sql.split('\n').length} lines) -> ${path}`);
}

console.log('\nThen seed the program content and issue a collaboration link:\n  npm run db:seed\n');
