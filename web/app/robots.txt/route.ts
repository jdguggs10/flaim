const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no';

export const dynamic = 'force-static';

// Content-signal is an emerging crawler preference convention; unknown
// directives are ignored by standard robots parsers.
// The explicit bot sections duplicate the wildcard policy intentionally:
// this keeps SEO/GEO crawler intent readable even when rules are identical.
const DISCOVERY_USER_AGENTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'Claude-SearchBot',
  'Claude-User',
  'ClaudeBot',
  'PerplexityBot',
  'Perplexity-User',
  'Googlebot',
  'Google-Extended',
  'GoogleOther',
  'Bingbot',
  'Applebot',
  'Applebot-Extended',
  'CCBot',
  'Meta-ExternalAgent',
  'Amazonbot',
  'Bytespider',
] as const;

function getBaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://flaim.app';
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

function formatRule(userAgent: string): string {
  return [
    `User-agent: ${userAgent}`,
    'Allow: /',
    'Disallow: /api/',
    `Content-signal: ${CONTENT_SIGNAL}`,
  ].join('\n');
}

export function GET() {
  const baseUrl = getBaseUrl();
  const body = [
    formatRule('*'),
    ...DISCOVERY_USER_AGENTS.map(formatRule),
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
