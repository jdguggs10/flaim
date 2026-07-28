-- Behavioral and privilege proof for service-role-only token RPCs.
--
-- Run only against a reset local database. Every credential-shaped value is
-- synthetic, and the transaction rolls back all test rows.

begin;

do $proof$
declare
  function_oid oid;
  function_count integer := 0;
begin
  for function_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'create_mcp_oauth_state',
        'consume_mcp_oauth_state',
        'claim_mcp_oauth_code',
        'find_mcp_oauth_access_token',
        'claim_mcp_oauth_refresh_token',
        'revoke_mcp_oauth_access_token',
        'consume_yahoo_oauth_state',
        'acquire_yahoo_refresh_lease',
        'recover_yahoo_credentials'
      ])
  loop
    function_count := function_count + 1;

    if not has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'service_role cannot execute token RPC %', function_oid::regprocedure;
    end if;

    if has_function_privilege('anon', function_oid, 'EXECUTE')
       or has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'public API role can execute token RPC %', function_oid::regprocedure;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(p.proacl) a
      where p.oid = function_oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute token RPC %', function_oid::regprocedure;
    end if;

    if exists (
      select 1
      from pg_proc p
      where p.oid = function_oid
        and (
          p.prosecdef
          or not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
        )
    ) then
      raise exception 'token RPC is not a search-path-safe security invoker: %',
        function_oid::regprocedure;
    end if;
  end loop;

  if function_count <> 9 then
    raise exception 'expected 9 token RPCs, found %', function_count;
  end if;
end;
$proof$;

insert into public.oauth_codes (
  code,
  user_id,
  redirect_uri,
  scope,
  expires_at,
  resource
) values (
  'synthetic-test-oauth-code',
  'synthetic-test-user',
  'https://example.invalid/oauth/callback',
  'mcp:read',
  now() + interval '1 hour',
  'https://example.invalid/mcp'
);

insert into public.oauth_tokens (
  access_token,
  user_id,
  scope,
  expires_at,
  refresh_token,
  refresh_token_expires_at,
  resource,
  client_name
) values
(
  'synthetic-test-access-token',
  'synthetic-test-user',
  'mcp:read',
  now() + interval '1 hour',
  'synthetic-test-unused-refresh-token',
  now() + interval '1 hour',
  'https://example.invalid/mcp',
  'Synthetic Test Client'
),
(
  'synthetic-test-refresh-access-token',
  'synthetic-test-user',
  'mcp:read',
  now() + interval '1 hour',
  'synthetic-test-refresh-token',
  now() + interval '1 hour',
  'https://example.invalid/mcp',
  'Synthetic Test Client'
);

insert into public.platform_oauth_states (
  state,
  platform,
  clerk_user_id,
  redirect_after,
  expires_at
) values (
  'synthetic-test-yahoo-state',
  'yahoo',
  'synthetic-test-user',
  '/connect',
  now() + interval '1 hour'
);

insert into public.yahoo_credentials (
  clerk_user_id,
  access_token,
  refresh_token,
  expires_at,
  app_fingerprint
) values (
  'synthetic-test-user',
  'synthetic-test-yahoo-access-token',
  'synthetic-test-yahoo-refresh-token',
  now() + interval '1 hour',
  'synthetic-test-fingerprint'
);

set local role service_role;

do $proof$
declare
  claimed_count integer;
  claimed_user text;
  claimed_scope text;
  claimed_resource text;
  claimed_client text;
  claimed_expiry timestamptz;
