// ============================================================
// oauth-start — begin a self-service marketing connection from the wizard.
// POST { provider: 'meta'|'google', practice_id } with the caller's JWT.
// The caller must be a member of that practice (or team).
//
// Connections run through COMPOSIO: we ask Composio for a hosted auth link
// (user_id = practice_id) and hand the browser Composio's redirect URL. Meta /
// Google tokens are held by Composio, never by us — there is no ROXIUM Meta or
// Google developer app to register or maintain.
//
// Returns { ok, configured, url? }:
//   • configured:false when Composio isn't wired up yet (no COMPOSIO_API_KEY or
//     no auth-config id for this provider) — the wizard degrades to "our team
//     will connect this with you" instead of dead-ending.
//   • otherwise Composio's authorize URL, with an HMAC-signed state token in the
//     callback so oauth-callback can trust which practice/provider it belongs to.
//
// Deploy:  supabase functions deploy oauth-start --no-verify-jwt
// Secrets: SYNC_SECRET (state signing), COMPOSIO_API_KEY,
//          COMPOSIO_META_AUTH_CONFIG_ID, COMPOSIO_GOOGLE_AUTH_CONFIG_ID.
// ============================================================
import { serviceClient, bearerToken, UUID_RE } from "../_shared/auth.ts";
import { signState, callbackUrl } from "../_shared/oauth.ts";
import { composioKey, composioProvider, createLink } from "../_shared/composio.ts";

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

    // Provider wired up in Composio yet?
    const prov = composioProvider(String(provider));
    if (!composioKey() || !prov) return respond({ ok: true, configured: false });

    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return respond({ ok: false, error: "SYNC_SECRET not configured" }, 500);

    // Sign practice+provider into the callback so the callback can trust it
    // regardless of the query params Composio appends.
    const state = await signState({ p: String(practice_id), v: String(provider), u: uid, ts: Date.now() }, secret);
    const cb = `${callbackUrl()}?state=${encodeURIComponent(state)}`;

    const { redirectUrl, connectedAccountId } = await createLink(prov.authConfigId, String(practice_id), cb);

    // Record the in-flight connection so the callback (and a re-click) can find it.
    await admin.from("platform_connections").upsert({
      practice_id: String(practice_id), provider: String(provider), status: "pending",
      composio_connection_id: connectedAccountId, connected_by: uid, last_error: null,
    }, { onConflict: "practice_id,provider" });

    return respond({ ok: true, configured: true, url: redirectUrl });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
