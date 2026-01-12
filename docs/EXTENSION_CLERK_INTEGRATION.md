# Clerk Direct Sign-In for Chrome Extension

> **Document Status**: Updated 2026-01-12. Implementation complete (v1.3.0) with Clerk Sync Host; legacy pairing flow removed.
>
> **Sources**: [Clerk Chrome Extension SDK](https://clerk.com/docs/reference/chrome-extension/overview), [Sync Host Guide](https://clerk.com/docs/guides/sessions/sync-host), [Deploy to Production](https://clerk.com/docs/deployments/deploy-chrome-extension), [SDK v2.0 Changelog](https://clerk.com/changelog/2024-11-22-chrome-extension-sdk-2.0)

---

## Table of Contents

1. [Goal](#goal)
2. [Current Architecture](#current-architecture-what-were-replacing)
3. [Clerk SDK Capabilities](#clerk-chrome-extension-sdk)
4. [Critical Limitations](#critical-limitations)
5. [Implementation Decision](#implementation-decision-sync-host-vs-direct-auth)
6. [Detailed Implementation Plan](#detailed-implementation-plan)
7. [File-by-File Changes](#file-by-file-changes)
8. [Database Migration](#database-migration)
9. [Testing Checklist](#testing-checklist)
10. [Rollback Plan](#rollback-plan)

---

## Goal

Replace the custom pairing-code token exchange with Clerk Sync Host authentication, so that:

1. Users signed into `flaim.app` automatically authenticate in the extension (Sync Host)
2. The extension uses Clerk JWTs instead of custom bearer tokens for API calls
3. Custom token infrastructure and pairing endpoints are removed

---

## Legacy Architecture (Pre-v1.3.0)

**Historical reference only** — the pairing-code flow below has been removed in v1.3.0.

### Extension Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CURRENT PAIRING CODE FLOW                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User visits flaim.app/extension                                     │
│     └── Clicks "Generate Pairing Code"                                  │
│         └── POST /api/extension/code (Clerk JWT)                        │
│             └── auth-worker creates 6-char code in extension_pairing_codes │
│                                                                         │
│  2. User opens extension popup                                          │
│     └── Enters 6-char code                                              │
│         └── POST /api/extension/pair (no auth, code is the auth)        │
│             └── auth-worker exchanges code for 64-char hex token        │
│                 └── Stores in extension_tokens table                    │
│                     └── Returns token to extension                      │
│                         └── Extension stores in chrome.storage.local    │
│                                                                         │
│  3. Extension makes API calls                                           │
│     └── Authorization: Bearer {64-char-hex-token}                       │
│         └── auth-worker validates token against extension_tokens        │
│             └── Returns userId for request context                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Current Architecture (v1.3.0)

```
Extension Popup → Clerk Sync Host (session from flaim.app)
     ↓
ESPN Cookies → POST /api/extension/sync → Auth Worker → Supabase
```

### Files Involved (Legacy)

| File | Purpose | Lines |
|------|---------|-------|
| `extension/src/popup/Popup.tsx` | Pairing code UI, 13 state machine states | 745 |
| `extension/src/lib/api.ts` | API client with custom bearer token auth | 220 |
| `extension/src/lib/storage.ts` | Token storage (`flaim_extension_token`) | 110 |
| `extension/src/background.ts` | External ping handler | 63 |
| `extension/manifest.json` | Permissions and externally_connectable | 38 |
| `web/app/(site)/extension/page.tsx` | Pairing code generation UI | 553 |
| `web/app/api/extension/code/route.ts` | Generate pairing code endpoint | ~50 |
| `web/app/api/extension/pair/route.ts` | Exchange code for token | ~60 |
| `web/app/api/extension/status/route.ts` | Check extension status | ~40 |
| `web/app/api/extension/connection/route.ts` | Web UI status check | ~40 |
| `web/app/api/extension/token/route.ts` | Revoke token | ~40 |
| `web/app/api/extension/sync/route.ts` | Sync ESPN credentials | ~50 |
| `web/app/api/extension/discover/route.ts` | Discover leagues | ~50 |
| `web/app/api/extension/set-default/route.ts` | Set default league | ~40 |
| `workers/auth-worker/src/extension-handlers.ts` | All extension endpoint logic | ~700 |
| `workers/auth-worker/src/extension-storage.ts` | Pairing code & token CRUD | ~300 |

### Current Files (v1.3.0)

- `extension/src/popup/Popup.tsx` (Clerk auth UI)
- `extension/src/popup/ClerkProvider.tsx`
- `extension/src/lib/api.ts` (Clerk JWT API calls)
- `extension/src/lib/storage.ts` (setup state only)
- `extension/src/background.ts` (Clerk ping via createClerkClient)
- `web/app/(site)/extension/page.tsx` (simplified status UI)
- `web/app/api/extension/{sync,status,discover,set-default,connection}/route.ts`
- `workers/auth-worker/src/extension-handlers.ts` (Clerk-only handlers)

### Database Tables (Legacy/Deprecated)

```sql
-- extension_pairing_codes
CREATE TABLE extension_pairing_codes (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  code CHAR(6) NOT NULL UNIQUE,  -- "A3F8K2"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- 10 minutes
  used_at TIMESTAMPTZ  -- NULL until exchanged
);

-- extension_tokens
CREATE TABLE extension_tokens (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,  -- 64-char hex
  name TEXT,  -- device name
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ  -- soft delete
);
-- Constraint: only one active token per user
```

---

## Clerk Chrome Extension SDK

### Verified Features ✅

| Feature | Status | Source |
|---------|--------|--------|
| `@clerk/chrome-extension` SDK | ✅ Verified | [npm](https://www.npmjs.com/package/@clerk/chrome-extension) |
| React components (`SignIn`, `SignUp`, `UserButton`, `SignedIn`, `SignedOut`) | ✅ Verified | [SDK Reference](https://clerk.com/docs/reference/chrome-extension/overview) |
| `createClerkClient()` for background workers | ✅ Verified | [createClerkClient docs](https://clerk.com/docs/reference/chrome-extension/create-clerk-client) |
| Sync Host session sync | ✅ Verified | [Sync Host Guide](https://clerk.com/docs/guides/sessions/sync-host) |
| `allowed_origins` API configuration | ✅ Verified | [Deploy Guide](https://clerk.com/docs/deployments/deploy-chrome-extension) |
| SDK v2.0 (Nov 2024) | ✅ Verified | [Changelog](https://clerk.com/changelog/2024-11-22-chrome-extension-sdk-2.0) |

### Authentication Methods Matrix

| Method | Popup/Side Panel | Sync Host Only | Notes |
|--------|------------------|----------------|-------|
| Email + OTP | ✅ Works | ✅ Works | Recommended for extension |
| Email + Password | ✅ Works | ✅ Works | Recommended for extension |
| Username + Password | ✅ Works | ✅ Works | |
| SMS + OTP | ✅ Works | ✅ Works | |
| Passkeys | ✅ Works | ✅ Works | |
| **OAuth/Social** | ❌ **BLOCKED** | ✅ Works (via web) | Chrome blocks redirects |
| **SAML** | ❌ **BLOCKED** | ✅ Works (via web) | Chrome blocks redirects |
| Email + Link | ❌ Popup closes | ✅ Works | Popup closes on link click |
| Google One Tap | ❌ Remote code | ❌ N/A | Chrome blocks remote code |
| Web3 | ❌ Remote code | ❌ N/A | Chrome blocks remote code |

---

## Critical Limitations

### 1. Bot Protection Must Be Disabled ⚠️

**Reason**: Clerk uses Cloudflare for bot detection, which doesn't work in Chrome extension environments.

**Action**: Clerk Dashboard → Settings → Attack Protection → **Disable Bot Protection**

### 2. Native API + Domain Required for Prod ⚠️

**Reason**: Clerk requires the Native API to be enabled and a production domain associated with the instance when deploying a Chrome extension.

**Action**: Clerk Dashboard → Native Applications → **Enable Native API**, and ensure a production domain is set for the instance.

### 3. Consistent CRX ID Required ⚠️

**Reason**: If the extension ID changes, `allowed_origins` configuration breaks.

**Development**:
- The unpacked extension gets a new ID each time Chrome restarts.
- Add a `key` field to `manifest.json` using a stable public key (Chrome/Clerk guidance) so the ID stays consistent. Do not regenerate it once set.

**Production**: Chrome Web Store assigns a permanent ID (`ogkkejmgkoolfaidplldmcghbikpmonn`).

### 4. OAuth/SAML Redirects Blocked ⚠️

**Reason**: Chrome extension popups cannot handle OAuth redirect flows—the IdP cannot redirect back to `chrome-extension://`.

**Workaround**: Use Sync Host—users authenticate on `flaim.app`, session syncs to extension.

### 5. Side Panel Sync Limitation ⚠️

**Reason**: Sync Host doesn't fully support side panels. Users must close/reopen to see updated auth state.

**Impact**: Flaim uses popup, not side panel—**no impact**.

### 6. Content Script Integration Unsupported ⚠️

**Reason**: Strict origin restrictions prevent Clerk components in content scripts.

**Impact**: Flaim doesn't use content scripts for auth—**no impact**.

---

## Implementation Decision: Sync Host vs Direct Auth

### Option A: Sync Host Only (Recommended) ✅

**Flow**:
1. User signs into `flaim.app` (any method including OAuth)
2. Opens extension → automatically authenticated via Sync Host
3. If not signed in → button to open `flaim.app/sign-in`

**Pros**:
- OAuth/social login works (user authenticates on web)
- Simpler extension UI (no sign-in form)
- Matches Clerk’s Sync Host model (set `syncHost` to the Clerk Frontend API domain and add it to `host_permissions`)

**Cons**:
- Not fully standalone (requires web browser)

### Option B: Direct Auth (Email/Password Only)

**Flow**:
1. User opens extension
2. Shows `<SignIn />` component (social buttons hidden)
3. User enters email/password or OTP

**Pros**:
- Fully standalone

**Cons**:
- OAuth/social login won't work in extension
- More complex UI
- Must hide social buttons to avoid confusion

### Option C: Hybrid

**Flow**:
1. Check for Sync Host session
2. If found → authenticated
3. If not → show choice: "Sign in at flaim.app" OR "Sign in with email"

**Recommendation**: **Option A (Sync Host Only)** for v1.3.0. Implemented. Add direct email auth later if user feedback warrants it.

---

## Detailed Implementation Plan

### Phase 1: Clerk Dashboard Configuration ✅ COMPLETE

**No code changes. Dashboard-only.**

> **Completed**: 2026-01-11

1. **Disable Bot Protection** ✅
   - Clerk Dashboard → Configure → User & authentication → Attack protection → Bot sign-up protection → **Off**
   - Verified: Switch is unchecked

2. **Enable Native API + Confirm Prod Domain** ✅
   - Clerk Dashboard → Configure → Developers → Native applications → **Enable Native API**
   - Production domain: `flaim.app`
   - Frontend API: `clerk.flaim.app` (this is the `syncHost` value)
   - Verified: Switch is checked

3. **Add Extension ID to Allowed Origins** ✅ (Production only)

   **Production** (Chrome Web Store ID):
   ```bash
   curl -X PATCH https://api.clerk.com/v1/instance \
     -H "Authorization: Bearer sk_live_YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"allowed_origins": ["chrome-extension://ogkkejmgkoolfaidplldmcghbikpmonn"]}'
   ```
   - Verified: API call succeeded (empty response = success)

   **Development** (add later when unpacked extension ID is known):
   ```bash
   curl -X PATCH https://api.clerk.com/v1/instance \
     -H "Authorization: Bearer sk_live_YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"allowed_origins": ["chrome-extension://ogkkejmgkoolfaidplldmcghbikpmonn", "chrome-extension://YOUR_DEV_EXTENSION_ID"]}'
   ```

4. **Verify in Dashboard** ⏳
   - Note: `allowed_origins` is set via API, not visible in Dashboard UI
   - Verification will happen during CHECKPOINT 1 testing

---

### Phase 2: Extension SDK Integration (2-3 hours)

#### Step 2.1: Install Dependencies

```bash
cd extension
npm install @clerk/chrome-extension
```

#### Step 2.2: Create Environment Files

The extension currently uses `chrome.management.getSelf()` for dev/prod detection. We need to add Clerk environment variables.

**Create `extension/.env.development`**:
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_DEV_KEY
VITE_CLERK_FRONTEND_API=https://YOUR_DEV_FRONTEND_API.clerk.accounts.dev
VITE_CLERK_SYNC_HOST=https://YOUR_DEV_FRONTEND_API.clerk.accounts.dev
# Optional: stable dev extension ID
# VITE_EXTENSION_DEV_KEY=YOUR_DEV_PUBLIC_KEY
```

**Create `extension/.env.production`**:
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_PROD_KEY
VITE_CLERK_FRONTEND_API=https://clerk.flaim.app
VITE_CLERK_SYNC_HOST=https://clerk.flaim.app
```

**Note**: `VITE_CLERK_SYNC_HOST` must match your Clerk Frontend API domain.
Copy the Frontend API domain from Clerk Dashboard → API Keys.

#### Step 2.3: Update Vite Config for Env Vars

**Update `extension/vite.config.ts`**:
```typescript
import { defineConfig, loadEnv } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import baseManifest from './manifest.json';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development';

  const hostPermissions = [
    'https://*.espn.com/*',
    isDev ? 'http://localhost/*' : 'https://flaim.app/*',
    `${env.VITE_CLERK_SYNC_HOST}/*`,
    `${env.VITE_CLERK_FRONTEND_API}/*`,
  ];

  // Strip localhost from manifest in production
  const manifest = {
    ...baseManifest,
    ...(isDev && env.VITE_EXTENSION_DEV_KEY ? { key: env.VITE_EXTENSION_DEV_KEY } : {}),
    host_permissions: hostPermissions.filter(Boolean),
    externally_connectable: {
      ...baseManifest.externally_connectable,
      matches: baseManifest.externally_connectable.matches.filter(
        (pattern: string) => isDev || !pattern.includes('localhost')
      ),
    },
  };

  return {
    plugins: [react(), crx({ manifest })],
    define: {
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(env.VITE_CLERK_PUBLISHABLE_KEY),
      'import.meta.env.VITE_CLERK_SYNC_HOST': JSON.stringify(env.VITE_CLERK_SYNC_HOST),
      'import.meta.env.VITE_CLERK_FRONTEND_API': JSON.stringify(env.VITE_CLERK_FRONTEND_API),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
```

#### Step 2.4: Update Manifest

**Update `extension/manifest.json`**:
```json
{
  "manifest_version": 3,
  "name": "Flaim - ESPN Fantasy Connector",
  "version": "1.3.0",
  "description": "Automatically sync your ESPN fantasy credentials to Flaim",
  "key": "YOUR_DEV_PUBLIC_KEY",
  "permissions": [
    "cookies",
    "storage"
  ],
  "host_permissions": [
    "https://*.espn.com/*",
    "https://flaim.app/*",
    "http://localhost/*",
    "https://YOUR_CLERK_SYNC_HOST/*",
    "https://YOUR_CLERK_FRONTEND_API/*"
  ],
  "background": {
    "service_worker": "src/background.ts",
    "type": "module"
  },
  "externally_connectable": {
    "matches": [
      "https://flaim.app/*",
      "http://localhost:3000/*"
    ]
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_icon": {
      "16": "assets/icons/icon-16.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png"
    }
  },
  "icons": {
    "16": "assets/icons/icon-16.png",
    "48": "assets/icons/icon-48.png",
    "128": "assets/icons/icon-128.png"
  }
}
```

**Note**: The `key` field is only needed to stabilize the unpacked/dev ID. If you want to avoid shipping it in production builds, inject it only for dev in `vite.config.ts`.

**Changes from current**:
- Version bump: `1.2.1` → `1.3.0`
- Added `key` for consistent dev extension ID (don’t regenerate once set)
- Replaced wildcard Clerk domain with explicit `syncHost` + `frontendApi` host permissions
- Changed `https://flaim.app/api/extension/*` → `https://flaim.app/*` (need full domain for Clerk)

#### Step 2.5: Create ClerkProvider Wrapper

**Create `extension/src/popup/ClerkProvider.tsx`**:
```tsx
import { ClerkProvider } from '@clerk/chrome-extension';
import { ReactNode } from 'react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable');
}

interface Props {
  children: ReactNode;
}

export function ExtensionClerkProvider({ children }: Props) {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      syncHost={SYNC_HOST}
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
```

#### Step 2.6: Update Entry Point

**Update `extension/src/popup/main.tsx`**:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ExtensionClerkProvider } from './ClerkProvider';
import Popup from './Popup';
import './popup.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExtensionClerkProvider>
      <Popup />
    </ExtensionClerkProvider>
  </React.StrictMode>
);
```

---

### Phase 3: Refactor Popup Component (2-3 hours)

The current `Popup.tsx` is 745 lines with 13 states. We'll simplify significantly.

#### New State Machine

```
OLD (13 states):
  loading, not_paired, entering_code, paired_no_espn, ready, syncing, success, error,
  setup_syncing, setup_discovering, setup_selecting_default, setup_complete, setup_error

NEW (7 states):
  loading, not_signed_in, signed_in_no_espn, ready,
  setup_syncing, setup_discovering, setup_selecting_default, setup_complete, setup_error
```

**Removed**: `not_paired`, `entering_code` (no more pairing codes)

#### New Popup Structure

**Replace `extension/src/popup/Popup.tsx`** (see File-by-File Changes section for full code)

Key changes:
1. Use `useAuth()` and `useUser()` from `@clerk/chrome-extension`
2. Remove all pairing code logic
3. Replace `getToken()` storage calls with `getToken()` from Clerk
4. Simplify state machine

---

### Phase 4: Update API Client (1 hour)

**Update `extension/src/lib/api.ts`**:

The API client needs to accept Clerk tokens instead of custom tokens.

```typescript
/**
 * Flaim API Client (Clerk Auth Version)
 * ---------------------------------------------------------------------------
 * API client for communicating with Flaim's extension endpoints.
 * Uses Clerk JWTs for authentication.
 */

// Cache the API base URL after first detection
let cachedApiBase: string | null = null;

/**
 * Detect if running in development mode.
 */
async function detectApiBase(): Promise<string> {
  if (cachedApiBase) return cachedApiBase;

  try {
    const info = await chrome.management.getSelf();
    const isDevMode = info.installType === 'development';
    cachedApiBase = isDevMode
      ? 'http://localhost:3000/api/extension'
      : 'https://flaim.app/api/extension';
  } catch {
    cachedApiBase = 'https://flaim.app/api/extension';
  }

  return cachedApiBase;
}

/**
 * Get the base URL for the Flaim site (not API).
 */
export async function getSiteBase(): Promise<string> {
  const apiBase = await detectApiBase();
  return apiBase.replace('/api/extension', '');
}

// ============================================================================
// API FUNCTIONS (now require Clerk token as parameter)
// ============================================================================

export interface SyncResponse {
  success: boolean;
  message: string;
}

export interface StatusResponse {
  success: boolean;
  connected: boolean;
  hasCredentials: boolean;
  lastSync: string | null;
}

/**
 * Sync ESPN credentials to Flaim
 * @param clerkToken - JWT from useAuth().getToken()
 */
export async function syncCredentials(
  clerkToken: string,
  credentials: { swid: string; s2: string }
): Promise<SyncResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || error.error || 'Sync failed');
  }

  return response.json();
}

/**
 * Check connection status
 * @param clerkToken - JWT from useAuth().getToken()
 */
export async function checkStatus(clerkToken: string): Promise<StatusResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || error.error || 'Status check failed');
  }

  return response.json();
}

// ... (discoverLeagues and setDefaultLeague similarly updated)
```

---

### Phase 5: Update Background Service Worker (30 min)

**Update `extension/src/background.ts`**:

```typescript
/**
 * Background Service Worker (Clerk Auth Version)
 * ---------------------------------------------------------------------------
 * Handles external messages from the Flaim website to verify extension status.
 * Uses Clerk session instead of custom tokens.
 */

import { createClerkClient } from '@clerk/chrome-extension/background';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string;

// Initialize Clerk client for background script (async per Clerk docs)
const clerkClientPromise = createClerkClient({
  publishableKey: PUBLISHABLE_KEY,
  syncHost: SYNC_HOST,
});

const getClerkState = async () => {
  const clerk = await clerkClientPromise;
  const token = clerk.session ? await clerk.session.getToken() : null;
  return { token, userId: clerk.user?.id || null };
};

// Message types
interface PingMessage {
  type: 'ping';
}

interface PingResponse {
  installed: true;
  signedIn: boolean;
  userId: string | null;
}

/**
 * Handle messages from external web pages (flaim.app, localhost:3000)
 * Configured via externally_connectable in manifest.json
 */
chrome.runtime.onMessageExternal.addListener(
  (
    message: PingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: PingResponse) => void
  ) => {
    if (message?.type === 'ping') {
      // Check Clerk session
      getClerkState()
        .then(({ token, userId }) => {
          sendResponse({
            installed: true,
            signedIn: !!token,
            userId,
          });
        })
        .catch(() => {
          sendResponse({
            installed: true,
            signedIn: false,
            userId: null,
          });
        });

      return true; // Async response
    }

    return false;
  }
);

console.log('[Flaim] Background service worker started (Clerk auth)');
```

---

### Phase 6: Update Auth Worker Endpoints ✅ Complete

- All extension endpoints validate Clerk JWTs via `getVerifiedUserId`.
- Legacy pairing endpoints removed: `/extension/code`, `/extension/pair`, `/extension/token`.
- `/extension/connection` now reflects Clerk-authenticated, credential-based status.

---

### Phase 7: Update Web UI ✅ Complete

**Simplify `web/app/(site)/extension/page.tsx`**:

Remove:
- Pairing code generation UI
- Code copying
- Token display (createdAt, lastUsedAt, device name)
- Disconnect button (users sign out from Clerk instead)

Keep:
- Connection status (using Clerk session)
- ESPN credentials card
- Chrome Web Store link

The page becomes much simpler—just shows if user is signed in and if extension has synced ESPN credentials.

---

### Phase 8: Cleanup ✅ Complete

1. **Deleted deprecated API routes**:
   - `web/app/api/extension/code/route.ts`
   - `web/app/api/extension/pair/route.ts`
   - `web/app/api/extension/token/route.ts`

2. **Removed legacy auth-worker handlers**:
   - `handleCreatePairingCode`
   - `handlePairExtension`
   - `handleRevokeToken`
   - `validateExtensionToken`

3. **Removed token storage utilities**:
   - `extension/src/lib/storage.ts` (token storage removed; setup state retained)

4. **Database cleanup** (optional, can keep for audit):
   ```sql
   -- After confirming no active usage
   DROP TABLE IF EXISTS extension_pairing_codes;
   DROP TABLE IF EXISTS extension_tokens;
   ```

---

## File-by-File Changes

### Extension Files

| File | Action | Changes |
|------|--------|---------|
| `extension/package.json` | Modify | Add `@clerk/chrome-extension` dependency |
| `extension/.env.development` | Create | Clerk dev environment vars |
| `extension/.env.production` | Create | Clerk prod environment vars |
| `extension/vite.config.ts` | Modify | Add env var loading and define |
| `extension/manifest.json` | Modify | Update host_permissions, bump version |
| `extension/src/popup/ClerkProvider.tsx` | Create | ClerkProvider wrapper component |
| `extension/src/popup/main.tsx` | Modify | Wrap with ExtensionClerkProvider |
| `extension/src/popup/Popup.tsx` | **Rewrite** | Remove pairing, use Clerk hooks |
| `extension/src/lib/api.ts` | Modify | Clerk JWT only (pairing removed) |
| `extension/src/lib/storage.ts` | Modify | Token storage removed; setup state retained |
| `extension/src/background.ts` | Modify | Use createClerkClient |

### Web Files

| File | Action | Changes |
|------|--------|---------|
| `web/app/(site)/extension/page.tsx` | Simplify | Remove pairing code UI |
| `web/lib/extension-ping.ts` | Modify | Update ping response types |
| `web/app/api/extension/code/route.ts` | Delete | Removed (pairing code) |
| `web/app/api/extension/pair/route.ts` | Delete | Removed (pairing exchange) |
| `web/app/api/extension/token/route.ts` | Delete | Removed (token revoke) |
| `web/app/api/extension/connection/route.ts` | Simplify | Check credentials only |
| `web/app/api/extension/sync/route.ts` | Modify | Forward Clerk JWT |
| `web/app/api/extension/status/route.ts` | Modify | Accept Clerk JWT |
| `web/app/api/extension/discover/route.ts` | Modify | Accept Clerk JWT |
| `web/app/api/extension/set-default/route.ts` | Modify | Accept Clerk JWT |

### Worker Files

| File | Action | Changes |
|------|--------|---------|
| `workers/auth-worker/src/index.ts` | Modify | Use Clerk JWT for extension endpoints |
| `workers/auth-worker/src/extension-handlers.ts` | Modify | Clerk-only handlers (no tokens) |
| `workers/auth-worker/src/extension-storage.ts` | Delete | Removed (legacy token storage) |

---

## New Popup.tsx (Simplified)

```tsx
import { useEffect, useState } from 'react';
import { useAuth, useUser, SignedIn, SignedOut } from '@clerk/chrome-extension';
import {
  getSetupState,
  setSetupState,
  clearSetupState,
  type LeagueOption,
  type SeasonCounts,
} from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import {
  syncCredentials,
  checkStatus,
  getSiteBase,
  discoverLeagues,
  setDefaultLeague,
  type DiscoveredLeague,
} from '../lib/api';

type State =
  | 'loading'
  | 'no_espn'
  | 'ready'
  | 'setup_syncing'
  | 'setup_discovering'
  | 'setup_selecting_default'
  | 'setup_complete'
  | 'setup_error';

const sportEmoji: Record<string, string> = {
  football: '🏈',
  baseball: '⚾',
  basketball: '🏀',
  hockey: '🏒',
};

export default function Popup() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);

  // Setup flow state
  const [discoveredLeagues, setDiscoveredLeagues] = useState<DiscoveredLeague[]>([]);
  const [currentSeasonLeagues, setCurrentSeasonLeagues] = useState<LeagueOption[]>([]);
  const [selectedDefault, setSelectedDefault] = useState<string>('');
  const [discoveryCounts, setDiscoveryCounts] = useState({
    currentSeason: { found: 0, added: 0, alreadySaved: 0 },
    pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
  });

  // Initialize on load
  useEffect(() => {
    if (!isLoaded) return;

    const init = async () => {
      // Check for saved setup state (popup close recovery)
      const savedSetup = await getSetupState();
      if (savedSetup?.step === 'selecting_default' && savedSetup.currentSeasonLeagues?.length) {
        // Restore selecting_default state
        setCurrentSeasonLeagues(savedSetup.currentSeasonLeagues);
        if (savedSetup.currentSeason && savedSetup.pastSeasons) {
          setDiscoveryCounts({
            currentSeason: savedSetup.currentSeason,
            pastSeasons: savedSetup.pastSeasons,
          });
        }
        const defaultLeague = savedSetup.currentSeasonLeagues.find(l => l.isDefault) || savedSetup.currentSeasonLeagues[0];
        setSelectedDefault(`${defaultLeague.sport}|${defaultLeague.leagueId}|${defaultLeague.seasonYear}`);
        setState('setup_selecting_default');
        return;
      } else if (savedSetup?.step) {
        await clearSetupState();
      }

      // Check ESPN cookies
      const espnCreds = await getEspnCredentials();
      if (!espnCreds || !validateCredentials(espnCreds)) {
        setState('no_espn');
        return;
      }

      // Check server status
      if (isSignedIn) {
        try {
          const token = await getToken();
          if (token) {
            const status = await checkStatus(token);
            setHasCredentials(status.hasCredentials);
          }
        } catch {
          // Ignore - will show ready state
        }
      }

      setState('ready');
    };

    init();
  }, [isLoaded, isSignedIn, getToken]);

  // Handle full setup flow
  const handleFullSetup = async () => {
    const token = await getToken();
    if (!token) return;

    const espnCreds = await getEspnCredentials();
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setState('no_espn');
      return;
    }

    setError(null);

    // Step 1: Sync credentials
    setState('setup_syncing');
    await setSetupState({ step: 'syncing' });

    try {
      await syncCredentials(token, espnCreds);
      setHasCredentials(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to sync';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
      return;
    }

    // Step 2: Discover leagues
    setState('setup_discovering');
    await setSetupState({ step: 'discovering' });

    try {
      const result = await discoverLeagues(token);
      setDiscoveredLeagues(result.discovered);
      setCurrentSeasonLeagues(result.currentSeasonLeagues);
      setDiscoveryCounts({
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });

      if (result.currentSeasonLeagues.length === 0) {
        setState('setup_complete');
        await clearSetupState();
        return;
      }

      const existingDefault = result.currentSeasonLeagues.find(l => l.isDefault);
      if (existingDefault && result.currentSeason.added === 0) {
        setSelectedDefault(`${existingDefault.sport}|${existingDefault.leagueId}|${existingDefault.seasonYear}`);
        setState('setup_complete');
        await clearSetupState();
        return;
      }

      const preselected = existingDefault || result.currentSeasonLeagues[0];
      setSelectedDefault(`${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`);

      setState('setup_selecting_default');
      await setSetupState({
        step: 'selecting_default',
        currentSeasonLeagues: result.currentSeasonLeagues,
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Discovery failed';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
    }
  };

  const handleFinishSetup = async () => {
    if (!selectedDefault) {
      setError('Please select a default league');
      return;
    }

    const token = await getToken();
    if (!token) return;

    const [sport, leagueId, seasonYearStr] = selectedDefault.split('|');
    const seasonYear = parseInt(seasonYearStr, 10);

    try {
      await setDefaultLeague(token, { sport, leagueId, seasonYear });
      setState('setup_complete');
      await clearSetupState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  };

  const openFlaim = async (path: string = '/') => {
    const baseUrl = await getSiteBase();
    chrome.tabs.create({ url: `${baseUrl}${path}` });
  };

  // Render signed-out state
  if (!isLoaded) {
    return (
      <div className="popup">
        <div className="header">
          <h1>Flaim</h1>
          <span className="status-badge disconnected">Loading</span>
        </div>
        <div className="content">
          <div className="message info" style={{ textAlign: 'center' }}>
            <span className="spinner"></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <div className="header">
        <h1>Flaim</h1>
        <SignedIn>
          <span className="status-badge connected">
            {state.startsWith('setup_') ? 'Setting Up' : 'Connected'}
          </span>
        </SignedIn>
        <SignedOut>
          <span className="status-badge disconnected">Not Signed In</span>
        </SignedOut>
      </div>

      <SignedOut>
        <div className="content">
          <div className="message info">
            Sign in to Flaim to sync your ESPN credentials.
          </div>
          <button className="button primary full-width" onClick={() => openFlaim('/sign-in')}>
            Sign in at flaim.app
          </button>
          <button className="button secondary full-width" onClick={() => openFlaim('/')}>
            Learn More
          </button>
        </div>
      </SignedOut>

      <SignedIn>
        {/* State-based rendering similar to current, but without pairing states */}
        {state === 'loading' && (
          <div className="content">
            <div className="message info" style={{ textAlign: 'center' }}>
              <span className="spinner"></span>
            </div>
          </div>
        )}

        {state === 'no_espn' && (
          <div className="content">
            <div className="message warning">
              Please log into ESPN.com first, then come back here.
            </div>
            <button
              className="button primary full-width"
              onClick={() => chrome.tabs.create({ url: 'https://www.espn.com/fantasy/' })}
            >
              Open ESPN Fantasy
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div className="content">
            {hasCredentials ? (
              <div className="message success">Your ESPN credentials are synced!</div>
            ) : (
              <div className="message info">Ready to sync your ESPN credentials.</div>
            )}
            <button className="button success full-width" onClick={handleFullSetup}>
              {hasCredentials ? 'Re-sync & Discover Leagues' : 'Sync to Flaim'}
            </button>
            <button className="button secondary full-width" onClick={() => openFlaim('/leagues')}>
              Go to Leagues
            </button>
          </div>
        )}

        {/* Setup flow states - same as current */}
        {state === 'setup_syncing' && (
          <div className="content">
            <div className="setup-progress">
              <div className="setup-step active">
                <span className="step-icon spinner"></span>
                <span>Syncing credentials...</span>
              </div>
              <div className="setup-step pending">
                <span className="step-icon">○</span>
                <span>Discovering leagues</span>
              </div>
              <div className="setup-step pending">
                <span className="step-icon">○</span>
                <span>Select default</span>
              </div>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: '20%' }}></div>
            </div>
          </div>
        )}

        {/* ... other setup states similar to current implementation ... */}

        {state === 'setup_error' && (
          <div className="content">
            <div className="message error">{error || 'Setup failed'}</div>
            <button className="button primary full-width" onClick={handleFullSetup}>
              Try Again
            </button>
            <button
              className="button secondary full-width"
              onClick={async () => {
                await clearSetupState();
                setState('ready');
              }}
            >
              Back
            </button>
          </div>
        )}
      </SignedIn>

      <div className="footer">
        <SignedIn>
          <span className="link" onClick={() => openFlaim('/sign-out')}>
            Sign Out
          </span>
        </SignedIn>
        <SignedOut>
          <span className="link" onClick={() => openFlaim('/')}>
            Learn more about Flaim
          </span>
        </SignedOut>
      </div>
    </div>
  );
}
```

---

## Database Migration

### Tables to Deprecate

After successful migration (Phase 8):

```sql
-- Mark as deprecated (add comment)
COMMENT ON TABLE extension_pairing_codes IS 'DEPRECATED: Replaced by Clerk auth in v1.3.0';
COMMENT ON TABLE extension_tokens IS 'DEPRECATED: Replaced by Clerk auth in v1.3.0';

-- After 30 days with no issues, can drop:
-- DROP TABLE IF EXISTS extension_pairing_codes;
-- DROP TABLE IF EXISTS extension_tokens;
```

### No New Tables Needed

Clerk manages sessions—no new database tables required.

---

## Testing Checklist

### Pre-Deployment (Phase 1) ✅

- [x] Clerk Dashboard: Bot protection disabled ✅ (2026-01-11)
- [x] Clerk Dashboard: Native API enabled + production domain set ✅ (2026-01-11)
- [x] Clerk Dashboard: Extension ID in allowed_origins (dev) ✅ (2026-01-12)
- [x] Clerk Dashboard: Extension ID in allowed_origins (prod) ✅ (2026-01-11)
- [x] Environment files created (`.env.development`, `.env.production`) ✅ (2026-01-12)
- [x] Manifest host permissions include Sync Host + Frontend API domains ✅ (2026-01-12)

### Development Testing ✅

- [x] Extension builds without errors (`npm run build:dev`)
- [x] Extension loads in Chrome (unpacked)
- [x] ClerkProvider initializes without errors
- [x] Console shows "[Flaim] Background service worker started (Clerk auth)"

### Sync Host Testing

- [ ] Sign OUT of extension AND flaim.app
- [ ] Sign IN at flaim.app
- [ ] Open extension popup → shows signed in
- [ ] Sign OUT at flaim.app
- [ ] Close and reopen extension popup → shows signed out

### ESPN Flow Testing

- [ ] Signed in, no ESPN cookies → shows "log into ESPN" message
- [ ] After logging into ESPN → shows "Ready to sync"
- [ ] Click "Sync to Flaim" → syncs credentials
- [ ] Click "Re-sync & Discover Leagues" → discovers leagues
- [ ] Select default league → completes setup
- [ ] Close popup mid-setup → reopen → recovers state

### API Testing

- [ ] `/api/extension/sync` accepts Clerk JWT
- [ ] `/api/extension/status` accepts Clerk JWT
- [ ] `/api/extension/discover` accepts Clerk JWT
- [ ] `/api/extension/set-default` accepts Clerk JWT
- [ ] Auth-worker validates Clerk JWT correctly

### Edge Cases

- [ ] Clerk token expires during operation → handles gracefully
- [ ] Network failure during Clerk init → shows error
- [ ] Multiple browser sessions → session syncs correctly
- [ ] User signs out mid-operation → handles gracefully

### Production Testing

- [ ] Published extension loads correctly
- [ ] Sync Host works with flaim.app (not localhost)
- [ ] Full user flow: sign in → sync → discover → set default
- [ ] Extension ping from flaim.app/extension works

---

## Rollback Plan

> **Note**: As of v1.3.0, pairing code endpoints have been removed. Rollback requires restoring code from git history.

If critical issues arise post-deployment:

### Immediate Rollback (< 1 hour)

1. **Revert extension to v1.2.1**
   - Chrome Web Store: Upload previous version
   - Users auto-update within 24 hours

2. **Restore pairing code endpoints from git**
   - `git checkout HEAD~N -- web/app/api/extension/code`
   - `git checkout HEAD~N -- web/app/api/extension/pair`
   - `git checkout HEAD~N -- web/app/api/extension/token`
   - `git checkout HEAD~N -- workers/auth-worker/src/extension-storage.ts`

3. **Database tables still exist**
   - `extension_pairing_codes` and `extension_tokens` are intact
   - No data migration needed

### Post-Rollback

1. **Users will need to re-pair**
   - Clerk-authenticated users lose extension access
   - Generate new pairing code and re-pair

2. **Monitor error rates**
   - Track 401 errors from extension endpoints
   - Compare pre/post deployment

---

## Estimated Effort

| Phase | Description | Time |
|-------|-------------|------|
| Phase 1 | Clerk Dashboard configuration | 15 min |
| Phase 2 | Extension SDK integration | 2-3 hours |
| Phase 3 | Popup component refactor | 2-3 hours |
| Phase 4 | API client update | 1 hour |
| Phase 5 | Background service worker | 30 min |
| Phase 6 | Auth-worker endpoints | 1-2 hours |
| Phase 7 | Web UI simplification | 1 hour |
| Phase 8 | Cleanup (post-deploy) | 1 hour |
| **Total** | | **9-12 hours** |

---

## Summary

**Goal**: Replace custom pairing-code flow with Clerk Sync Host authentication (implemented in v1.3.0).

**Approach**: Sync Host (users sign in at flaim.app, session syncs to extension).

**Key Changes**:
1. Add `@clerk/chrome-extension` SDK
2. Wrap popup in `<ClerkProvider>` with `syncHost`
3. Use Clerk JWTs for API calls instead of custom tokens
4. Simplify popup from 13 states to 7 states
5. Auth-worker validates Clerk JWTs for extension endpoints (pairing endpoints removed)

**Benefits**:
- No more pairing codes to manage
- Unified auth (web and extension use same Clerk session)
- Simpler codebase (remove ~1000 lines of pairing code logic)
- OAuth/social login works (via web, syncs to extension)

**Risks**:
- Clerk SDK compatibility with Vite/@crxjs
- Sync Host reliability
- User migration (existing users need to sign out/in)

**Mitigation**:
- Thorough testing before deployment
- Rollback requires restoring pairing endpoints from git if needed
- Monitor error rates post-deployment
