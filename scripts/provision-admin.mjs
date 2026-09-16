#!/usr/bin/env node
/**
 * provision-admin.mjs — create (or repair) a ROXIUM platform administrator.
 *
 *   ROXIUM_TARGET=staging \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *   node scripts/provision-admin.mjs
 *
 * WHAT IT DOES
 *   1. Creates the Supabase Auth user with that email and password, or — if the
 *      account already exists — sets the password on the EXISTING account.
 *   2. Ensures a profiles row with role = 'team' (platform administrator).
 *
 * WHAT IT DOES NOT DO
 *   • It never stores, logs or echoes the password. Supabase Auth hashes and
 *     owns it; this script only passes it through and forgets it.
 *   • It never creates a passwords table or any credential of our own.
 *   • It never changes an existing user's id, memberships, practice links or
 *     history. Setting a password on an existing account is an update to that
 *     account, not a replacement of it.
 *
 * SAFETY
 *   Promoting someone to `team` grants access to every practice, so the target
 *   project must be named explicitly (ROXIUM_TARGET) and, for production, a
 *   typed confirmation is required. Deny by default.
 *
 * Zero dependencies: talks to the Auth admin API and PostgREST over fetch.
 */
const TARGETS = new Set(['staging', 'production']);

const env = (k) => (process.env[k] || '').trim();
const die = (msg) => { console.error(`\nREFUSED: ${msg}\n`); process.exit(1); };

const target = env('ROXIUM_TARGET').toLowerCase();
const url = env('SUPABASE_URL').replace(/\/+$/, '');
const key = env('SUPABASE_SERVICE_ROLE_KEY');
const email = env('ADMIN_EMAIL').toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const fullName = env('ADMIN_NAME') || null;
const dryRun = process.argv.includes('--dry-run');

if (!TARGETS.has(target)) die(`ROXIUM_TARGET must be "staging" or "production" (got "${target}"). Refusing to guess which project to grant admin rights on.`);
if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) die(`SUPABASE_URL "${url}" is not a Supabase project URL.`);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('ADMIN_EMAIL must be a valid email address.');
if (!password) die('ADMIN_PASSWORD is required (supply it as a secret — never as a literal in a file).');
if (password.length < 10) die('ADMIN_PASSWORD must be at least 10 characters.');

if (target === 'production' && env('CONFIRM') !== 'PROVISION PRODUCTION ADMIN') {
  die('Granting platform-administrator rights on PRODUCTION requires CONFIRM="PROVISION PRODUCTION ADMIN".');
}

const api = async (path, init = {}) => {
  const r = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
};

const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i) || [])[1];
console.log(`── Target ───────────────────────────────────────────────`);
console.log(`  environment : ${target}`);
console.log(`  project ref : ${ref}`);
console.log(`  admin email : ${email}`);
console.log(`  password    : (supplied, ${password.length} characters — never printed or stored)`);
if (dryRun) { console.log('\n--dry-run: nothing was written.\n'); process.exit(0); }

// 1 ── the auth user ---------------------------------------------------------
console.log(`\n── Supabase Auth ────────────────────────────────────────`);
let userId = null;
let created = false;

const mk = await api('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password, email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {} }),
});
if (mk.ok && mk.body?.id) {
  userId = mk.body.id; created = true;
  console.log('  ok  created the auth user');
} else {
  // Already registered: find it and set the password on the EXISTING account,
  // preserving its id and therefore every membership and row that references it.
  const found = await api(`/auth/v1/admin/users?page=1&per_page=1000`);
  if (!found.ok) die(`could not list users: ${found.status} ${JSON.stringify(found.body)}`);
  const hit = (found.body?.users || []).find((u) => String(u.email || '').toLowerCase() === email);
  if (!hit) die(`could not create the user and could not find an existing one: ${JSON.stringify(mk.body)}`);
  userId = hit.id;
  console.log(`  ok  account already exists (id unchanged: ${userId})`);
  const upd = await api(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!upd.ok) die(`could not set the password: ${upd.status} ${JSON.stringify(upd.body)}`);
  console.log('  ok  password set on the existing account');
}

// 2 ── the profile row -------------------------------------------------------
console.log(`\n── Platform administrator ───────────────────────────────`);
const prof = await api(`/rest/v1/profiles?id=eq.${userId}&select=id,role,full_name`);
const existing = Array.isArray(prof.body) ? prof.body[0] : null;

if (!existing) {
  const ins = await api('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: userId, role: 'team', full_name: fullName }),
  });
  if (!ins.ok) die(`could not create the profile: ${ins.status} ${JSON.stringify(ins.body)}`);
  console.log("  ok  profile created with role 'team'");
} else if (existing.role !== 'team') {
  const up = await api(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(fullName ? { role: 'team', full_name: fullName } : { role: 'team' }),
  });
  if (!up.ok) die(`could not promote the profile: ${up.status} ${JSON.stringify(up.body)}`);
  console.log("  ok  existing profile promoted to role 'team'");
} else {
  console.log("  ok  already a platform administrator (role 'team')");
}

// 3 ── verify, rather than assume -------------------------------------------
const check = await api(`/rest/v1/profiles?id=eq.${userId}&select=id,role`);
const row = Array.isArray(check.body) ? check.body[0] : null;
if (row?.role !== 'team') die(`verification failed: profiles.role is "${row?.role}", not "team".`);

console.log(`\n── Result ───────────────────────────────────────────────`);
console.log(`  ✅ ${email} can sign in with email + password`);
console.log(`  ✅ role 'team' — full ROXIUM platform administrator`);
console.log(`  ✅ user id ${userId}${created ? ' (new account)' : ' (existing account, unchanged)'}`);
console.log(`\n  Sign in at the portal and change this password from a device you trust.\n`);
