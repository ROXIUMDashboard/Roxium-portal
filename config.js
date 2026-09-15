// ============================================================
// ROXIUM PORTAL · config.js — ENVIRONMENT RESOLUTION
// ------------------------------------------------------------
// Decides which Supabase project this page talks to, and REFUSES TO GUESS.
//
// Resolution order:
//   1. ROXIUM_BUILD_ENV — stamped in by scripts/prepare-pages.sh at deploy time.
//   2. The hostname the page is served from (see ENVIRONMENTS[].hosts).
//   3. Nothing. -> FAIL CLOSED. No Supabase client is created and the page shows
//      an error. There is deliberately NO default and NO fallback to production.
//
// Then a cross-check: the resolved environment must claim the current hostname.
// A production build served from a staging host (or the reverse) fails closed too,
// so a mis-wired deploy can never point real customers at staging — or, far worse,
// point a staging test at the production database.
//
// The anon keys below are PUBLIC by design (Row Level Security is what protects
// the data). Service-role keys are NEVER in this file and never reach the browser.
// ============================================================

const ROXIUM_ENVIRONMENTS = {
  production: {
    label: 'production',
    // Real customers. roxium.com serves the marketing page at / and the portal at /portal/.
    hosts: ['roxium.com', 'www.roxium.com', 'roxium-portal.pages.dev'],
    SUPABASE_URL: 'https://nchtmeqsjkpcvtuscxfy.supabase.co',
    SUPABASE_ANON_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jaHRtZXFzamtwY3Z0dXNjeGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDc0ODgsImV4cCI6MjA5Njc4MzQ4OH0.pkqxEXf3XdzESvRPtZWTaCIDyfQ3g6CJAFfUnEoIt9c',
  },

  staging: {
    label: 'staging',
    // Test data only. Never real customers.
    // Cloudflare Pages serves every non-production branch under <branch>.roxium-portal.pages.dev.
    hosts: [
      'staging.roxium.com',
      'staging.roxium-portal.pages.dev',
      'localhost',
      '127.0.0.1',
      '',                       // file:// during local inspection
    ],
    hostSuffixes: ['.roxium-portal.pages.dev'],   // every Pages preview build -> staging
    // TODO(Max): fill these in from the STAGING Supabase project
    // (Settings -> API -> Project URL and `anon` public key), then commit.
    // Until then staging FAILS CLOSED, which is the intended behaviour.
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
  },
};

// Stamped by scripts/prepare-pages.sh. Left as the literal placeholder in the repo
// so an un-built checkout falls through to hostname resolution.
const ROXIUM_BUILD_ENV = '__ROXIUM_BUILD_ENV__';

function roxiumMatchesHost(env, hostname) {
  if (env.hosts && env.hosts.indexOf(hostname) !== -1) return true;
  return (env.hostSuffixes || []).some((s) => hostname.endsWith(s));
}

/**
 * Resolve the environment for a hostname. Pure: no globals, no DOM — so it is
 * unit-tested directly (tests/unit/env-resolution.test.mjs).
 * @returns {{ok:true, name:string, env:object} | {ok:false, reason:string, detail:string}}
 */
