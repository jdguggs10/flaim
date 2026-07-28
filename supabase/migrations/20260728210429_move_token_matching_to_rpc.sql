begin;

-- Keep OAuth and Yahoo credential values out of PostgREST filter URLs. These
-- functions run with the caller's privileges and are executable only by the
-- service role used by the Auth Worker.

create function public.create_mcp_oauth_state(
  p_state text,
  p_redirect_uri text,
  p_binding text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  insert into public.oauth_states (
    state,
    redirect_uri,
    client_id,
    expires_at
  )
  values (
    p_state,
    p_redirect_uri,
    p_binding,
    p_expires_at
  )
  on conflict (state) do nothing;

  if found then
    return true;
  end if;

  return exists (
    select 1
    from public.oauth_states s
    where s.state = p_state
      and s.redirect_uri = p_redirect_uri
      and s.client_id = p_binding
      and s.expires_at > pg_catalog.now()
  );
end;
$function$;

comment on function public.create_mcp_oauth_state(text, text, text, timestamptz)
  is 'Create an MCP OAuth state or accept an identical unexpired retry.';

create function public.consume_mcp_oauth_state(
  p_state text,
  p_redirect_uri text,
  p_binding text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  delete from public.oauth_states s
  where s.state = p_state
    and s.redirect_uri = p_redirect_uri
    and s.client_id = p_binding
    and s.expires_at > pg_catalog.now();

  return found;
end;
$function$;

comment on function public.consume_mcp_oauth_state(text, text, text)
  is 'Atomically consume one unexpired MCP OAuth state with its exact binding.';

create function public.claim_mcp_oauth_code(p_code text)
returns table (
  user_id text,
  redirect_uri text,
  code_challenge text,
  code_challenge_method text,
  scope text,
  resource text,
  expires_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $function$
  update public.oauth_codes c
  set used_at = pg_catalog.now()
  where c.code = p_code
    and c.used_at is null
    and c.expires_at > pg_catalog.now()
  returning
    c.user_id,
    c.redirect_uri,
    c.code_challenge,
    c.code_challenge_method,
    c.scope,
    c.resource,
    c.expires_at;
$function$;

comment on function public.claim_mcp_oauth_code(text)
  is 'Atomically claim one unexpired, unused MCP authorization code.';

create function public.find_mcp_oauth_access_token(p_access_token text)
returns table (
  user_id text,
  scope text,
  resource text,
  client_name text,
  expires_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    t.user_id,
    t.scope,
    t.resource,
    t.client_name,
    t.expires_at,
    t.revoked_at
  from public.oauth_tokens t
  where t.access_token = p_access_token;
$function$;

comment on function public.find_mcp_oauth_access_token(text)
  is 'Return validation metadata for one MCP access token.';

create function public.claim_mcp_oauth_refresh_token(p_refresh_token text)
returns table (
  user_id text,
  scope text,
  resource text,
  client_name text
)
language sql
volatile
security invoker
set search_path = ''
as $function$
  update public.oauth_tokens t
  set revoked_at = pg_catalog.now()
  where t.refresh_token = p_refresh_token
    and t.revoked_at is null
    and (
      t.refresh_token_expires_at is null
      or t.refresh_token_expires_at > pg_catalog.now()
    )
  returning
    t.user_id,
    t.scope,
    t.resource,
    t.client_name;
$function$;

comment on function public.claim_mcp_oauth_refresh_token(text)
  is 'Atomically consume one unexpired MCP refresh token and revoke its token row.';

create function public.revoke_mcp_oauth_access_token(p_access_token text)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $function$
  with revoked as (
    update public.oauth_tokens t
    set revoked_at = pg_catalog.now()
    where t.access_token = p_access_token
    returning 1
  )
  select true
  from (select count(*) from revoked) completed;
$function$;

comment on function public.revoke_mcp_oauth_access_token(text)
  is 'Idempotently revoke an MCP access token.';

create function public.consume_yahoo_oauth_state(p_state text)
returns table (
  clerk_user_id text,
  platform text,
  redirect_after text,
  expires_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $function$
  delete from public.platform_oauth_states s
  where s.state = p_state
  returning
    s.clerk_user_id,
    s.platform,
    s.redirect_after,
    s.expires_at;
$function$;

comment on function public.consume_yahoo_oauth_state(text)
  is 'Atomically consume one Yahoo platform OAuth state.';

create function public.acquire_yahoo_refresh_lease(
  p_clerk_user_id text,
  p_owner_id text,
  p_expires_at timestamptz,
  p_expected_refresh_token text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $function$
  with acquired as (
    update public.yahoo_credentials c
    set
      refresh_lease_owner = p_owner_id,
      refresh_lease_expires_at = p_expires_at
    where c.clerk_user_id = p_clerk_user_id
      and c.refresh_token = p_expected_refresh_token
      and (
        c.refresh_lease_owner is null
        or c.refresh_lease_expires_at is null
        or c.refresh_lease_expires_at < pg_catalog.now()
      )
    returning 1
  )
  select exists (select 1 from acquired);
$function$;

comment on function public.acquire_yahoo_refresh_lease(text, text, timestamptz, text)
  is 'Conditionally acquire a Yahoo refresh lease for the expected token version.';

create function public.recover_yahoo_credentials(
  p_clerk_user_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_app_fingerprint text,
  p_expected_refresh_token text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $function$
  with recovered as (
    update public.yahoo_credentials c
    set
      access_token = p_access_token,
      refresh_token = coalesce(p_refresh_token, c.refresh_token),
      expires_at = p_expires_at,
      updated_at = pg_catalog.now(),
      refresh_lease_owner = null,
      refresh_lease_expires_at = null,
      app_fingerprint = coalesce(p_app_fingerprint, c.app_fingerprint)
    where c.clerk_user_id = p_clerk_user_id
      and c.refresh_token = p_expected_refresh_token
      and (
        c.refresh_lease_owner is null
        or c.refresh_lease_expires_at is null
        or c.refresh_lease_expires_at < pg_catalog.now()
      )
    returning 1
  )
  select exists (select 1 from recovered);
$function$;

comment on function public.recover_yahoo_credentials(text, text, text, timestamptz, text, text)
  is 'Recover Yahoo credentials only when the expected refresh token is still current.';

revoke execute on function public.create_mcp_oauth_state(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.consume_mcp_oauth_state(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.claim_mcp_oauth_code(text)
  from public, anon, authenticated;
revoke execute on function public.find_mcp_oauth_access_token(text)
  from public, anon, authenticated;
revoke execute on function public.claim_mcp_oauth_refresh_token(text)
  from public, anon, authenticated;
revoke execute on function public.revoke_mcp_oauth_access_token(text)
  from public, anon, authenticated;
revoke execute on function public.consume_yahoo_oauth_state(text)
  from public, anon, authenticated;
revoke execute on function public.acquire_yahoo_refresh_lease(text, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.recover_yahoo_credentials(text, text, text, timestamptz, text, text)
  from public, anon, authenticated;

grant execute on function public.create_mcp_oauth_state(text, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_mcp_oauth_state(text, text, text)
  to service_role;
grant execute on function public.claim_mcp_oauth_code(text)
  to service_role;
grant execute on function public.find_mcp_oauth_access_token(text)
  to service_role;
grant execute on function public.claim_mcp_oauth_refresh_token(text)
  to service_role;
grant execute on function public.revoke_mcp_oauth_access_token(text)
  to service_role;
grant execute on function public.consume_yahoo_oauth_state(text)
  to service_role;
grant execute on function public.acquire_yahoo_refresh_lease(text, text, timestamptz, text)
  to service_role;
grant execute on function public.recover_yahoo_credentials(text, text, text, timestamptz, text, text)
  to service_role;

commit;
