/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_CLERK_SYNC_HOST: string;
  readonly VITE_CLERK_FRONTEND_API: string;
  readonly VITE_EXTENSION_DEV_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
