interface PublicChatCacheEntry {
  cache_key: string;
  context_text: string;
  expires_at: string;
  updated_at: string;
}

interface PublicChatCacheConfig {
  cacheKey: string;
  ttlMs: number;
  label: string;
  build: () => Promise<string | null>;
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY is not configured");
  }

  return { supabaseUrl, supabaseServiceKey };
}

async function readCacheEntry(cacheKey: string): Promise<PublicChatCacheEntry | null> {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/public_chat_context_cache`);
  url.searchParams.set("cache_key", `eq.${cacheKey}`);
  url.searchParams.set("select", "cache_key,context_text,expires_at,updated_at");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to read public chat cache (${response.status})`);
  }

  const rows = (await response.json()) as PublicChatCacheEntry[];
  return rows[0] ?? null;
}

async function writeCacheEntry(input: {
  cacheKey: string;
  contextText: string;
  expiresAt: string;
}): Promise<void> {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/public_chat_context_cache`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        cache_key: input.cacheKey,
        context_text: input.contextText,
        expires_at: input.expiresAt,
        updated_at: new Date().toISOString(),
      },
    ]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to write public chat cache (${response.status})`);
  }
}

function isFresh(entry: PublicChatCacheEntry | null) {
  if (!entry) {
    return false;
  }

  const expiresAt = new Date(entry.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function getOrRefreshPublicChatCache(
  config: PublicChatCacheConfig
): Promise<string | null> {
  const existing = await readCacheEntry(config.cacheKey).catch((error) => {
    console.error(`Failed to read ${config.label} cache:`, error);
    return null;
  });

  if (isFresh(existing)) {
    return existing?.context_text ?? null;
  }

  try {
    const nextValue = await config.build();
    if (!nextValue) {
      return existing?.context_text ?? null;
    }

    await writeCacheEntry({
      cacheKey: config.cacheKey,
      contextText: nextValue,
      expiresAt: new Date(Date.now() + config.ttlMs).toISOString(),
    }).catch((error) => {
      console.error(`Failed to write ${config.label} cache:`, error);
    });

    return nextValue;
  } catch (error) {
    console.error(`Failed to refresh ${config.label} cache:`, error);
    return existing?.context_text ?? null;
  }
}
