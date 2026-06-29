// ============================================================
// notify-video-ready — email a practice's client users when a video is posted.
// Called by the portal when the team posts a finished video URL ({ video_id }).
//
// Deploy:  supabase functions deploy notify-video-ready --project-ref <ref>
// Secrets: RESEND_API_KEY (required to send), EMAIL_FROM. SUPABASE_URL / SERVICE_ROLE_KEY auto-injected.
// Requires practice_member_emails() RPC (migrations/2026-06-23_phase_d_email.sql).
// ============================================================

import { requireTeamUser, serviceClient, UUID_RE } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const emailHtml = (item: string, url: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0D0C10;padding:32px;color:#F2EDE3">
    <div style="max-width:520px;margin:0 auto;border:1px solid rgba(201,168,76,.35);border-radius:8px;padding:28px 30px">
      <div style="letter-spacing:.4em;font-weight:600">ROX<span style="color:#C9A84C">I</span>UM</div>
      <p style="font-size:16px;line-height:1.6;margin:22px 0">Your new video <b>${escapeHtml(item)}</b> is ready to watch.</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#C9A84C;color:#171410;text-decoration:none;
         padding:12px 22px;border-radius:4px;font-weight:600;letter-spacing:.06em">▶ Watch the video</a>
    </div>
  </div>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const auth = await requireTeamUser(req);
    if ("error" in auth) {
      const body = await auth.error.json();
      return respond(body, auth.error.status);
    }

    const { video_id } = await req.json();
    if (!video_id) return respond({ ok: false, error: "video_id required" }, 400);
    if (!UUID_RE.test(String(video_id))) return respond({ ok: false, error: "invalid video_id" }, 400);

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    const sb = serviceClient();

    const { data: v, error: vErr } = await sb
      .from("video_pipeline").select("practice_id,item,video_url").eq("id", video_id).single();
    if (vErr || !v) return respond({ ok: false, error: vErr?.message || "video not found" }, 404);
    if (!v.video_url) return respond({ ok: false, error: "video has no URL yet" }, 400);

    const { data: rows, error } = await sb.rpc("practice_member_emails", { p_id: v.practice_id });
    if (error) return respond({ ok: false, error: error.message }, 500);
    const to = (rows || []).map((r: { email: string }) => r.email).filter(Boolean);
    if (!to.length) return respond({ ok: true, emailed: 0, note: "no client emails on file" });
    if (!RESEND) return respond({ ok: true, emailed: 0, note: "RESEND_API_KEY not set — would have emailed " + to.length });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: `Your video "${v.item}" is ready`, html: emailHtml(v.item, v.video_url) }),
    });
    if (!res.ok) return respond({ ok: false, error: `resend ${res.status}: ${await res.text()}` }, 502);
    return respond({ ok: true, emailed: to.length });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
