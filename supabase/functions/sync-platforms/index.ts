// ============================================================
// sync-platforms — pull marketing metrics for every Composio-connected practice
// into kpi_monthly AND kpi_daily, using the exact same row shapes and conflict
// keys as the Coefficient pipeline, so the portal cannot tell the difference.
//
// Tokens are held by Composio (keyed by user_id = practice_id); we never store
// or refresh them. We call Composio's tool-execute API, which injects each
// practice's token:
//   • Meta  → METAADS_GET_AD_ACCOUNTS (discover ALL ad accounts once, persisted
//     to platform_connections.accounts for the account picker); per month
//     METAADS_GET_INSIGHTS whole-month (TRUE deduplicated monthly reach) →
//     kpi_monthly; and an incremental day-walker — METAADS_GET_INSIGHTS one
//     single-day call per missing/recent day (the Composio tool has NO
//     time_increment param; a multi-day pull collapses to one aggregate row) →
//     kpi_daily. Capped at MAX_DAY_CALLS per run; history backfills across
//     cron cycles, then steady-state is ~3 day-calls per run. Source 'marketing'.
//   • Google→ GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS (discover customer ids once,
//     persisted for the picker) then ONE GOOGLEADS_SEARCH_STREAM_GAQL segmented
//     by date; daily rows land in kpi_daily and month totals are derived by
//     summing days (cost/impressions/clicks are additive) → source 'google_ads'.
//     No developer token needed — Composio's managed auth carries its own.
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
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// One short-backoff retry on 429: Composio's managed auth shares developer
// tokens across its customers, so QPS-style throttles are common and often
// clear in seconds. (A drained DAILY quota won't — the 2-hour cron re-tries.)
const is429 = (e: unknown) => /RESOURCE_EXHAUSTED|"code":\s*429|\b429\b/.test(String((e as Error)?.message || e));
async function withRetry429<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (!is429(e)) throw e;
    await new Promise((res) => setTimeout(res, 5000));
    return await fn();
  }
}

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

// Steady-state ~3 single-day calls per run (re-pull the last 2 days + today);
// larger gaps backfill at up to this many days per run across cron cycles.
const MAX_DAY_CALLS = 14;
const BACKFILL_START_DAYS = 30; // with no daily history at all, start 30 days back

