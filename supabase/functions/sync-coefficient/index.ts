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
// Variants are normalized (lower-cased, punctuation/extra-spaces collapsed) before
// lookup by `aliasOf`, so we only list distinct wordings here, not every spacing/case.
const COLUMN_ALIASES: Record<string, string> = {
  "amount spent": "spend", "amount spent usd": "spend", "spend": "spend", "ad spend": "spend",
  "total spend": "spend", "total spent": "spend", "cost": "spend", "cost usd": "spend", "amount": "spend",
  "reach": "reach", "unique reach": "reach", "people reached": "reach",
  "impressions": "impr", "impressions reach": "impr", "impr": "impr", "impressions served": "impr",
  "link clicks": "clicks", "clicks": "clicks", "clicks all": "clicks", "outbound clicks": "clicks",
  "link click": "clicks", "outbound link clicks": "clicks", "unique link clicks": "clicks", "total clicks": "clicks",
  "landing page views": "lpv", "landing page visits": "lpv", "landing page view": "lpv", "lpv": "lpv",
  "page likes": "page_likes", "page_likes": "page_likes", "new page likes": "page_likes", "page like": "page_likes",
  "page engagement": "page_engagement", "page_engagement": "page_engagement", "engagement": "page_engagement",
  "post engagement": "page_engagement", "engagements": "page_engagement",
  "followers": "foll", "qualified followers added": "foll", "foll": "foll", "new followers": "foll", "follows": "foll",
};
// Normalize a raw header before alias lookup: lower-case, strip punctuation/parens,
// collapse whitespace. So "CPM (cost per 1,000 impressions)" → "cpm cost per 1 000 impressions",
// and "Amount Spent (USD)" → "amount spent usd" — tolerant of spacing/case/punctuation.
const normHeader = (h: string) => (h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const aliasOf = (h: string): string | undefined => COLUMN_ALIASES[normHeader(h)] ?? COLUMN_ALIASES[(h || "").trim().toLowerCase()];
// Daily-export metrics are SUMMED into a month so portal values match the sheet column
// total (reach summed = total monthly exposures — what adding the column gives). Running
// totals (followers, cumulative page likes) take the latest/max day.
const ADDITIVE = new Set(["spend", "impr", "clicks", "lpv", "reach", "page_engagement"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A date/period column can be named many ways across exports. Meta uses "Reporting
// starts"/"Day", Google "Week"/"Month", Coefficient "Date"/"Period". Matched by exact
// name OR known prefix so "reporting starts (ds)" etc. still counts.
const DATE_COL_NAMES = new Set(["period","date","day","month","week","reporting date",
  "reporting starts","reporting ends","reporting start","start date","week starting",
  "month start","date start","ds","reporting month","report month","report date",
  "month period","date day"]);
const isDateCol = (h: string) => {
  const c = normHeader(h);                    // tolerant of case/punctuation/spacing
  if (DATE_COL_NAMES.has(c)) return true;
  return c.startsWith("reporting start") || c.startsWith("reporting period")
    || c.startsWith("reporting month") || c.startsWith("week of") || c.startsWith("month of");
};

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
  // Google Sheets serial date (days since 1899-12-30). The Sheets API returns these
  // for real date cells under UNFORMATTED_VALUE, so a column of "46106" is actually a
  // date, not a number. Range-guarded so plain years/counts aren't misread as dates.
  if ((m = s.match(/^(\d{4,6})(?:\.\d+)?$/))) {
    const serial = +m[1];
    if (serial >= 20000 && serial <= 80000) {        // ~1954-09 .. ~2119-01
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }
  }
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

// Full calendar day for daily-tab ingestion (YYYY-MM-DD). Falls back to month-start
// when the sheet only has month-level dates.
function resolveDay(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4,6})(?:\.\d+)?$/))) {
    const serial = +m[1];
    if (serial >= 20000 && serial <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const y = +m[1], mo = +m[2], da = +m[3];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    return null;
  }
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) {
    const y = +m[1], mo = +m[2], da = +m[3];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    return null;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const mo = +m[1]; let y = +m[3]; const da = +m[2];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    return null;
  }
  const period = resolvePeriod(s);
  return period;
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
    // spreadsheets.readonly = read values + tab metadata; drive.readonly = list the
    // master folder to discover each client's workbook by name.
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
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

