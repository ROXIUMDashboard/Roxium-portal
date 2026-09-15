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
          auth: {
            getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
            getUser: function () { return Promise.resolve({ data: { user: null }, error: null }); },
            onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
            signInWithOtp: function () { return Promise.resolve({ data: {}, error: { message: 'stub: no mail sent' } }); },
            verifyOtp: function () { return Promise.resolve({ data: {}, error: { message: 'stub' } }); },
            signOut: function () { return Promise.resolve({ error: null }); },
          },
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
async function stubPortal(page) {
  await page.route(/\/config\.js(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_CONFIG }));

  await page.route(/cdn\.jsdelivr\.net.*supabase.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SUPABASE }));

  await page.route(/cdn\.jsdelivr\.net.*chart.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_CHART }));

  // Fonts are cosmetic; answer them so nothing hangs on a blocked network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  // Any direct call to the stub backend returns no rows.
  await page.route('**://stub.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

module.exports = { stubPortal };