begin
  if not public.create_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-test-binding',
    now() + interval '1 hour'
  ) then
    raise exception 'failed to create MCP OAuth state';
  end if;

  if not public.create_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-test-binding',
    now() + interval '1 hour'
  ) then
    raise exception 'identical MCP OAuth state retry was rejected';
  end if;

  if public.create_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-different-binding',
    now() + interval '1 hour'
  ) then
    raise exception 'mismatched MCP OAuth state retry was accepted';
  end if;

  if public.consume_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-different-binding'
  ) then
    raise exception 'mismatched MCP OAuth state claim succeeded';
  end if;

  if not public.consume_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-test-binding'
  ) then
    raise exception 'valid MCP OAuth state claim failed';
  end if;

  if public.consume_mcp_oauth_state(
    'synthetic-test-mcp-state',
    'https://example.invalid/oauth/callback',
    'synthetic-test-binding'
  ) then
    raise exception 'MCP OAuth state replay succeeded';
  end if;

  select count(*)
  into claimed_count
  from public.claim_mcp_oauth_code('synthetic-test-oauth-code');
  if claimed_count <> 1 then
    raise exception 'first MCP OAuth code claim returned % rows', claimed_count;
  end if;

  select count(*)
  into claimed_count
  from public.claim_mcp_oauth_code('synthetic-test-oauth-code');
  if claimed_count <> 0 then
    raise exception 'MCP OAuth code replay returned % rows', claimed_count;
  end if;

  select
    user_id,
    scope,
    resource,
    client_name,
    expires_at
  into
    claimed_user,
    claimed_scope,
    claimed_resource,
    claimed_client,
    claimed_expiry
  from public.find_mcp_oauth_access_token('synthetic-test-access-token');

  if claimed_user <> 'synthetic-test-user'
     or claimed_scope <> 'mcp:read'
     or claimed_resource <> 'https://example.invalid/mcp'
     or claimed_client <> 'Synthetic Test Client'
     or claimed_expiry <= now() then
    raise exception 'MCP access-token lookup returned unexpected metadata';
  end if;

  if not public.revoke_mcp_oauth_access_token('synthetic-test-access-token') then
    raise exception 'MCP access-token revoke failed';
  end if;

  if not public.revoke_mcp_oauth_access_token('synthetic-missing-access-token') then
    raise exception 'idempotent MCP access-token revoke failed';
  end if;

  if not exists (
    select 1
    from public.oauth_tokens
    where access_token = 'synthetic-test-access-token'
      and revoked_at is not null
  ) then
    raise exception 'MCP access-token revoke did not persist';
  end if;

  select count(*)
  into claimed_count
  from public.claim_mcp_oauth_refresh_token('synthetic-test-refresh-token');
  if claimed_count <> 1 then
    raise exception 'first MCP refresh-token claim returned % rows', claimed_count;
  end if;

  select count(*)
  into claimed_count
  from public.claim_mcp_oauth_refresh_token('synthetic-test-refresh-token');
  if claimed_count <> 0 then
    raise exception 'MCP refresh-token replay returned % rows', claimed_count;
  end if;

  if not exists (
    select 1
    from public.oauth_tokens
    where refresh_token = 'synthetic-test-refresh-token'
      and revoked_at is not null
  ) then
    raise exception 'MCP refresh-token claim did not revoke the old row';
  end if;
end;
$proof$;

do $proof$
declare
  claimed_count integer;
  state_user text;
  state_platform text;
  state_redirect text;
  state_expiry timestamptz;
begin
  select
    clerk_user_id,
    platform,
    redirect_after,
    expires_at
  into
    state_user,
    state_platform,
    state_redirect,
    state_expiry
  from public.consume_yahoo_oauth_state('synthetic-test-yahoo-state');

  if state_user <> 'synthetic-test-user'
     or state_platform <> 'yahoo'
     or state_redirect <> '/connect'
     or state_expiry <= now() then
    raise exception 'Yahoo OAuth state claim returned unexpected metadata';
  end if;

  select count(*)
  into claimed_count
  from public.consume_yahoo_oauth_state('synthetic-test-yahoo-state');
  if claimed_count <> 0 then
    raise exception 'Yahoo OAuth state replay returned % rows', claimed_count;
  end if;

  if not public.acquire_yahoo_refresh_lease(
    'synthetic-test-user',
    'synthetic-owner-one',
    now() + interval '1 minute',
    'synthetic-test-yahoo-refresh-token'
  ) then
    raise exception 'first Yahoo refresh lease claim failed';
  end if;

  if public.acquire_yahoo_refresh_lease(
    'synthetic-test-user',
    'synthetic-owner-two',
    now() + interval '1 minute',
    'synthetic-test-yahoo-refresh-token'
  ) then
    raise exception 'second Yahoo refresh lease claim succeeded';
  end if;

  if public.recover_yahoo_credentials(
    'synthetic-test-user',
    'synthetic-recovered-access-token',
    'synthetic-recovered-refresh-token',
    now() + interval '1 hour',
    'synthetic-recovered-fingerprint',
    'synthetic-test-yahoo-refresh-token'
  ) then
    raise exception 'Yahoo recovery ignored an active refresh lease';
  end if;

  update public.yahoo_credentials
  set refresh_lease_expires_at = now() - interval '1 minute'
  where clerk_user_id = 'synthetic-test-user';

  if public.recover_yahoo_credentials(
    'synthetic-test-user',
    'synthetic-recovered-access-token',
    'synthetic-recovered-refresh-token',
    now() + interval '1 hour',
    'synthetic-recovered-fingerprint',
    'synthetic-test-yahoo-refresh-token'
  ) is not true then
    raise exception 'Yahoo recovery with the current refresh token failed';
  end if;

  if public.recover_yahoo_credentials(
    'synthetic-test-user',
    'synthetic-stale-access-token',
    null,
    now() + interval '1 hour',
    null,
    'synthetic-test-yahoo-refresh-token'
  ) then
    raise exception 'Yahoo recovery accepted a stale refresh token';
  end if;

  if not exists (
    select 1
    from public.yahoo_credentials
    where clerk_user_id = 'synthetic-test-user'
      and access_token = 'synthetic-recovered-access-token'
      and refresh_token = 'synthetic-recovered-refresh-token'
      and app_fingerprint = 'synthetic-recovered-fingerprint'
      and refresh_lease_owner is null
      and refresh_lease_expires_at is null
  ) then
    raise exception 'Yahoo credential recovery did not persist expected values';
  end if;
end;
$proof$;

reset role;

rollback;

select 'token RPC behavior and privileges verified' as result;
