import type { MetadataRoute } from 'next';

function getBaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://flaim.app';
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/oauth/', '/sign-in', '/sign-up'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