// Same idea for a Drive folder link ('…/drive/folders/<ID>' or '…/folders/<ID>?…').
function extractFolderId(s: string): string {
  const v = (s || "").trim();
  const m = v.match(/\/folders\/([a-zA-Z0-9-_]+)/);
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

// ============================================================
// DISCOVERY — folder → workbook → tabs. Used by the admin "Detect" actions so the
// team can wire a client from its Drive folder without copying ids by hand. Read-only.
// ============================================================

// List the tabs of a workbook (titles + gids) via spreadsheets.get. Cheap metadata call.
async function listTabs(sheetId: string): Promise<{ title: string; gid: number; index: number }[]> {
  const token = await googleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(title,sheetId,index)`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sheets api ${res.status}: ${await res.text()}`);
  const body = await res.json() as { sheets?: { properties?: { title?: string; sheetId?: number; index?: number } }[] };
  return (body.sheets || []).map(s => ({
    title: s.properties?.title || "", gid: s.properties?.sheetId ?? 0, index: s.properties?.index ?? 0,
  }));
}

// List spreadsheets inside a Drive folder (the team master folder). Read-only.
async function driveListInFolder(folderId: string): Promise<{ id: string; name: string }[]> {
  const token = await googleAccessToken();
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=200&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`drive api ${res.status}: ${await res.text()}`);
  const body = await res.json() as { files?: { id: string; name: string }[] };
  return body.files || [];
}

