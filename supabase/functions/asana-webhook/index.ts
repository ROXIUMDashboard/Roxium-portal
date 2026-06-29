// ============================================================
// Edge Function: asana-webhook
// Minimal webhook endpoint for inserting Asana-completed-task messages into activity.
// Intended to be called by Zapier/Make or a webhook forwarder that can map a task
// completion to a practice_id and a human message.
// - Expects POST { practice_id: string, message: string }
// - If ASANA_SECRET is set, the request must include header `x-asana-secret` matching it.
// - Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to insert into `activity`.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-asana-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ASANA_SECRET = Deno.env.get('ASANA_SECRET') ?? '';
  if (!ASANA_SECRET) return json({ error: 'Webhook not configured (ASANA_SECRET missing)' }, 503);
  const hdr = req.headers.get('x-asana-secret') || '';
  if (hdr !== ASANA_SECRET) return json({ error: 'Invalid webhook secret' }, 403);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "Missing Supabase env" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { practice_id?: string; message?: string; author?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }

  const practice_id = (body.practice_id ?? '').trim();
  const message = (body.message ?? '').trim();
  const author = (body.author ?? 'Asana').trim();
  if (!practice_id || !message) return json({ error: 'practice_id and message are required' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(practice_id))
    return json({ error: 'invalid practice_id' }, 400);

  const { data: practice } = await admin.from('practices').select('id').eq('id', practice_id).maybeSingle();
  if (!practice) return json({ error: 'practice not found' }, 404);

  try {
    const { data, error } = await admin.from('activity').insert({ practice_id, message, author, source: 'asana' }).select();
    if (error) return json({ error: String(error) }, 500);
    return json({ ok: true, inserted: data && data.length ? data[0].id : null });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
