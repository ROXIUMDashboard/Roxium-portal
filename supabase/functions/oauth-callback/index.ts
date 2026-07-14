// ============================================================
// oauth-callback — the browser returns here from Composio after the practice
// completes consent. GET ?state=…&status=success&connected_account_id=ca_…
//   • state is HMAC-signed by oauth-start and carries { practice, provider }.
//   • status / connected_account_id are appended by Composio.
//
// We verify the state, then confirm with Composio that the connected account is
// ACTIVE and actually belongs to this practice (user_id match) before flipping
// platform_connections to 'connected'. No token ever touches our database —
// Composio holds it. Finally we 302 the browser back to the portal wizard with
// ?connected=<provider> (or ?connect_error=<reason>).
//
// Deploy:  supabase functions deploy oauth-callback --no-verify-jwt
// Secrets: SYNC_SECRET, SITE_URL, COMPOSIO_API_KEY.
// External: this function's URL is the callback registered by oauth-start; no
//           provider-side redirect URI configuration is needed (Composio owns
//           the Meta / Google developer apps).
// ============================================================
import { serviceClient } from "../_shared/auth.ts";
import { verifyState, portalUrl } from "../_shared/oauth.ts";
import { getConnectedAccount } from "../_shared/composio.ts";

const redirect = (qs: string) =>
  new Response(null, { status: 302, headers: { Location: portalUrl(qs) } });
const fail = (reason: string) => redirect("connect_error=" + encodeURIComponent(reason.slice(0, 80)));

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("error"))
      return fail(url.searchParams.get("error_description") || url.searchParams.get("error") || "denied");

    const stateTok = url.searchParams.get("state");
    if (!stateTok) return fail("missing state");

    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return fail("server not configured");
    const state = await verifyState(stateTok, secret);
    if (!state) return fail("expired or invalid state — try again");

    // Composio appends these; status can be "success" | "failed".
    const statusParam = (url.searchParams.get("status") || "").toLowerCase();
    const caId = url.searchParams.get("connected_account_id") || url.searchParams.get("connectedAccountId");

    const sb = serviceClient();

    // Resolve the connection id — prefer the callback param, else the one we
    // stored when the link was created.
    let connectionId = caId || "";
    if (!connectionId) {
      const { data: row } = await sb.from("platform_connections")
        .select("composio_connection_id").eq("practice_id", state.p).eq("provider", state.v).maybeSingle();
      connectionId = String(row?.composio_connection_id || "");
    }

    if (statusParam && statusParam !== "success") {
      if (connectionId || state.p) {
        await sb.from("platform_connections")
          .update({ status: "error", last_error: "connection was not completed" })
          .eq("practice_id", state.p).eq("provider", state.v);
      }
      return fail("connection was not completed");
    }
    if (!connectionId) return fail("no connection id returned");

    // Confirm with Composio: must be ACTIVE and belong to this practice.
    const acct = await getConnectedAccount(connectionId);
    if (acct.userId && String(acct.userId) !== String(state.p)) return fail("connection ownership mismatch");
    if (acct.status && !["ACTIVE", "CONNECTED"].includes(acct.status))
      return fail("connection is not active yet — try again in a moment");

    const { error: cerr } = await sb.from("platform_connections").upsert({
      practice_id: state.p, provider: state.v, status: "connected",
      composio_connection_id: connectionId,
      external_account_name: acct.label || undefined,
      connected_by: state.u || null, connected_at: new Date().toISOString(), last_error: null,
    }, { onConflict: "practice_id,provider" });
    if (cerr) throw new Error(cerr.message);

    // Kick off the FIRST import immediately (fire-and-forget) so dashboards
    // populate right after connecting instead of waiting for the next cron tick.
    const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    if (base && secret) {
      const firstSync = fetch(`${base}/functions/v1/sync-platforms`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-key": secret },
        body: JSON.stringify({ practice_id: state.p, provider: state.v }),
      }).catch(() => {});
      // deno-lint-ignore no-explicit-any
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(firstSync); } catch { /* best effort */ }
    }

    return redirect("connected=" + encodeURIComponent(state.v));
  } catch (e) {
    return fail(String((e as Error)?.message || e));
  }
});
