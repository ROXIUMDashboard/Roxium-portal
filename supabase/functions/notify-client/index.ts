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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
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

const emailHtml = (message: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0D0C10;padding:32px;color:#F2EDE3">
    <div style="max-width:520px;margin:0 auto;border:1px solid rgba(201,168,76,.35);border-radius:8px;padding:28px 30px">
      <div style="letter-spacing:.4em;font-weight:600;color:#F2EDE3">ROX<span style="color:#C9A84C">I</span>UM</div>
      <p style="font-size:16px;line-height:1.6;margin:22px 0;color:#F2EDE3">${escapeHtml(message)}</p>
      <p style="font-size:12px;color:#9A948A;margin-top:24px">Sign in to your portal to see the details.</p>
    </div>
  </div>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  try {
    const { practice_id, message, kind } = await req.json();
    if (!practice_id || !message) return json({ ok: false, error: "practice_id and message required" }, 400);

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: rows, error } = await sb.rpc("practice_member_emails", { p_id: practice_id });
    if (error) return json({ ok: false, error: error.message }, 500);
    const to = (rows || []).map((r: { email: string }) => r.email).filter(Boolean);
    if (!to.length) return json({ ok: true, emailed: 0, note: "no client emails on file" });
    if (!RESEND) return json({ ok: true, emailed: 0, note: "RESEND_API_KEY not set — would have emailed " + to.length });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: SUBJECTS[kind] || "An update from ROXIUM", html: emailHtml(message) }),
    });
    if (!res.ok) return json({ ok: false, error: `resend ${res.status}: ${await res.text()}` }, 502);
    return json({ ok: true, emailed: to.length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