const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Match a client to a workbook in the folder. Returns the confident match (exact /
// strong substring) plus ALL candidates, so the caller can refuse to guess when
// the match is ambiguous (multiple) or weak (none).
function matchWorkbook(files: { id: string; name: string }[], clientName: string, expected?: string | null):
  { match: { id: string; name: string } | null; candidates: { id: string; name: string }[]; reason: string } {
  const want = normName(expected || clientName);
  if (!files.length) return { match: null, candidates: [], reason: "folder is empty or not shared with the service account" };
  const exact = files.filter(f => normName(f.name) === want);
  if (exact.length === 1) return { match: exact[0], candidates: exact, reason: "exact name match" };
  if (exact.length > 1) return { match: null, candidates: exact, reason: "multiple exact matches — pick one" };
  const sub = files.filter(f => { const n = normName(f.name); return n.includes(want) || want.includes(n); });
  if (sub.length === 1) return { match: sub[0], candidates: sub, reason: "name contained in workbook title" };
  if (sub.length > 1) return { match: null, candidates: sub, reason: "several possible workbooks — pick one" };
  return { match: null, candidates: files, reason: "no name match — pick the workbook manually" };
}

// Guess which source/channel a tab title represents. Meta Ads stays under the legacy
// 'marketing' key so it lines up with manual entry + the dashboard; the rest use their
// own channel key. Order matters — most specific patterns first.
function guessSource(title: string): string | null {
  const t = normName(title);
  if (!t) return null;
  const has = (re: RegExp) => re.test(t);
  // paid ads
  if (has(/\bmeta\b/) || t.includes("meta ads") || has(/\bfacebook ads\b/) || has(/\bfb ads\b/)) return "marketing";
  if (has(/\bgoogle\b/) || t.includes("g ads")) return "google_ads";
  if (has(/\bmicrosoft\b/) || has(/\bbing\b/)) return "microsoft_ads";
  // organic / insights / analytics
  if (has(/\binstagram\b/) || has(/\big\b/)) return "instagram_insights";
  if (has(/\byoutube\b/) || has(/\byt\b/)) return "youtube_analytics";
  if (has(/\bfacebook\b/) || has(/\bfb\b/)) return "facebook_insights";
  if (t.includes("page engagement") || t === "engagement") return "page_engagement";
  return null;
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

interface DayBucket {
  practice_id: string;
  day: string;
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
// ============================================================
// RESILIENT PARSE PIPELINE: detect shape → find header → normalize → parse → report.
// Deterministic and safe: parses daily / monthly / wide month-block layouts, tolerant
// of title rows, blank rows, and header naming/spacing/case — but refuses to import
// when confidence is too low, returning a specific reason instead.
// ============================================================
interface ParseReport {
  source: string;
  shape: "daily" | "monthly" | "wide" | "unknown";
  header_row: number | null;                 // 1-based row we treated as the header
  period_field: string | null;               // the column used for the date/period
  normalized_headers: Record<string, string>; // original header → canonical metric
  metric_columns: string[];                  // canonical metrics recognized
  produced: number;                          // monthly KPI rows produced
  months: string[];                          // 'YYYY-MM' months produced
  skipped_rows: number;
  skipped_samples: unknown[];
  confidence: "high" | "medium" | "low" | "none";
  reason: string;                            // human summary / why it failed
}

// Daily vs monthly is cosmetic (both aggregate to month) but useful in diagnostics:
// daily if the date column shows several non-first-of-month days.
function classifyGranularity(grid: string[][], hIdx: number, dateIdx: number): "daily" | "monthly" {
  let nonFirst = 0, seen = 0;
  for (let i = hIdx + 1; i < grid.length && seen < 24; i++) {
    const raw = (grid[i][dateIdx] ?? "").trim(); if (!raw) continue; seen++;
    let day = 1;
    let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) day = +m[3];
    else if ((m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) day = +m[2];
    else if (/^\d{4,6}(\.\d+)?$/.test(raw)) { const s = +raw; if (s >= 20000 && s <= 80000) day = new Date(Date.UTC(1899,11,30)+s*86400000).getUTCDate(); }
    if (day !== 1) nonFirst++;
  }
  return nonFirst >= 2 ? "daily" : "monthly";
}

// WIDE month-block: metric labels down a left column, months across a header row.
function detectWide(grid: string[][], nCols: number):
  { labelCol: number; headerRow: number; colPeriod: Record<number, string>; metrics: string[] } | null {
  const monthAt = (s: string) => resolvePeriod(s) || bareMonth(s);
  let labelCol = -1, bestHits = 0;
  for (let c = 0; c < Math.min(nCols, 4); c++) {
    let hits = 0;
    for (let r = 0; r < grid.length; r++) if (aliasOf(grid[r][c] ?? "")) hits++;
    if (hits > bestHits) { bestHits = hits; labelCol = c; }
  }
  if (bestHits < 2) return null;
  let headerRow = -1, bestMonths = 0;
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    let hits = 0;
    for (let c = 0; c < nCols; c++) if (c !== labelCol && monthAt(grid[r][c] ?? "")) hits++;
    if (hits > bestMonths) { bestMonths = hits; headerRow = r; }
  }
  if (bestMonths < 1) return null;
  const colPeriod: Record<number, string> = {};
  for (let c = 0; c < nCols; c++) {
    if (c === labelCol) continue;
    const p = monthAt(grid[headerRow][c] ?? ""); if (!p) continue;
    const py = +p.slice(0, 4), nowY = new Date().getUTCFullYear();
    if (py >= 2020 && py <= nowY + 1 && p <= nextMonthCutoff()) colPeriod[c] = p;
  }
  if (!Object.keys(colPeriod).length) return null;
  const metrics: string[] = [];
  for (let r = 0; r < grid.length; r++) { const canon = aliasOf(grid[r][labelCol] ?? ""); if (canon && !metrics.includes(canon)) metrics.push(canon); }
  return { labelCol, headerRow, colPeriod, metrics };
}

interface ShapeDetection {
  shape: ParseReport["shape"]; headerRow: number; dateIdx: number; periodField: string | null;
  metricCols: string[]; normalized: Record<string, string>;
  confidence: ParseReport["confidence"]; reason: string;
  wide?: { labelCol: number; headerRow: number; colPeriod: Record<number, string>; metrics: string[] };
}

// Step 1+2+3: pick the most likely header row, then classify the layout.
function detectShape(grid: string[][]): ShapeDetection {
  const nCols = Math.max(...grid.map(r => r.length), 0);
  let hIdx = -1, hScore = 0, ties = 0;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const cells = grid[i].map(c => (c ?? "").trim());
    const hasDate = cells.some(isDateCol);
    let metrics = 0; for (const c of cells) if (aliasOf(c)) metrics++;
    const hasPid = cells.some(c => normHeader(c) === "practice id");
    const score = (hasDate ? 2 : 0) + metrics + (hasPid ? 1 : 0);
    if (score > hScore) { hScore = score; hIdx = i; ties = 1; }
    else if (score === hScore && score >= 3) ties++;       // another strong candidate
  }
  const det: ShapeDetection = { shape: "unknown", headerRow: hIdx, dateIdx: -1, periodField: null,
    metricCols: [], normalized: {}, confidence: "low", reason: "" };
  if (hIdx >= 0) {
    const header = grid[hIdx].map(h => (h ?? "").trim());
    const dateIdx = header.findIndex(isDateCol);
    const normalized: Record<string, string> = {}; const metricCols: string[] = [];
    header.forEach(h => { const canon = aliasOf(h); if (canon) { normalized[h] = canon; if (!metricCols.includes(canon)) metricCols.push(canon); } });
    det.dateIdx = dateIdx; det.periodField = dateIdx >= 0 ? header[dateIdx] : null;
    det.normalized = normalized; det.metricCols = metricCols;
    if (dateIdx >= 0 && metricCols.length >= 1) {            // confident TIDY layout
      det.shape = classifyGranularity(grid, hIdx, dateIdx);
      det.confidence = ties > 1 ? "medium" : "high";
      if (ties > 1) det.reason = "multiple plausible header rows; used the topmost recognized one";
      return det;
    }
  }
  const wide = detectWide(grid, nCols);                      // confident WIDE layout
  if (wide) { det.shape = "wide"; det.headerRow = wide.headerRow; det.wide = wide;
    det.metricCols = wide.metrics; det.periodField = "month columns across the header row";
    det.confidence = "high"; return det; }
  // Not confident → explain precisely (Step: fail safe)
  if (det.dateIdx >= 0 && det.metricCols.length === 0)
    det.reason = `found a date/period column ('${det.periodField}') but no recognized KPI metric columns`;
  else if (det.metricCols.length >= 1 && det.dateIdx < 0)
    det.reason = `recognized ${det.metricCols.length} metric column(s) but no date/period column and no month-block layout — add a Date/Reporting month column`;
  else
    det.reason = "no recognizable KPI columns — this tab looks like notes/summary content, not data";
  det.shape = "unknown"; det.confidence = "low";
  return det;
}

// Step 4+5: parse per detected shape and normalize into kpi_monthly rows + a report.
function parseGrid(grid: string[][], source: string, defaultPid: string | null, label: string):
  { rows: Record<string, unknown>[]; dailyRows: Record<string, unknown>[]; report: ParseReport } {
  const report: ParseReport = { source: label, shape: "unknown", header_row: null, period_field: null,
    normalized_headers: {}, metric_columns: [], produced: 0, months: [], skipped_rows: 0,
    skipped_samples: [], confidence: "none", reason: "" };
  if (grid.length < 2) { report.reason = "tab is empty or has no data rows"; return { rows: [], dailyRows: [], report }; }

  const det = detectShape(grid);
  report.shape = det.shape; report.confidence = det.confidence;
  report.header_row = det.headerRow >= 0 ? det.headerRow + 1 : null;
  report.period_field = det.periodField; report.normalized_headers = det.normalized; report.metric_columns = det.metricCols;
  if (det.shape === "unknown") { report.reason = det.reason; return { rows: [], dailyRows: [], report }; }

  const skips: Record<string, number> = {}; const samples: unknown[] = [];
  const skip = (reason: string, extra?: Record<string, unknown>) => {
    skips[reason] = (skips[reason] || 0) + 1; if (samples.length < 5) samples.push({ reason, ...extra }); };
  let rows: Record<string, unknown>[] = [];
  let dailyRows: Record<string, unknown>[] = [];

  if (det.shape === "wide" && det.wide) {
    const pid = defaultPid || "";
    if (!UUID_RE.test(pid)) { report.reason = "month-block sheet has no client to attach to (missing practice_id)"; return { rows: [], dailyRows: [], report }; }
    const { labelCol, headerRow, colPeriod } = det.wide;
    const buckets = new Map<string, MonthBucket>();
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const col = aliasOf(grid[r][labelCol] ?? ""); if (!col) continue;
      for (const cs of Object.keys(colPeriod)) {
        const c = +cs, period = colPeriod[c];
        const v = num((grid[r][c] ?? "").trim()); if (v == null) continue;
        const b = buckets.get(period) || { practice_id: pid, period };
        if (ADDITIVE.has(col)) b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
        else b[col] = Math.max(typeof b[col] === "number" ? b[col] as number : -Infinity, v);
        buckets.set(period, b);
      }
    }
    rows = [...buckets.values()]
      .filter(b => Object.keys(b).some(k => k !== "practice_id" && k !== "period" && typeof b[k] === "number"))
      .map(b => { const { practice_id, period, ...m } = b; return { practice_id, period, source, ...m }; });
  } else {                                                   // TIDY daily/monthly
    const header = grid[det.headerRow].map(h => (h ?? "").trim());
    const pidIdx = header.findIndex(h => normHeader(h) === "practice id");
    const buckets = new Map<string, MonthBucket>();
    const dayBuckets = new Map<string, DayBucket>();
    const isDailyShape = det.shape === "daily";
    for (let i = det.headerRow + 1; i < grid.length; i++) {
      const r = grid[i];
      const pid = pidIdx >= 0 ? (r[pidIdx] ?? "").trim() : (defaultPid || "");
      if (!UUID_RE.test(pid)) { skip("no/invalid practice_id"); continue; }
      const raw = (r[det.dateIdx] ?? "").trim(); if (!raw) continue;
      const period = resolvePeriod(raw);
      if (!period) { skip("unparseable period/date", { value: raw }); continue; }
      const py = +period.slice(0, 4), nowY = new Date().getUTCFullYear();
      if (py < 2020 || py > nowY + 1 || period > nextMonthCutoff()) { skip("implausible/future period", { value: period }); continue; }
      const key = pid + "|" + period;
      const b = buckets.get(key) || { practice_id: pid, period };
      for (let c = 0; c < header.length; c++) {
        const col = aliasOf(header[c]); if (!col) continue;
        const v = num((r[c] ?? "").trim()); if (v == null) continue;
        if (ADDITIVE.has(col)) b[col] = (typeof b[col] === "number" ? b[col] as number : 0) + v;
        else b[col] = Math.max(typeof b[col] === "number" ? b[col] as number : -Infinity, v);
      }
      buckets.set(key, b);
      if (isDailyShape) {
        const day = resolveDay(raw);
        if (!day) { skip("unparseable day", { value: raw }); continue; }
        const dkey = pid + "|" + day;
        const db = dayBuckets.get(dkey) || { practice_id: pid, day };
        for (let c = 0; c < header.length; c++) {
          const col = aliasOf(header[c]); if (!col) continue;
          const v = num((r[c] ?? "").trim()); if (v == null) continue;
          if (ADDITIVE.has(col)) db[col] = (typeof db[col] === "number" ? db[col] as number : 0) + v;
          else db[col] = Math.max(typeof db[col] === "number" ? db[col] as number : -Infinity, v);
        }
        dayBuckets.set(dkey, db);
      }
    }
    rows = [...buckets.values()]
      .filter(b => Object.keys(b).some(k => k !== "practice_id" && k !== "period" && typeof b[k] === "number"))
      .map(b => { const { practice_id, period, ...m } = b; return { practice_id, period, source, ...m }; });
    dailyRows = [...dayBuckets.values()]
      .filter(b => Object.keys(b).some(k => k !== "practice_id" && k !== "day" && typeof b[k] === "number"))
      .map(b => { const { practice_id, day, ...m } = b; return { practice_id, day, source, ...m }; });
  }

  report.produced = rows.length;
  report.months = [...new Set(rows.map(r => String(r.period).slice(0, 7)))].sort();
  report.skipped_rows = Object.values(skips).reduce((a, b) => a + b, 0);
  report.skipped_samples = samples;
  if (rows.length) {
    const note = det.shape === "daily" ? " (daily rows aggregated by month + per-day snapshots)" : det.shape === "wide" ? " (month-block)" : "";
    report.reason = `parsed as ${det.shape}${note} → ${report.months.join(", ")}`;
  } else if (skips["no/invalid practice_id"]) {
    report.reason = "rows found but none attached to a client (no/invalid practice_id) — usually the global CSV_URL path; use a per-client source";
  } else if (skips["unparseable period/date"]) {
    report.reason = "found a date column but its values could not be parsed as dates";
  } else {
    report.reason = "no monthly rows produced — no numeric metric values under the recognized columns";
  }
  return { rows, dailyRows, report };
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
  // parse the request body once: { trigger?, action?, ...params }
  let reqBody: Record<string, unknown> = {};
  try { const b = await req.clone().json(); if (b && typeof b === "object") reqBody = b as Record<string, unknown>; } catch (_) { /* no body */ }
  const trigger = typeof reqBody.trigger === "string" ? reqBody.trigger as string : "scheduled";
  const action = typeof reqBody.action === "string" ? reqBody.action as string : "sync";

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const denied = await authorize(req, sb);
    if (denied) return denied;

    // ---- DISCOVERY actions (read-only; no DB writes) ----------------------------
    // resolve the master folder: explicit body → global app_settings → env fallback.
    const resolveFolder = async (): Promise<string> => {
      let raw = String(reqBody.folder_id || "");
      if (!raw) {
        const { data: setting } = await sb.from("app_settings")
          .select("value").eq("key", "master_reporting_drive_folder").maybeSingle();
        raw = String(setting?.value || Deno.env.get("REPORTING_FOLDER_ID") || "");
      }
      return extractFolderId(raw);
    };
    // list_workbooks: "test connection" — list every spreadsheet in the master folder.
    if (action === "list_workbooks") {
      const folderId = await resolveFolder();
      if (!folderId) return json({ ok: false, error: "no master reporting Drive folder configured — set it in Admin → System" }, 400);
      const files = await driveListInFolder(folderId);
      return json({ ok: true, action, folder_id: folderId, file_count: files.length, files });
    }
    // find_workbook: match a client to its workbook in the master folder.
    if (action === "find_workbook") {
      const folderId = await resolveFolder();
      const name = String(reqBody.name || "");
      if (!folderId) return json({ ok: false, error: "no master reporting Drive folder configured — set it in Admin → System" }, 400);
      if (!name) return json({ ok: false, error: "no client name provided to match" }, 400);
      const files = await driveListInFolder(folderId);   // live folder contents each call
      const { match, candidates, reason } = matchWorkbook(files, name, reqBody.expected as string | null);
      // return the FULL folder list too, so the admin can pick a newly-added workbook
      // even when one existing sheet name-matches the client.
      return json({ ok: true, action, folder_id: folderId, match, candidates, reason, file_count: files.length, files });
    }
    // detect: inspect a workbook's tabs and dry-run parse each so the admin can map
    // tabs → sources with eyes open (no silent guessing, no writes).
    if (action === "detect") {
      let sheetId = extractSheetId(String(reqBody.sheet_id || ""));
      if (!sheetId && reqBody.practice_id) {
        const { data: p } = await sb.from("practices").select("workbook_sheet_id").eq("id", reqBody.practice_id).single();
        sheetId = extractSheetId(String(p?.workbook_sheet_id || ""));
      }
      if (!sheetId) return json({ ok: false, error: "no sheet_id and the practice has no master workbook set" }, 400);
      const tabs = await listTabs(sheetId);
      const out: unknown[] = [];
      for (const t of tabs) {
        let sample: string[][] = [];
        try {
          const grid = await readSheetGrid(sheetId, t.title);
          sample = grid.slice(0, 4).map(r => r.slice(0, 8));
          // placeholder pid → shape/parse check only, nothing is written
          const { report } = parseGrid(grid, guessSource(t.title) || "marketing",
            "00000000-0000-0000-0000-000000000000", t.title);
          out.push({ title: t.title, gid: t.gid, suggested_source: guessSource(t.title),
            parsed_rows: report.produced, months: report.months, shape: report.shape,
            header_row: report.header_row, period_field: report.period_field,
            normalized_headers: report.normalized_headers, confidence: report.confidence,
            reason: report.reason, skipped_rows: report.skipped_rows, sample });
        } catch (e) {
          out.push({ title: t.title, gid: t.gid, suggested_source: guessSource(t.title),
            parsed_rows: 0, months: [], shape: "unknown", reason: String((e as Error)?.message || e), sample });
        }
      }
      return json({ ok: true, action, sheet_id: sheetId, tab_count: tabs.length, tabs: out });
    }

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
    const dailyUpserts: Record<string, unknown>[] = [];
    const perSource: Record<string, Record<string, unknown>> = {};
    const reports: ParseReport[] = [];     // full per-tab parse report (shape, header, reason…)
    const allMonths = new Set<string>();   // distinct 'YYYY-MM' months seen across every source

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
        const { rows, dailyRows, report } = parseGrid(grid, job.source, job.pid, job.label);
        reports.push(report);
        upserts.push(...rows);
        dailyUpserts.push(...dailyRows);
        const months = report.months;
        months.forEach(m => allMonths.add(m));
        const ok = rows.length > 0;
        perSource[job.label] = { ok, rows: rows.length, daily_rows: dailyRows.length, months, shape: report.shape,
          header_row: report.header_row, confidence: report.confidence,
          skipped: report.skipped_rows, reason: report.reason };
        // a zero-row parse is a soft failure: keep it visible in the global skipped list
        if (!ok || report.skipped_rows) skipped.push({ source: job.label, ...report });
        // per-channel observability: a clean human summary lands on the source row
        if (job.pid) await sb.from("sheet_sources").update({
          last_synced_at: ranAt, last_status: ok ? "ok" : "error",
          last_error: ok ? null : report.reason, last_rows: rows.length, last_months: months,
        }).eq("practice_id", job.pid).eq("source", job.source);
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        perSource[job.label] = { ok: false, error: msg };
        skipped.push({ source: job.label, reason: msg });
        if (job.pid) await sb.from("sheet_sources").update({
          last_synced_at: ranAt, last_status: "error", last_error: msg,
        }).eq("practice_id", job.pid).eq("source", job.source);
      }
    }

    let upserted = 0, dailyUpserted = 0, error: string | null = null;
    if (upserts.length) {
      const { data, error: e } = await sb.from("kpi_monthly")
        .upsert(upserts, { onConflict: "practice_id,period,source" }).select("id");
      if (e) error = e.message; else upserted = data?.length ?? upserts.length;
    }
    if (!error && dailyUpserts.length) {
      const { data, error: e } = await sb.from("kpi_daily")
        .upsert(dailyUpserts, { onConflict: "practice_id,day,source" }).select("id");
      if (e) error = e.message; else dailyUpserted = data?.length ?? dailyUpserts.length;
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
      daily_rows_seen: dailyUpserts.length, daily_upserted: dailyUpserted,
      skipped_count: skipped.length, months_seen, skipped: skipped.slice(0, 25),
      reports, error }, error ? 500 : 200);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return json({ ok: false, ran_at: ranAt, trigger, error: msg }, 500);
  }
});
