// ============================================================
// invite-user — invite a user to a practice (profile + membership + allowlist row)
//
// Callers allowed:
//   • ROXIUM team (profiles.role = 'team') — any practice
//   • Practice owner (memberships.role = 'owner') — their practice only
//
// Flow:
//   1. Verify caller may invite to this practice.
//   2. Upsert practice_invites (allowlist) as pending → sent.
//   3. Mint a SET-PASSWORD link with admin.generateLink (invite for brand-new
//      users, recovery for existing ones) and EMAIL IT VIA RESEND — the same
//      proven path the portal's other notifications use.
//
//      The link carries its token in the URL FRAGMENT and points at our own
//      page, which redeems it with verifyOtp() in JavaScript. Corporate mail
//      scanners pre-fetch links and would otherwise burn a one-time token
//      before the human ever clicks; a fragment is never sent to a server and a
//      scanner does not run our JS. See request-password-reset for the same
//      reasoning in the recovery flow.
//   4. Upsert profiles + memberships; mark invite accepted + approved.
//
// Deploy:  supabase functions deploy invite-user
// Secrets: SITE_URL (portal origin for the invite redirect; REQUIRED — the link
//          is built from it),
//          RESEND_API_KEY + EMAIL_FROM (to actually deliver the invite email).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invitation URL: hashed token in the FRAGMENT, redeemed client-side.
 * Kept identical in shape to request-password-reset's link so the portal has one
 * callback to parse.
 */
export function setPasswordLink(portal: string, hashedToken: string, type: string): string {
  return `${portal.replace(/\/+$/, "")}/#auth=recovery&token=${encodeURIComponent(hashedToken)}&t=${encodeURIComponent(type)}`;
}

