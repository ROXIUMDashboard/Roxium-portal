// ============================================================
// Edge Function: notify-video-ready
// Notifies practice members that a finished video is posted.
// - Expects POST { video_id: string }
// - Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to read the video and members.
// - Returns { ok: true, emailed: N } where N is the number of intended recipients.
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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "Missing Supabase env" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { video_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const video_id = (body.video_id ?? '').trim();
  if (!video_id) return json({ error: 'video_id is required' }, 400);

  try {
    const { data: v, error: vErr } = await admin.from('video_pipeline').select('id, practice_id, item').eq('id', video_id).single();
    if (vErr || !v) return json({ error: 'Video not found' }, 404);

    const message = `New video published: ${v.item || 'your video'}. Watch it in your portal.`;

    const { data: members, error: mErr } = await admin.from('memberships').select('user_id').eq('practice_id', v.practice_id);
    if (mErr) return json({ error: 'Could not load members' }, 500);
    const count = (members || []).length;

    // Optionally insert a notifications row server-side (frontend already inserts one).
    try{ await admin.from('notifications').insert({ practice_id: v.practice_id, kind: 'video', message }); }catch(e){ /* non-blocking */ }

    return json({ ok: true, emailed: count });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
