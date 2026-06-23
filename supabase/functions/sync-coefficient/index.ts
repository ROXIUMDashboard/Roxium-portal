// ============================================================
// sync-coefficient — pull each client's published Coefficient/Google-Sheet CSV
// and upsert AD-PERFORMANCE metrics into kpi_monthly, then freeze past months.
//
// Source of truth = Supabase. The portal NEVER reads the sheet directly.
//
// Auth (either path):
//   • x-sync-key header (or ?key=) matching SYNC_SECRET — for pg_cron / pg_net
//   • Bearer JWT from a team user — for the Admin "Sync now" button in the portal
//
// Per-client sources:
//   • Preferred: rows in `sheet_sources` (one per practice, each with its own
//     csv_url — a tab in the master sheet or a per-client sheet). The sync loops
//     every active source. practice_id comes from the row, so the sheet doesn't
//     even need a practice_id column (but it's still accepted if present).
//   • Fallback: the legacy single CSV_URL secret (one master sheet whose rows
//     carry a practice_id column). Used only when no sheet_sources exist.
//
// Env: SYNC_SECRET (required for cron), KPI_SOURCE (default 'marketing'),
//      CSV_URL (legacy fallback), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto).
// Deploy:  supabase functions deploy sync-coefficient --no-verify-jwt   (cron)
//          supabase functions deploy sync-coefficient                   (portal button)
// ============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const COLUMN_ALIASES: Record<string, string> = {
  "amount spent": "spend", "amount spent (usd)": "spend", "spend": "spend",
  "reach": "reach",
  "impressions": "impr", "impressions & reach": "impr", "impr": "impr",
  "link clicks": "clicks", "clicks": "clicks",
  "landing page views": "lpv", "landing page visits": "lpv", "lpv": "lpv",
  "page likes": "page_likes", "page_likes": "page_likes",
  "followers": "foll", "qualified followers added": "foll", "foll": "foll",
};
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

function rowsFromGrid(grid: string[][], source: string, defaultPid: string | null,
                      skipped: unknown[], label: string): Record<string, unknown>[] {
  if (grid.length < 2) return [];
  const header = grid[0].map(h => h.trim().toLowerCase());
  const idxOf = (n: string) => header.indexOf(n);
  const cell = (r: string[], n: string) => { const i = idxOf(n); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  if (idxOf("period") < 0) { skipped.push({ source: label, reason: "no period column" }); return []; }

  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const pid = idxOf("practice_id") >= 0 ? cell(r, "practice_id") : (defaultPid || "");
    if (!UUID_RE.test(pid)) { skipped.push({ source: label, row: i + 1, reason: "no/invalid practice_id" }); continue; }

    let period = cell(r, "period");
    if (/^\d{4}-\d{2}$/.test(period)) period += "-01";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) { skipped.push({ source: label, row: i + 1, reason: "bad period", value: period }); continue; }
    const py = Number(period.slice(0, 4));
    const nowY = new Date().getUTCFullYear();
    if (py < 2020 || py > nowY + 1 || period > nextMonthCutoff()) {
      skipped.push({ source: label, row: i + 1, reason: "implausible/future period", value: period }); continue;
    }

    const obj: Record<string, unknown> = { practice_id: pid, period, source };
    for (let c = 0; c < header.length; c++) {
      const col = COLUMN_ALIASES[header[c]];
      if (col) obj[col] = num((r[c] ?? "").trim());
    }
    out.push(obj);
  }
  return out;
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
