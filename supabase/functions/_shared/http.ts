// Shared HTTP helpers for edge functions — one source of truth for CORS and
// JSON responses. Functions historically each inlined their own `cors`/`respond`
// (and their own UUID_RE + authorize), which drifted; new/refactored functions
// import these instead. (Migrating the legacy inlined functions —
// sync-coefficient, invite-user, asana-* — onto this + a unified authorize is a
// follow-up to do when the functions can be live-tested.)

export const cors = {
  "Access-Control-Allow-Origin": "*",
  // Superset that covers every function (x-sync-key is only used by the sync/
  // cron functions, but listing it here is harmless for the others).
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

export const preflight = () => new Response("ok", { headers: cors });

export { UUID_RE } from "./auth.ts";
