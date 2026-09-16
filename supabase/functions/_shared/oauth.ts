import { siteUrl } from "./env.ts";

// Shared OAuth helpers for the self-service marketing connections.
// State tokens are HMAC-SHA256 signed with SYNC_SECRET so the callback can
// trust the practice/provider it carries without any session.

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export type OAuthState = { p: string; v: string; u?: string; ts: number };

export async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(state)));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyState(token: string, secret: string, maxAgeMs = 2 * 3600_000): Promise<OAuthState | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  if (sig !== await hmac(payload, secret)) return null;
  try {
    const state = JSON.parse(b64urlDecode(payload)) as OAuthState;
    if (!state.p || !state.v || !state.ts) return null;
    if (Date.now() - state.ts > maxAgeMs) return null;
    return state;
  } catch { return null; }
}

export type ProviderConfig = {
  clientId: string; clientSecret: string;
  authUrl: string; tokenUrl: string; scopes: string[];
};

// Provider apps are EXTERNAL configuration (Meta developer app / Google Cloud
// OAuth client). Absent env vars simply mean "not configured yet" — callers
// degrade gracefully rather than erroring.
export function providerConfig(provider: string): ProviderConfig | null {
  if (provider === "meta") {
    const clientId = Deno.env.get("META_APP_ID"), clientSecret = Deno.env.get("META_APP_SECRET");
    if (!clientId || !clientSecret) return null;
    return {
      clientId, clientSecret,
      authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
      scopes: ["ads_read", "read_insights", "pages_show_list", "pages_read_engagement",
               "instagram_basic", "instagram_manage_insights", "business_management"],
    };
  }
  if (provider === "google") {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return {
      clientId, clientSecret,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email",
               "https://www.googleapis.com/auth/adwords",
               "https://www.googleapis.com/auth/analytics.readonly"],
    };
  }
  return null;
}

export function callbackUrl(): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/oauth-callback`;
}

export function portalUrl(qs: string): string {
  // siteUrl() fails closed on staging instead of defaulting to the live site.
  return `${siteUrl()}/portal/${qs ? "?" + qs : ""}`;
}
