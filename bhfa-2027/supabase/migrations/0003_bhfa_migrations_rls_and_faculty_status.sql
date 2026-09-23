-- ---------------------------------------------------------------------------
-- BHFA 2027 — close two gaps found while verifying the move to the dedicated
-- BHFA project. Additive and idempotent.
-- ---------------------------------------------------------------------------

-- 1. bhfa_migrations is created by scripts/apply-migrations.mjs, not by 0001,
--    so it never got the RLS every other bhfa_* table has. With RLS off, the
--    public (browser) key could read it — and, worse, write it: deleting a row
--    would make a migration replay, inserting one would make a migration be
--    skipped. RLS on with no policies leaves it to the server key alone, like
--    everything else here.
create table if not exists bhfa_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
alter table bhfa_migrations enable row level security;

-- 2. 0002 marks the two live-surgery leads the program names as confirmed. On a
--    freshly provisioned database it ran before the programme was copied in, so
--    that UPDATE matched no rows. It is repeated here, after the data exists.
--    Only rows nobody has triaged yet are touched.
update bhfa_faculty
   set status = 'confirmed'
 where status is null
   and lower(name) in ('dr. marc mani', 'dr. ashkan ghavami');
