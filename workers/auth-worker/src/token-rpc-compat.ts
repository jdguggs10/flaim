import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export interface TokenRpcErrorLike {
  code?: string;
  message?: string;
}

interface CompatResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

const warnedFunctions = new Set<string>();

export function isMissingTokenRpcError(
  error: TokenRpcErrorLike | null | undefined
): boolean {
  return error?.code === 'PGRST202';
}

export function warnTokenRpcFallback(functionName: string): void {
  if (warnedFunctions.has(functionName)) {
    return;
  }

  warnedFunctions.add(functionName);
  console.warn(
    `[token-rpc-compat] ${functionName} is not available; using the pre-migration database path`
  );
}

export async function legacyCreateMcpOAuthState(
  supabase: SupabaseClient,
  params: {
    state: string;
    redirectUri: string;
    binding: string;
    expiresAt: string;
  }
): Promise<CompatResult<boolean>> {
  const { error } = await supabase.from('oauth_states').insert({
    state: params.state,
    redirect_uri: params.redirectUri,
    client_id: params.binding,
    expires_at: params.expiresAt,
  });

  if (!error) {
    return { data: true, error: null };
  }

  if (error.code !== '23505') {
    return { data: false, error };
  }

  const { data: existingState, error: lookupError } = await supabase
    .from('oauth_states')
    .select('state')
    .eq('state', params.state)
    .eq('redirect_uri', params.redirectUri)
    .eq('client_id', params.binding)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  return existingState && !lookupError
    ? { data: true, error: null }
    : { data: false, error: lookupError ?? error };
}

export async function legacyConsumeMcpOAuthState(
  supabase: SupabaseClient,
  params: {
    state: string;
    redirectUri: string;
    binding: string;
  }
): Promise<CompatResult<boolean>> {
  const { data, error } = await supabase
    .from('oauth_states')
    .delete()
    .eq('state', params.state)
    .eq('redirect_uri', params.redirectUri)
    .eq('client_id', params.binding)
    .gt('expires_at', new Date().toISOString())
    .select('state');

  return {
    data: (data?.length ?? 0) === 1,
    error,
  };
}

export async function legacyClaimMcpOAuthCode(
  supabase: SupabaseClient,
  code: string
): Promise<CompatResult<Record<string, unknown>>> {
  return supabase
    .from('oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select(
      'user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at'
    )
    .maybeSingle();
}

export async function legacyFindMcpOAuthAccessToken(
  supabase: SupabaseClient,
  accessToken: string
): Promise<CompatResult<Record<string, unknown>>> {
  return supabase
    .from('oauth_tokens')
    .select('user_id, scope, resource, client_name, expires_at, revoked_at')
    .eq('access_token', accessToken)
    .maybeSingle();
}

export async function legacyClaimMcpOAuthRefreshToken(
  supabase: SupabaseClient,
  refreshToken: string
): Promise<CompatResult<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select(
      'access_token, user_id, scope, resource, client_name, refresh_token_expires_at, revoked_at'
    )
    .eq('refresh_token', refreshToken)
    .maybeSingle();

  if (error || !data) {
    return { data: null, error };
  }

  if (
    data.revoked_at ||
    (data.refresh_token_expires_at &&
      new Date(data.refresh_token_expires_at).getTime() < Date.now())
  ) {
    return { data: null, error: null };
  }

  const { error: revokeError } = await supabase
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('access_token', data.access_token);

  if (revokeError) {
    return { data: null, error: revokeError };
  }

  return {
    data: {
      user_id: data.user_id,
      scope: data.scope,
      resource: data.resource,
      client_name: data.client_name,
    },
    error: null,
  };
}

export async function legacyRevokeMcpOAuthAccessToken(
  supabase: SupabaseClient,
  accessToken: string
): Promise<CompatResult<boolean>> {
  const { error } = await supabase
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('access_token', accessToken);

  return {
    data: !error,
    error,
  };
}

export async function legacyConsumeYahooOAuthState(
  supabase: SupabaseClient,
  state: string
): Promise<CompatResult<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from('platform_oauth_states')
    .select('clerk_user_id, platform, redirect_after, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (error || !data) {
    return { data: null, error };
  }

  const { error: deleteError } = await supabase
    .from('platform_oauth_states')
    .delete()
    .eq('state', state);

  return deleteError
    ? { data: null, error: deleteError }
    : { data, error: null };
}

export async function legacyRecoverYahooCredentials(
  supabase: SupabaseClient,
  params: {
    clerkUserId: string;
    updateData: Record<string, string | null>;
    expectedRefreshToken: string;
  }
): Promise<CompatResult<boolean>> {
  const { data, error } = await supabase
    .from('yahoo_credentials')
    .update(params.updateData)
    .eq('clerk_user_id', params.clerkUserId)
    .eq('refresh_token', params.expectedRefreshToken)
    .or(
      `refresh_lease_owner.is.null,refresh_lease_expires_at.lt.${new Date().toISOString()},refresh_lease_expires_at.is.null`
    )
    .select('clerk_user_id');

  return {
    data: (data?.length ?? 0) > 0,
    error,
  };
}

export async function legacyAcquireYahooRefreshLease(
  supabase: SupabaseClient,
  params: {
    clerkUserId: string;
    ownerId: string;
    expiresAt: string;
    expectedRefreshToken: string;
  }
): Promise<CompatResult<boolean>> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('yahoo_credentials')
    .update({
      refresh_lease_owner: params.ownerId,
      refresh_lease_expires_at: params.expiresAt,
    })
    .eq('clerk_user_id', params.clerkUserId)
    .eq('refresh_token', params.expectedRefreshToken)
    .or(
      `refresh_lease_owner.is.null,refresh_lease_expires_at.lt.${now},refresh_lease_expires_at.is.null`
    )
    .select('clerk_user_id');

  return {
    data: (data?.length ?? 0) > 0,
    error,
  };
}
