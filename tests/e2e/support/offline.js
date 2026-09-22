// Offline harness for the portal.
//
// portal/index.html loads supabase-js and chart.js from a CDN. CI (and this
// sandbox) may have no egress, and we do not want these tests depending on a
// third party anyway — so we serve minimal stand-ins and a synthetic, fully
// configured environment. That lets the real app.js boot and lets us assert what
// a visitor actually sees, with no backend and no credentials.

const STUB_CONFIG = `
  var CONFIG = { SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_ANON_KEY: 'stub-anon-key' };
  window.ROXIUM_ENV = 'staging';
  window.ROXIUM_ENV_ERROR = null;
`;

// A chainable PostgREST-shaped stub. Every query resolves to "no rows", which is
// exactly what RLS returns to a caller with no session.
const STUB_SUPABASE = `
  (function () {
    var EMPTY = { data: [], error: null };
    function qb() {
      var p = Promise.resolve(EMPTY);
      var api = {};
      ['select','insert','update','upsert','delete','eq','neq','in','gte','lte','gt','lt',
       'ilike','like','is','order','limit','range','filter','not','or'
      ].forEach(function (m) { api[m] = function () { return api; }; });
      api.single = function () { return Promise.resolve({ data: null, error: { message: 'no rows' } }); };
      api.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
      api.then = function (a, b) { return p.then(a, b); };
      api.catch = function (f) { return p.catch(f); };
      return api;
    }
    window.__ROXIUM_STUB_CALLS = [];
    window.supabase = {
      createClient: function (url, key) {
        window.__ROXIUM_STUB_CALLS.push({ url: url, key: key });
        return {
          auth: (function () {
            // Scriptable auth stub. Tests set window.__ROXIUM_AUTH before load to
            // choose outcomes; every call is recorded so a test can assert that
            // the app called Supabase Auth rather than inventing its own thing.
            var cfg = window.__ROXIUM_AUTH || {};
            var calls = window.__ROXIUM_AUTH_CALLS = [];
            var listeners = [];
            var session = cfg.session || null;
            var rec = function (name, arg) { calls.push({ name: name, arg: arg }); };
            var fail = function (spec) {
              return { message: spec.message || 'stub error', status: spec.status };
            };
            return {
              getSession: function () { rec('getSession'); return Promise.resolve({ data: { session: session }, error: null }); },
              getUser: function () { rec('getUser'); return Promise.resolve({ data: { user: session ? session.user : null }, error: null }); },
              onAuthStateChange: function (cb) {
                listeners.push(cb);
                window.__ROXIUM_EMIT = function (event, s) { session = s || session; listeners.forEach(function (f) { f(event, s); }); };
                return { data: { subscription: { unsubscribe: function () {} } } };
              },
              signInWithPassword: function (creds) {
                rec('signInWithPassword', { email: creds && creds.email, hasPassword: !!(creds && creds.password) });
                if (cfg.signInError) return Promise.resolve({ data: {}, error: fail(cfg.signInError) });
                session = { user: { id: 'stub-user', email: creds.email } };
                setTimeout(function () { listeners.forEach(function (f) { f('SIGNED_IN', session); }); }, 0);
                return Promise.resolve({ data: { session: session }, error: null });
              },
              verifyOtp: function (args) {
                rec('verifyOtp', args);
                if (cfg.verifyError) return Promise.resolve({ data: {}, error: fail(cfg.verifyError) });
                session = { user: { id: 'stub-user', email: 'stub@practice.test' } };
                return Promise.resolve({ data: { session: session }, error: null });
              },
              updateUser: function (attrs) {
                rec('updateUser', { hasPassword: !!(attrs && attrs.password), length: attrs && attrs.password ? attrs.password.length : 0 });
                if (cfg.updateUserError) return Promise.resolve({ data: {}, error: fail(cfg.updateUserError) });
                return Promise.resolve({ data: { user: { id: 'stub-user' } }, error: null });
              },
              resetPasswordForEmail: function (email, opts) {
                rec('resetPasswordForEmail', { email: email, opts: opts });
                return Promise.resolve({ data: {}, error: null });
              },
              signOut: function () { rec('signOut'); session = null; return Promise.resolve({ error: null }); },
            };
          })(),
          from: function () { return qb(); },
          rpc: function () { return Promise.resolve({ data: null, error: null }); },
          functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } },
          storage: { from: function () { return { list: function () { return Promise.resolve(EMPTY); } }; } },
        };
      },
    };
  })();
`;

const STUB_CHART = `window.Chart = function () { return { destroy: function () {}, update: function () {} }; };
  window.Chart.register = function () {};`;

/**
 * Serve a configured environment, stubbed CDN libraries and an empty backend.
 * @param {import('@playwright/test').Page} page
 */
async function stubPortal(page, auth) {
  // Injected before any page script runs, so the stub reads it at createClient time.
  await page.addInitScript((a) => { window.__ROXIUM_AUTH = a || {}; }, auth || {});

  await page.route(/\/config\.js(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_CONFIG }));

  await page.route(/cdn\.jsdelivr\.net.*supabase.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SUPABASE }));

  await page.route(/cdn\.jsdelivr\.net.*chart.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_CHART }));

  // Fonts are cosmetic; answer them so nothing hangs on a blocked network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  // Any direct call to the stub backend returns no rows. Edge functions get a
  // neutral { ok: true } — the same answer request-password-reset always gives.
  await page.route('**://stub.supabase.co/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**://stub.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

module.exports = { stubPortal };
