// ============================================================
// sync-platforms — pull marketing metrics for every Composio-connected practice
// into kpi_monthly, using the exact same row shape and conflict keys as the
// Coefficient pipeline, so the portal cannot tell the difference.
//
// Tokens are held by Composio (keyed by user_id = practice_id); we never store
// or refresh them. We call Composio's tool-execute API, which injects each
// practice's token:
//   • Meta  → METAADS_GET_AD_ACCOUNTS (discover the ad account once) then
//     METAADS_GET_INSIGHTS per month, last 6 months → source 'marketing'.
//   • Google→ GOOGLEADS_SEARCH_STREAM_GAQL (monthly cost/impr/clicks) → source
//     'google_ads'. No developer token needed — Composio's managed Google Ads
//     auth config carries its own approved developer token.
//
// Auth mirrors sync-coefficient: x-sync-key == SYNC_SECRET (cron) or team JWT.
// Schedule alongside the existing 2-hour sync cron (see docs).
//
// Deploy:  supabase functions deploy sync-platforms --no-verify-jwt
// Secrets: SYNC_SECRET, COMPOSIO_API_KEY.
// ============================================================
import { serviceClient, bearerToken, UUID_RE } from "../_shared/auth.ts";
import { composioKey, executeTool } from "../_shared/composio.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

type Json = Record<string, unknown>;
const num = (x: unknown) => { const n = Number(x); return isFinite(n) ? n : 0; };
const monthStart = (d: string) => d.slice(0, 7) + "-01";

// Cron (x-sync-key) and team sync everything; a practice member may refresh
// their OWN practice ("Refresh now" in the Connections manager) by passing
// practice_id — the membership check scopes them to it.
async function authorize(req: Request, practiceId: string | null): Promise<Response | null> {
  const secret = Deno.env.get("SYNC_SECRET");
  const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
  if (secret && got === secret) return null;
  const admin = serviceClient();
  const token = bearerToken(req);
  if (token) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", data.user.id).single();
      if (prof?.role === "team") return null;
      if (practiceId) {
        const { data: mem } = await admin.from("memberships")
          .select("role").eq("user_id", data.user.id).eq("practice_id", practiceId).maybeSingle();
        if (mem) return null;
      }
    }
  }
  if (!secret) return respond({ ok: false, error: "SYNC_SECRET not configured" }, 500);
  return respond({ ok: false, error: "unauthorized" }, 401);
}

// ---- response helpers -------------------------------------------------------
function firstArrayByKeys(o: unknown, keys: string[]): Json[] | null {
  if (!o || typeof o !== "object") return null;
  const obj = o as Json;
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as Json[];
  return null;
}
// Composio wraps the tool's output under `data`; the tool payload then carries
// the real rows under a provider-specific key.
function rows(resp: Json, keys: string[]): Json[] {
  const d = (resp.data && typeof resp.data === "object" && !Array.isArray(resp.data))
    ? resp.data as Json : resp;
  return firstArrayByKeys(d, keys)
    ?? firstArrayByKeys((d as Json).data, keys)
    ?? (Array.isArray(resp.data) ? resp.data as Json[] : []);
}

// ---- Meta -------------------------------------------------------------------
function monthWindows(n: number): { since: string; until: string; period: string }[] {
  const out: { since: string; until: string; period: string }[] = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  for (let i = 0; i < n; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const since = first.toISOString().slice(0, 10);
    let until = last.toISOString().slice(0, 10);
    if (until > today) until = today; // don't ask past today for the live month
    out.push({ since, until, period: since }); // since is already YYYY-MM-01
  }
  return out;
}

