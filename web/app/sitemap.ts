import type { MetadataRoute } from 'next';

function getBaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://flaim.app';
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  const lastModified = new Date();

  return [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/inspirations`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];
}
