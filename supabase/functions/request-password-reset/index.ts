// ============================================================
// request-password-reset — send a ROXIUM-branded "set a new password" email.
//
// Public (no auth): deployed with --no-verify-jwt so the sign-in card can POST
// to it. It ALWAYS answers { ok: true } — never whether the address is
// registered — so it cannot be used to enumerate ROXIUM clients.
//
// WHY THIS EXISTS INSTEAD OF CALLING resetPasswordForEmail() DIRECTLY
//   Supabase's default recovery email links to GET /auth/v1/verify, which
//   consumes the one-time token on first fetch. Corporate mail security
//   (Microsoft Defender Safe Links and equivalents) fetches links before the
//   human ever sees them, so the token is already spent by the time the client
//   clicks. That is the exact failure that made the old magic-link login
//   unreliable for this customer base.
//
//   So: mint the link with admin.generateLink, take the HASHED TOKEN out of it,
//   and email a link to our own page with the token in the URL FRAGMENT:
//
//       https://roxium.com/portal/#auth=recovery&token=<hashed>&t=recovery
//
//   A fragment is never sent to a server, and a scanner does not run our
//   JavaScript — so only the real user's browser can redeem it, by calling
//   verifyOtp() client-side. Both halves of the mitigation, together.
//
// POST { email }  ->  { ok: true }   (always, for any input)
//
// Deploy:  supabase functions deploy request-password-reset --no-verify-jwt
// Secrets: SITE_URL (portal origin), RESEND_API_KEY + EMAIL_FROM (delivery),
//          APP_ENV=staging on the staging project.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { respond, preflight } from "../_shared/http.ts";
import { portalOrigin } from "../_shared/env.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Branded, Outlook-safe (table + inline CSS), same visual language as invite-user.
const resetHtml = (actionLink: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0D0C10;margin:0;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#141218;border:1px solid rgba(201,168,76,.35);border-radius:10px;">
        <tr><td align="center" style="padding:30px 40px 6px;">
          <div style="font-family:Georgia,'Times New Roman',serif;letter-spacing:6px;font-size:22px;color:#F2EDE3;">ROX<span style="color:#C9A84C;">I</span>UM</div>
          <div style="height:2px;width:40px;background:#C9A84C;margin:12px auto 0;"></div>
        </td></tr>
        <tr><td align="center" style="padding:18px 44px 0;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.35;color:#F2EDE3;">Set a new password</td></tr>
        <tr><td style="padding:20px 44px 2px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#F2EDE3;">We received a request to reset the password for your ROXIUM portal account. Click below to choose a new one. This link is valid for one hour.</td></tr>
        <tr><td align="center" style="padding:24px 44px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#C9A84C" style="border-radius:6px;">
            <a href="${esc(actionLink)}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#0D0C10;text-decoration:none;">Choose a new password</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:6px 44px 2px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9A948A;">If the button doesn't work, copy and paste this link:<br><span style="color:#C9A84C;word-break:break-all;">${esc(actionLink)}</span></td></tr>
        <tr><td style="padding:16px 44px 30px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#7C776E;border-top:1px solid rgba(201,168,76,.18);">If you didn't ask for this, you can ignore this email — your password will not change.</td></tr>
      </table>
    </td></tr>
  </table>`;

/** The scanner-proof recovery URL: token in the fragment, redeemed by JS. */
export function recoveryLink(origin: string, hashedToken: string, type = "recovery"): string {
  return `${origin.replace(/\/+$/, "")}/#auth=recovery&token=${encodeURIComponent(hashedToken)}&t=${encodeURIComponent(type)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);

  // One neutral answer for every outcome below. The caller learns nothing about
  // whether the address exists, and neither does anyone watching response times
  // closely enough to care — the work is the same shape either way.
  const neutral = () => respond({ ok: true });

  let email = "";
  try {
    const body = await req.json().catch(() => ({}));
    email = String(body?.email ?? "").trim().toLowerCase().slice(0, 320);
  } catch { return neutral(); }
  if (!email || !EMAIL_RE.test(email)) return neutral();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return neutral();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // generateLink mints the token but sends nothing — we deliver it ourselves.
    // It fails for an address with no account, which is exactly the case where
    // we want to send no email at all, and still answer the caller identically.
    const gen = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: portalOrigin() },
    });
    const hashed = (gen.data as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
    if (gen.error || !hashed) return neutral();

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
    if (!RESEND) {
      console.warn("[request-password-reset] RESEND_API_KEY is not set — no email was sent.");
      return neutral();
    }

    const link = recoveryLink(portalOrigin(), hashed, "recovery");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [email],
        subject: "Set a new ROXIUM portal password",
        html: resetHtml(link),
      }),
    });
    if (!res.ok) console.warn(`[request-password-reset] resend ${res.status}: ${await res.text()}`);
  } catch (e) {
    // Never surface an internal failure to an unauthenticated caller.
    console.warn("[request-password-reset]", String((e as Error)?.message || e));
  }
  return neutral();
});
