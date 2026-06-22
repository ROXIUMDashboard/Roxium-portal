// ============================================================
// Edge Function: invite-user
// Team-only. Invites a surgeon/client user to a practice and wires up their
// profile + membership in one step (no manual Supabase work).
//
// Flow:
//   1. Verify the CALLER is a team user (from their JWT).
//   2. invite (or look up) the auth user by email — sends Supabase's invite email.
//   3. Upsert their profile (role 'client', default practice) + membership row.
//
// Deploy:  supabase functions deploy invite-user
// Secrets (Project Settings → Edge Functions, or `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-injected on Supabase),
//   SITE_URL  (your portal origin, used as the invite redirect)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  // Admin client (bypasses RLS) for the privileged steps.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1) Identify the caller from their bearer token and confirm they are team.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not authenticated" }, 401);

  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", caller.user.id).single();
  if (!callerProfile || callerProfile.role !== "team")
    return json({ error: "Team access required" }, 403);

  // 2) Validate input.
  let body: { email?: string; practice_id?: string; role?: string; full_name?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  const practice_id = body.practice_id ?? "";
  const role = body.role === "owner" ? "owner" : "member";
  const full_name = (body.full_name ?? "").trim() || null;
  if (!email || !practice_id) return json({ error: "email and practice_id are required" }, 400);

  const { data: practice } = await admin.from("practices").select("id").eq("id", practice_id).single();
  if (!practice) return json({ error: "Practice not found" }, 404);

  // 3) Invite (or find) the user.
  let userId: string | null = null;
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: SITE_URL || undefined,
  });
  if (invited?.user) {
    userId = invited.user.id;
  } else if (inviteErr && /already.*regist|exist/i.test(inviteErr.message)) {
    // User already exists — just attach them to this practice (no new invite email).
    const { data: list } = await admin.auth.admin.listUsers();
    userId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if (!userId) return json({ error: "User exists but could not be located" }, 500);
  } else {
    return json({ error: inviteErr?.message ?? "Invite failed" }, 500);
  }

  // 4) Upsert profile (default/active practice) + membership (access).
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

  return json({ ok: true, user_id: userId, invited: !!invited?.user, email, practice_id, role });
});
