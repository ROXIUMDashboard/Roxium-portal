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
//   3. inviteUserByEmail (or attach existing auth user).
//   4. Upsert profiles + memberships; mark invite accepted.
//
// Deploy:  supabase functions deploy invite-user
// Secrets: SITE_URL (portal origin for invite redirect)
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

  const { data: practice } = await admin.from("practices").select("id").eq("id", practice_id).single();
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

  let userId: string | null = null;
  let didInvite = false;
  // Capitalized role label so the Supabase "Invite user" template can render
  // "invited as Owner" via {{ .Data.role_label }} (Go templates can't title-case).
  const role_label = role === "owner" ? "Owner" : "Member";
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role, role_label },
    // Invite links land on the portal app page — the site root is the public
    // marketing page (its auth-forwarder would catch this, but go direct).
    redirectTo: SITE_URL ? SITE_URL.replace(/\/+$/, "") + "/portal/" : undefined,
  });
  if (invited?.user) {
    userId = invited.user.id;
    didInvite = true;
  } else if (inviteErr && /already.*regist|exist/i.test(inviteErr.message)) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if (!userId) return json({ error: "User exists but could not be located" }, 500);
  } else {
    return json({ error: inviteErr?.message ?? "Invite failed" }, 500);
  }

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

  await admin.from("practice_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("practice_id", practice_id).ilike("email", email);

  return json({ ok: true, user_id: userId, invited: didInvite, email, practice_id, role });
});
