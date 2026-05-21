import { clerkMiddleware } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Exact machine-to-machine endpoint paths exempted here must enforce their own request authentication.
const CSRF_EXEMPT_PATHS = new Set(['/api/webhooks/clerk']);

const ALLOWED_ORIGINS = [
  'https://flaim.app',
  'https://preview.flaim.app',
  'https://www.flaim.app',
  'https://flaim.vercel.app',
  'https://flaim-*.vercel.app',
  'http://localhost:3000',
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${escaped}$`);
}

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed.includes('*')) {
      return wildcardToRegex(allowed).test(origin);
    }
    return allowed === origin;
  });
}

function getRequestOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function normalizePathname(pathname: string): string {
  if (pathname.length > 1) {
    return pathname.replace(/\/+$/, '');
  }
  return pathname;
}

export function shouldRejectForCsrf(request: NextRequest): boolean {
  const pathname = normalizePathname(request.nextUrl.pathname);

  if (
    !(pathname.startsWith('/api') || pathname.startsWith('/trpc')) ||
    !CSRF_METHODS.has(request.method) ||
    CSRF_EXEMPT_PATHS.has(pathname)
  ) {
    return false;
  }

  const hasAuthHeader = Boolean(request.headers.get('authorization'));
  if (hasAuthHeader) {
    return false;
  }

  const origin = getRequestOrigin(request);
  return !origin || !isOriginAllowed(origin);
}

export default clerkMiddleware((_auth, request) => {
  if (shouldRejectForCsrf(request)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
