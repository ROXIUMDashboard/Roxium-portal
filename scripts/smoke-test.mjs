#!/usr/bin/env node
/**
 * smoke-test.mjs — post-deploy verification. READ-ONLY and NON-DESTRUCTIVE.
 *
 *   node scripts/smoke-test.mjs --url https://roxium.com --env production [--sha abc1234]
 *
 * Checks, in order:
 *   1. the site root responds
 *   2. /portal/ responds and is the portal shell (not the SPA fallback misfiring)
 *   3. every critical asset loads (app.js, styles.css, config.js)
 *   4. version.json reports the expected environment (and SHA, when given)
 *   5. the bundle is stamped for the environment it is actually served from
 *   6. /privacy and /terms still serve themselves, not the portal  (_redirects order)
 *   7. Supabase is reachable and the anon role is refused unauthenticated table data
 *
 * Step 7 issues one GET with limit=1 against a single table. It never writes,
 * never calls an RPC and never triggers an email. Nothing here mutates anything.
 * Exit 0 = healthy, 1 = a check failed, 2 = could not run.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const BASE = (args.url || '').replace(/\/+$/, '');
const WANT_ENV = args.env || '';
const WANT_SHA = args.sha || '';
if (!BASE) { console.error('usage: smoke-test.mjs --url <base> --env <production|staging> [--sha <sha>]'); process.exit(2); }

let failed = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed++; };

async function get(path, opts = {}) {
  const r = await fetch(BASE + path, { redirect: 'follow', ...opts });
  return { status: r.status, text: r.ok ? await r.text() : '', ct: r.headers.get('content-type') || '' };
}

console.log(`Smoke test: ${BASE}  (expecting environment "${WANT_ENV || 'any'}")\n`);

// 1 · root
try { const r = await get('/'); r.status === 200 ? pass(`site root responds (200)`) : fail(`site root returned ${r.status}`); }
catch (e) { fail(`site root unreachable: ${e.message}`); }

// 2 · portal shell
let portalHtml = '';
try {
  const r = await get('/portal/');
  portalHtml = r.text;
  if (r.status !== 200) fail(`/portal/ returned ${r.status}`);
  else if (!/ROXIUM · Client Portal|id="login"/.test(r.text)) fail('/portal/ did not return the portal shell');
  else pass('/portal/ serves the portal shell');
  if (/BUILD_SHA/.test(r.text)) fail('/portal/ still contains the literal BUILD_SHA placeholder — raw repo was deployed');
} catch (e) { fail(`/portal/ unreachable: ${e.message}`); }

// 3 · critical assets
for (const a of ['/app.js', '/styles.css', '/config.js']) {
  try { const r = await get(a); r.status === 200 && r.text.length > 100 ? pass(`asset ${a} loads (${Math.round(r.text.length / 1024)} KB)`) : fail(`asset ${a} returned ${r.status}`); }
  catch (e) { fail(`asset ${a} unreachable: ${e.message}`); }
}

// 4 · version.json
let version = null;
try {
  const r = await get('/version.json');
  version = JSON.parse(r.text);
  pass(`version.json: sha=${version.sha} env=${version.environment}`);
  if (WANT_ENV && version.environment !== WANT_ENV) fail(`version.json says environment "${version.environment}", expected "${WANT_ENV}"`);
  if (WANT_SHA && version.sha !== WANT_SHA.slice(0, 7)) fail(`version.json says sha "${version.sha}", expected "${WANT_SHA.slice(0, 7)}"`);
} catch (e) { fail(`version.json missing or invalid: ${e.message}`); }

// 5 · the shipped bundle is stamped for this environment
let supaUrl = '';
try {
  const r = await get('/config.js');
  const stamped = r.text.match(/ROXIUM_BUILD_ENV\s*=\s*'([^']*)'/)?.[1] || '';
  if (WANT_ENV && stamped !== WANT_ENV) fail(`config.js stamped "${stamped}", expected "${WANT_ENV}"`);
  else pass(`config.js stamped for "${stamped || 'hostname resolution'}"`);
  // the URL the stamped environment will actually use
  const block = r.text.split(`${WANT_ENV}: {`)[1] || '';
  supaUrl = block.match(/SUPABASE_URL:\s*'([^']*)'/)?.[1] || '';
  if (WANT_ENV && !supaUrl) fail(`config.js has no SUPABASE_URL for "${WANT_ENV}"`);
} catch (e) { fail(`config.js unreadable: ${e.message}`); }

// 6 · _redirects ordering — legal pages must not be swallowed by the SPA fallback
for (const p of ['/privacy', '/terms']) {
  try {
    const r = await get(p);
    if (r.status !== 200) fail(`${p} returned ${r.status}`);
    else if (/id="login"|ROXIUM · Client Portal/.test(r.text)) fail(`${p} served the PORTAL — _redirects ordering regressed`);
    else pass(`${p} serves its own page`);
  } catch (e) { fail(`${p} unreachable: ${e.message}`); }
}

// 7 · Supabase reachability + anon denial (read-only)
if (supaUrl) {
  try {
    const r = await get('/config.js');
    const block = r.text.split(`${WANT_ENV}: {`)[1] || '';
    const key = block.match(/SUPABASE_ANON_KEY:\s*\n?\s*'([^']*)'/)?.[1] || '';
    if (!key) { fail(`no anon key found for "${WANT_ENV}"`); }
    else {
      const res = await fetch(`${supaUrl}/rest/v1/practices?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      const body = await res.json().catch(() => null);
      if (res.status !== 200) fail(`Supabase unhealthy: /rest/v1/practices returned ${res.status}`);
      else if (Array.isArray(body) && body.length === 0) pass('Supabase healthy; anonymous read returns no rows (RLS holding)');
      else fail(`*** anonymous read returned ${Array.isArray(body) ? body.length : '?'} row(s) — RLS is NOT holding ***`);
    }
  } catch (e) { fail(`Supabase check failed: ${e.message}`); }
}

console.log(`\n${failed === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED — ${failed} check(s)`}`);
process.exit(failed === 0 ? 0 : 1);
