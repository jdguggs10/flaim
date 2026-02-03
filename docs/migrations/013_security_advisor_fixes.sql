-- Migration 013: Address Supabase security advisor warnings
-- Fixes: RLS disabled on oauth_states (ERROR), mutable search_path on 7 functions (WARN)

-- 1. Enable RLS on oauth_states (the only table missing it)
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- 2. Recreate all functions with SET search_path = '' to pin the search path.
--    Function bodies are unchanged; only the security-relevant SET clause is added.

CREATE OR REPLACE FUNCTION public.cleanup_expired_extension_codes()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.extension_pairing_codes
  WHERE expires_at < NOW()
     OR used_at IS NOT NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_platform_oauth_states()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.platform_oauth_states
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_codes()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_codes
  WHERE expires_at < NOW() OR used_at IS NOT NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_tokens()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_tokens
  WHERE expires_at < NOW()
    OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_states()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_states
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Keep 7 days of history for debugging, delete older
  DELETE FROM public.rate_limits
  WHERE window_date < CURRENT_DATE - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit(p_user_id text)
 RETURNS TABLE(request_count integer, window_date date)
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    INSERT INTO public.rate_limits (user_id, window_date, request_count, updated_at)
      VALUES (p_user_id, CURRENT_DATE, 1, NOW())
        ON CONFLICT (user_id, window_date)
          DO UPDATE SET
              request_count = public.rate_limits.request_count + 1,
              updated_at = NOW()
            RETURNING public.rate_limits.request_count, public.rate_limits.window_date;
END;
$function$;
