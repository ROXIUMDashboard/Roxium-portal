// ============================================================
// delete-account — the team-only teardown an RPC cannot perform.
//
// A plpgsql function can delete local rows but NOT the auth.users row, so a
// "deleted" client would sign in again and `ensure_my_profile` would recreate a
// pending profile — the reappearing-client bug. This function calls the delete
// RPCs (which return the client user-ids that should be fully removed), revokes
// each affected practice's Composio connections, and then calls
// auth.admin.deleteUser so the account is gone for good.
//
// POST (team JWT):
//   { practice_id }  → tear down a whole practice (detaches multi-practice
//                      clients, deletes single-practice clients' auth users)
//   { user_id }      → delete one client account entirely
//
// Deploy:  supabase functions deploy delete-account --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COMPOSIO_API_KEY (optional).
// ============================================================
import { serviceClient, bearerToken, UUID_RE } from "../_shared/auth.ts";
import { composioKey, deleteConnectedAccount } from "../_shared/composio.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

// Revoke every Composio connection for a set of practices (best-effort).
async function revokePracticeConnections(sb: ReturnType<typeof serviceClient>, practiceIds: string[]) {
  if (!practiceIds.length || !composioKey()) return;
  const { data: conns } = await sb.from("platform_connections")
    .select("composio_connection_id").in("practice_id", practiceIds);
  for (const c of (conns || []) as Array<{ composio_connection_id: string | null }>) {
    if (c.composio_connection_id) {
      try { await deleteConnectedAccount(c.composio_connection_id); } catch { /* best effort */ }
    }
  }
}

// Delete a batch of auth users (best-effort per user; report failures).
async function deleteAuthUsers(sb: ReturnType<typeof serviceClient>, ids: string[]) {
  const failed: string[] = [];
  for (const id of ids) {
    if (!UUID_RE.test(id)) continue;
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) failed.push(id);
  }
  return failed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "method not allowed" }, 405);
  try {
    const sb = serviceClient();

    // Team-only.
    const token = bearerToken(req);
    if (!token) return respond({ ok: false, error: "not authenticated" }, 401);
    const { data: userData, error: uerr } = await sb.auth.getUser(token);
    if (uerr || !userData?.user) return respond({ ok: false, error: "invalid session" }, 401);
    const { data: prof } = await sb.from("profiles").select("role").eq("id", userData.user.id).single();
    if (prof?.role !== "team") return respond({ ok: false, error: "team only" }, 403);

    const { practice_id, user_id } = await req.json().catch(() => ({}));

    if (practice_id) {
      if (!UUID_RE.test(String(practice_id))) return respond({ ok: false, error: "bad practice_id" }, 400);
      await revokePracticeConnections(sb, [String(practice_id)]);      // before rows cascade away
      const { data: res, error } = await sb.rpc("delete_practice", { p_id: practice_id });
      if (error) throw new Error(error.message);
      const ids = ((res as { deleted_user_ids?: string[] })?.deleted_user_ids) || [];
      const failed = await deleteAuthUsers(sb, ids);
      return respond({ ok: true, deleted_users: ids.length, failed });
    }

    if (user_id) {
      if (!UUID_RE.test(String(user_id))) return respond({ ok: false, error: "bad user_id" }, 400);
      const { data: res, error } = await sb.rpc("delete_client", { p_user: user_id });
      if (error || (res as { ok?: boolean })?.ok === false)
        throw new Error(error?.message || (res as { error?: string })?.error || "delete_client failed");
      const failed = await deleteAuthUsers(sb, [String(user_id)]);
      return respond({ ok: true, deleted_users: 1, failed });
    }

    return respond({ ok: false, error: "practice_id or user_id required" }, 400);
  } catch (e) {
    return respond({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
