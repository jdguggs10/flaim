-- Migration 016: expire stale public chat runs before concurrency checks
-- Run this in Supabase Dashboard -> SQL Editor after 015_public_chat_runs.sql
-- Created: 2026-03-24

CREATE OR REPLACE FUNCTION public.acquire_public_chat_run(
  p_visitor_key TEXT,
  p_preset_id TEXT,
  p_model TEXT,
  p_max_concurrent INTEGER DEFAULT 1
)
RETURNS TABLE(
  allowed BOOLEAN,
  run_id UUID,
  rejection_reason TEXT,
  concurrent_count INTEGER
) AS $$
DECLARE
  v_run_id UUID;
  v_concurrent_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_visitor_key));

  -- Clean up abandoned runs so a killed request does not block the visitor forever.
  UPDATE public_chat_runs
  SET status = 'aborted',
      error_code = COALESCE(error_code, 'stale_timeout'),
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE visitor_key = p_visitor_key
    AND status = 'running'
    AND started_at < NOW() - INTERVAL '5 minutes';

  SELECT COUNT(*)
  INTO v_concurrent_count
  FROM public_chat_runs
  WHERE visitor_key = p_visitor_key
    AND status = 'running';

  IF v_concurrent_count >= p_max_concurrent THEN
    INSERT INTO public_chat_runs (
      visitor_key,
      preset_id,
      model,
      status
    ) VALUES (
      p_visitor_key,
      p_preset_id,
      p_model,
      'concurrency_rejected'
    )
    RETURNING id INTO v_run_id;

    RETURN QUERY
    SELECT FALSE, v_run_id, 'concurrency_limited', v_concurrent_count;
    RETURN;
  END IF;

  INSERT INTO public_chat_runs (
    visitor_key,
    preset_id,
    model,
    status
  ) VALUES (
    p_visitor_key,
    p_preset_id,
    p_model,
    'running'
  )
  RETURNING id INTO v_run_id;

  RETURN QUERY
  SELECT TRUE, v_run_id, NULL::TEXT, v_concurrent_count;
END;
$$ LANGUAGE plpgsql;