function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// Branded, Outlook-safe (table + inline CSS) invitation.
const inviteHtml = (practiceName: string, actionLink: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0D0C10;margin:0;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#141218;border:1px solid rgba(201,168,76,.35);border-radius:10px;">
        <tr><td align="center" style="padding:30px 40px 6px;">
          <div style="font-family:Georgia,'Times New Roman',serif;letter-spacing:6px;font-size:22px;color:#F2EDE3;">ROX<span style="color:#C9A84C;">I</span>UM</div>
          <div style="height:2px;width:40px;background:#C9A84C;margin:12px auto 0;"></div>
        </td></tr>
        <tr><td align="center" style="padding:18px 44px 0;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.35;color:#F2EDE3;">You're invited to your ROXIUM portal</td></tr>
        ${practiceName ? `<tr><td align="center" style="padding:6px 44px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.5px;color:#C9A84C;text-transform:uppercase;">${escapeHtml(practiceName)}</td></tr>` : ""}
        <tr><td style="padding:20px 44px 2px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#F2EDE3;">Your practice's growth dashboard is ready — marketing performance, deliverables, video and reporting, all in one place. Click below to choose a password and open your portal.</td></tr>
        <tr><td align="center" style="padding:24px 44px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#C9A84C" style="border-radius:6px;">
            <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#0D0C10;text-decoration:none;">Set your password</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:6px 44px 2px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9A948A;">If the button doesn't work, copy and paste this link:<br><span style="color:#C9A84C;word-break:break-all;">${escapeHtml(actionLink)}</span></td></tr>
        <tr><td style="padding:16px 44px 30px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#7C776E;border-top:1px solid rgba(201,168,76,.18);">You're receiving this because ROXIUM set up a portal for your practice.</td></tr>
      </table>
    </td></tr>
  </table>`;

async function canInvite(admin: ReturnType<typeof createClient>, callerId: string, practiceId: string): Promise<boolean> {
  const { data: prof } = await admin.from("profiles").select("role").eq("id", callerId).single();
  if (prof?.role === "team") return true;
  const { data: mem } = await admin.from("memberships")
    .select("role").eq("user_id", callerId).eq("practice_id", practiceId).single();
  return mem?.role === "owner";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";
  const REDIRECT = SITE_URL ? SITE_URL.replace(/\/+$/, "") + "/portal/" : undefined;
  const RESEND = Deno.env.get("RESEND_API_KEY");
  const FROM = Deno.env.get("EMAIL_FROM") || "ROXIUM <updates@roxium.com>";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not authenticated" }, 401);

  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json({ error: "Invalid session" }, 401);

  let body: { email?: string; practice_id?: string; role?: string; full_name?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  const practice_id = body.practice_id ?? "";
  const role = body.role === "owner" ? "owner" : "member";
  const full_name = (body.full_name ?? "").trim() || null;
  if (!email || !practice_id) return json({ error: "email and practice_id are required" }, 400);
  if (!UUID_RE.test(practice_id)) return json({ error: "invalid practice_id" }, 400);

  if (!await canInvite(admin, caller.user.id, practice_id))
    return json({ error: "You may only invite users to practices you manage" }, 403);

  const { data: practice } = await admin.from("practices").select("id, name").eq("id", practice_id).single();
  if (!practice) return json({ error: "Practice not found" }, 404);

  // Allowlist row before auth user exists
  const { data: existing } = await admin.from("practice_invites")
    .select("id").eq("practice_id", practice_id).ilike("email", email).maybeSingle();
  if (existing?.id) {
    await admin.from("practice_invites").update({
      full_name, role, status: "pending", invited_by: caller.user.id,
    }).eq("id", existing.id);
  } else {
    await admin.from("practice_invites").insert({
      practice_id, email, full_name, role, status: "pending", invited_by: caller.user.id,
    });
  }

  const role_label = role === "owner" ? "Owner" : "Member";
  const meta = { full_name, role, role_label };

  // 1) Ensure the auth user exists. This is the part that MUST succeed — it is
  //    deliberately DECOUPLED from email so a mis-configured mailer can never
  //    hard-fail an invite. createUser doesn't send anything; email is step 3.
  let userId: string | null = null;
  let invited = false;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: meta,
  });
  if (created?.user) {
    userId = created.user.id; invited = true;
  } else if (createErr && /already|registered|exist/i.test(createErr.message)) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
  }
  if (!userId) return json({ error: createErr?.message ?? "Could not create the account" }, 500);

  // 2) Grant access: allowlist → profile → membership → approve.
  await admin.from("practice_invites")
    .update({ status: "sent" })
    .eq("practice_id", practice_id).ilike("email", email);

  const { error: profErr } = await admin.from("profiles").upsert(
    { id: userId, role: "client", practice_id, full_name },
    { onConflict: "id" },
  );
  if (profErr) return json({ error: `Profile: ${profErr.message}` }, 500);

  const { error: memErr } = await admin.from("memberships").upsert(
    { user_id: userId, practice_id, role },
    { onConflict: "user_id,practice_id" },
  );
  if (memErr) return json({ error: `Membership: ${memErr.message}` }, 500);

  // Invited users are approved by definition. The insert-only approval trigger
  // does NOT fire on a membership conflict-update (re-invite of an existing
  // member), so set approval explicitly here. Best-effort so a pre-migration DB
  // (no approval_status column) still completes the invite.
  await admin.from("profiles").update({ approval_status: "approved" }).eq("id", userId);

  await admin.from("practice_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("practice_id", practice_id).ilike("email", email);

  // 3) Best-effort email — NEVER blocks the invite. Mint a magic sign-in link and
  //    deliver it via Resend. If RESEND isn't configured (or delivery fails), the
  //    account is already created; we just report emailed:false + a reason so the
  //    UI can say "invited — email not sent yet".
  let emailed = false;
  let email_note = "";
  try {
    // A brand-new account has no password yet, so it gets an `invite` token; an
    // existing account keeps its identity and gets a `recovery` token, which is
    // also how a legacy magic-link user establishes a password for the first
    // time. Either way the user id, memberships and history are untouched.
    // Without SITE_URL there is no origin to build the link from. Fail here
    // rather than emailing a relative URL nobody can open — the account is
    // already created, so this only sets emailed:false + a reason.
    if (!REDIRECT) throw new Error("SITE_URL is not configured on this project, so no invitation link could be built");
    const linkType = invited ? "invite" : "recovery";
    const gen = await admin.auth.admin.generateLink({ type: linkType, email, options: { redirectTo: REDIRECT } });
    const hashed = (gen.data as { properties?: { hashed_token?: string } })?.properties?.hashed_token || "";
    if (gen.error || !hashed) throw new Error(gen.error?.message || "could not generate a set-password link");
    const actionLink = setPasswordLink(REDIRECT, hashed, linkType);
    if (RESEND) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: [email],
          subject: "Set up your ROXIUM portal account",
          html: inviteHtml((practice as { name?: string }).name || "", actionLink),
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
      emailed = true;
    } else {
      email_note = "Account created, but no invite email was sent — RESEND_API_KEY isn't configured yet.";
    }
  } catch (e) {
    email_note = String((e as Error)?.message || e);
  }

  return json({ ok: true, user_id: userId, invited, emailed, email_note, email, practice_id, role });
});
