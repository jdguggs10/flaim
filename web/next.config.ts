import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@flaim/worker-shared'],
  devIndicators: false,
  async redirects() {
    return [
      // Legacy per-provider and per-AI guide routes collapse straight to the
      // shared docs pages (no chained redirect through /guide/*).
      { source: '/guide/espn', destination: '/docs/platforms', permanent: true },
      { source: '/guide/yahoo', destination: '/docs/platforms', permanent: true },
      { source: '/guide/sleeper', destination: '/docs/platforms', permanent: true },
      { source: '/guide/claude', destination: '/docs/ai', permanent: true },
      { source: '/guide/chatgpt', destination: '/docs/ai', permanent: true },
      { source: '/guide/perplexity', destination: '/docs/ai', permanent: true },
      { source: '/guide/gemini', destination: '/docs/ai', permanent: true },
      // The guide hub and its remaining pages moved to /docs.
      { source: '/guide', destination: '/docs', permanent: true },
      { source: '/guide/:path*', destination: '/docs/:path*', permanent: true },
      { source: '/chat', destination: '/#live-demo', permanent: true },
      { source: '/inspirations', destination: '/about', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Long-lived caching for brand images. /icon-light.png is the MCP
        // server icon that every ChatGPT client fetches; Vercel's default
        // max-age=0 forced a revalidation per render (~500k requests/day).
        // To change one of these images, add it under a new filename.
        source: '/:image(icon-light.png|icon-dark.png|icon-light-5kb.png|icon-dark-5kb.png|flaim-mark-hero.png|flaim-mark-hero-dark.png|flaim-email-mark.png|openai_logo.svg)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
