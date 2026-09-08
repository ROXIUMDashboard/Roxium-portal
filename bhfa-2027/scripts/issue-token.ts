/**
 * Issues a fresh collaboration link for the program without touching content.
 * The previous link stops working the moment this runs.
 */
import { createClient } from '@supabase/supabase-js';
import { SEED_PROGRAM } from '../lib/seed/program-2027';
import { generateToken, hashToken, tokenPrefix } from '../lib/server/tokens';
import { requireSupabaseEnv } from './env';

const { url, key } = requireSupabaseEnv();
const client = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: program, error } = await client
    .from('bhfa_programs')
    .select('id')
    .eq('key', SEED_PROGRAM.key)
    .maybeSingle();

  if (error || !program) {
    console.error('\nNo program found. Run `npm run db:seed` first.\n');
    process.exit(1);
  }

  const token = generateToken();
  const payload = {
    token_hash: hashToken(token),
    token_prefix: tokenPrefix(token),
    created_at: new Date().toISOString(),
  };

  const { data: workspace } = await client
    .from('bhfa_workspaces')
    .select('id')
    .eq('program_id', program.id)
    .is('revoked_at', null)
    .maybeSingle();

  const result = workspace
    ? await client.from('bhfa_workspaces').update(payload).eq('id', workspace.id)
    : await client.from('bhfa_workspaces').insert({ program_id: program.id, ...payload });

  if (result.error) {
    console.error(`\nCould not issue a link: ${result.error.message}\n`);
    process.exit(1);
  }

  console.log(`\nNew collaboration link (shown once):\n\n  /program/${token}\n`);
}

void main();
