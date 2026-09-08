import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load .env.local then .env, the same order Next.js uses. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) config({ path, override: false, quiet: true });
  }
}

export function requireSupabaseEnv(): { url: string; key: string } {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '\nMissing credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n' +
        '(Supabase → Project settings → API. The service-role key is server-only.)\n',
    );
    process.exit(1);
  }
  return { url, key };
}
