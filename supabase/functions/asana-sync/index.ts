// ============================================================
// asana-sync — import an Asana project's tasks into a practice's deliverables,
// mapping the "promised vs delivered" workflow:
//   • Asana section  → deliverable `phase`
//   • Asana task     → deliverable `name`   (idempotent via asana_task_id)
//   • task completed → status 'delivered', else 'in_progress' (assignee) / 'promised'
//
// This is the Phase-D scaffold for the end goal (Asana → promised/delivered). It is
// runnable once the secrets below exist; the mapping rules are intentionally simple
// and centralized here so they're easy to evolve.
//
// Deploy:  supabase functions deploy asana-sync --project-ref <ref>
// Call:    POST { practice_id, project_id }  (header x-sync-key: <SYNC_SECRET>)
// Secrets: ASANA_TOKEN (required), SYNC_SECRET (shared secret to authorize calls).
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY auto-injected.
// Requires deliverables.asana_task_id (migrations/2026-06-23_phase_d_email.sql).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  assignee: { gid: string } | null;
  memberships: { section?: { name?: string } }[];
}

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("SYNC_SECRET");
    const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
    if (!secret || got !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const token = Deno.env.get("ASANA_TOKEN");
    if (!token) return json({ ok: false, error: "ASANA_TOKEN not configured" }, 500);

    const { practice_id, project_id } = await req.json();
    if (!UUID_RE.test(practice_id || "")) return json({ ok: false, error: "valid practice_id required" }, 400);
    if (!project_id) return json({ ok: false, error: "project_id required" }, 400);

    // Pull tasks (with section membership + completion) from Asana.
    const fields = "name,completed,assignee,memberships.section.name";
    const res = await fetch(
      `https://app.asana.com/api/1.0/projects/${project_id}/tasks?opt_fields=${fields}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return json({ ok: false, error: `asana ${res.status}: ${await res.text()}` }, 502);
    const tasks: AsanaTask[] = (await res.json()).data || [];

    const rows = tasks.map((t, i) => ({
      practice_id,
      asana_task_id: t.gid,
      phase: t.memberships?.[0]?.section?.name || "Imported from Asana",
      name: t.name,
      status: t.completed ? "delivered" : (t.assignee ? "in_progress" : "promised"),
      delivered_at: t.completed ? new Date().toISOString() : null,
      sort: i,
    }));
    if (!rows.length) return json({ ok: true, upserted: 0, note: "no tasks in project" });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb
      .from("deliverables")
      .upsert(rows, { onConflict: "practice_id,asana_task_id" })
      .select("id");
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, tasks_seen: tasks.length, upserted: data?.length ?? rows.length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
