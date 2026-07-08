// ============================================================
// sync-platforms — pull marketing metrics DIRECTLY from connected platforms
// (OAuth connections made in the Marketing Setup Wizard) into kpi_monthly /
// kpi_daily, using the exact same row shape and conflict keys as the
// Coefficient pipeline — the portal cannot tell the difference.
//
//   • Meta: account-level insights, last 6 months monthly (spend, reach,
//     impressions, link clicks) + current-month daily rows → source 'marketing'
//   • Google Ads: monthly cost/impressions/clicks via GAQL → source
//     'google_ads'. Requires GOOGLE_ADS_DEVELOPER_TOKEN (external approval);
//     silently skipped until that secret exists.
//
// Auth mirrors sync-coefficient: x-sync-key == SYNC_SECRET (cron) or team JWT.
// Schedule alongside the existing 2-hour sync cron (see docs).
//
// Deploy:  supabase functions deploy sync-platforms --no-verify-jwt
// ============================================================
import { serviceClient, bearerToken } from "../_shared/auth.ts";
import { providerConfig } from "../_shared/oauth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

type Json = Record<string, unknown>;
const monthStart = (d: string) => d.slice(0, 7) + "-01";

async function authorize(req: Request): Promise<Response | null> {
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
    }
  }
  if (!secret) return respond({ ok: false, error: "SYNC_SECRET not configured" }, 500);
  return respond({ ok: false, error: "unauthorized" }, 401);
}

