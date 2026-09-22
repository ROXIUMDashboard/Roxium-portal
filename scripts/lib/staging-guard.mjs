/**
 * staging-guard.mjs — refuses to let destructive tooling touch production.
 *
 * Every script that holds a service-role key routes through assertStagingTarget()
 * FIRST. The guard is deliberately paranoid and deny-by-default: an unrecognised
 * target is refused, not allowed.
 */

/** Production project ref. Anything resolving to this is refused, always. */
export const PRODUCTION_PROJECT_REFS = ['nchtmeqsjkpcvtuscxfy'];

/** Hostnames that must never be the target of seed/reset tooling. */
export const PRODUCTION_HOSTS = ['roxium.com', 'www.roxium.com', 'roxium-portal.pages.dev'];

export function projectRefFromUrl(url) {
  // Parse rather than prefix-match. A regex anchored only at the start accepts
  // `https://<ref>.supabase.co.example.test`, a host that is NOT Supabase at
  // all — so the hostname must END at .supabase.co, not merely contain it.
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const m = u.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.co$/);
  return m ? m[1] : null;
}

/**
 * @returns {{ok:true, ref:string} | {ok:false, reason:string, detail:string}}
 */
export function checkStagingTarget(url, { allowRefs = [] } = {}) {
  if (!url || !String(url).trim()) {
    return { ok: false, reason: 'missing-url', detail: 'No Supabase URL supplied. Refusing to guess a target.' };
  }
  const ref = projectRefFromUrl(url);
  if (!ref) {
    return { ok: false, reason: 'unparseable-url',
      detail: `"${url}" is not a https://<ref>.supabase.co URL. Refusing to run against an unrecognised target.` };
  }
  if (PRODUCTION_PROJECT_REFS.includes(ref)) {
    return { ok: false, reason: 'production-target',
      detail: `Target "${ref}" is the PRODUCTION project. This tool writes and deletes data and will never run against production.` };
  }
  if (allowRefs.length && !allowRefs.includes(ref)) {
    return { ok: false, reason: 'not-allowlisted',
      detail: `Target "${ref}" is not in the expected staging allowlist (${allowRefs.join(', ')}).` };
  }
  return { ok: true, ref };
}

/** Throws unless `url` is a safe, non-production target. */
export function assertStagingTarget(url, opts) {
  const r = checkStagingTarget(url, opts);
  if (!r.ok) {
    throw new Error(`REFUSED (${r.reason}): ${r.detail}`);
  }
  return r.ref;
}

// ---------------------------------------------------------------------------
// Database connection strings (used by the staging bootstrap, which runs DDL).
// A Supabase connection string carries the project ref in one of two shapes:
//   direct   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
//   pooler   postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
// Both are recognised. Anything we cannot positively identify is REFUSED.
// ---------------------------------------------------------------------------

export function projectRefFromDbUrl(dbUrl) {
  // Parse rather than substring-match, for the same reason as projectRefFromUrl:
  // `db.<ref>.supabase.co.example.test` must NOT be read as a Supabase project.
  let u;
  try { u = new URL(String(dbUrl || '')); } catch { return null; }
  const host = u.hostname.toLowerCase();

  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (direct) return direct[1];

  // Pooler: the ref lives in the username, but the HOST must still be Supabase's
  // pooler — otherwise anyone could route `postgres.<ref>@their-own-host` here.
  if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    const user = decodeURIComponent(u.username || '').toLowerCase();
    const m = user.match(/^postgres\.([a-z0-9]+)$/);
    if (m) return m[1];
  }
  return null;
}

/** @returns {{ok:true, ref:string} | {ok:false, reason:string, detail:string}} */
export function checkStagingDbUrl(dbUrl) {
  if (!dbUrl || !String(dbUrl).trim()) {
    return { ok: false, reason: 'missing-db-url', detail: 'No database connection string supplied. Refusing to guess a target.' };
  }
  const raw = String(dbUrl);
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    return { ok: false, reason: 'not-a-postgres-url', detail: 'The connection string does not start with postgres:// or postgresql://.' };
  }
  // Belt and braces: catch the production ref anywhere in the string, whatever the shape.
  for (const prodRef of PRODUCTION_PROJECT_REFS) {
    if (raw.toLowerCase().includes(prodRef)) {
      return { ok: false, reason: 'production-target',
        detail: `The connection string references the PRODUCTION project "${prodRef}". This tool runs DDL and will never run against production.` };
    }
  }
  const ref = projectRefFromDbUrl(raw);
  if (!ref) {
    return { ok: false, reason: 'unrecognised-db-url',
      detail: 'Could not identify a Supabase project ref in the connection string. Refusing to run DDL against an unidentified database.' };
  }
  if (PRODUCTION_PROJECT_REFS.includes(ref)) {
    return { ok: false, reason: 'production-target', detail: `Target "${ref}" is the PRODUCTION project.` };
  }
  return { ok: true, ref };
}

export function assertStagingDbUrl(dbUrl) {
  const r = checkStagingDbUrl(dbUrl);
  if (!r.ok) throw new Error(`REFUSED (${r.reason}): ${r.detail}`);
  return r.ref;
}

/** APP_ENV must literally be "staging". Independent of every other check. */
export function assertAppEnvStaging(appEnv) {
  if (String(appEnv || '').trim().toLowerCase() !== 'staging') {
    throw new Error(`REFUSED (app-env): APP_ENV must be exactly "staging" (got "${appEnv ?? ''}").`);
  }
}

/** The operator must type the phrase exactly. */
export function assertConfirmation(given, expected) {
  if (String(given || '') !== expected) {
    throw new Error(`REFUSED (confirmation): type "${expected}" exactly to proceed.`);
  }
}
