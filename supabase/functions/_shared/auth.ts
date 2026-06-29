// Shared JWT auth helpers for Edge Functions that must not trust the body alone.
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export type AuthFail = { error: Response };
export type AuthOk = { user: User; admin: SupabaseClient };

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function requireTeamUser(
  req: Request,
  admin: SupabaseClient = serviceClient(),
): Promise<AuthOk | AuthFail> {
  const token = bearerToken(req);
  if (!token) return { error: json({ ok: false, error: "Not authenticated" }, 401) };

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return { error: json({ ok: false, error: "Invalid session" }, 401) };

  const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (prof?.role !== "team") return { error: json({ ok: false, error: "Team only" }, 403) };

  return { user: userData.user, admin };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
