import type { MetadataRoute } from 'next';

function getBaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://flaim.app';
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();

  return [
    {
      url: baseUrl,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/terms`,
      changeFrequency: 'yearly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/guide/platforms`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/guide/sports`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/guide/ai`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/inspirations`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];
}
