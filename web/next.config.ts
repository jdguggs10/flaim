import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@flaim/worker-shared'],
  devIndicators: false,
  async redirects() {
    return [
      { source: '/guide/espn', destination: '/guide/platforms', permanent: true },
      { source: '/guide/yahoo', destination: '/guide/platforms', permanent: true },
      { source: '/guide/sleeper', destination: '/guide/platforms', permanent: true },
      { source: '/guide/claude', destination: '/guide/ai', permanent: true },
      { source: '/guide/chatgpt', destination: '/guide/ai', permanent: true },
      { source: '/guide/perplexity', destination: '/guide/ai', permanent: true },
      { source: '/guide/gemini', destination: '/guide/ai', permanent: true },
      { source: '/chat', destination: '/#live-demo', permanent: true },
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
    ];
  },
};

export default nextConfig;