async function pullMeta(sb: ReturnType<typeof serviceClient>, conn: Json) {
  const practice = String(conn.practice_id);
  const caId = (conn.composio_connection_id as string) || null;

  // Discover ALL accessible ad accounts once and persist the list — the
  // Connections UI account picker renders platform_connections.accounts.
  // Re-runs when the list is missing even if an account is already selected.
  let acct = String(conn.external_account_id || "");
  const haveList = Array.isArray(conn.accounts) && (conn.accounts as unknown[]).length > 0;
  if (!acct || !haveList) {
    const r = await executeTool("METAADS_GET_AD_ACCOUNTS", practice,
      { limit: 50, fields: "id,account_id,name" }, caId);
    const list = rows(r, ["data", "ad_accounts", "accounts"]);
    const accounts = list.map((a) => {
      const o = a as Json;
      return {
        id: String(o.id || (o.account_id ? `act_${o.account_id}` : "")),
        label: String(o.name || o.id || ""),
      };
    }).filter((a) => a.id);
    if (!accounts.length) throw new Error("no ad account accessible for this connection");
    if (!acct) acct = accounts[0].id;
    const chosen = accounts.find((a) => a.id === acct);
    await sb.from("platform_connections").update({
      external_account_id: acct,
      external_account_name: chosen?.label || (conn.external_account_name as string | null) || null,
      accounts,
    }).eq("id", conn.id);
  }

  // Monthly: whole-month call → TRUE monthly reach (Meta deduplicates across
  // the month; summing daily reach would count a person once per day they saw an ad).
  const monthly: Json[] = [];
  for (const w of monthWindows(6)) {
    const r = await executeTool("METAADS_GET_INSIGHTS", practice, {
      object_id: acct, level: "account",
      time_range: { since: w.since, until: w.until },
      fields: ["spend", "reach", "impressions", "clicks"],
    }, caId);
    const insight = rows(r, ["data"]);
    if (!insight.length) continue;
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

  // Daily: the Composio insights tool has NO time_increment — a multi-day pull
  // collapses into one aggregate row. So walk missing/recent days one call per
  // day (single-day reach is per-day deduplicated, i.e. correct), starting two
  // days before the newest stored day (late-settling metrics), capped per run.
  const today = new Date().toISOString().slice(0, 10);
  const { data: newest } = await sb.from("kpi_daily")
    .select("day").eq("practice_id", practice).eq("source", "marketing")
    .order("day", { ascending: false }).limit(1);
  let cursor = newest?.[0]?.day ? addDays(String(newest[0].day), -2) : addDays(today, -BACKFILL_START_DAYS);
  const daily: Json[] = [];
  for (let i = 0; i < MAX_DAY_CALLS && cursor <= today; i++, cursor = addDays(cursor, 1)) {
    const r = await executeTool("METAADS_GET_INSIGHTS", practice, {
      object_id: acct, level: "account",
      time_range: { since: cursor, until: cursor },
      fields: ["spend", "reach", "impressions", "clicks"],
    }, caId);
    const ins = rows(r, ["data"]);
    if (!ins.length) continue;
    const agg = ins.reduce((a, row) => ({
      spend: a.spend + num(row.spend), reach: a.reach + num(row.reach),
      impr: a.impr + num(row.impressions), clicks: a.clicks + num(row.clicks ?? row.inline_link_clicks),
    }), { spend: 0, reach: 0, impr: 0, clicks: 0 });
    if (agg.spend === 0 && agg.impr === 0 && agg.clicks === 0 && agg.reach === 0) continue;
    daily.push({
      practice_id: practice, day: cursor, source: "marketing",
      spend: agg.spend, reach: agg.reach, impr: agg.impr, clicks: agg.clicks,
      updated_at: new Date().toISOString(),
    });
  }

  if (monthly.length) {
    const { error } = await sb.from("kpi_monthly").upsert(monthly, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }
  if (daily.length) {
    const { error } = await sb.from("kpi_daily").upsert(daily, { onConflict: "practice_id,day,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: monthly.length, daily: daily.length };
}

// ---- Google Ads -------------------------------------------------------------
// Mirror of pullMeta's discovery step. Without an explicit customer_id the GAQL
// call runs in Composio's default connection context and Google answers
// 403 PERMISSION_DENIED — the exact failure seen since 2026-07-15.
async function discoverGoogleCustomers(practice: string, caId: string | null): Promise<string[]> {
  const r = await withRetry429(() => executeTool("GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS", practice, {}, caId));
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const m = v.match(/customers\/(\d{5,})/);
      const id = m ? m[1] : (/^\d{10}$/.test(v.trim()) ? v.trim() : null);
      if (id && !found.includes(id)) found.push(id);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(r);
  return found;
}

async function pullGoogleAds(sb: ReturnType<typeof serviceClient>, conn: Json) {
  const practice = String(conn.practice_id);
  const caId = (conn.composio_connection_id as string) || null;
  // ONE date-segmented query serves both tables: daily rows go to kpi_daily
  // verbatim, and month totals are derived by summing days — cost, impressions
  // and clicks are additive, so the derived monthly numbers are exact. (GAQL has
  // no LAST_180_DAYS literal, so use an explicit BETWEEN for ~6 months.)
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks
                 FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;

  const run = (customerId: string): Promise<Json> =>
    withRetry429(() => executeTool("GOOGLEADS_SEARCH_STREAM_GAQL", practice, { query, customer_id: customerId }, caId));

  let acct = String(conn.external_account_id || "").replace(/\D/g, "");
  const haveList = Array.isArray(conn.accounts) && (conn.accounts as unknown[]).length > 0;
  let r: Json | null = null;

  if (acct && haveList) {
    r = await run(acct);
  } else {
    // Discover the accessible customers, persist the full list for the
    // account-picker UI, then adopt (or keep) the first customer that actually
    // answers a metrics query. Managers (MCC) reject metrics with
    // REQUESTED_METRICS_FOR_MANAGER; per-customer PERMISSION_DENIED is also
    // possible — both just mean "try the next one".
    const customers = await discoverGoogleCustomers(practice, caId);
    if (!customers.length) {
      throw new Error("no google ads account accessible for this connection — reconnect with a Google login that has Google Ads access");
    }
    await sb.from("platform_connections").update({
      accounts: customers.map((id) => ({ id, label: `Google Ads ${id}` })),
    }).eq("id", conn.id);
    const order = acct && customers.includes(acct) ? [acct, ...customers.filter((c) => c !== acct)] : customers;
    let lastErr: unknown = null;
    for (const id of order) {
      try { r = await run(id); acct = id; break; }
      catch (e) { lastErr = e; }
    }
    if (!r || !acct) {
      throw lastErr instanceof Error ? lastErr
        : new Error(String(lastErr || "every accessible google ads account rejected the metrics query"));
    }
    await sb.from("platform_connections").update({
      external_account_id: acct,
      external_account_name: String(conn.external_account_name || "") || `Google Ads ${acct}`,
    }).eq("id", conn.id);
  }

  const results = rows(r, ["results", "rows", "data"]);

  const byDay = new Map<string, { spend: number; impr: number; clicks: number }>();
  for (const row of results) {
    const seg = (row.segments as Json) || {};
    const met = (row.metrics as Json) || {};
    const day = String(seg.date || "");
    if (!DAY_RE.test(day)) continue;
    const m = byDay.get(day) || { spend: 0, impr: 0, clicks: 0 };
    m.spend += num(met.costMicros ?? met.cost_micros) / 1e6;
    m.impr += num(met.impressions);
    m.clicks += num(met.clicks);
    byDay.set(day, m);
  }
  const byMonth = new Map<string, { spend: number; impr: number; clicks: number }>();
  for (const [day, m] of byDay) {
    const period = monthStart(day);
    const t = byMonth.get(period) || { spend: 0, impr: 0, clicks: 0 };
    t.spend += m.spend; t.impr += m.impr; t.clicks += m.clicks;
    byMonth.set(period, t);
  }

  const daily = [...byDay.entries()].map(([day, m]) => ({
    practice_id: practice, day, source: "google_ads",
    spend: Math.round(m.spend * 100) / 100, impr: m.impr, clicks: m.clicks,
    updated_at: new Date().toISOString(),
  }));
  const monthly = [...byMonth.entries()].map(([period, m]) => ({
    practice_id: practice, period, source: "google_ads",
    spend: Math.round(m.spend * 100) / 100, impr: m.impr, clicks: m.clicks,
    updated_at: new Date().toISOString(),
  }));
  if (monthly.length) {
    const { error } = await sb.from("kpi_monthly").upsert(monthly, { onConflict: "practice_id,period,source" });
    if (error) throw new Error(error.message);
  }
  if (daily.length) {
    const { error } = await sb.from("kpi_daily").upsert(daily, { onConflict: "practice_id,day,source" });
    if (error) throw new Error(error.message);
  }
  return { monthly: monthly.length, daily: daily.length, customer_id: acct };
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
      .select("id,practice_id,provider,external_account_id,external_account_name,composio_connection_id,accounts,status")
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