async function pullMeta(sb: ReturnType<typeof serviceClient>, conn: Json) {
  const practice = String(conn.practice_id);
  const caId = (conn.composio_connection_id as string) || null;

  // Discover the ad account once, then persist it (id + human label).
  let acct = String(conn.external_account_id || "");
  if (!acct) {
    const r = await executeTool("METAADS_GET_AD_ACCOUNTS", practice,
      { limit: 1, fields: "id,account_id,name" }, caId);
    const list = rows(r, ["data", "ad_accounts", "accounts"]);
    const first = list[0] as Json | undefined;
    if (!first) throw new Error("no ad account accessible for this connection");
    acct = String(first.id || (first.account_id ? `act_${first.account_id}` : ""));
    if (!acct) throw new Error("could not resolve ad account id");
    await sb.from("platform_connections").update({
      external_account_id: acct,
      external_account_name: first.name ? String(first.name) : (conn.external_account_name ?? null),
    }).eq("id", conn.id);
  }

  const monthly: Json[] = [];
  for (const w of monthWindows(6)) {
    const r = await executeTool("METAADS_GET_INSIGHTS", practice, {
      object_id: acct, level: "account",
      time_range: { since: w.since, until: w.until },
      fields: ["spend", "reach", "impressions", "clicks"],
    }, caId);
    const insight = rows(r, ["data"]);
    if (!insight.length) continue;
    // Aggregate (a windowed account-level query returns a single row, but sum defensively).
    const agg = insight.reduce((a, row) => ({
      spend: a.spend + num(row.spend), reach: a.reach + num(row.reach),
      impr: a.impr + num(row.impressions), clicks: a.clicks + num(row.clicks ?? row.inline_link_clicks),
    }), { spend: 0, reach: 0, impr: 0, clicks: 0 });
    monthly.push({
      practice_id: practice, period: monthStart(w.period), source: "marketing",
      spend: agg.spend, reach: agg.reach, impr: agg.impr, clicks: agg.clicks,
      updated_at: new Date().toISOString(),
    });
  }
  if (monthly.length) {
    const { error } = await sb.from("kpi_monthly").upsert(monthly, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: monthly.length };
}

// ---- Google Ads -------------------------------------------------------------
async function pullGoogleAds(sb: ReturnType<typeof serviceClient>, conn: Json) {
  const practice = String(conn.practice_id);
  const caId = (conn.composio_connection_id as string) || null;
  // GAQL has no LAST_180_DAYS literal (only LAST_7/14/30_DAYS etc.), so use an
  // explicit BETWEEN range for the trailing ~6 months.
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const query = `SELECT segments.month, metrics.cost_micros, metrics.impressions, metrics.clicks
                 FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  // One short-backoff retry on 429: Composio's managed Google Ads auth shares a
  // developer token across its customers, so QPS-style throttles are common and
  // often clear in seconds. (A drained DAILY quota won't — the cron re-tries.)
  let r: Json;
  try {
    r = await executeTool("GOOGLEADS_SEARCH_STREAM_GAQL", practice, { query }, caId);
  } catch (e) {
    if (!/RESOURCE_EXHAUSTED|"code":\s*429|\b429\b/.test(String((e as Error)?.message || e))) throw e;
    await new Promise((res) => setTimeout(res, 5000));
    r = await executeTool("GOOGLEADS_SEARCH_STREAM_GAQL", practice, { query }, caId);
  }
  const results = rows(r, ["results", "rows", "data"]);

  const byMonth = new Map<string, { spend: number; impr: number; clicks: number }>();
  for (const row of results) {
    const seg = (row.segments as Json) || {};
    const met = (row.metrics as Json) || {};
    const raw = String(seg.month || "");
    if (!raw) continue;
    const period = monthStart(raw);
    if (!period || period === "-01") continue;
    const m = byMonth.get(period) || { spend: 0, impr: 0, clicks: 0 };
    m.spend += num(met.costMicros ?? met.cost_micros) / 1e6;
    m.impr += num(met.impressions);
    m.clicks += num(met.clicks);
    byMonth.set(period, m);
  }
  const monthly = [...byMonth.entries()].map(([period, m]) => ({
    practice_id: practice, period, source: "google_ads",
    spend: Math.round(m.spend * 100) / 100, impr: m.impr, clicks: m.clicks,
    updated_at: new Date().toISOString(),
  }));
  if (monthly.length) {
    const { error } = await sb.from("kpi_monthly").upsert(monthly, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: monthly.length };
}

// ---- main -------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    // Optional scope: {practice_id, provider} → sync just that connection
    // (used by the first-import-on-connect kick and the client "Refresh now").
    let scope: { practice_id?: string; provider?: string } = {};
    try { scope = await req.json() || {}; } catch { /* empty body = sync all */ }
    const scopePractice = scope.practice_id && UUID_RE.test(String(scope.practice_id)) ? String(scope.practice_id) : null;
    const scopeProvider = scope.provider && /^[a-z][a-z0-9_]{1,30}$/.test(String(scope.provider)) ? String(scope.provider) : null;

    const denied = await authorize(req, scopePractice);
    if (denied) return denied;
    if (!composioKey()) return respond({ ok: false, error: "COMPOSIO_API_KEY not configured" }, 500);

    const sb = serviceClient();
    let q = sb.from("platform_connections")
      .select("id,practice_id,provider,external_account_id,external_account_name,composio_connection_id,status")
      .eq("status", "connected");
    if (scopePractice) q = q.eq("practice_id", scopePractice);
    if (scopeProvider) q = q.eq("provider", scopeProvider);
    const { data: conns, error } = await q;
    if (error) throw error;

    const reports: Json[] = [];
    for (const conn of (conns || []) as Json[]) {
      try {
        let result: Json;
        if (conn.provider === "meta") result = await pullMeta(sb, conn);
        else if (conn.provider === "google") result = await pullGoogleAds(sb, conn);
        else result = { skipped: "ingestion for this platform is handled by ROXIUM" };
        await sb.from("platform_connections")
          .update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", conn.id);
        reports.push({ id: conn.id, provider: conn.provider, practice: conn.practice_id, ...result });
      } catch (e) {
        // Google/Meta errors often arrive as a JSON blob — condense to
        // "STATUS: message" so ops (and the client UI) get a readable line.
        let msg = String((e as Error)?.message || e);
        try {
          const parsed = JSON.parse(msg);
          const err = (Array.isArray(parsed) ? (parsed[0] as Json)?.error : (parsed as Json)?.error) as Json | undefined;
          if (err) msg = `${err.status || err.code || "error"}: ${err.message || ""}`.trim();
        } catch { /* not a JSON blob — keep as-is */ }
        msg = msg.slice(0, 300);
        // Only genuine auth failures flip the connection to 'error' (needs
        // reconnect). Quota throttles and query bugs stay 'connected' — the
        // cron simply retries them.
        const authDead = /expired|invalid_grant|revoked|not active|reconnect|unauthorized|\b401\b/i.test(msg);
        await sb.from("platform_connections")
          .update({ status: authDead ? "error" : "connected", last_error: msg })
          .eq("id", conn.id);
        reports.push({ id: conn.id, provider: conn.provider, error: msg });
      }
    }
    return respond({ ok: true, connections: (conns || []).length, reports });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
