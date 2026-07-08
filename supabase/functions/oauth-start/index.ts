// ============================================================
// oauth-start — begin a self-service marketing connection from the wizard.
// POST { provider: 'meta'|'google', practice_id } with the caller's JWT.
// The caller must be a member of that practice (or team).
//
// Returns { ok, configured, url? }:
//   • configured:false when the provider's developer app isn't set up yet
//     (no META_APP_ID / GOOGLE_CLIENT_ID secrets) — the wizard degrades to
//     "our team will connect this with you" instead of dead-ending.
//   • otherwise an authorize URL carrying an HMAC-signed state token so the
//     callback can trust which practice/provider it belongs to.
//
// Deploy:  supabase functions deploy oauth-start --no-verify-jwt
// Secrets: SYNC_SECRET (state signing; already set), and per provider:
//          META_APP_ID + META_APP_SECRET, GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
// ============================================================
import { serviceClient, bearerToken, UUID_RE } from "../_shared/auth.ts";
import { providerConfig, signState, callbackUrl } from "../_shared/oauth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const { provider, practice_id } = await req.json();
    if (!provider || !practice_id || !UUID_RE.test(String(practice_id)))
      return respond({ ok: false, error: "provider and practice_id required" }, 400);

    const admin = serviceClient();
    const token = bearerToken(req);
    if (!token) return respond({ ok: false, error: "not authenticated" }, 401);
    const { data: userData, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !userData?.user) return respond({ ok: false, error: "invalid session" }, 401);
    const uid = userData.user.id;

    // Member of the practice, or team.
    const { data: prof } = await admin.from("profiles").select("role").eq("id", uid).single();
    if (prof?.role !== "team") {
      const { data: mem } = await admin.from("memberships")
        .select("role").eq("user_id", uid).eq("practice_id", practice_id).maybeSingle();
      if (!mem) return respond({ ok: false, error: "not a member of this practice" }, 403);
    }

    const cfg = providerConfig(String(provider));
    if (!cfg) return respond({ ok: true, configured: false });

    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return respond({ ok: false, error: "SYNC_SECRET not configured" }, 500);
    const state = await signState({ p: String(practice_id), v: String(provider), u: uid, ts: Date.now() }, secret);

    const u = new URL(cfg.authUrl);
    u.searchParams.set("client_id", cfg.clientId);
    u.searchParams.set("redirect_uri", callbackUrl());
    u.searchParams.set("state", state);
    u.searchParams.set("scope", cfg.scopes.join(provider === "google" ? " " : ","));
    if (provider === "google") {
      u.searchParams.set("response_type", "code");
      u.searchParams.set("access_type", "offline");   // refresh token
      u.searchParams.set("prompt", "consent");        // always re-issue refresh token
      u.searchParams.set("include_granted_scopes", "true");
    } else {
      u.searchParams.set("response_type", "code");
    }
    return respond({ ok: true, configured: true, url: u.toString() });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
