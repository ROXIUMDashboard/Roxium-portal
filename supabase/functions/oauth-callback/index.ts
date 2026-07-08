// ============================================================
// oauth-callback — the browser returns here from Meta / Google consent.
// GET ?code=…&state=…  (state is HMAC-signed by oauth-start).
//
// Exchanges the code for tokens (Meta: upgraded to a ~60-day long-lived
// token; Google: access + refresh token), discovers the connected account's
// name/id, stores metadata in platform_connections and tokens in the
// service-role-only platform_tokens table, then 302s the browser back to the
// portal wizard with ?connected=<provider> (or ?connect_error=<reason>).
//
// Deploy:  supabase functions deploy oauth-callback --no-verify-jwt
// Secrets: SYNC_SECRET, SITE_URL, META_APP_ID/SECRET, GOOGLE_CLIENT_ID/SECRET.
// External: this function's URL must be registered as a valid OAuth redirect
//           URI in the Meta developer app and the Google Cloud OAuth client.
// ============================================================
import { serviceClient } from "../_shared/auth.ts";
import { providerConfig, verifyState, callbackUrl, portalUrl } from "../_shared/oauth.ts";

const redirect = (qs: string) =>
  new Response(null, { status: 302, headers: { Location: portalUrl(qs) } });
const fail = (reason: string) => redirect("connect_error=" + encodeURIComponent(reason.slice(0, 80)));

type Json = Record<string, unknown>;

async function exchangeMeta(cfg: NonNullable<ReturnType<typeof providerConfig>>, code: string) {
  const u = new URL(cfg.tokenUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("client_secret", cfg.clientSecret);
  u.searchParams.set("redirect_uri", callbackUrl());
  u.searchParams.set("code", code);
  const r1 = await fetch(u); const t1 = await r1.json() as Json;
  if (!r1.ok || !t1.access_token) throw new Error(String((t1.error as Json)?.message || "token exchange failed"));
  // Upgrade to a long-lived (~60d) token.
  const u2 = new URL(cfg.tokenUrl);
  u2.searchParams.set("grant_type", "fb_exchange_token");
  u2.searchParams.set("client_id", cfg.clientId);
  u2.searchParams.set("client_secret", cfg.clientSecret);
  u2.searchParams.set("fb_exchange_token", String(t1.access_token));
  const r2 = await fetch(u2); const t2 = await r2.json() as Json;
  const accessToken = String(t2.access_token || t1.access_token);
  const expiresIn = Number(t2.expires_in || t1.expires_in || 0);
  // Discover the ad accounts this login can read.
  const ar = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id&limit=25&access_token=${encodeURIComponent(accessToken)}`);
  const aj = await ar.json() as Json;
  const accounts = Array.isArray(aj.data) ? aj.data as Json[] : [];
  const first = accounts[0] || null;
  return {
    accessToken, refreshToken: null as string | null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    accountId: first ? `act_${first.account_id}` : null,
    accountName: first ? String(first.name || "") : null,
    accounts,
  };
}

async function exchangeGoogle(cfg: NonNullable<ReturnType<typeof providerConfig>>, code: string) {
  const body = new URLSearchParams({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
    redirect_uri: callbackUrl(), grant_type: "authorization_code",
  });
  const r = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const t = await r.json() as Json;
  if (!r.ok || !t.access_token) throw new Error(String((t as Json).error_description || t.error || "token exchange failed"));
  let email = "";
  try {
    const ur = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } });
    email = String(((await ur.json()) as Json).email || "");
  } catch { /* label only */ }
  return {
    accessToken: String(t.access_token),
    refreshToken: t.refresh_token ? String(t.refresh_token) : null,
    expiresAt: t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000).toISOString() : null,
    accountId: null as string | null,
    accountName: email || null,
    accounts: [] as Json[],
  };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || url.searchParams.get("error") || "denied");
    const code = url.searchParams.get("code"), stateTok = url.searchParams.get("state");
    if (!code || !stateTok) return fail("missing code");

    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return fail("server not configured");
    const state = await verifyState(stateTok, secret);
    if (!state) return fail("expired or invalid state — try again");

    const cfg = providerConfig(state.v);
    if (!cfg) return fail("provider not configured");

    const tok = state.v === "meta" ? await exchangeMeta(cfg, code) : await exchangeGoogle(cfg, code);

    const sb = serviceClient();
    const { data: conn, error: cerr } = await sb.from("platform_connections").upsert({
      practice_id: state.p, provider: state.v, status: "connected",
      external_account_id: tok.accountId, external_account_name: tok.accountName,
      accounts: tok.accounts.length ? tok.accounts : null,
      scopes: cfg.scopes, connected_by: state.u || null,
      connected_at: new Date().toISOString(), last_error: null,
    }, { onConflict: "practice_id,provider" }).select("id").single();
    if (cerr || !conn) throw new Error(cerr?.message || "could not store connection");

    const { error: terr } = await sb.from("platform_tokens").upsert({
      connection_id: conn.id, access_token: tok.accessToken,
      refresh_token: tok.refreshToken, expires_at: tok.expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "connection_id" });
    if (terr) throw new Error(terr.message);

    return redirect("connected=" + encodeURIComponent(state.v));
  } catch (e) {
    return fail(String((e as Error)?.message || e));
  }
});
