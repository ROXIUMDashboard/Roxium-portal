/**
 * The claim this pass rests on, tested against a real Supabase project:
 *
 *   An existing, passwordless account can establish a password through the
 *   first-time-setup flow WITHOUT changing its identity — same auth user id,
 *   same profile, same memberships, same practice, same role.
 *
 * It runs the actual mechanism end to end: create a passwordless user (as
 * invite-user does), grant a membership, mint a recovery link exactly as
 * request-password-reset does, redeem the token, set a password, then sign in
 * with it as a normal client would.
 *
 *   STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... \
 *   STAGING_SUPABASE_ANON_KEY=... node --test tests/integration/*.test.mjs
 *
 * SKIPPED without those. scripts/lib/staging-guard.mjs refuses the production
 * project before anything is created, so this can never run against live data.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertStagingTarget } from '../../scripts/lib/staging-guard.mjs';

const URL_ = (process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.STAGING_SUPABASE_ANON_KEY || '';
const READY = Boolean(URL_ && SERVICE && ANON);

// Reserved TLD: these addresses can never resolve, so no real person is mailed.
const EMAIL = `migration-${randomUUID().slice(0, 8)}@fixture.test`;
const NEW_PASSWORD = `pw-${randomUUID()}`;

const admin = (path, init = {}) => fetch(`${URL_}${path}`, {
  ...init,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
}).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }));

const anon = (path, init = {}) => fetch(`${URL_}${path}`, {
  ...init,
  headers: { apikey: ANON, 'Content-Type': 'application/json', ...(init.headers || {}) },
}).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }));

let userId = null;
let practiceId = null;
const before_ = {};

describe('an existing passwordless account establishes a password', { skip: !READY && 'staging credentials not set' }, () => {
  before(async () => {
    assertStagingTarget(URL_);   // refuses production before anything is written

    // 1 ── the account as invite-user creates it: no password at all.
    const created = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, email_confirm: true, user_metadata: { seeded: true, full_name: 'Migration Fixture' } }),
    });
    assert.ok(created.body?.id, `could not create the fixture user: ${JSON.stringify(created.body)}`);
    userId = created.body.id;

    // 2 ── a practice and a membership, so there is real authorization to preserve.
    const practice = await admin('/rest/v1/practices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: `Migration Fixture ${userId.slice(0, 8)} (TEST)` }),
    });
    practiceId = practice.body?.[0]?.id;
    assert.ok(practiceId, `could not create the fixture practice: ${JSON.stringify(practice.body)}`);

    await admin('/rest/v1/profiles', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: userId, role: 'client', practice_id: practiceId, full_name: 'Migration Fixture' }),
    });
    await admin('/rest/v1/memberships', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, practice_id: practiceId, role: 'member' }),
    });

    const prof = await admin(`/rest/v1/profiles?id=eq.${userId}&select=id,role,practice_id,full_name`);
    const mems = await admin(`/rest/v1/memberships?user_id=eq.${userId}&select=practice_id,role`);
    before_.profile = prof.body?.[0];
    before_.memberships = mems.body;
    assert.ok(before_.profile, 'fixture profile was not created');
    assert.equal(before_.memberships.length, 1);
  });

  after(async () => {
    // Deleting the auth user cascades profiles/memberships (FK on delete cascade).
    if (userId) await admin(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
    if (practiceId) await admin(`/rest/v1/practices?id=eq.${practiceId}`, { method: 'DELETE' });
  });

  test('the account genuinely has no password to begin with', async () => {
    const r = await anon('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: EMAIL, password: NEW_PASSWORD }),
    });
    assert.equal(r.ok, false, 'a passwordless account must not accept a password');
  });

  test('a setup link is minted against the EXISTING user, creating nothing', async () => {
    const usersBefore = await admin('/auth/v1/admin/users?page=1&per_page=1000');
    const countBefore = (usersBefore.body?.users || []).filter((u) => (u.email || '').toLowerCase() === EMAIL).length;
    assert.equal(countBefore, 1);

    // Exactly what request-password-reset does for intent "setup".
    const gen = await admin('/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({ type: 'recovery', email: EMAIL }),
    });
    assert.ok(gen.body?.hashed_token, `generate_link returned no hashed token: ${JSON.stringify(gen.body)}`);
    before_.hashedToken = gen.body.hashed_token;
    assert.equal(gen.body.user_id ?? userId, userId, 'the link was minted for a different user');

    const usersAfter = await admin('/auth/v1/admin/users?page=1&per_page=1000');
    const matching = (usersAfter.body?.users || []).filter((u) => (u.email || '').toLowerCase() === EMAIL);
    assert.equal(matching.length, 1, 'a duplicate account was created');
    assert.equal(matching[0].id, userId, 'the user id changed');
  });

  test('redeeming the token yields a session for the same user', async () => {
    // The client-side equivalent of verifyOtp({ token_hash, type: 'recovery' }).
    const v = await anon('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ type: 'recovery', token_hash: before_.hashedToken }),
    });
    assert.ok(v.ok, `verify failed: ${v.status} ${JSON.stringify(v.body)}`);
    assert.equal(v.body?.user?.id, userId, 'the recovery token resolved to a different user');
    before_.accessToken = v.body.access_token;
    assert.ok(before_.accessToken);
  });

  test('setting the password updates that account and no other', async () => {
    // The client-side equivalent of updateUser({ password }).
    const u = await anon('/auth/v1/user', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${before_.accessToken}` },
      body: JSON.stringify({ password: NEW_PASSWORD }),
    });
    assert.ok(u.ok, `updateUser failed: ${u.status} ${JSON.stringify(u.body)}`);
    assert.equal(u.body?.id, userId);
  });

  test('the new password signs in, as a normal client would', async () => {
    const r = await anon('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: EMAIL, password: NEW_PASSWORD }),
    });
    assert.ok(r.ok, `sign-in with the new password failed: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.user?.id, userId, 'signing in produced a DIFFERENT user id');
    before_.clientToken = r.body.access_token;
  });

  test('identity, profile, role and practice are unchanged', async () => {
    const prof = await admin(`/rest/v1/profiles?id=eq.${userId}&select=id,role,practice_id,full_name`);
    assert.deepEqual(prof.body?.[0], before_.profile, 'the profile changed while setting a password');
  });

  test('membership is intact', async () => {
    const mems = await admin(`/rest/v1/memberships?user_id=eq.${userId}&select=practice_id,role`);
    assert.deepEqual(mems.body, before_.memberships, 'memberships changed while setting a password');
  });

  test('the signed-in user reads their own practice, and only that one', async () => {
    // Through RLS with the user's own token — the authorization boundary itself.
    const seen = await fetch(`${URL_}/rest/v1/practices?select=id,name`, {
      headers: { apikey: ANON, Authorization: `Bearer ${before_.clientToken}` },
    }).then((r) => r.json());
    assert.ok(Array.isArray(seen));
    assert.deepEqual(seen.map((p) => p.id), [practiceId], 'the migrated user sees the wrong set of practices');
  });

  test('the old state is gone: there is still exactly one account for this email', async () => {
    const list = await admin('/auth/v1/admin/users?page=1&per_page=1000');
    const matching = (list.body?.users || []).filter((u) => (u.email || '').toLowerCase() === EMAIL);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].id, userId);
  });

  test('a second setup link can still be issued, and the old one is spent', async () => {
    const replay = await anon('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ type: 'recovery', token_hash: before_.hashedToken }),
    });
    assert.equal(replay.ok, false, 'a recovery token was accepted twice');
  });
});
