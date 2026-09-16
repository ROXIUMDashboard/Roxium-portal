/**
 * Read the PRODUCTION Supabase credentials out of config.js.
 *
 * Extracted so it can be unit-tested. It was not, and it silently broke: the
 * parser required double quotes around the anon key, config.js was reformatted
 * to single quotes, and the drift check then threw on every CI run. Because the
 * throw exited 1 — the same code as "drift found" — the verify job looked like
 * a schema problem for weeks while the check had never reached the database.
 *
 * Two rules follow from that, and both are tested:
 *   1. Read the `production` entry specifically. config.js is a registry now;
 *      "the first Supabase URL in the file" would verify staging once staging
 *      is configured, and report it as production.
 *   2. Failing to parse is NOT drift. Callers must distinguish the two.
 */

/** @returns {{url: string, key: string}} @throws if the production entry cannot be read */
export function productionCredentialsFrom(configSource) {
  const cfg = String(configSource || '');
  const start = cfg.indexOf('production:');
  if (start === -1) throw new Error('config.js has no `production:` environment entry');

  // Stop at the next environment key so we can never stray into staging.
  const next = cfg.indexOf('staging:', start);
  const block = cfg.slice(start, next === -1 ? cfg.length : next);

  const url = block.match(/['"`](https:\/\/[a-z0-9]+\.supabase\.co)['"`]/)?.[1];
  const key = block.match(/['"`](eyJ[A-Za-z0-9._-]+)['"`]/)?.[1];
  if (!url || !key) {
    throw new Error(
      'could not read the production SUPABASE_URL / anon key from config.js. ' +
      'Pass SUPABASE_URL and SUPABASE_ANON_KEY explicitly, or fix the production entry.',
    );
  }
  return { url, key };
}
