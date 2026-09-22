# Staging Data

Staging uses **deterministic synthetic fixtures**, not a copy of production.

You asked for "the exact same data". The safe reading of that — and what is built
here — is the **same data *shape* and the same operational scenarios**, with
invented practices and people. That gives realistic dashboards to review without
ever putting a real surgeon's name, email or performance data in a test system.

---

## Using it

**Normally you do not run anything.** The fixtures are loaded for you:

| To | Do this |
|---|---|
| Load them the first time | **Actions ▸ Initialize STAGING** (part of first-time setup) |
| Reset them to the baseline | **Actions ▸ Reset STAGING Data ▸ Run workflow**, type `RESET STAGING DATA` |
| See what a reset would do, changing nothing | the same workflow with **Preview only** ticked |

<details>
<summary>Running the seeder directly (engineers only)</summary>

```bash
# See exactly what would be created. Touches nothing, needs no credentials.
node scripts/seed-staging.mjs --dry-run

# Seed (idempotent — safe to re-run; updates rather than duplicates)
STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... npm run seed:staging

# Delete the fixtures and re-create them from scratch
STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... npm run reset:staging
```

`scripts/lib/staging-guard.mjs` runs before the first write either way, so the
seeder refuses the production project however it is invoked.

</details>

Every row carries a **deterministic id** derived from a fixed namespace, so
re-seeding updates the same rows and `--reset` deletes exactly what the seeder
created — nothing else in the database is touched.

---

## It cannot run against production

`scripts/lib/staging-guard.mjs` runs **before anything else** and is
deny-by-default:

- the production project ref is hard-refused (also upper-case, with a trailing
  slash, and every other variation)
- a URL that is not `https://<ref>.supabase.co` is refused
- a missing URL is refused
- an optional allowlist can narrow it further

Verified: pointing the seeder at production exits `1` with
`REFUSED (production-target)` before a single write. Covered by
`tests/unit/staging-guard.test.mjs` (13 assertions) and
`tests/unit/staging-fixtures.test.mjs`.

---

## The four practices

| Practice | Shape |
|---|---|
| **Northstar Facial Surgery (TEST)** | Healthy, mature. 8 months of KPI history, most deliverables shipped, a working Meta connection, recent updates, **two users** (owner + staff). |
| **Brightpath Aesthetics (TEST)** | Brand new. Nine days in, Phase 0 running, one item waiting on ROXIUM and one on the client, an invitation sent but not accepted. |
| **Cedar Ridge Plastic Surgery (TEST)** | In trouble. Phase overdue, deliverable overdue, video overdue, a video blocked on the surgeon, a **failed** marketing connection, no update in 47 days. |
| **Harbor Point Cosmetic (TEST)** | The isolation control. Its own user and its own private deliverable, used to prove one practice cannot see another's data. |

## The eight users

All on the reserved **`.test`** TLD, which can never resolve on the public
internet — so a stray email can never reach a real person.

| Email | Role |
|---|---|
| `team.ops@roxium.test` | ROXIUM team (platform admin) |
| `owner.northstar@roxium.test` | client, practice owner |
| `staff.northstar@roxium.test` | client, member — proves multi-user practices |
| `owner.brightpath@roxium.test` | client, owner |
| `owner.cedarridge@roxium.test` | client, owner |
| `owner.harborpoint@roxium.test` | client, owner — the isolation control |
| `pending.applicant@roxium.test` | signed up, **no membership** → pending approval |
| `revoked.former@roxium.test` | access **revoked** → rejected, no membership |
| `invited.newstaff@roxium.test` | invitation **sent**, not yet accepted |

## Scenario coverage

All 22 requested scenarios are covered, and
`tests/unit/staging-fixtures.test.mjs` **fails the build** if a fixture edit
silently drops one.

| # | Scenario | Where |
|---|---|---|
| 1 | Healthy client | Northstar |
| 2 | New onboarding client | Brightpath |
| 3 | Phase approaching deadline | Brightpath (Phase 0, day 9 of 14) |
| 4 | Phase overdue | Cedar Ridge (Phase 2, past red) |
| 5 | Deliverable in progress | Brightpath |
| 6 | Deliverable waiting on ROXIUM | Brightpath |
| 7 | Deliverable waiting on client | Cedar Ridge |
| 8 | Deliverable completed | Northstar |
| 9 | Video in progress | Northstar (editing) |
| 10 | Video approaching deadline | Cedar Ridge (shoot in 4 days) |
| 11 | Video overdue | Cedar Ridge (15 days past) |
| 12 | Video waiting on client | Cedar Ridge (blocked on approval) |
| 13 | Client with recent updates | Northstar (yesterday) |
| 14 | Stale / no recent update | Cedar Ridge (47 days) |
| 15 | Pending account approval | `pending.applicant@roxium.test` |
| 16 | Invited account | `invited.newstaff@roxium.test` |
| 17 | Revoked / inactive account | `revoked.former@roxium.test` |
| 18 | Healthy marketing connection | Northstar (Meta, synced 2h ago) |
| 19 | Failed marketing connection | Cedar Ridge (expired token) |
| 20 | KPI history for realistic dashboards | Northstar 8 months, Cedar Ridge 6, Harbor Point 3 |
| 21 | Multiple users in one practice | Northstar (owner + staff) |
| 22 | Multiple practices / tenant isolation | all four, Harbor Point as the control |

## What is never seeded

- real customer names, emails, phone numbers or addresses
- production OAuth tokens or API credentials
- real uploaded files
- authentication secrets of any kind
- anything copied from the production database

---

## If we ever need production-shaped debugging data

**Not implemented, and not needed today.** Synthetic fixtures are safer and
cheaper to maintain. Should a genuine production-shaped debugging case arise, the
sanitisation path must be built first, and must run **inside** the production
security boundary — a dump is never moved before it is sanitised.

It would have to replace or remove, at minimum:

| Field | Treatment |
|---|---|
| `profiles.full_name`, `auth.users.email` | replace with deterministic pseudonyms on `.test` |
| `practices.name` | replace with generated practice names |
| phone numbers, addresses (wherever added) | remove |
| `platform_tokens.*`, `platform_connections.composio_connection_id` | **drop the rows entirely** |
| `practices.workbook_sheet_id`, `sheet_sources.csv_url`/`sheet_id` | remove — they point at real Drive documents |
| `platform_connections.external_account_id`/`external_account_name` | replace with synthetic ids |
| `video_pipeline.video_url`, storage objects | remove |
| `activity.message`, `notifications.message`, `video_comments.body` | free text that can name real patients — replace, do not attempt to redact |
| `deliverables.asana_task_id` | remove |

Preserve: row counts, foreign keys, dates, statuses, phase/stage distributions and
KPI magnitudes — those are what make the data useful for debugging.

Rules that would apply: sanitise before export, never the reverse; the output is
still confidential; it goes only to staging, never to a laptop; and it is deleted
on a fixed schedule. Until then, **use the fixtures**.
