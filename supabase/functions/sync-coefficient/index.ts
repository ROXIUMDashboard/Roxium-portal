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
//   • daily metrics (spend/impr/clicks/lpv/reach/page_engagement) summed per month
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
  "page engagement": "page_engagement", "page_engagement": "page_engagement", "engagement": "page_engagement",
  "followers": "foll", "qualified followers added": "foll", "foll": "foll", "new followers": "foll",
};
// Daily-export metrics are SUMMED into a month so portal values match the sheet column
// total (reach summed = total monthly exposures — what adding the column gives). Running
// totals (followers, cumulative page likes) take the latest/max day.
const ADDITIVE = new Set(["spend", "impr", "clicks", "lpv", "reach", "page_engagement"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// month-name lookup for the deterministic period parser (handles 'Mar', 'March', etc.)
const MONTHS: Record<string, number> = {
  jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5,
  jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9,
  oct:10, october:10, nov:11, november:11, dec:12, december:12,
};

// Deterministic period resolver — returns 'YYYY-MM-01' or null. This REPLACES the old
// `new Date(raw)` fallback, which silently mis-parsed (or rejected) common sheet formats:
//   • bare 'YYYY-MM'         → new Date() => Invalid Date  → row dropped (this is how March vanished)
//   • 'Mar-26' / 'March 2026'→ new Date() => Invalid Date  → row dropped
//   • 'M/D/YYYY'             → TZ/locale shifts at month boundaries → misfiled month
// We parse explicitly and TZ-free so every supported format maps to the right month.
function resolvePeriod(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  // ISO 'YYYY-MM' or 'YYYY-MM-DD'
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
    const y = +m[1], mo = +m[2];
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-01`;
    return null;
  }
  // 'YYYY/MM' or 'YYYY/MM/DD'
  if ((m = s.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/))) {
    const y = +m[1], mo = +m[2];
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-01`;
    return null;
  }
  // US 'M/D/YYYY' or 'M/D/YY' (month first — TZ-free, no Date() drift)
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const mo = +m[1]; let y = +m[3];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-01`;
    return null;
  }
  // month name + year: 'March 2026', 'Mar-26', 'Mar 2026', '2026 March'
  const mn = s.toLowerCase().match(/[a-z]+/)?.[0] || "";
  const yr = s.match(/\d{2,4}/)?.[0];
  if (mn && MONTHS[mn] && yr) {
    let y = +yr; if (y < 100) y += 2000;
    return `${y}-${String(MONTHS[mn]).padStart(2, "0")}-01`;
  }
  return null;
}

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

// ============================================================
// PRIVATE INGESTION (Option B) — read Google Sheets via the Sheets API with a
// service-account key, so the sheet stays PRIVATE and the public CSV link can be
// retired. The sheet is shared (viewer) with the service-account email; the JSON
// key lives in the Supabase secret GOOGLE_SA_KEY and never touches the frontend.
//
//   • Each client has ONE master workbook (practices.workbook_sheet_id); every
//     source is a TAB inside it, configured per-source via sheet_sources.tab_name.
//   • INGESTION_MODE = 'sheets_api' turns this path on; 'csv' (default) keeps the
//     legacy public-CSV behaviour so the migration is safe and incremental.
// ============================================================
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Mint a short-lived Google OAuth access token from a service-account JSON key
// (RS256-signed JWT grant). Cached in-process for the function invocation.
let _gToken: { token: string; exp: number } | null = null;
async function googleAccessToken(): Promise<string> {
  if (_gToken && _gToken.exp > Date.now() / 1000 + 60) return _gToken.token;
  const raw = Deno.env.get("GOOGLE_SA_KEY");
  if (!raw) throw new Error("GOOGLE_SA_KEY not set (required for INGESTION_MODE=sheets_api)");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })));
  const unsigned = `${header}.${claim}`;
  // import the PEM PKCS#8 private key for RS256 signing
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  const tok = await res.json() as { access_token: string; expires_in: number };
  _gToken = { token: tok.access_token, exp: now + (tok.expires_in || 3600) };
  return tok.access_token;
}

// Accept either a bare Google Sheet ID or a full URL ('…/spreadsheets/d/<ID>/edit…')
// pasted into the workbook/sheet field, so a stray link doesn't become a bad API call.
function extractSheetId(s: string): string {
  const v = (s || "").trim();
  const m = v.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : v;
}

// Read a tab from a private sheet via the Sheets API and return it as a string grid
// (same shape parseCSV produces, so rowsFromGrid is reused unchanged).
async function readSheetGrid(sheetId: string, tab?: string | null): Promise<string[][]> {
  const token = await googleAccessToken();
  const range = encodeURIComponent((tab && tab.trim()) ? tab.trim() : "A:Z");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sheets api ${res.status}: ${await res.text()}`);
  const body = await res.json() as { values?: unknown[][] };
  return (body.values || []).map(row => row.map(c => c == null ? "" : String(c)));
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

// Bare month name (no year) → current year first-of-month. resolvePeriod requires a
// year, so this covers wide sheets whose column headers are just "Jan"/"March".
const MONTHS_BARE = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function bareMonth(s: string): string | null {
  const t = (s || "").trim().toLowerCase();
  const i = MONTHS_BARE.findIndex(m => t === m || (t.startsWith(m) && t.length <= 9 && !/\d/.test(t)));
  return i >= 0 ? `${new Date().getUTCFullYear()}-${String(i + 1).padStart(2, "0")}-01` : null;
}

// WIDE / transposed "month-block" layout: metric labels run DOWN a column (e.g. col A
// rows 3-6: Reach, Impressions, Amount Spent…) and months run ACROSS the columns
// (Jan, Feb, Mar 2026…). Reads each (metric-row × month-column) cell and writes ONE
// snapshot per month. Empty months are dropped (so blank Jan/Feb don't appear).
// Returns [] when the sheet isn't this shape (caller then keeps the tidy result).
function parseWide(grid: string[][], pid: string, source: string,
                   skipped: unknown[], label: string): Record<string, unknown>[] {
  const nCols = Math.max(...grid.map(r => r.length));
  const monthAt = (s: string) => resolvePeriod(s) || bareMonth(s);
  // metric-label column = left-most column with the most metric-alias matches
  let labelCol = -1, bestHits = 0;
  for (let c = 0; c < Math.min(nCols, 4); c++) {
    let hits = 0;
    for (let r = 0; r < grid.length; r++) if (COLUMN_ALIASES[(grid[r][c] ?? "").trim().toLowerCase()]) hits++;
    if (hits > bestHits) { bestHits = hits; labelCol = c; }
  }
  if (bestHits < 2) return [];
  // month-header row = the row with the most month-parseable cells (excluding label col)
  let headerRow = -1, bestMonths = 0;
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    let hits = 0;
    for (let c = 0; c < nCols; c++) if (c !== labelCol && monthAt(grid[r][c] ?? "")) hits++;
    if (hits > bestMonths) { bestMonths = hits; headerRow = r; }
  }
  if (bestMonths < 1) return [];
  const colPeriod: Record<number, string> = {};
  for (let c = 0; c < nCols; c++) {
    if (c === labelCol) continue;
    const p = monthAt(grid[headerRow][c] ?? "");
    if (!p) continue;
    const py = +p.slice(0, 4), nowY = new Date().getUTCFullYear();
    if (py >= 2020 && py <= nowY + 1 && p <= nextMonthCutoff()) colPeriod[c] = p;
  }
  const buckets = new Map<string, MonthBucket>();
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const col = COLUMN_ALIASES[(grid[r][labelCol] ?? "").trim().toLowerCase()];
    if (!col) continue;
    for (const cs of Object.keys(colPeriod)) {
      const c = +cs, period = colPeriod[c];
      const v = num((grid[r][c] ?? "").trim()); if (v == null) continue;
      const b = buckets.get(period) || { practice_id: pid, period };
      if (ADDITIVE.has(col)) b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
      else b[col] = Math.max(typeof b[col] === "number" ? b[col] as number : -Infinity, v);
      buckets.set(period, b);
    }
  }
  const rows = [...buckets.values()]
    .filter(b => Object.keys(b).some(k => k !== "practice_id" && k !== "period" && typeof b[k] === "number"))
    .map(b => { const { practice_id, period, ...m } = b; return { practice_id, period, source, ...m }; });
  if (rows.length) skipped.push({ source: label, info: "parsed as WIDE month-block", label_column: labelCol, header_row: headerRow + 1, months: Object.values(colPeriod) });
  return rows;
}

