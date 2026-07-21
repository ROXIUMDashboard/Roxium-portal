// ============================================================
// book-demo — receives a "Book a demo" request from the public landing page
// and delivers it to the ROXIUM team by email (Resend), best-effort logging it
// to the demo_requests table when that table exists.
//
// Public (no auth): deployed with --no-verify-jwt so the static landing page can
// POST to it directly. Input is validated and length-capped; nothing here trusts
// the caller beyond sending an internal notification email.
//
// POST { name, practice, email, channels }  ->  { ok: true }
//
// Deploy:  supabase functions deploy book-demo --no-verify-jwt
// Secrets: RESEND_API_KEY (required to send), EMAIL_FROM (verified sender),
//          DEMO_NOTIFY_EMAIL (where demo requests land; defaults below).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, respond, preflight } from "../_shared/http.ts";

const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const name = clean(body.name);
    const practice = clean(body.practice);
    const email = clean(body.email);
    const channels = clean(body.channels, 300);

    if (!name || !practice || !email) return respond({ ok: false, error: "name, practice and email are required" }, 400);
    if (!EMAIL_RE.test(email)) return respond({ ok: false, error: "please enter a valid email" }, 400);

    // 1) Best-effort log to demo_requests (ignored if the table isn't there yet).
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && key) {
        const admin = createClient(url, key, { auth: { persistSession: false } });
        await admin.from("demo_requests").insert({ name, practice, email, channels });
      }
    } catch { /* table optional — email is the source of truth */ }

    // 2) Notify the team by email (the part that makes this "actually work").
    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    const TO = Deno.env.get("DEMO_NOTIFY_EMAIL") || "hello@roxiumstudio.com";

    if (!RESEND) {
      // No mailer configured — don't 500 the visitor; report so we can wire it.
      return respond({ ok: true, emailed: false, note: "logged, but RESEND_API_KEY isn't set yet" });
    }

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#1a1712">
        <h2 style="font-family:Georgia,serif;color:#8A7440;margin:0 0 12px">New demo request</h2>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 14px 4px 0;color:#777">Name</td><td><b>${esc(name)}</b></td></tr>
          <tr><td style="padding:4px 14px 4px 0;color:#777">Practice</td><td><b>${esc(practice)}</b></td></tr>
          <tr><td style="padding:4px 14px 4px 0;color:#777">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
          <tr><td style="padding:4px 14px 4px 0;color:#777">Channels</td><td>${esc(channels) || "—"}</td></tr>
        </table>
        <p style="margin-top:16px;color:#999;font-size:12px">Sent from the ROXIUM landing page · reply to reach ${esc(name)} directly.</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `Demo request — ${practice} (${name})`,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return respond({ ok: false, error: `couldn't send just now`, detail: detail.slice(0, 200) }, 502);
    }

    return respond({ ok: true, emailed: true });
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
