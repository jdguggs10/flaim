-- Migration 015: public chat run tracking and concurrency guard
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-03-24

CREATE TABLE IF NOT EXISTS public_chat_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_key TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'running',
      'completed',
      'error',
      'aborted',
      'rate_limited',
      'concurrency_rejected'
    )
  ),
  error_code TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_chat_runs_visitor_started
  ON public_chat_runs (visitor_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_chat_runs_status_started
  ON public_chat_runs (status, started_at DESC);

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

CREATE OR REPLACE FUNCTION public.complete_public_chat_run(
  p_run_id UUID,
  p_status TEXT,
  p_duration_ms INTEGER DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public_chat_runs
  SET status = p_status,
      duration_ms = p_duration_ms,
      error_code = p_error_code,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public_chat_runs ENABLE ROW LEVEL SECURITY;