// ---- Meta -------------------------------------------------------------------
async function pullMeta(sb: ReturnType<typeof serviceClient>, conn: Json, token: string) {
  const acct = String(conn.external_account_id || "");
  if (!acct) throw new Error("no ad account discovered for this connection");
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const base = `https://graph.facebook.com/v21.0/${acct}/insights`;
  const common = `level=account&fields=spend,reach,impressions,inline_link_clicks&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${encodeURIComponent(token)}`;

  // Monthly snapshots.
  const mr = await fetch(`${base}?time_increment=monthly&${common}`);
  const mj = await mr.json() as Json;
  if (!mr.ok) throw new Error(String((mj.error as Json)?.message || "meta insights failed"));
  const monthly = (Array.isArray(mj.data) ? mj.data as Json[] : []).map((r) => ({
    practice_id: conn.practice_id, period: monthStart(String(r.date_start)), source: "marketing",
    spend: Number(r.spend || 0), reach: Number(r.reach || 0),
    impr: Number(r.impressions || 0), clicks: Number(r.inline_link_clicks || 0),
    updated_at: new Date().toISOString(),
  }));
  if (monthly.length) {
    const { error } = await sb.from("kpi_monthly").upsert(monthly, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }

  // Daily rows for the live month (feeds the month-zoom charts).
  const curSince = new Date(); curSince.setDate(1);
  const dcommon = `level=account&fields=spend,reach,impressions,inline_link_clicks&time_range=${encodeURIComponent(JSON.stringify({ since: curSince.toISOString().slice(0, 10), until }))}&access_token=${encodeURIComponent(token)}`;
  const dr = await fetch(`${base}?time_increment=1&${dcommon}`);
  const dj = await dr.json() as Json;
  const daily = (dr.ok && Array.isArray(dj.data) ? dj.data as Json[] : []).map((r) => ({
    practice_id: conn.practice_id, day: String(r.date_start), source: "marketing",
    spend: Number(r.spend || 0), reach: Number(r.reach || 0),
    impr: Number(r.impressions || 0), clicks: Number(r.inline_link_clicks || 0),
    updated_at: new Date().toISOString(),
  }));
  if (daily.length) {
    const { error } = await sb.from("kpi_daily").upsert(daily, { onConflict: "practice_id,day,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: monthly.length, daily: daily.length };
}

// ---- Google Ads -------------------------------------------------------------
async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const cfg = providerConfig("google");
  if (!cfg) throw new Error("google oauth not configured");
  const body = new URLSearchParams({
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  });
  const r = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const t = await r.json() as Json;
  if (!r.ok || !t.access_token) throw new Error(String(t.error_description || t.error || "google token refresh failed"));
  return String(t.access_token);
}

async function pullGoogleAds(sb: ReturnType<typeof serviceClient>, conn: Json, refreshToken: string) {
  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!devToken) return { skipped: "GOOGLE_ADS_DEVELOPER_TOKEN not set" };
  const access = await refreshGoogleToken(refreshToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access}`, "developer-token": devToken, "Content-Type": "application/json",
  };
  // Discover the customer id once, then persist it on the connection.
  let customer = String(conn.external_account_id || "");
  if (!customer) {
    const lr = await fetch("https://googleads.googleapis.com/v18/customers:listAccessibleCustomers", { headers });
    const lj = await lr.json() as Json;
    if (!lr.ok) throw new Error(String((lj.error as Json)?.message || "listAccessibleCustomers failed"));
    const names = Array.isArray(lj.resourceNames) ? lj.resourceNames as string[] : [];
    if (!names.length) throw new Error("no accessible Google Ads accounts");
    customer = names[0].replace("customers/", "");
    await sb.from("platform_connections").update({ external_account_id: customer }).eq("id", conn.id);
  }
  const query = `SELECT segments.month, metrics.cost_micros, metrics.impressions, metrics.clicks
                 FROM customer WHERE segments.date DURING LAST_180_DAYS`;
  const r = await fetch(`https://googleads.googleapis.com/v18/customers/${customer}/googleAds:search`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const j = await r.json() as Json;
  if (!r.ok) throw new Error(String((j.error as Json)?.message || "google ads search failed"));
  const byMonth = new Map<string, { spend: number; impr: number; clicks: number }>();
  (Array.isArray(j.results) ? j.results as Json[] : []).forEach((row) => {
    const seg = row.segments as Json, met = row.metrics as Json;
    const period = monthStart(String(seg?.month || ""));
    if (!period || period === "-01") return;
    const m = byMonth.get(period) || { spend: 0, impr: 0, clicks: 0 };
    m.spend += Number(met?.costMicros || 0) / 1e6;
    m.impr += Number(met?.impressions || 0);
    m.clicks += Number(met?.clicks || 0);
    byMonth.set(period, m);
  });
  const rows = [...byMonth.entries()].map(([period, m]) => ({
    practice_id: conn.practice_id, period, source: "google_ads",
    spend: Math.round(m.spend * 100) / 100, impr: m.impr, clicks: m.clicks,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await sb.from("kpi_monthly").upsert(rows, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: rows.length };
}

// ---- main -------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    const sb = serviceClient();
    const { data: conns, error } = await sb.from("platform_connections")
      .select("id,practice_id,provider,external_account_id,status").eq("status", "connected");
    if (error) throw error;

    const reports: Json[] = [];
    for (const conn of (conns || []) as Json[]) {
      const { data: tok } = await sb.from("platform_tokens")
        .select("access_token,refresh_token,expires_at").eq("connection_id", conn.id).maybeSingle();
      if (!tok?.access_token) { reports.push({ id: conn.id, error: "no token" }); continue; }
      try {
        let result: Json;
        if (conn.provider === "meta") {
          result = await pullMeta(sb, conn, String(tok.access_token));
        } else if (conn.provider === "google") {
          result = tok.refresh_token
            ? await pullGoogleAds(sb, conn, String(tok.refresh_token)) as Json
            : { skipped: "no refresh token — reconnect Google" };
        } else {
          result = { skipped: "unknown provider" };
        }
        await sb.from("platform_connections")
          .update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", conn.id);
        reports.push({ id: conn.id, provider: conn.provider, practice: conn.practice_id, ...result });
      } catch (e) {
        const msg = String((e as Error)?.message || e).slice(0, 300);
        await sb.from("platform_connections")
          .update({ status: /expired|invalid|revoked|OAuth/i.test(msg) ? "error" : "connected", last_error: msg })
          .eq("id", conn.id);
        reports.push({ id: conn.id, provider: conn.provider, error: msg });
      }
    }
    return respond({ ok: true, connections: (conns || []).length, reports });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
