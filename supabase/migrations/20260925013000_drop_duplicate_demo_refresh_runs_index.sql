-- FLA-231: drop the exact duplicate index on public.demo_refresh_runs.
--
-- The baseline (20260727230606_baseline.sql) deliberately reproduces the
-- observed production before-state, which carried two indexes with the same
-- definition:
--
--   public.idx_public_demo_refresh_runs_preset_sport_created   <- dropped here
--   public.public_demo_refresh_runs_preset_sport_created_at_idx <- survivor
--
-- Both are `btree (preset_id, sport, created_at desc)` on
-- public.demo_refresh_runs, and neither backs a constraint. A read-only
-- production inspection on 2026-09-25 found both valid at about 1 MB each,
-- with 0 index scans on the dropped candidate since the last statistics reset
-- and 63 on the survivor. The planner already chooses the survivor, so the
-- duplicate only costs write amplification, vacuum work, and storage. Removing
-- it also clears the one expected duplicate-index advisor warning.
--
-- This is a plain `drop index`, not `drop index concurrently`: Supabase runs
-- each migration inside a transaction, where CONCURRENTLY is not allowed. The
-- plain drop takes an ACCESS EXCLUSIVE lock on demo_refresh_runs, but only for
-- as long as it takes to remove a ~1 MB index, which is well under a second.
-- `lock_timeout` bounds the wait for that lock, so a long-running transaction
-- on the table fails this migration fast instead of queueing demo reads and
-- writes behind it.
--
-- The preflight refuses to run unless both indexes exist, the survivor is
-- valid, the two are structurally identical (the same pg_index comparison
-- supabase/tests/reproducibility.sql used for the before-state, plus
-- uniqueness), and nothing but the index's normal automatic dependency on its
-- table references the candidate. Applied a second time, or to a database that
-- never had the duplicate, it raises instead of silently doing nothing. The
-- drop deliberately has no `if exists` for the same reason. The postcheck
-- refuses to commit unless the candidate is gone and the survivor is still
-- present and valid.
--
-- Rollback: supabase/rollback/20260925_rollback_drop_duplicate_demo_refresh_runs_index.sql.
-- Hosted application remains a separate approval gate.

begin;

set local lock_timeout = '5s';

do $preflight$
declare
  candidate_oid oid := pg_catalog.to_regclass(
    'public.idx_public_demo_refresh_runs_preset_sport_created'
  );
  survivor_oid oid := pg_catalog.to_regclass(
    'public.public_demo_refresh_runs_preset_sport_created_at_idx'
  );
  table_oid oid := pg_catalog.to_regclass('public.demo_refresh_runs');
  offending_count integer;
begin
  if candidate_oid is null or survivor_oid is null or table_oid is null then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'FLA-231 preflight: expected public.demo_refresh_runs with both duplicate indexes; public.demo_refresh_runs %s, candidate public.idx_public_demo_refresh_runs_preset_sport_created %s, survivor public.public_demo_refresh_runs_preset_sport_created_at_idx %s',
        case when table_oid is null then 'missing' else 'present' end,
        case when candidate_oid is null then 'missing' else 'present' end,
        case when survivor_oid is null then 'missing' else 'present' end
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as i
    join pg_catalog.pg_class as c on c.oid = i.indexrelid
    where i.indexrelid = candidate_oid
      and c.relkind = 'i'
      and i.indrelid = table_oid
  ) or not exists (
    select 1
    from pg_catalog.pg_index as i
    join pg_catalog.pg_class as c on c.oid = i.indexrelid
    where i.indexrelid = survivor_oid
      and c.relkind = 'i'
      and i.indrelid = table_oid
  ) then
    raise exception using
      errcode = '55000',
      message = 'FLA-231 preflight: both named objects must be plain indexes on public.demo_refresh_runs';
  end if;

  if not (
    select i.indisvalid
    from pg_catalog.pg_index as i
    where i.indexrelid = survivor_oid
  ) then
    raise exception using
      errcode = '55000',
      message = 'FLA-231 preflight: survivor public.public_demo_refresh_runs_preset_sport_created_at_idx is not valid; refusing to drop its duplicate';
  end if;

  if (
    select row(
      i.indrelid,
      i.indkey,
      i.indcollation,
      i.indclass,
      i.indoption,
      pg_catalog.pg_get_expr(i.indexprs, i.indrelid),
      pg_catalog.pg_get_expr(i.indpred, i.indrelid),
      i.indisunique
    )
    from pg_catalog.pg_index as i
    where i.indexrelid = candidate_oid
  ) is distinct from (
    select row(
      i.indrelid,
      i.indkey,
      i.indcollation,
      i.indclass,
      i.indoption,
      pg_catalog.pg_get_expr(i.indexprs, i.indrelid),
      pg_catalog.pg_get_expr(i.indpred, i.indrelid),
      i.indisunique
    )
    from pg_catalog.pg_index as i
    where i.indexrelid = survivor_oid
  ) then
    raise exception using
      errcode = '55000',
      message = 'FLA-231 preflight: the candidate and survivor indexes are not structurally identical; refusing to drop';
  end if;

  select count(*)
  into offending_count
  from pg_catalog.pg_constraint as con
  where con.conindid = candidate_oid;

  if offending_count <> 0 then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'FLA-231 preflight: %s constraint(s) reference the candidate index; refusing to drop',
        offending_count
      );
  end if;

  -- Anything that depends on the candidate, or any dependency of the candidate
  -- other than its automatic dependency on columns of its own table.
  select count(*)
  into offending_count
  from pg_catalog.pg_depend as d
  where (
      d.refclassid = 'pg_catalog.pg_class'::regclass
      and d.refobjid = candidate_oid
    )
    or (
      d.classid = 'pg_catalog.pg_class'::regclass
      and d.objid = candidate_oid
      and not (
        d.refclassid = 'pg_catalog.pg_class'::regclass
        and d.refobjid = table_oid
        and d.deptype = 'a'
      )
    );

  if offending_count <> 0 then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'FLA-231 preflight: %s unexpected pg_depend row(s) reference the candidate index; refusing to drop',
        offending_count
      );
  end if;
end;
$preflight$;

drop index public.idx_public_demo_refresh_runs_preset_sport_created;

do $postcheck$
begin
  if pg_catalog.to_regclass(
    'public.idx_public_demo_refresh_runs_preset_sport_created'
  ) is not null then
    raise exception using
      errcode = '55000',
      message = 'FLA-231 postcheck: public.idx_public_demo_refresh_runs_preset_sport_created still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as i
    where i.indexrelid = pg_catalog.to_regclass(
        'public.public_demo_refresh_runs_preset_sport_created_at_idx'
      )
      and i.indrelid = pg_catalog.to_regclass('public.demo_refresh_runs')
      and i.indisvalid
  ) then
    raise exception using
      errcode = '55000',
      message = 'FLA-231 postcheck: survivor public.public_demo_refresh_runs_preset_sport_created_at_idx is missing or not valid';
  end if;
end;
$postcheck$;

commit;