// Parse one CSV grid into kpi_monthly upsert rows. defaultPid is used when the
// sheet has no practice_id column (per-client source). Supports both a monthly
// `period` column and a daily `date` column (daily rows are aggregated per month).
function rowsFromGrid(grid: string[][], source: string, defaultPid: string | null,
                      skipped: unknown[], label: string): Record<string, unknown>[] {
  if (grid.length < 2) return [];
  // Find the REAL header row — ad exports (Meta/Coefficient) put title/"last updated"
  // rows ABOVE the header, so we can't assume grid[0]. Pick the row that best matches
  // a date column + known metric columns.
  const DATE_COLS = ["period", "date", "day", "reporting date", "month"];
  let hIdx = 0, hScore = -1;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const low = grid[i].map(c => (c ?? "").trim().toLowerCase());
    let score = low.some(c => DATE_COLS.includes(c)) ? 2 : 0;
    for (const c of low) if (COLUMN_ALIASES[c] || c === "practice_id") score += 1;
    if (score > hScore) { hScore = score; hIdx = i; }
  }
  const header = grid[hIdx].map(h => h.trim().toLowerCase());
  const idxOf = (n: string) => header.indexOf(n);
  const cell = (r: string[], n: string) => { const i = idxOf(n); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const dateIdx = DATE_COLS.map(idxOf).find(i => i >= 0) ?? -1;

  const buckets = new Map<string, MonthBucket>();
  if (dateIdx >= 0) {                                  // ---- TIDY layout (one row per date) ----
    for (let i = hIdx + 1; i < grid.length; i++) {
      const r = grid[i];
      const pid = idxOf("practice_id") >= 0 ? cell(r, "practice_id") : (defaultPid || "");
      if (!UUID_RE.test(pid)) { skipped.push({ source: label, row: i + 1, reason: "no/invalid practice_id" }); continue; }
      const raw = (r[dateIdx] ?? "").trim();
      if (!raw) continue;                              // blank trailing row
      const period = resolvePeriod(raw);
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
        if (ADDITIVE.has(col)) b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
        else b[col] = Math.max(typeof b[col] === "number" ? b[col] as number : -Infinity, v);
      }
      buckets.set(key, b);
    }
  }

  let rows = [...buckets.values()]
    .filter(b => Object.keys(b).some(k => k !== "practice_id" && k !== "period" && typeof b[k] === "number"))
    .map(b => { const { practice_id, period, ...metrics } = b; return { practice_id, period, source, ...metrics }; });

  // ---- fall back to the WIDE month-block layout if tidy found nothing usable ----
  if (!rows.length && defaultPid && UUID_RE.test(defaultPid)) {
    rows = parseWide(grid, defaultPid, source, skipped, label);
  }
  if (!rows.length && dateIdx < 0) skipped.push({ source: label, reason: "no period/date column and not a recognizable wide month-block sheet" });
  return rows;
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

  const ranAt = new Date().toISOString();
  // who/what triggered this run? 'manual' from the Admin Sync-now button, else scheduled.
  let trigger = "scheduled";
  try { const b = await req.clone().json(); if (b && typeof b.trigger === "string") trigger = b.trigger; } catch (_) { /* no body */ }

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const denied = await authorize(req, sb);
    if (denied) return denied;

    const SOURCE = Deno.env.get("KPI_SOURCE") || "marketing";
    // 'sheets_api' = private Google Sheets API (Option B); 'csv' (default) = legacy public CSV.
    const MODE = (Deno.env.get("INGESTION_MODE") || "csv").toLowerCase();

    // Each client has ONE master reporting workbook (practices.workbook_sheet_id);
    // every source is a TAB inside it. Pull the per-client workbook id up front so a
    // source row only needs to name its tab.
    const { data: pracs } = await sb.from("practices").select("id,workbook_sheet_id");
    const workbookByPid: Record<string, string> = {};
    for (const p of pracs || []) {
      const w = (p.workbook_sheet_id ?? "").toString().trim();
      if (w) workbookByPid[p.id] = w;
    }

    const { data: sources } = await sb.from("sheet_sources")
      .select("practice_id,csv_url,sheet_id,tab_name,is_active,source").eq("is_active", true);
    // One job per active source TAB. In sheets_api mode the sheet id is the client's
    // master workbook and the source's tab_name selects WHICH tab to read — the master
    // workbook is a CONTAINER, never parsed whole, so a tab is required when reading it.
    // The legacy per-row sheet_id is a standalone sheet (tab optional). Each job carries
    // its own `source` so every tab lands under its own kpi source.
    const skipped: unknown[] = [];
    const jobs: { pid: string | null; url?: string; sheetId?: string; tab?: string | null; label: string; source: string }[] = [];
    if (sources && sources.length) {
      for (const s of sources) {
        const src = s.source || SOURCE;
        const lbl = `${s.practice_id} · ${src}`;
        const tab = (s.tab_name || "").trim();
        const masterId = extractSheetId(workbookByPid[s.practice_id] || "");   // client master workbook (accepts URL or bare id)
        const legacyId = extractSheetId(s.sheet_id || "");                     // legacy per-row standalone sheet
        if (MODE === "sheets_api") {
          if (masterId) {
            // reading the shared master workbook → a tab is mandatory, else we'd parse
            // the wrong (first) tab. Skip with a clear, actionable reason.
            if (tab) jobs.push({ pid: s.practice_id, sheetId: masterId, tab, label: lbl, source: src });
            else skipped.push({ source: lbl, reason: "no tab configured for this source — set its tab name so sync reads that tab inside the master workbook (the workbook itself is not a flat KPI sheet)" });
          } else if (legacyId) {
            jobs.push({ pid: s.practice_id, sheetId: legacyId, tab: tab || null, label: lbl, source: src });
          } else if (s.csv_url) {
            jobs.push({ pid: s.practice_id, url: s.csv_url, label: lbl, source: src });
          } else {
            skipped.push({ source: lbl, reason: "no master workbook set for this client (practices.workbook_sheet_id) and no per-source sheet/CSV" });
          }
        } else if (s.csv_url) {
          jobs.push({ pid: s.practice_id, url: s.csv_url, label: lbl, source: src });
        }
      }
    } else if (MODE !== "sheets_api" && Deno.env.get("CSV_URL")) {
      jobs.push({ pid: null, url: Deno.env.get("CSV_URL")!, label: "legacy CSV_URL", source: SOURCE });
    }
    if (!jobs.length) return json({ ok: false, ran_at: ranAt, trigger, rows_seen: 0, upserted: 0,
      skipped_count: skipped.length, skipped: skipped.slice(0, 25), error: MODE === "sheets_api"
      ? "no syncable source tabs — set each client's master workbook (practices.workbook_sheet_id) and give each source a tab name"
      : "no active sheet sources and no CSV_URL" }, 400);

    const upserts: Record<string, unknown>[] = [];
    const perSource: Record<string, { ok: boolean; rows?: number; months?: string[]; error?: string }> = {};
    const allMonths = new Set<string>();   // distinct 'YYYY-MM' months seen across every source
    // distinct months ('YYYY-MM') a set of upsert rows touched — surfaced per client + globally
    const monthsOf = (rows: Record<string, unknown>[]) =>
      [...new Set(rows.map(r => String(r.period).slice(0, 7)))].sort();

    for (const job of jobs) {
      try {
        // private path: Sheets API grid; legacy path: fetch + parse the public CSV
        let grid: string[][];
        if (job.sheetId) {
          grid = await readSheetGrid(job.sheetId, job.tab);
        } else {
          const res = await fetch(job.url!, { redirect: "follow" });
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          grid = parseCSV(await res.text());
        }
        const rows = rowsFromGrid(grid, job.source, job.pid, skipped, job.label);
        upserts.push(...rows);
        const months = monthsOf(rows);
        months.forEach(m => allMonths.add(m));
        perSource[job.label] = { ok: true, rows: rows.length, months };
        // per-channel observability: scope the status update to this practice + source
        if (job.pid) await sb.from("sheet_sources").update({
          last_synced_at: ranAt, last_status: "ok", last_error: null,
          last_rows: rows.length, last_months: months,
        }).eq("practice_id", job.pid).eq("source", job.source);
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        perSource[job.label] = { ok: false, error: msg };
        if (job.pid) await sb.from("sheet_sources").update({
          last_synced_at: ranAt, last_status: "error", last_error: msg,
        }).eq("practice_id", job.pid).eq("source", job.source);
      }
    }

    let upserted = 0, error: string | null = null;
    if (upserts.length) {
      const { data, error: e } = await sb.from("kpi_monthly")
        .upsert(upserts, { onConflict: "practice_id,period,source" }).select("id");
      if (e) error = e.message; else upserted = data?.length ?? upserts.length;
    }
    await sb.rpc("finalize_past_months");

    const months_seen = [...allMonths].sort();
    const ok = !error;
    // write an audit row so the Admin panel can prove the 2-hour automation ran
    // (table created by the sync_observability migration — ignore if not yet applied)
    try {
      await sb.from("sync_runs").insert({
        ran_at: ranAt, trigger, ok, rows_seen: upserts.length, upserted,
        skipped_count: skipped.length, months_seen, sources: perSource, error,
      });
    } catch (_) { /* sync_runs table not present yet */ }

    return json({ ok, ran_at: ranAt, trigger, sources: perSource, rows_seen: upserts.length, upserted,
      skipped_count: skipped.length, months_seen, skipped: skipped.slice(0, 25), error }, error ? 500 : 200);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return json({ ok: false, ran_at: ranAt, trigger, error: msg }, 500);
  }
});
