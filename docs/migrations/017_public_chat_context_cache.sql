CREATE TABLE IF NOT EXISTS public_chat_context_cache (
  cache_key TEXT PRIMARY KEY,
  context_text TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_chat_context_cache_expires_at
  ON public_chat_context_cache (expires_at);

ALTER TABLE public_chat_context_cache ENABLE ROW LEVEL SECURITY;
