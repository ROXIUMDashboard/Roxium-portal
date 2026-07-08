// ============================================================
// weekly-digest — email the ROXIUM team one operational summary of every
// practice: what shipped, what's late, sync/access health, and KPI movement.
// The "follow-up report" for the operation itself, so nothing ages silently
// between daily queue checks.
//
// Auth (mirrors sync-coefficient):
//   • x-sync-key header (or ?key=) matching SYNC_SECRET — for cron
//   • OR a signed-in team member's JWT (manual test runs from the browser)
//
// Recipients: DIGEST_TO secret (comma-separated emails) if set; otherwise all
// profiles with role='team' (emails resolved via the auth admin API).
//
// Deploy:  supabase functions deploy weekly-digest --no-verify-jwt
// Secrets: RESEND_API_KEY, SYNC_SECRET (reused), optional DIGEST_TO, EMAIL_FROM,
//          SITE_URL. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// Schedule: weekly cron (e.g. Monday 07:00) POSTing to the function URL with
//           the x-sync-key header — same mechanism as the 2-hour sync cron.
// If RESEND_API_KEY is absent it returns the composed summary (safe no-op).
// ============================================================

import { serviceClient, requireTeamUser, json } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const fmt$ = (v: number | null) => (v == null ? "—" : "$" + Math.round(v).toLocaleString());
const fmtN = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString());
const pctDelta = (cur: number | null, prev: number | null) => {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return "";
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(p) < 0.5) return " (±0%)";
  return ` (${p > 0 ? "+" : ""}${p.toFixed(0)}%)`;
};

type Row = Record<string, unknown>;

