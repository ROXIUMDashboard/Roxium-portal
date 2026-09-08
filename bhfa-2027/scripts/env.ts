import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeCredentials, readSupabaseCredentials } from '../lib/server/supabase-env';

/** Load .env.local then .env, the same order Next.js uses. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) config({ path, override: false, quiet: true });
  }
}

export function requireSupabaseEnv(): { url: string; key: string } {
  loadEnv();
  try {
    const credentials = readSupabaseCredentials();
    console.log(`supabase  ${describeCredentials(credentials)}`);
    return { url: credentials.url, key: credentials.key };
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}\n\n` +
        'Set SUPABASE_URL and SUPABASE_SECRET_KEY in bhfa-2027/.env.local\n' +
        '(Supabase → Project settings → API keys. The secret key is server-only and\n' +
        '.env.local is gitignored.)\n',
    );
    process.exit(1);
  }
}
