// ============================================================
// Composio v3 client — the self-service marketing connections run entirely
// through Composio, so ROXIUM never registers its own Meta / Google developer
// app and never stores an access token. Composio holds each practice's OAuth
// token keyed by user_id (= our practice_id) and injects it at execute time.
//
// Env:
//   COMPOSIO_API_KEY               — org API key (sent as x-api-key)
//   COMPOSIO_META_AUTH_CONFIG_ID   — ac_… managed auth config for the `metaads` toolkit
//   COMPOSIO_GOOGLE_AUTH_CONFIG_ID — ac_… managed auth config for the `googleads` toolkit
//
// Auth configs are created ONCE in the Composio dashboard (Managed auth, zero
// setup for popular toolkits) and their ids pasted into the secrets above.
// ============================================================

const BASE = "https://backend.composio.dev/api/v3";
type Json = Record<string, unknown>;

export function composioKey(): string | null {
  return Deno.env.get("COMPOSIO_API_KEY") || null;
}

// Any provider key → its Composio auth config, or null when that provider
// hasn't been wired up yet (callers degrade gracefully). Adding a NEW platform
// requires zero code changes here: create the auth config in the Composio
// dashboard and set COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID as an edge secret
// (e.g. provider 'google_analytics' → COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID).
export function composioProvider(provider: string): { authConfigId: string } | null {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(provider)) return null;
  const id = Deno.env.get(`COMPOSIO_${provider.toUpperCase()}_AUTH_CONFIG_ID`);
  return id ? { authConfigId: id } : null;
}

async function api(path: string, init: RequestInit): Promise<Json> {
  const key = composioKey();
  if (!key) throw new Error("COMPOSIO_API_KEY not configured");
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-api-key": key, "content-type": "application/json", ...(init.headers || {}) },
  });
  const j = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) {
    const err = (j.error as Json) || {};
    throw new Error(String(err.message || j.message || j.error || `composio ${r.status}`).slice(0, 300));
  }
  return j;
}

// Create a hosted auth link so a practice can connect a toolkit with their own
// login. After consent Composio redirects the browser to `callbackUrl` with
// ?status=success&connected_account_id=ca_… appended.
export async function createLink(
  authConfigId: string,
  userId: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string; connectedAccountId: string | null }> {
  const j = await api("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({ auth_config_id: authConfigId, user_id: userId, callback_url: callbackUrl }),
  });
  const redirectUrl = String(j.redirect_url || j.redirectUrl || "");
  const connectedAccountId = (j.connected_account_id || j.connectedAccountId || null) as string | null;
  if (!redirectUrl) throw new Error("composio did not return a redirect url");
  return { redirectUrl, connectedAccountId };
}

// Fetch a connected account to confirm it is ACTIVE and belongs to the practice
// (defends against a tampered callback replaying someone else's connection id).
export async function getConnectedAccount(id: string): Promise<{
  status: string;
  userId: string | null;
  toolkit: string | null;
  label: string | null;
}> {
  const j = await api(`/connected_accounts/${encodeURIComponent(id)}`, { method: "GET" });
  const tk = (j.toolkit as Json) || {};
  return {
    status: String(j.status || (j.state as Json)?.status || "").toUpperCase(),
    userId: (j.user_id || j.userId || (j.entity as Json)?.id || j.entity_id || null) as string | null,
    toolkit: String(tk.slug || j.toolkit_slug || "") || null,
    label: (j.name || (j.data as Json)?.name || null) as string | null,
  };
}

// Execute a Composio tool as a given practice (user_id) — Composio injects that
// user's stored token. Prefer the explicit connected_account_id when known.
export async function executeTool(
  slug: string,
  userId: string,
  args: Json,
  connectedAccountId?: string | null,
): Promise<Json> {
  // Composio requires the entity `user_id` AND a `version`; a connected_account_id
  // must be paired with the user_id (sent alone it 400s with entity-id-required),
  // and without `version` the execute endpoint 404s with "Tool not found".
  const body: Json = { arguments: args, user_id: userId, version: "latest" };
  if (connectedAccountId) body.connected_account_id = connectedAccountId;
  const j = await api(`/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (j.successful === false || j.error) {
    throw new Error(String((j.error as Json)?.message || j.error || "tool execution failed").slice(0, 300));
  }
  return j;
}
