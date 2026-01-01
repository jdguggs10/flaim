import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import baseManifest from './manifest.json';

// Strip localhost from host_permissions in production builds
const manifest = {
  ...baseManifest,
  host_permissions: baseManifest.host_permissions.filter(
    (permission: string) => process.env.NODE_ENV === 'development' || !permission.includes('localhost')
  ),
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
