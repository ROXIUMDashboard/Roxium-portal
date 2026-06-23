// ============================================================
// sync-coefficient — pull each client's published Coefficient/Google-Sheet CSV
// and upsert AD-PERFORMANCE metrics into kpi_monthly, then freeze past months.
//
// Source of truth = Supabase. The portal NEVER reads the sheet directly.
//
// Per-client sources:
//   • Preferred: rows in `sheet_sources` (one per practice, each with its own
//     csv_url — a tab in the master sheet or a per-client sheet). The sync loops
//     every active source. practice_id comes from the row, so the sheet doesn't
//     even need a practice_id column (but it's still accepted if present).
//   • Fallback: the legacy single CSV_URL secret (one master sheet whose rows
//     carry a practice_id column). Used only when no sheet_sources exist.
//
// Snapshots:
//   • Each (practice_id, period, source) is one row. The CURRENT calendar month is
//     live (finalized=false, keeps updating). After upserting, finalize_past_months()
//     freezes every earlier month; a DB trigger makes finalized rows immutable.
//
// Metrics mapped (header → column): the real ad fields. CTR/CPM/CPC are derived
// in the dashboard from spend·impr·clicks, so they aren't stored.
//
// Env: SYNC_SECRET (required), KPI_SOURCE (default 'marketing'),
//      CSV_URL (legacy fallback), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// header alias (lower-cased) -> kpi_monthly column. Accepts human labels (incl. the
// common Meta/Coefficient variants) AND raw DB keys, so a real ad export or our
// template both work. CTR/CPM/CPC are derived in the dashboard, so they're ignored here.
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

function nextMonthCutoff(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });

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

  // bucket rows by practice|period, aggregating metrics
  const buckets = new Map<string, Record<string, number | null>>();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const pid = idxOf("practice_id") >= 0 ? cell(r, "practice_id") : (defaultPid || "");
    if (!UUID_RE.test(pid)) { skipped.push({ source: label, row: i + 1, reason: "no/invalid practice_id" }); continue; }

    // resolve the reporting month from a 'YYYY-MM' period or any parseable date
    let period: string | null = null;
    const raw = (r[dateIdx] ?? "").trim();
    if (hasPeriod && /^\d{4}-\d{2}(-\d{2})?$/.test(raw)) period = raw.slice(0, 7) + "-01";
    else { const d = new Date(raw); if (!isNaN(d.getTime())) period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`; }
    if (!period) { skipped.push({ source: label, row: i + 1, reason: "unparseable period/date", value: raw }); continue; }

    const py = Number(period.slice(0, 4)), nowY = new Date().getUTCFullYear();
    if (py < 2020 || py > nowY + 1 || period > nextMonthCutoff()) {
      skipped.push({ source: label, row: i + 1, reason: "implausible/future period", value: period }); continue;
    }

    const key = pid + "|" + period;
    const b = buckets.get(key) || { __pid: pid as unknown as number, __period: period as unknown as number };
    for (let c = 0; c < header.length; c++) {
      const col = COLUMN_ALIASES[header[c]]; if (!col) continue;
      const v = num((r[c] ?? "").trim()); if (v == null) continue;
      if (ADDITIVE.has(col)) b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
      else b[col] = Math.max(typeof b[col] === "number" ? b[col] as number : -Infinity, v);
    }
    buckets.set(key, b);
  }

  return [...buckets.values()].map(b => {
    const { __pid, __period, ...metrics } = b as Record<string, unknown>;
    return { practice_id: __pid, period: __period, source, ...metrics };
  });
}

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return json({ ok: false, error: "SYNC_SECRET not configured" }, 500);
    const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
    if (got !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const SOURCE = Deno.env.get("KPI_SOURCE") || "marketing";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // gather the sources to pull: per-client sheet_sources, else the legacy CSV_URL
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
      // finalized rows are protected by a DB trigger, so upserting them is a safe no-op
      const { data, error: e } = await sb.from("kpi_monthly")
        .upsert(upserts, { onConflict: "practice_id,period,source" }).select("id");
      if (e) error = e.message; else upserted = data?.length ?? upserts.length;
    }
    // freeze every month before the current one (idempotent)
    await sb.rpc("finalize_past_months");

    return json({ ok: !error, sources: perSource, rows_seen: upserts.length, upserted,
      skipped_count: skipped.length, skipped: skipped.slice(0, 25), error }, error ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
