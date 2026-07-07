// ============================================================
// notify-client — email a practice's client users when the team posts an update.
// Called by the portal (app.js notifyClient) with the caller's JWT. Looks up the
// practice's client emails server-side (service role) and sends via Resend.
//
// Deploy:  supabase functions deploy notify-client --project-ref <ref>
// Secrets: RESEND_API_KEY (required to send), EMAIL_FROM (e.g. "ROXIUM <updates@roxium.com>")
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// Requires the practice_member_emails() RPC (migrations/2026-06-23_phase_d_email.sql).
// If RESEND_API_KEY is absent it returns the intended recipient count (safe no-op).
// ============================================================

import { requireTeamUser, serviceClient, UUID_RE } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const SUBJECTS: Record<string, string> = {
  deliverable: "A deliverable just shipped",
  milestone: "You've hit a new milestone",
  stats: "Your latest performance update is ready",
  video: "A new video is ready to watch",
};

function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// Branded, Outlook-safe (table + inline CSS) completion notice.
const emailHtml = (practiceName: string, message: string, whenStr: string, site: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0D0C10;margin:0;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#141218;border:1px solid rgba(201,168,76,.35);border-radius:10px;">
        <tr><td align="center" style="padding:30px 40px 6px;">
          <div style="font-family:Georgia,'Times New Roman',serif;letter-spacing:6px;font-size:22px;color:#F2EDE3;">ROX<span style="color:#C9A84C;">I</span>UM</div>
          <div style="height:2px;width:40px;background:#C9A84C;margin:12px auto 0;"></div>
        </td></tr>
        <tr><td align="center" style="padding:18px 44px 0;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.35;color:#F2EDE3;">Your ROXIUM Portal has been updated</td></tr>
        ${practiceName ? `<tr><td align="center" style="padding:6px 44px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.5px;color:#C9A84C;text-transform:uppercase;">${escapeHtml(practiceName)}</td></tr>` : ""}
        <tr><td style="padding:20px 44px 2px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#F2EDE3;">${escapeHtml(message)}</td></tr>
        ${whenStr ? `<tr><td style="padding:2px 44px 4px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#9A948A;">Completed on ${escapeHtml(whenStr)}</td></tr>` : ""}
        <tr><td align="center" style="padding:24px 44px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#C9A84C" style="border-radius:6px;">
            <a href="${escapeHtml(site)}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#0D0C10;text-decoration:none;">Review in your portal</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:16px 44px 30px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#7C776E;border-top:1px solid rgba(201,168,76,.18);">You're receiving this because your practice uses the ROXIUM portal.</td></tr>
      </table>
    </td></tr>
  </table>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const auth = await requireTeamUser(req);
    if ("error" in auth) {
      const body = await auth.error.json();
      const status = auth.error.status;
      return respond(body, status);
    }

    const { practice_id, message, kind } = await req.json();
    if (!practice_id || !message) return respond({ ok: false, error: "practice_id and message required" }, 400);
    if (!UUID_RE.test(String(practice_id))) return respond({ ok: false, error: "invalid practice_id" }, 400);
    if (String(message).length > 4000) return respond({ ok: false, error: "message too long" }, 400);

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    const SITE = Deno.env.get("SITE_URL") || "https://roxium.com";
    const when = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    const sb = serviceClient();

    const { data: practice } = await sb.from("practices").select("id, name").eq("id", practice_id).maybeSingle();
    if (!practice) return respond({ ok: false, error: "practice not found" }, 404);

    const { data: rows, error } = await sb.rpc("practice_member_emails", { p_id: practice_id });
    if (error) return respond({ ok: false, error: error.message }, 500);
    const to = (rows || []).map((r: { email: string }) => r.email).filter(Boolean);
    if (!to.length) return respond({ ok: true, emailed: 0, note: "no client emails on file" });
    if (!RESEND) return respond({ ok: true, emailed: 0, note: "RESEND_API_KEY not set — would have emailed " + to.length });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: SUBJECTS[kind] || "An update from ROXIUM", html: emailHtml((practice as { name?: string }).name || "", message, when, SITE) }),
    });
    if (!res.ok) return respond({ ok: false, error: `resend ${res.status}: ${await res.text()}` }, 502);
    return respond({ ok: true, emailed: to.length });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
