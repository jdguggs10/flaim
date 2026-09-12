-- FLA-359: give `public.espn_credentials` the `created_at` column that every
-- other credential/connection table already has.
--
-- What exists today, verified against the live hosted database on 2026-09-09:
--
--   * `public.espn_credentials` carries only `updated_at`
--     (timestamptz, nullable, default `timezone('utc'::text, now())`). It is
--     the sole connection-owning table with no creation timestamp.
--   * `public.yahoo_credentials` and `public.sleeper_connections` both carry
--     `created_at timestamptz default now()` alongside `updated_at`, and
--     `public.espn_leagues` carries a `created_at` of its own.
--
-- Consequence of the gap: there is no way to ask when an ESPN connection was
-- first established. `updated_at` moves on every credential re-sync, so it
-- answers "when was this last touched", never "when did this user connect".
-- Any tenure, cohort, or connection-funnel question involving ESPN is
-- unanswerable, while the same question for Yahoo and Sleeper is trivial.
--
-- Design decisions:
--
--   * `not null default now()`. The default mirrors the sibling credential
--     tables; `not null` is deliberately stricter than they are, because a
--     nullable creation timestamp would reintroduce the exact "we cannot tell
--     when" gap this migration exists to close. Postgres 11+ stores a
--     non-volatile default as a table-level attribute, evaluated once at
--     ADD COLUMN time and handed to existing rows on read, so this is a
--     metadata-only change with no table rewrite. `now()` qualifies: it is
--     STABLE, not VOLATILE. It is not a literal constant — it is evaluated,
--     just only once — which is why every pre-existing row ends up sharing
--     this migration's run time (see the limitation note below).
--   * No trigger and no application write. `EspnSupabaseStorage.setCredentials`
--     is the only writer, and it inserts a row only when none exists and
--     otherwise UPDATEs an explicit column list that does not name
--     `created_at`. The default therefore stamps first connection and nothing
--     moves it afterwards. A disconnect deletes the row, so a later reconnect
--     correctly stamps a new creation time.
--
-- KNOWN, ACCEPTED LIMITATION — no retroactive backfill:
--
--   Every row that exists when this migration runs receives `now()`, i.e. the
--   migration's own run time, not the moment that ESPN connection was actually
--   established. Nothing in the database records the true value: `updated_at`
--   is a last-touched timestamp that credential re-syncs have already moved,
--   and `espn_leagues.created_at` is a per-league row timestamp that manual
--   league replacement has historically reset. Synthesizing an earlier date
--   from either would manufacture a number that looks authoritative and is
--   not. Following the same no-backfill principle as FLA-358, history starts
--   at this migration and is honest from here forward. Readers computing ESPN
--   tenure or cohorts must treat pre-migration rows as censored at this
--   timestamp rather than as same-day connections.

begin;

-- The ADD COLUMN itself is metadata-only, but it still takes an
-- ACCESS EXCLUSIVE lock on `espn_credentials` for the moment it runs, and
-- while it waits for that lock it queues every other reader and writer behind
-- it. If a long-running transaction already holds a conflicting lock, an
-- unbounded wait would take the ESPN credential path down for as long as that
-- transaction lives. Fail fast instead: give up after 5s and let the migration
-- be retried at a quieter moment.
set local lock_timeout = '5s';

alter table public.espn_credentials
  add column created_at timestamptz not null default now();

comment on column public.espn_credentials.created_at is
  $$When this ESPN connection was established. Rows that predate this column carry the FLA-359 migration run time, not a true creation time, because none was recorded anywhere; treat them as censored at that timestamp rather than as connections made that day. Written only by the column default, so it never moves for the life of a row.$$;

commit;
