// ============================================================
// sync-coefficient — pull each client's published Coefficient/Google-Sheet CSV
// and upsert AD-PERFORMANCE metrics into kpi_monthly, then freeze past months.
//
// Auth (either path):
//   • x-sync-key header (or ?key=) matching SYNC_SECRET — for pg_cron / pg_net
//   • Bearer JWT from a team user — for the Admin "Sync now" button in the portal
//
// Sheet parsing:
//   • Accepts period OR date/day/month columns (daily rows roll up to one month)
//   • Extra header aliases for Coefficient/Meta exports (cost, outbound clicks, etc.)
//   • spend/impr/clicks/lpv are summed per month; reach/foll/etc. take the max
//
// Deploy:  supabase functions deploy sync-coefficient --no-verify-jwt
// ============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// header alias (lower-cased) -> kpi_monthly column. Accepts human labels (incl. the
// common Meta/Coefficient variants) AND raw DB keys. CTR/CPM/CPC are derived in the
// dashboard, so they're ignored here.
const COLUMN_ALIASES: Record<string, string> = {
  "amount spent": "spend", "amount spent (usd)": "spend", "spend": "spend", "cost": "spend",
  "reach": "reach",
  "impressions": "impr", "impressions & reach": "impr", "impr": "impr",
  "link clicks": "clicks", "clicks": "clicks", "clicks (all)": "clicks", "outbound clicks": "clicks",
  "landing page views": "lpv", "landing page visits": "lpv", "lpv": "lpv",
  "page likes": "page_likes", "page_likes": "page_likes", "new page likes": "page_likes",
  "followers": "foll", "qualified followers added": "foll", "foll": "foll", "new followers": "foll",
};
// additive metrics are SUMmed when aggregating daily rows into a month; the rest
// (unique-people / running totals) take the MAX day as the best monthly proxy.
const ADDITIVE = new Set(["spend", "impr", "clicks", "lpv"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function nextMonthCutoff(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !r.every(c => (c ?? "").trim() === ""));
}

const num = (v: string) => {
  if (v === "") return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

interface MonthBucket {
  practice_id: string;
  period: string;
  [metric: string]: string | number | null;
}

// Parse one CSV grid into kpi_monthly upsert rows. defaultPid is used when the
// sheet has no practice_id column (per-client source). Supports both a monthly
// `period` column and a daily `date` column (daily rows are aggregated per month).
function rowsFromGrid(grid: string[][], source: string, defaultPid: string | null,
                      skipped: unknown[], label: string): Record<string, unknown>[] {
  if (grid.length < 2) return [];
  const header = grid[0].map(h => h.trim().toLowerCase());
  const idxOf = (n: string) => header.indexOf(n);
  const cell = (r: string[], n: string) => { const i = idxOf(n); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const hasPeriod = idxOf("period") >= 0;
  const dateIdx = ["period", "date", "day", "reporting date", "month"].map(idxOf).find(i => i >= 0) ?? -1;
  if (dateIdx < 0) { skipped.push({ source: label, reason: "no period/date column" }); return []; }

  const buckets = new Map<string, MonthBucket>();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const pid = idxOf("practice_id") >= 0 ? cell(r, "practice_id") : (defaultPid || "");
    if (!UUID_RE.test(pid)) { skipped.push({ source: label, row: i + 1, reason: "no/invalid practice_id" }); continue; }

    // resolve the reporting month from a 'YYYY-MM' period or any parseable date
    let period: string | null = null;
    const raw = (r[dateIdx] ?? "").trim();
    if (hasPeriod && /^\d{4}-\d{2}(-\d{2})?$/.test(raw)) period = raw.slice(0, 7) + "-01";
    else {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }
    if (!period) { skipped.push({ source: label, row: i + 1, reason: "unparseable period/date", value: raw }); continue; }

    const py = Number(period.slice(0, 4)), nowY = new Date().getUTCFullYear();
    if (py < 2020 || py > nowY + 1 || period > nextMonthCutoff()) {
      skipped.push({ source: label, row: i + 1, reason: "implausible/future period", value: period }); continue;
    }

    const key = pid + "|" + period;
    const b = buckets.get(key) || { practice_id: pid, period };
    for (let c = 0; c < header.length; c++) {
      const col = COLUMN_ALIASES[header[c]]; if (!col) continue;
      const v = num((r[c] ?? "").trim()); if (v == null) continue;
      if (ADDITIVE.has(col)) {
        b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
      } else {
        const prev = typeof b[col] === "number" ? b[col] as number : -Infinity;
        b[col] = Math.max(prev, v);
      }
    }
    buckets.set(key, b);
  }

  return [...buckets.values()].map(b => {
    const { practice_id, period, ...metrics } = b;
    return { practice_id, period, source, ...metrics };
  });
}

async function isTeamCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: caller, error } = await admin.auth.getUser(token);
  if (error || !caller?.user) return false;
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", caller.user.id).single();
  return profile?.role === "team";
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const secret = Deno.env.get("SYNC_SECRET");
  const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
  if (secret && got === secret) return null;
  if (await isTeamCaller(req, admin)) return null;
  if (!secret) return json({ ok: false, error: "SYNC_SECRET not configured" }, 500);
  return json({ ok: false, error: "unauthorized — set x-sync-key to SYNC_SECRET, or sign in as team" }, 401);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const denied = await authorize(req, sb);
    if (denied) return denied;

    const SOURCE = Deno.env.get("KPI_SOURCE") || "marketing";

    const { data: sources } = await sb.from("sheet_sources")
      .select("practice_id,csv_url,is_active").eq("is_active", true);
    const jobs: { pid: string | null; url: string; label: string }[] = [];
    if (sources && sources.length) {
      for (const s of sources) if (s.csv_url) jobs.push({ pid: s.practice_id, url: s.csv_url, label: s.practice_id });
    } else if (Deno.env.get("CSV_URL")) {
      jobs.push({ pid: null, url: Deno.env.get("CSV_URL")!, label: "legacy CSV_URL" });
    }
    if (!jobs.length) return json({ ok: false, error: "no active sheet sources and no CSV_URL" }, 400);

    const skipped: unknown[] = [];
    const upserts: Record<string, unknown>[] = [];
    const perSource: Record<string, { ok: boolean; rows?: number; error?: string }> = {};

    for (const job of jobs) {
      try {
        const res = await fetch(job.url, { redirect: "follow" });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const rows = rowsFromGrid(parseCSV(await res.text()), SOURCE, job.pid, skipped, job.label);
        upserts.push(...rows);
        perSource[job.label] = { ok: true, rows: rows.length };
        if (job.pid) await sb.from("sheet_sources").update({ last_synced_at: new Date().toISOString(), last_status: "ok", last_error: null }).eq("practice_id", job.pid);
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        perSource[job.label] = { ok: false, error: msg };
        if (job.pid) await sb.from("sheet_sources").update({ last_synced_at: new Date().toISOString(), last_status: "error", last_error: msg }).eq("practice_id", job.pid);
      }
    }

    let upserted = 0, error: string | null = null;
    if (upserts.length) {
      const { data, error: e } = await sb.from("kpi_monthly")
        .upsert(upserts, { onConflict: "practice_id,period,source" }).select("id");
      if (e) error = e.message; else upserted = data?.length ?? upserts.length;
    }
    await sb.rpc("finalize_past_months");

    return json({ ok: !error, sources: perSource, rows_seen: upserts.length, upserted,
      skipped_count: skipped.length, skipped: skipped.slice(0, 25), error }, error ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
