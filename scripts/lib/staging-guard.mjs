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
  const m = String(url || '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1].toLowerCase() : null;
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
