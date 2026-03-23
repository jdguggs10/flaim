import { describe, it, expect } from 'vitest';
import { resolvePreviewOrigin, getFrontendUrl } from '../preview-url';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com', { headers });
}

describe('resolvePreviewOrigin', () => {
  it('returns origin for valid Vercel preview URL', () => {
    const req = makeRequest({ Origin: 'https://flaim-git-my-branch-gerald-guggers-projects.vercel.app' });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim-git-my-branch-gerald-guggers-projects.vercel.app');
  });

  it('returns origin for base flaim.vercel.app', () => {
    const req = makeRequest({ Origin: 'https://flaim.vercel.app' });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim.vercel.app');
  });

  it('returns origin for commit-hash style URLs', () => {
    const req = makeRequest({ Origin: 'https://flaim-abc123def-gerald-guggers-projects.vercel.app' });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim-abc123def-gerald-guggers-projects.vercel.app');
  });

  it('falls back to Referer when Origin is absent', () => {
    const req = makeRequest({ Referer: 'https://flaim-git-feature-gerald-guggers-projects.vercel.app/guide' });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim-git-feature-gerald-guggers-projects.vercel.app');
  });

  it('uses X-Forwarded-Origin from Next.js API proxies', () => {
    const req = makeRequest({ 'X-Forwarded-Origin': 'https://flaim-git-feature-gerald-guggers-projects.vercel.app' });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim-git-feature-gerald-guggers-projects.vercel.app');
  });

  it('prefers X-Forwarded-Origin over Origin', () => {
    const req = makeRequest({
      'X-Forwarded-Origin': 'https://flaim-git-preview-gerald-guggers-projects.vercel.app',
      Origin: 'https://flaim-git-other-gerald-guggers-projects.vercel.app',
    });
    expect(resolvePreviewOrigin(req)).toBe('https://flaim-git-preview-gerald-guggers-projects.vercel.app');
  });

  it('rejects non-Vercel origins', () => {
    const req = makeRequest({ Origin: 'https://evil.com' });
    expect(resolvePreviewOrigin(req)).toBeUndefined();
  });

  it('rejects similar but non-matching domains', () => {
    const req = makeRequest({ Origin: 'https://notflaim.vercel.app' });
    expect(resolvePreviewOrigin(req)).toBeUndefined();
  });

  it('rejects flaim subdomain spoofing', () => {
    const req = makeRequest({ Origin: 'https://flaim.vercel.app.evil.com' });
    expect(resolvePreviewOrigin(req)).toBeUndefined();
  });

  it('returns undefined when no Origin or Referer', () => {
    const req = makeRequest({});
    expect(resolvePreviewOrigin(req)).toBeUndefined();
  });
});

describe('getFrontendUrl', () => {
  it('uses FRONTEND_URL env var when set', () => {
    expect(getFrontendUrl({ FRONTEND_URL: 'https://custom.example.com/' })).toBe('https://custom.example.com');
  });

  it('returns localhost for dev environment', () => {
    expect(getFrontendUrl({ ENVIRONMENT: 'dev' })).toBe('http://localhost:3000');
  });

  it('returns localhost for development NODE_ENV', () => {
    expect(getFrontendUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
  });

  it('resolves preview origin in preview environment', () => {
    const req = makeRequest({ Origin: 'https://flaim-git-test-gerald-guggers-projects.vercel.app' });
    expect(getFrontendUrl({ ENVIRONMENT: 'preview' }, req)).toBe('https://flaim-git-test-gerald-guggers-projects.vercel.app');
  });

  it('falls back to flaim.app in preview without valid origin', () => {
    const req = makeRequest({ Origin: 'https://evil.com' });
    expect(getFrontendUrl({ ENVIRONMENT: 'preview' }, req)).toBe('https://flaim.app');
  });

  it('falls back to flaim.app in preview without request', () => {
    expect(getFrontendUrl({ ENVIRONMENT: 'preview' })).toBe('https://flaim.app');
  });

  it('returns flaim.app for prod', () => {
    expect(getFrontendUrl({ ENVIRONMENT: 'prod' })).toBe('https://flaim.app');
  });

  it('FRONTEND_URL takes priority over preview origin', () => {
    const req = makeRequest({ Origin: 'https://flaim-git-test.vercel.app' });
    expect(getFrontendUrl({ FRONTEND_URL: 'https://override.com', ENVIRONMENT: 'preview' }, req)).toBe('https://override.com');
  });
});
