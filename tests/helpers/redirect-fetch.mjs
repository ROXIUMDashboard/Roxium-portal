/**
 * redirect-fetch.mjs — preloaded into the seeder under test with --import.
 *
 * The seeder's production guard requires a real https://<ref>.supabase.co URL
 * and refuses anything else, which is exactly the behaviour we want to keep
 * exercising: the test therefore hands it a genuine staging-shaped URL and
 * rewrites only the socket destination, here, at the last moment. The guard,
 * the request construction, the headers and the payloads are all the real ones.
 *
 * Weakening the guard to accept http://127.0.0.1 would have been the easy path
 * and would have left the production check untested.
 */
const FROM = process.env.ROXIUM_FAKE_SUPABASE_FROM || '';
const TO = process.env.ROXIUM_FAKE_SUPABASE_TO || '';

if (FROM && TO) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    return realFetch(url.startsWith(FROM) ? TO + url.slice(FROM.length) : url, init);
  };
}
