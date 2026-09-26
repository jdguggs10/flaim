-- FLA-277: add a per-user preference to hide the league widget rendered by
-- the get_user_session tool in ChatGPT and Claude.
--
-- This is Mechanism B only (per-response suppression): get_user_session adds
-- a widget.hidden flag to its structured content when the preference is
-- true, and the widget script renders nothing and reports zero size. It does
-- not touch what leagues are returned to the model -- only whether the
-- visual card renders. Suppressing the widget descriptor itself at
-- tools/list (Mechanism A) is a separate, later change that can read this
-- same column.
--
-- The production database already has this exact column: it was applied out
-- of band before this file was committed. The statement is therefore
-- `add column if not exists`, so running this file there changes nothing.
-- Applying it to any other hosted database remains a separate approval gate.
-- The auth-worker reads the preference as false when the column is absent,
-- so this migration and the Worker deploy can land in either order.

begin;

-- The constant default makes ADD COLUMN metadata-only (no table rewrite), but
-- ALTER TABLE still takes an ACCESS EXCLUSIVE lock on user_preferences, even
-- when the column already exists, and queues every preference read behind it
-- while it waits. Fail fast instead of stalling get_user_session behind a
-- long-running transaction.
set local lock_timeout = '5s';

alter table public.user_preferences
  add column if not exists hide_league_widget boolean not null default false;

comment on column public.user_preferences.hide_league_widget is
  'When true, get_user_session tells the ChatGPT/Claude league widget to render nothing (FLA-277). Leagues are still returned to the model.';

commit;
