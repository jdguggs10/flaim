-- Reviewed rollback artifact for
-- 20260924200000_add_signups_hourly_paths.sql (FLA-413).
--
-- This file lives OUTSIDE supabase/migrations on purpose, exactly like the
-- artifacts in supabase/cron: a local `supabase db reset` applies every
-- timestamped file in supabase/migrations, so a rollback stored there would
-- undo the migration it is meant to reverse on every reset. Apply this file
-- only as a deliberate, separately approved operation.
--
-- The migration added one aggregate view and nothing else, so the rollback is
-- a single drop. No table, function, or row is touched, and no data is lost:
-- every value the view returned is recomputed from public.signup_log.
--
-- Pause the internal hourly acquisition monitor that reads this view BEFORE
-- applying this file. Once the view is gone every read fails, and after a few
-- consecutive failed hours the monitor reports its data source as unusable.

begin;

drop view if exists analytics.signups_hourly_paths;

commit;
