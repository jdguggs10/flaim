-- Reviewed rollback artifact for
-- 20260925180000_add_hide_league_widget_preference.sql (FLA-277).
--
-- This file lives OUTSIDE supabase/migrations on purpose, exactly like the
-- artifacts in supabase/cron: a local `supabase db reset` applies every
-- timestamped file in supabase/migrations, so a rollback stored there would
-- undo the migration it is meant to reverse on every reset. Apply this file
-- only as a deliberate, separately approved operation.
--
-- The migration added one column and its comment, so the rollback is a single
-- drop. It DISCARDS DATA: every user's saved hide-widget choice is lost and
-- every league widget shows again. The auth-worker keeps serving without the
-- column (it reads the preference as false), but the /leagues toggle fails to
-- save until the column is restored.

begin;

set local lock_timeout = '5s';

alter table public.user_preferences
  drop column if exists hide_league_widget;

commit;
