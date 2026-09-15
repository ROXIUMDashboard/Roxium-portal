# Rollback & Recovery

Two very different problems. **Do not treat them the same way.**

| | Frontend | Database |
|---|---|---|
| What it is | HTML/JS/CSS on Cloudflare Pages | Schema and data in Supabase |
| Reversible? | Yes, instantly | **Often not** |
| How | Rollback to a previous deployment | Forward-fix, or restore from backup |
| Risk | Very low | High |

---

## Frontend rollback — the normal case

Cloudflare Pages keeps every deployment. Rolling back re-points the domain at one
that already exists; it does not rebuild anything.

1. **Cloudflare dashboard ▸ Workers & Pages ▸ `roxium-portal` ▸ Deployments**
2. Filter to **Production**.
3. Find the last known-good deployment — the commit hash is shown, and matches
   what `https://roxium.com/version.json` reported before the bad release.
4. **⋯ ▸ Rollback** ▸ confirm.

Live within seconds. Then verify:

```
node scripts/smoke-test.mjs --url https://roxium.com --env production
```

**Then tell Claude.** A rollback is a pause, not a fix: `main` still contains the
bad commit and the next release would ship it again. The fix is a follow-up pull
request (or `git revert`), through the normal staging-then-approve path.

### Caveat: a rollback does not revert Edge Functions
A production release deploys the frontend **and** the Supabase Edge Functions.
Rolling back Pages restores the frontend only. If the problem is in a function,
re-release the previous commit through **Release to PRODUCTION** — that
redeploys the functions at that commit too.

### Caveat: a rollback does not revert the database
See below.

---

## Database recovery — forward-fix by default

**Do not assume a migration can be reversed.** Most of this project's migrations
are additive (`add column if not exists`, `create or replace function`), and
additive changes are safe to leave in place. Destructive changes — dropping a
column, rewriting data — usually cannot be undone without a restore, because the
old values no longer exist.

### The default: forward-fix
Write a **new** migration that corrects the problem, take it through staging, and
release it. This is almost always right, and it is the only approach that leaves
a truthful history.

### When a restore is genuinely required
Only when data has been lost or corrupted and cannot be recomputed.

1. **Stop writes first.** Roll the frontend back so the broken code is not making
   things worse.
2. **Supabase ▸ Database ▸ Backups.** Note the restore point.
3. **Take a fresh backup before restoring** — restoring is itself destructive.
4. Restore, then immediately run
   `node scripts/verify-production-schema.mjs` and
   `scripts/verify-production-schema.sql` to confirm the schema is what the code
   expects.
5. Anything written between the restore point and now is **gone**. Work out what
   was lost before you restore, not after.

A restore is a serious, customer-affecting event. Do not do it alone or in a
hurry.

### Rehearse it on staging
Staging exists precisely so a risky migration can be applied, broken and
recovered with nothing at stake. Any migration you are nervous about should be
run on staging first — and `npm run reset:staging` puts staging back to a known
baseline in one command.

---

## Quick reference

| Symptom | Action |
|---|---|
| Site looks wrong / broken layout / JS errors | Frontend rollback |
| A feature misbehaves but data is intact | Frontend rollback, then forward-fix |
| Emails or OAuth broken after a release | Re-release the previous commit (restores functions) |
| A migration added something wrong | Forward-fix migration |
| A migration destroyed data | Stop writes, assess loss, consider restore |
| Not sure | Frontend rollback first — it is safe and reversible |
