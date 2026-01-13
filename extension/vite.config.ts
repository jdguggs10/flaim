import { defineConfig, loadEnv } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import baseManifest from './manifest.json';

export default defineConfig(({ mode }) => {
  // Load environment variables based on mode (development/production/preview)
  const env = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development';
  const isPreview = mode === 'preview';

  const getOrigin = (value: string | undefined, name: string) => {
    if (!value) return null;
    try {
      return new URL(value).origin;
    } catch {
      try {
        return new URL(`https://${value}`).origin;
      } catch {
        throw new Error(
          `Invalid ${name} value "${value}". Expected a full URL like "https://clerk.example.com".`
        );
      }
    }
  };

  // Build host_permissions dynamically based on environment
  const hostPermissions = [
    'https://*.espn.com/*',
    // API access - full domain needed for Clerk
    isDev ? 'http://localhost:3000/*' : 'https://flaim.app/*',
  ];

  // For preview mode, allow all Vercel preview domains
  if (isPreview) {
    hostPermissions.push('https://*.vercel.app/*');
  }

  // Add Clerk sync host to host_permissions if defined
  const syncHostOrigin = getOrigin(env.VITE_CLERK_SYNC_HOST, 'VITE_CLERK_SYNC_HOST');
  if (syncHostOrigin) hostPermissions.push(`${syncHostOrigin}/*`);

  const frontendApiOrigin = getOrigin(
    env.VITE_CLERK_FRONTEND_API,
    'VITE_CLERK_FRONTEND_API'
  );
  if (frontendApiOrigin) hostPermissions.push(`${frontendApiOrigin}/*`);

  // Strip localhost from manifest in production builds
  const manifest = {
    ...baseManifest,
    ...(isDev && env.VITE_EXTENSION_DEV_KEY ? { key: env.VITE_EXTENSION_DEV_KEY } : {}),
    host_permissions: hostPermissions.filter(
      (permission, index, self) =>
        // Dedupe and filter localhost in prod
        self.indexOf(permission) === index &&
        (isDev || !permission.includes('localhost'))
    ),
    externally_connectable: {
      ...baseManifest.externally_connectable,
      matches: isPreview
        ? ['https://*.vercel.app/*'] // Preview: only Vercel domains
        : baseManifest.externally_connectable.matches.filter(
            (pattern: string) => isDev || !pattern.includes('localhost')
          ),
    },
  };

  return {
    plugins: [react(), crx({ manifest })],
    define: {
      // Expose environment variables to the extension
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(
        env.VITE_CLERK_PUBLISHABLE_KEY || ''
      ),
      'import.meta.env.VITE_CLERK_SYNC_HOST': JSON.stringify(
        env.VITE_CLERK_SYNC_HOST || ''
      ),
      'import.meta.env.VITE_CLERK_FRONTEND_API': JSON.stringify(
        env.VITE_CLERK_FRONTEND_API || ''
      ),
      'import.meta.env.VITE_SITE_BASE': JSON.stringify(env.VITE_SITE_BASE || ''),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
