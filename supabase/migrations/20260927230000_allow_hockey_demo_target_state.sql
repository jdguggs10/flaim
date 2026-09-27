-- FLA-425: allow hockey rows in the homepage-demo gate table.
--
-- demo_target_state records the per-platform, per-sport public-enable flag
-- and expected version tags. Its sport CHECK was created for baseball and
-- football only (20260805112500_add_platform_to_demo_tables.sql), so no
-- hockey gate row can be inserted. This forward migration replaces that one
-- constraint with the same name and a list that adds hockey. Nothing else
-- changes: no row, column, grant, policy, or index. The other demo tables
-- carry no sport constraint.
--
-- Widening the constraint does not enable anything by itself. A hockey
-- target only becomes public once a public_enabled gate row exists at the
-- expected versions AND every one of its presets has a usable cache row.
-- Applying this migration to any hosted database remains a separate approval
-- gate.

begin;

-- Both statements take an ACCESS EXCLUSIVE lock on demo_target_state, which
-- the public capabilities check reads. The table holds a handful of rows, so
-- re-validating the new CHECK is instant; fail fast rather than queue those
-- reads behind a long-running transaction.
set local lock_timeout = '5s';

alter table public.demo_target_state
  drop constraint demo_target_state_sport_check;

alter table public.demo_target_state
  add constraint demo_target_state_sport_check
    check (sport in ('baseball', 'football', 'hockey'));

commit;
