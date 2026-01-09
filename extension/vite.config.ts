import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import baseManifest from './manifest.json';

const isDev = process.env.NODE_ENV === 'development';

// Strip localhost from host_permissions and externally_connectable in production builds
const manifest = {
  ...baseManifest,
  host_permissions: baseManifest.host_permissions.filter(
    (permission: string) => isDev || !permission.includes('localhost')
  ),
  externally_connectable: {
    ...baseManifest.externally_connectable,
    matches: baseManifest.externally_connectable.matches.filter(
      (pattern: string) => isDev || !pattern.includes('localhost')
    ),
  },
};

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