async function authorize(req: Request): Promise<Response | null> {
  const secret = Deno.env.get("SYNC_SECRET");
  const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
  if (secret && got === secret) return null;
  const teamCheck = await requireTeamUser(req);
  if (!("error" in teamCheck)) return null;
  if (!secret) return respond({ ok: false, error: "SYNC_SECRET not configured" }, 500);
  return respond({ ok: false, error: "unauthorized — set x-sync-key to SYNC_SECRET, or sign in as team" }, 401);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const denied = await authorize(req);
    if (denied) return denied;

    const sb = serviceClient();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const staleCut = new Date(Date.now() - 26 * 3600000).toISOString();

    const [practices, delivs, videos, vhist, sources, kpi] = await Promise.all([
      sb.from("practices").select("id,name").order("name"),
      sb.from("deliverables").select("practice_id,name,status,due,delivered_at,status_since"),
      sb.from("video_pipeline").select("practice_id,item,stage,stage_since,blocked"),
      sb.from("video_history").select("practice_id,stage,moved_at").gte("moved_at", weekAgo),
      sb.from("sheet_sources").select("*"),
      sb.from("kpi_monthly").select("practice_id,period,source,spend,reach,clicks"),
    ]);
    if (practices.error) throw practices.error;

    const now = Date.now();
    const rows = (practices.data || []).map((p: Row) => {
      const pid = p.id;
      const ds = ((delivs.data || []) as Row[]).filter((d) => d.practice_id === pid);
      const vs = ((videos.data || []) as Row[]).filter((v) => v.practice_id === pid);
      const srcs = ((sources.data || []) as Row[]).filter((s) => s.practice_id === pid);
      const deliveredWk = ds.filter((d) => d.status === "delivered" && d.delivered_at && String(d.delivered_at) >= weekAgo).length;
      const overdue = ds.filter((d) => d.status !== "delivered" && d.due && new Date(String(d.due)) < new Date()).length;
      const postedWk = ((vhist.data || []) as Row[]).filter((h) => h.practice_id === pid && h.stage === "posted").length;
      const stuckVids = vs.filter((v) => {
        if (v.stage === "posted" || v.stage === "delivered") return false;
        const since = v.stage_since ? new Date(String(v.stage_since)).getTime() : now;
        return (now - since) / 86400000 >= 7;
      }).length;
      const syncErr = srcs.filter((s) => s.last_status === "error").length;
      const syncStale = srcs.filter((s) => s.last_status !== "error" && s.last_synced_at && String(s.last_synced_at) < staleCut).length;
      const accessPending = srcs.filter((s) => s.access_status === "requested" || (s.access_status === "granted" && !s.last_synced_at)).length;
      // KPI movement: latest reported month vs the one before, summed across sources
      const months = new Map<string, { spend: number; reach: number; clicks: number }>();
      ((kpi.data || []) as Row[]).filter((r) => r.practice_id === pid).forEach((r) => {
        const key = String(r.period);
        const m = months.get(key) || { spend: 0, reach: 0, clicks: 0 };
        m.spend += num(r.spend) ?? 0; m.reach += num(r.reach) ?? 0; m.clicks += num(r.clicks) ?? 0;
        months.set(key, m);
      });
      const ordered = [...months.keys()].sort();
      const cur = ordered.length ? months.get(ordered[ordered.length - 1])! : null;
      const prev = ordered.length > 1 ? months.get(ordered[ordered.length - 2])! : null;
      return { name: String(p.name || ""), deliveredWk, overdue, postedWk, stuckVids, syncErr, syncStale, accessPending, cur, prev };
    });

    const SITE = (Deno.env.get("SITE_URL") || "https://roxium.com").replace(/\/+$/, "") + "/portal/";
    const cell = (v: number, bad = false) =>
      `<td style="padding:8px 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${v && bad ? "#C66A58" : "#F2EDE3"};text-align:center;">${v || "—"}</td>`;
    const tableRows = rows.map((r) => `
      <tr style="border-top:1px solid rgba(201,168,76,.15);">
        <td style="padding:8px 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#C9A84C;">${esc(r.name)}</td>
        ${cell(r.deliveredWk)}${cell(r.postedWk)}${cell(r.overdue, true)}${cell(r.stuckVids, true)}${cell(r.syncErr + r.syncStale, true)}${cell(r.accessPending, true)}
        <td style="padding:8px 10px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9A948A;white-space:nowrap;">
          ${r.cur ? `${fmt$(r.cur.spend)}${pctDelta(r.cur.spend, r.prev?.spend ?? null)} · reach ${fmtN(r.cur.reach)}${pctDelta(r.cur.reach, r.prev?.reach ?? null)}` : "no data"}
        </td>
      </tr>`).join("");

    const totalFlags = rows.reduce((s, r) => s + r.overdue + r.stuckVids + r.syncErr + r.syncStale + r.accessPending, 0);
    const html = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0D0C10;margin:0;padding:32px 0;">
        <tr><td align="center">
          <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;background:#141218;border:1px solid rgba(201,168,76,.35);border-radius:10px;">
            <tr><td align="center" style="padding:28px 40px 4px;">
              <div style="font-family:Georgia,'Times New Roman',serif;letter-spacing:6px;font-size:20px;color:#F2EDE3;">ROX<span style="color:#C9A84C;">I</span>UM</div>
            </td></tr>
            <tr><td align="center" style="padding:10px 40px 2px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#F2EDE3;">Weekly operations digest</td></tr>
            <tr><td align="center" style="padding:2px 40px 14px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9A948A;">${rows.length} client${rows.length === 1 ? "" : "s"} · ${totalFlags} open flag${totalFlags === 1 ? "" : "s"} · last 7 days</td></tr>
            <tr><td style="padding:0 24px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>${["Client", "Delivered 7d", "Posted 7d", "Overdue", "Stuck vids", "Sync ⚠", "Access ⏳", "Latest month"]
                  .map((h) => `<th style="padding:6px 10px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:1.5px;color:#9A948A;text-transform:uppercase;text-align:center;">${h}</th>`).join("")}</tr>
                ${tableRows}
              </table>
            </td></tr>
            <tr><td align="center" style="padding:16px 40px 26px;">
              <a href="${esc(SITE)}#operations" style="display:inline-block;padding:12px 26px;background:#C9A84C;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#0D0C10;text-decoration:none;">Open the Operations Dashboard</a>
            </td></tr>
          </table>
        </td></tr>
      </table>`;

    // Recipients: DIGEST_TO override, else every team profile's auth email.
    let to = (Deno.env.get("DIGEST_TO") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!to.length) {
      const { data: teamProfiles } = await sb.from("profiles").select("id").eq("role", "team");
      const ids = new Set((teamProfiles || []).map((r: Row) => r.id));
      const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
      to = (users?.users || []).filter((u) => ids.has(u.id)).map((u) => u.email!).filter(Boolean);
    }
    if (!to.length) return respond({ ok: true, emailed: 0, note: "no team recipients found — set DIGEST_TO" });

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    if (!RESEND) return respond({ ok: true, emailed: 0, note: `RESEND_API_KEY not set — would have emailed ${to.length}`, clients: rows.length, flags: totalFlags });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: `ROXIUM weekly digest — ${rows.length} clients, ${totalFlags} open flags`, html }),
    });
    if (!res.ok) return respond({ ok: false, error: `resend ${res.status}: ${await res.text()}` }, 502);
    return respond({ ok: true, emailed: to.length, clients: rows.length, flags: totalFlags });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
