/**
 * Reads and sanity-checks the Supabase server credentials.
 *
 * Supabase issues two generations of keys. The current ones are opaque strings
 * (`sb_secret_…` for server use, `sb_publishable_…` for browsers); the legacy
 * ones are JWTs carrying a `role` claim (`service_role` / `anon`). Either
 * generation works here — the key is only ever passed through to supabase-js,
 * which knows how to send each format.
 *
 * What this file exists to catch is the one misconfiguration that fails
 * confusingly: a *browser* key in the server slot. Row Level Security is
 * enabled on every table with no policies, so a publishable or anon key reads
 * back an empty programme rather than an error — and the natural "fix" for
 * that is to loosen RLS, which would expose the whole planning room. Better to
 * refuse at boot and say exactly what went wrong.
 *
 * No message in this file ever includes the key itself.
 */

export type KeyKind = 'secret' | 'legacy-service-role' | 'unrecognised';

export interface SupabaseCredentials {
  url: string;
  key: string;
  keyKind: KeyKind;
}

export class SupabaseConfigError extends Error {}

/** Read the `role` claim from a legacy JWT key without verifying it. */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const role = (JSON.parse(payload) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function classifyKey(key: string): KeyKind {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (jwtRole(key) === 'service_role') return 'legacy-service-role';
  return 'unrecognised';
}

/**
 * Resolve credentials from the environment.
 *
 * `SUPABASE_SECRET_KEY` is the current name; `SUPABASE_SERVICE_ROLE_KEY` is
 * still honoured so existing deployments keep working.
 */
export function readSupabaseCredentials(
  env: Record<string, string | undefined> = process.env,
): SupabaseCredentials {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

  if (!url) {
    throw new SupabaseConfigError('SUPABASE_URL is not set.');
  }
  if (!/^https?:\/\//.test(url)) {
    throw new SupabaseConfigError('SUPABASE_URL must be the full project URL, starting with https://');
  }
  if (!key) {
    throw new SupabaseConfigError(
      'SUPABASE_SECRET_KEY is not set. Use the server-side secret key (sb_secret_…) from ' +
        'Project settings → API keys.',
    );
  }

  if (key.startsWith('sb_publishable_')) {
    throw new SupabaseConfigError(
      'That is a publishable key, which is meant for browsers and cannot read this schema — ' +
        'every table has Row Level Security enabled with no policies. Use the secret key ' +
        '(sb_secret_…) from Project settings → API keys.',
    );
  }
  if (jwtRole(key) === 'anon') {
    throw new SupabaseConfigError(
      'That is the anon key, which is meant for browsers and cannot read this schema. Use the ' +
        'secret key (sb_secret_…) from Project settings → API keys.',
    );
  }

  return { url, key, keyKind: classifyKey(key) };
}

/** One line for the console at boot or in a script, naming no secrets. */
export function describeCredentials({ url, keyKind }: SupabaseCredentials): string {
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const kind =
    keyKind === 'secret'
      ? 'secret key (sb_secret_…)'
      : keyKind === 'legacy-service-role'
        ? 'legacy service_role key'
        : 'server key of an unrecognised format — supabase-js will pass it through and the server decides';
  return `${host} · ${kind}`;
}
