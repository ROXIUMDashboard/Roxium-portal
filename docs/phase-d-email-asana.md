# Phase D — Production email (Resend) + Asana integration

Two integrations, both as Supabase Edge Functions. Code is in the repo; going live
needs your secrets + a deploy (this can't be done from the sandboxed agent).

---

## 1. Resend email

Sends client emails when the team posts an update (`notify-client`) or a finished
video (`notify-video-ready`). The portal already calls both; they were no-ops until
now because the functions didn't exist.

### A. Verify a sending domain (one-time, in Resend)
1. Resend dashboard → **Domains → Add domain** (e.g. `roxium.com` or `mail.roxium.com`).
2. Add the **SPF, DKIM and DMARC** DNS records Resend shows to your DNS host.
3. Wait for **Verified**. You can then send from any address `@that-domain`
   (e.g. `updates@roxium.com`, `video@roxium.com`) — that covers "multiple senders".

### B. Run the migration
`migrations/2026-06-23_phase_d_email.sql` — adds `practice_member_emails()` (the
function looks up a practice's client emails server-side; not exposed to clients).

### C. Set secrets + deploy
```bash
supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="ROXIUM <updates@roxium.com>"
supabase functions deploy notify-client       --project-ref nchtmeqsjkpcvtuscxfy
supabase functions deploy notify-video-ready   --project-ref nchtmeqsjkpcvtuscxfy
```
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected. Deploy **with** JWT
verification (default) so only signed-in team users can trigger sends.

### Env summary
| Var | Where | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Supabase function secret | Resend API auth |
| `EMAIL_FROM` | Supabase function secret | Verified sender, e.g. `ROXIUM <updates@roxium.com>` |

### Local dev
`supabase functions serve notify-client --env-file ./supabase/.env.local` with
`RESEND_API_KEY`/`EMAIL_FROM` in that file. Resend has a test mode for safe sends.

---

## 2. Asana → promised / delivered

`asana-sync` imports an Asana project's tasks into a practice's deliverables — the
end-goal mapping:

| Asana | → | Portal |
|---|---|---|
| section | → | deliverable `phase` |
| task | → | deliverable (`name`), idempotent via `asana_task_id` |
| completed | → | status `delivered` |
| has assignee (not done) | → | `in_progress` |
| otherwise | → | `promised` |

### Setup
1. Run `migrations/2026-06-23_phase_d_email.sql` (adds `deliverables.asana_task_id`).
2. Create an Asana **Personal Access Token** (Asana → Settings → Apps → Developer).
3. Secrets + deploy:
   ```bash
   supabase secrets set ASANA_TOKEN=1/xxx SYNC_SECRET=<shared-secret>
   supabase functions deploy asana-sync --no-verify-jwt --project-ref nchtmeqsjkpcvtuscxfy
   ```
4. Trigger (per practice/project):
   ```bash
   curl -X POST ".../functions/v1/asana-sync" -H "x-sync-key: <SYNC_SECRET>" \
     -H "Content-Type: application/json" \
     -d '{"practice_id":"<uuid>","project_id":"<asana-project-gid>"}'
   ```
   Re-running updates the same deliverables (no duplicates). Schedule it with
   `pg_cron` the same way `sync-coefficient` is scheduled if you want it automatic.

### Notes / future
- The mapping rules live in one place (`asana-sync/index.ts`) so they're easy to
  evolve (e.g. map Asana custom fields → owner_seat, or a "delivered" section).
- Pagination: the scaffold pulls the first 100 tasks; add Asana cursor paging when
  a project grows past that.
