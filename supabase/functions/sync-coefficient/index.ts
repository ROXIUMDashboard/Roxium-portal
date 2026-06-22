// ============================================================
// sync-coefficient — pull the published Coefficient Google Sheet (CSV) and
// upsert it into kpi_monthly. One row per practice·month·source.
//
// Design (matches Phase B):
//   • Keyed by (practice_id, period, source) → re-syncing a month only updates
//     that month's snapshot; past months are never overwritten.
//   • period 'YYYY-MM' (or 'YYYY-MM-01') → stored as first-of-month date.
//   • month is auto-derived by the sync_kpi_month() DB trigger — we never send it.
//   • Option A: every synced row is written as source = KPI_SOURCE (default
//     'marketing') so the dashboard shows it immediately. The sheet's own
//     `source` column is ignored on purpose. To separate sources later, change
//     the KPI_SOURCE secret (and teach the app to read it).
//
// Env (Supabase function secrets):
//   CSV_URL                  – published-to-web CSV link of the sheet (required)
//   SYNC_SECRET              – shared secret; callers must send it as the
//                              `x-sync-key` header or `?key=` query (required)
//   KPI_SOURCE               – source tag to write (default 'marketing')
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – auto-injected by Supabase
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const METRIC_KEYS = [
  "spend","impr","clicks","lpv","leads","cons","proc","apv","price",
  "sent","opens","eclk","sms","vid","foll","rank","posts",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

// Minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF).
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

Deno.serve(async (req) => {
  try {
    // ---- auth: shared secret (header or query) ----
    const secret = Deno.env.get("SYNC_SECRET");
    if (!secret) return json({ ok: false, error: "SYNC_SECRET not configured" }, 500);
    const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
    if (got !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const CSV_URL = Deno.env.get("CSV_URL");
    if (!CSV_URL) return json({ ok: false, error: "CSV_URL not configured" }, 500);
    const SOURCE = Deno.env.get("KPI_SOURCE") || "marketing";

    // ---- fetch + parse the published sheet ----
    const res = await fetch(CSV_URL, { redirect: "follow" });
    if (!res.ok) return json({ ok: false, error: `CSV fetch failed (${res.status})` }, 502);
    const grid = parseCSV(await res.text());
    if (grid.length < 2) return json({ ok: false, error: "sheet has no data rows" }, 400);

    const header = grid[0].map(h => h.trim().toLowerCase());
    const idxOf = (name: string) => header.indexOf(name);
    const cell = (r: string[], name: string) => {
      const i = idxOf(name);
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    if (idxOf("practice_id") < 0 || idxOf("period") < 0)
      return json({ ok: false, error: "sheet must have practice_id and period columns" }, 400);

    const upserts: Record<string, unknown>[] = [];
    const skipped: { row: number; reason: string; value?: string }[] = [];

    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const pid = cell(r, "practice_id");
      if (!UUID_RE.test(pid)) { skipped.push({ row: i + 1, reason: "practice_id not a UUID", value: pid }); continue; }

      let period = cell(r, "period");
      if (/^\d{4}-\d{2}$/.test(period)) period += "-01";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) { skipped.push({ row: i + 1, reason: "bad period", value: period }); continue; }

      const obj: Record<string, unknown> = { practice_id: pid, period, source: SOURCE };
      for (const k of METRIC_KEYS) {
        const v = cell(r, k);
        if (v === "") { obj[k] = null; continue; }
        const n = Number(v.replace(/[$,%]/g, ""));   // tolerate $ , % in cells
        obj[k] = Number.isFinite(n) ? n : null;
      }
      upserts.push(obj);
    }

    let upserted = 0, error: string | null = null;
    if (upserts.length) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error: e } = await sb
        .from("kpi_monthly")
        .upsert(upserts, { onConflict: "practice_id,period,source" })
        .select("id");
      if (e) error = e.message; else upserted = data?.length ?? upserts.length;
    }

    return json({
      ok: !error,
      source: SOURCE,
      rows_seen: grid.length - 1,
      upserted,
      skipped_count: skipped.length,
      skipped: skipped.slice(0, 25),
      error,
    }, error ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
