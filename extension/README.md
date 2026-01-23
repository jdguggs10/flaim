# Flaim Chrome Extension

Chrome extension that auto-captures ESPN credentials (SWID, espn_s2 cookies) and syncs them to Flaim via Clerk Sync Host (no pairing codes). Eliminates manual DevTools cookie extraction.

## User Flow (v1.3.2)

1. Install extension from [Chrome Web Store](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn)
2. Sign in to `flaim.app` (session syncs to the extension)
3. Log into ESPN.com (if not already)
4. Click "Sync to Flaim" - the extension will:
   - Sync your ESPN credentials
   - Auto-discover all your leagues (including past seasons) via ESPN Fan API
   - Show discovery results with granular counts (new vs already saved)
   - Let you pick a default league
5. View your leagues at `flaim.app/leagues`

**Automation boundaries**
- The extension only runs discovery when you click **Sync / Re-sync**.
- `/leagues` actions are manual and separate from the extension flow.

## Development

### Prerequisites

- Node.js 24+
- npm

### Setup

```bash
cd extension
npm install
```

### Build Commands

```bash
# Development build (includes localhost for local testing)
npm run build:dev

# Production build (strips localhost, ready for CWS)
npm run build

# Create zip for Chrome Web Store upload
zip -r flaim-extension-v1.3.2.zip dist/
```

### Load Unpacked Extension

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/dist` folder

### Dev vs Prod Detection

The extension uses `chrome.management.getSelf()` to detect install type:
- **Unpacked** (development): Routes to `localhost:3000`
- **Chrome Web Store** (production): Routes to `flaim.app`

This is handled in `src/lib/api.ts`. The `vite.config.ts` also strips localhost from `host_permissions` in production builds.

## Architecture

```
Extension Popup → Clerk Sync Host → POST /api/extension/sync → Auth Worker → Supabase
     ↓
ESPN Cookies → POST /api/extension/sync → Auth Worker → Supabase
```

**Discovery note**: League discovery uses ESPN's Fan API with a normalized
`{SWID}` and ESPN-recommended headers; this reduces calls to a single request.

### Sync Host Flow

1. User signs in at `flaim.app`
2. Extension popup detects session via Clerk Sync Host
3. Extension reads ESPN cookies and syncs to Flaim using Clerk JWTs

### API Endpoints

All routes go through Next.js proxy (`/api/extension/*`) to auth-worker:

| Endpoint | Auth | Rate Limit | Purpose |
|----------|------|------------|---------|
| `POST /extension/sync` | Clerk JWT | None | Sync ESPN credentials |
| `POST /extension/discover` | Clerk JWT | None | Discover and save leagues (v1.1) |
| `POST /extension/set-default` | Clerk JWT | None | Set default league (v1.1) |
| `GET /extension/status` | Clerk JWT | None | Check connection status |
| `GET /extension/connection` | Clerk | None | Web UI status check |

## File Structure

```
extension/
├── dist/                       # Built output (load this in Chrome)
├── src/
│   ├── popup/
│   │   ├── index.html          # Popup entry point
│   │   ├── main.tsx            # React mount
│   │   ├── Popup.tsx           # Main UI component
│   │   └── popup.css           # Styles
│   └── lib/
│       ├── api.ts              # Flaim API client (dev/prod detection)
│       ├── storage.ts          # chrome.storage wrapper
│       └── espn.ts             # ESPN cookie capture
├── assets/icons/               # 16/48/128 PNG icons
├── manifest.json               # Extension manifest (Manifest V3)
├── vite.config.ts              # Build config (strips localhost in prod)
├── tsconfig.json               # TypeScript config
└── package.json
```

### Related Files (outside extension/)

```
workers/auth-worker/src/
├── extension-handlers.ts       # Extension API handlers (Clerk JWT)
└── index.ts                    # Routes

web/app/api/extension/          # Next.js proxy routes
web/app/(site)/page.tsx         # Landing page setup flow
web/app/(site)/privacy/         # Privacy policy page
```

## Security

- **Clerk JWT auth**: Extension uses Clerk session, no custom tokens stored
- **HTTPS only**: All API calls encrypted in transit
- **No credentials in extension**: ESPN cookies synced once, not stored locally

## Chrome Web Store

### Store Listing

- **Name**: Flaim - ESPN Fantasy Connector
- **Summary**: Automatically sync your ESPN fantasy credentials to Flaim without manual cookie extraction.
- **Category**: Productivity
- **Privacy policy**: https://flaim.app/privacy

### Permission Justifications

| Permission | Justification |
|------------|---------------|
| `cookies` | Read ESPN authentication cookies (SWID, espn_s2) to sync fantasy league access to Flaim. This is the extension's core and only purpose. |
| `storage` | Store setup state locally (popup recovery). |
| `host_permissions: espn.com` | Access ESPN.com cookies for user authentication. Required for core functionality. |
| `host_permissions: flaim.app` | Communicate with Flaim API to sync credentials securely over HTTPS. |

### Publishing Updates

1. Bump `version` in `manifest.json` (e.g., "1.0.0" → "1.0.1")
2. Run `npm run build`
3. Zip the `dist/` folder
4. Upload to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
5. Submit for review (updates typically reviewed in hours to 1 day)
6. Chrome auto-updates users within ~24 hours

## Local Dev: Website ↔ Extension Ping

The website can ping the extension directly to verify it's installed and signed in. This requires:

1. **Extension side**: `externally_connectable` in manifest.json (already configured for `flaim.app` and `localhost:3000`)
   - After changes, rebuild and reload the unpacked extension:
     ```
     npm run build:dev
     ```
     Then reload in `chrome://extensions` and confirm the **service worker** link appears.

2. **Website side**: Extension ID(s) to ping. For local dev with an unpacked extension:
   - Find your local extension ID in `chrome://extensions` (shown under the extension name in Developer mode)
   - Set `NEXT_PUBLIC_EXTENSION_IDS` in `web/.env.local`:
     ```
     # Comma-separated: production ID first, then local dev ID
     NEXT_PUBLIC_EXTENSION_IDS=ogkkejmgkoolfaidplldmcghbikpmonn,YOUR_LOCAL_EXTENSION_ID
     ```
   - The website will try each ID until one responds

**Note**: Each time you reload an unpacked extension, the ID may change unless you set a stable dev key. If ping fails in local dev, check the ID.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Failed to fetch" | Production build loaded locally | Rebuild with `npm run build:dev` |
| Extension shows "Not Signed In" | Clerk session not synced | Close/reopen the extension popup |
| ESPN cookies not found | Not logged into ESPN | Log into espn.com, then retry |
| Website shows "Not Connected" in Chrome | Extension ID mismatch | Check `NEXT_PUBLIC_EXTENSION_IDS` matches your local extension ID |

## Future Enhancements

- **Multi-browser**: Publish to Edge Add-ons (same Manifest V3)
- **Status badge**: Show icon badge when credentials need refresh
- **Background sync**: Periodic credential refresh without user action
