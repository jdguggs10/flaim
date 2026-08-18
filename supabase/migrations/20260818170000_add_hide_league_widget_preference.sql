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
-- Applying this migration to any hosted database remains a separate
-- approval gate.

alter table public.user_preferences
  add column if not exists hide_league_widget boolean not null default false;

comment on column public.user_preferences.hide_league_widget is
  'When true, get_user_session tells the ChatGPT/Claude league widget to render nothing (FLA-277). Leagues are still returned to the model.';