function resolveRoxiumEnvironment(hostname, buildEnv) {
  const stamped = buildEnv && buildEnv.indexOf('__ROXIUM') !== 0 ? buildEnv : null;

  if (stamped) {
    const env = ROXIUM_ENVIRONMENTS[stamped];
    if (!env) {
      return { ok: false, reason: 'unknown-build-env',
        detail: 'This build was stamped ROXIUM_BUILD_ENV="' + stamped + '", which is not a known environment.' };
    }
    if (!roxiumMatchesHost(env, hostname)) {
      return { ok: false, reason: 'host-mismatch',
        detail: 'This is a ' + stamped + ' build, but it is being served from "' + hostname +
                '", which ' + stamped + ' does not claim. Refusing to connect rather than risk ' +
                'pointing the wrong audience at the wrong database.' };
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return { ok: false, reason: 'unconfigured',
        detail: 'The "' + stamped + '" environment has no Supabase project configured yet in config.js.' };
    }
    return { ok: true, name: stamped, env: env };
  }

  const matches = Object.keys(ROXIUM_ENVIRONMENTS).filter((n) => roxiumMatchesHost(ROXIUM_ENVIRONMENTS[n], hostname));
  if (matches.length === 0) {
    return { ok: false, reason: 'unknown-host',
      detail: 'No ROXIUM environment claims the hostname "' + hostname + '". ' +
              'Add it to config.js if this host is legitimate. Refusing to guess.' };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'ambiguous-host',
      detail: 'Hostname "' + hostname + '" is claimed by more than one environment (' + matches.join(', ') + ').' };
  }
  const name = matches[0];
  const env = ROXIUM_ENVIRONMENTS[name];
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, reason: 'unconfigured',
      detail: 'The "' + name + '" environment has no Supabase project configured yet in config.js.' };
  }
  return { ok: true, name: name, env: env };
}

// ---- browser wiring -------------------------------------------------------
// In Node (unit tests) there is no `window`; export the pure pieces and stop.
if (typeof window === 'undefined') {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ROXIUM_ENVIRONMENTS, resolveRoxiumEnvironment };
  }
} else {
  const _r = resolveRoxiumEnvironment(window.location.hostname, ROXIUM_BUILD_ENV);

  // eslint-disable-next-line no-var
  var CONFIG = _r.ok
    ? { SUPABASE_URL: _r.env.SUPABASE_URL, SUPABASE_ANON_KEY: _r.env.SUPABASE_ANON_KEY }
    : null;

  window.ROXIUM_ENV = _r.ok ? _r.name : null;
  window.ROXIUM_ENV_ERROR = _r.ok ? null : _r;

  if (!_r.ok) {
    // FAIL CLOSED, loudly. app.js checks window.ROXIUM_ENV_ERROR and stops.
    console.error('[ROXIUM] environment not resolved (' + _r.reason + '): ' + _r.detail);
    window.addEventListener('DOMContentLoaded', function () {
      const s = document.createElement('div');
      s.setAttribute('role', 'alert');
      s.style.cssText =
        'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;background:#0D0C10;color:#F2EDE3;font:400 15px/1.6 Inter,system-ui,sans-serif';
      s.innerHTML =
        '<div style="max-width:520px;border:1px solid rgba(201,168,76,.35);border-radius:10px;padding:32px 34px">' +
        '<div style="font-family:Georgia,serif;letter-spacing:6px;font-size:20px">ROX<span style="color:#C9A84C">I</span>UM</div>' +
        '<div style="height:2px;width:40px;background:#C9A84C;margin:14px 0 20px"></div>' +
        '<div style="font-family:Georgia,serif;font-size:20px;margin-bottom:10px">This deployment is not configured</div>' +
        '<p style="color:#9A948A;margin:0 0 14px">' +
        String(_r.detail).replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        }) +
        '</p><p style="color:#7C776E;font-size:12.5px;margin:0">No database connection was opened. ' +
        'This is a deliberate safety stop, not a crash &mdash; see docs/ENVIRONMENTS.md.</p></div>';
      document.body.appendChild(s);
    });
  } else if (_r.name !== 'production') {
    // Non-production marker. Internal-only: production renders nothing extra.
    window.addEventListener('DOMContentLoaded', function () {
      const b = document.createElement('div');
      b.id = 'roxiumEnvBadge';
      b.textContent = _r.name.toUpperCase();
      b.style.cssText =
        'position:fixed;left:0;bottom:0;z-index:9998;padding:3px 10px;border-top-right-radius:6px;' +
        'background:#C9A84C;color:#171410;font:600 10px/1.4 Inter,system-ui,sans-serif;letter-spacing:.18em;' +
        'pointer-events:none;opacity:.9';
      document.body.appendChild(b);
    });
  }
}
