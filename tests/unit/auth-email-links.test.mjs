/**
 * Security properties of the two Edge Functions that mint account links.
 *
 * These cannot run under node:test (they are Deno TypeScript), so this file
 * asserts the properties the design depends on against the source itself. Each
 * one is a thing that, if it silently changed, would reintroduce a real defect:
 * a token a mail scanner can burn, or an account-enumeration oracle.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../supabase/functions/${p}`, import.meta.url), 'utf8');
const reset = read('request-password-reset/index.ts');
const invite = read('invite-user/index.ts');

// The link builders are pure string functions; lift them out and run them so the
// assertions are about behaviour, not about the text of the file.
function liftLinkBuilder(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start > -1, `${name} not found — the link builder was renamed or removed`);
  const sigOpen = src.indexOf('(', start);
  const sigClose = src.indexOf(')', sigOpen);
  // Keep the real parameter names and defaults; drop only the TypeScript types.
  const params = src.slice(sigOpen + 1, sigClose)
    .split(',')
    .map((p) => p.replace(/:\s*string/g, '').trim())
    .filter(Boolean);
  const open = src.indexOf('{', sigClose);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(open, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return function(${params.join(', ')}) ${body};`)();
}

describe('the account link carries its token in the URL fragment', () => {
  // A fragment is never transmitted to a server, so a mail scanner that
  // pre-fetches the link cannot consume the one-time token. This is the whole
  // reason the old magic-link login was unreliable behind corporate mail
  // security, and the reason these functions exist instead of a plain
  // resetPasswordForEmail() call.
  for (const [label, src, name] of [
    ['request-password-reset', reset, 'recoveryLink'],
    ['invite-user', invite, 'setPasswordLink'],
  ]) {
    test(`${label} puts the token after the # and never in the query`, () => {
      const build = liftLinkBuilder(src, name);
      const url = build('https://roxium.com/portal/', 'SECRET-TOKEN', 'recovery');
      const [before, after] = url.split('#');
      assert.ok(after, `${label} produced no fragment: ${url}`);
      assert.ok(after.includes('SECRET-TOKEN'), 'the token must be inside the fragment');
      assert.ok(!before.includes('SECRET-TOKEN'), `the token leaked into the path or query: ${before}`);
      assert.ok(!before.includes('?'), `${label} added a query string a scanner would transmit: ${before}`);
    });

    test(`${label} points at our own portal, not at Supabase's verify endpoint`, () => {
      const build = liftLinkBuilder(src, name);
      const url = build('https://roxium.com/portal/', 'tok', 'recovery');
      assert.ok(url.startsWith('https://roxium.com/portal/'), url);
      assert.ok(!/\/auth\/v1\/verify/.test(url), 'a GET-verify link is exactly what a scanner burns');
    });

    test(`${label} escapes the token and tolerates a trailing slash`, () => {
      const build = liftLinkBuilder(src, name);
      const a = build('https://roxium.com/portal/', 'a b+c/d', 'recovery');
      const b = build('https://roxium.com/portal', 'a b+c/d', 'recovery');
      assert.equal(a, b, 'a trailing slash must not change the link');
      assert.ok(!/ /.test(a), `the token was not URL-encoded: ${a}`);
      assert.ok(a.includes(encodeURIComponent('a b+c/d')));
    });
  }

  test('both functions build the same shape, so the portal has one parser', () => {
    const r = liftLinkBuilder(reset, 'recoveryLink')('https://x.test/portal/', 'T', 'recovery');
    const i = liftLinkBuilder(invite, 'setPasswordLink')('https://x.test/portal/', 'T', 'recovery');
    assert.equal(r, i);
  });
});

describe('request-password-reset cannot be used to enumerate accounts', () => {
  test('every exit path returns the same neutral response', () => {
    // Any `respond(` that is not the shared neutral helper or a method-not-allowed
    // guard would be a branch a caller could tell apart.
    const responds = [...reset.matchAll(/respond\(\s*\{[^}]*\}/g)].map((m) => m[0]);
    const nonNeutral = responds.filter((r) => !/ok:\s*false,\s*error:\s*"method not allowed"/.test(r) && !/ok:\s*true/.test(r));
    assert.deepEqual(nonNeutral, [], `these responses differ from the neutral one: ${nonNeutral.join(' | ')}`);
  });

  test('an unknown address produces the neutral answer, not an error', () => {
    // generateLink fails for an address with no account; that path must fall
    // through to neutral() rather than surfacing the failure.
    assert.match(reset, /if \(gen\.error \|\| !hashed\) return neutral\(\);/);
  });

  test('internal failures are logged, never returned', () => {
    const catchBlock = reset.slice(reset.indexOf('} catch (e) {'));
    assert.match(catchBlock, /console\.warn/);
    assert.ok(!/return respond\(\{[^}]*error:/.test(catchBlock), 'an internal error must not reach an unauthenticated caller');
  });

  test('the email is normalised and length-capped before use', () => {
    assert.match(reset, /\.trim\(\)\.toLowerCase\(\)\.slice\(0, 320\)/);
    assert.match(reset, /if \(!email \|\| !EMAIL_RE\.test\(email\)\) return neutral\(\);/);
  });
});

describe('neither function invents its own credential handling', () => {
  for (const [label, src] of [['request-password-reset', reset], ['invite-user', invite]]) {
    test(`${label} never receives or forwards a password value`, () => {
      // No password is read from the request, and none is sent anywhere. These
      // functions deal in one-time links only; Supabase Auth owns credentials.
      assert.ok(!/body[?.]*\.password/.test(src), `${label} reads a password from its request body`);
      assert.ok(!/password\s*:/.test(src), `${label} sends a password field somewhere`);
    });

    test(`${label} does no hashing of its own`, () => {
      for (const forbidden of ['bcrypt', 'scrypt', 'argon', 'pbkdf2', 'createHash', 'crypto.subtle']) {
        assert.ok(!src.includes(forbidden), `${label} references ${forbidden} — credentials must stay with Supabase Auth`);
      }
    });

    test(`${label} writes no credential to the database`, () => {
      const writes = [...src.matchAll(/\.(insert|upsert|update)\(([\s\S]{0,240})/g)].map((m) => m[2]);
      for (const w of writes) {
        assert.ok(!/password|token|hashed/i.test(w), `${label} writes a credential-shaped field: ${w.slice(0, 120)}`);
      }
    });

    test(`${label} mints links through the Supabase admin API only`, () => {
      assert.match(src, /admin\.auth\.admin\.generateLink/);
    });
  }
});

describe('invite-user keeps identity stable', () => {
  test('an existing account gets a recovery link, not a new account', () => {
    // `invited` is true only when createUser succeeded, i.e. the account is new.
    assert.match(invite, /const linkType = invited \? "invite" : "recovery";/);
  });
  test('it refuses to email a link it cannot build an origin for', () => {
    assert.match(invite, /if \(!REDIRECT\) throw new Error\(/);
  });
  test('it resolves the portal origin through the shared helper, not the raw secret', () => {
    // invite-user used to read SITE_URL directly. On production that secret had
    // never been required — the live version passed redirectTo: undefined and let
    // Supabase's own Site URL resolve it — so making the link depend on it meant
    // the first invitation after a release would silently fail to send on a
    // project that had always worked. _shared/env.ts already has the right
    // answer: the live portal on production, a hard failure on staging.
    assert.match(invite, /import \{[^}]*portalOrigin[^}]*\} from "\.\.\/_shared\/env\.ts"/,
      'invite-user does not import the shared origin resolver');
    assert.ok(!/Deno\.env\.get\("SITE_URL"\)/.test(invite),
      'invite-user still reads the SITE_URL secret directly, bypassing the shared fallback');
  });

  test('every function that emails a link resolves its origin the same way', () => {
    // Four functions build customer-facing links. If one of them resolves the
    // origin differently, that is the one that sends a staging link to a client
    // or a broken link to a surgeon.
    for (const [label, src] of [
      ['invite-user', invite],
      ['request-password-reset', reset],
      ['notify-client', read('notify-client/index.ts')],
      ['weekly-digest', read('weekly-digest/index.ts')],
    ]) {
      assert.match(src, /from "\.\.\/_shared\/env\.ts"/, `${label} does not use the shared origin resolver`);
      assert.ok(!/Deno\.env\.get\("SITE_URL"\)/.test(src), `${label} reads SITE_URL directly`);
    }
  });

  test('profiles and memberships are upserted, never deleted', () => {
    assert.ok(!/\.delete\(\)/.test(invite), 'invite-user must never delete a row');
    assert.match(invite, /from\("profiles"\)\.upsert/);
    assert.match(invite, /from\("memberships"\)\.upsert/);
  });
});


describe('setup and reset share one mechanism, differing only in wording', () => {
  // The first-time-setup affordance is safe precisely BECAUSE it is a recovery
  // token against the existing auth user. If it ever gained its own account
  // creation path, an unapproved stranger could mint themselves an account.
  test('there is exactly one generateLink call, and it is always recovery', () => {
    const calls = [...reset.matchAll(/generateLink\(\{[\s\S]{0,200}?\}\)/g)].map((m) => m[0]);
    assert.equal(calls.length, 1, `expected one generateLink call, found ${calls.length}`);
    assert.match(calls[0], /type:\s*"recovery"/);
  });

  test('the intent never reaches createUser, signUp or any write', () => {
    assert.ok(!/createUser/.test(reset), 'the reset/setup endpoint must never create a user');
    assert.ok(!/signUp/.test(reset), 'the reset/setup endpoint must never sign anyone up');
    assert.ok(!/\.(insert|upsert|update|delete)\(/.test(reset), 'it must not write to the database at all');
  });

  test('an unrecognised intent falls back to reset rather than branching', () => {
    // Only the literal "setup" switches wording; everything else is "reset".
    assert.match(reset, /let intent: Intent = "reset";/);
    assert.match(reset, /if \(String\(body\?\.intent \?\? ""\) === "setup"\) intent = "setup";/);
  });

  test('the intent changes copy only — the token path ignores it', () => {
    // Between reading the intent and minting the link, the intent must not be
    // consulted: otherwise the two purposes could diverge in behaviour.
    const from = reset.indexOf('const gen = await admin.auth.admin.generateLink');
    const to = reset.indexOf('if (gen.error || !hashed)');
    assert.ok(from > -1 && to > from);
    assert.ok(!reset.slice(from, to).includes('intent'), 'the token is minted without reference to the intent');
  });

  test('both intents answer with the same neutral response', () => {
    // neutral() is the single exit; nothing branches on intent to return early.
    const returns = [...reset.matchAll(/return neutral\(\);/g)];
    assert.ok(returns.length >= 4, 'every early exit should be neutral()');
    assert.ok(!/intent[^;]{0,80}return respond/.test(reset), 'no response varies by intent');
  });

  test('the setup email says setup and the reset email says reset', () => {
    const copy = reset.slice(reset.indexOf('const COPY'), reset.indexOf('// Branded, Outlook-safe'));
    assert.match(copy, /reset: \{[\s\S]*?subject: "Set a new ROXIUM portal password"/);
    assert.match(copy, /setup: \{[\s\S]*?subject: "Set up your ROXIUM portal password"/);
    // The setup wording must not imply an existing password was forgotten.
    const setupBlock = copy.slice(copy.indexOf('setup: {'));
    assert.ok(!/forgot|reset the password/i.test(setupBlock), `setup copy reads like a reset: ${setupBlock.slice(0, 200)}`);
  });

  test('the intent rides in the fragment too, so a scanner still sees nothing', () => {
    const build = liftLinkBuilder(reset, 'recoveryLink');
    const url = build('https://roxium.com/portal/', 'TOK', 'recovery', 'setup');
    const [before, after] = url.split('#');
    assert.ok(after.includes('i=setup'));
    assert.ok(!before.includes('setup'));
    assert.ok(!before.includes('TOK'));
  });

  test('omitting the intent produces the link shape invite-user also builds', () => {
    const r = liftLinkBuilder(reset, 'recoveryLink')('https://x.test/portal/', 'T', 'recovery');
    const i = liftLinkBuilder(invite, 'setPasswordLink')('https://x.test/portal/', 'T', 'recovery');
    assert.equal(r, i);
    assert.ok(!r.includes('i='));
  });
});
