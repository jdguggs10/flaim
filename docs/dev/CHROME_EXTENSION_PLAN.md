# Chrome Extension Implementation

> **Status**: Production Ready | **Next**: Chrome Web Store submission (when ready for users)
> **Updated**: December 31, 2025

---

## Summary

Chrome extension that auto-captures ESPN credentials (SWID, espn_s2 cookies) and syncs them to Flaim via a pairing code flow. Users select leagues on `/leagues` page after syncing.

---

## Completed

### Infrastructure & Code ✅

| Task | Status | Verified |
|------|--------|----------|
| Database migration | ✅ Done | Tables visible in Supabase |
| Auth worker handlers | ✅ Done | Rate limiting, atomic ops |
| Next.js API routes | ✅ Done | 6 proxy routes with IP forwarding |
| Web UI `/extension` page | ✅ Done | Pairing flow works |
| Chrome extension code | ✅ Done | Manifest V3, React popup |
| Extension icons | ✅ Done | 16/48/128 PNG from AppIcons |
| Extension build | ✅ Done | `extension/dist/` created |

### Local Testing ✅

| Test | Result | Date |
|------|--------|------|
| Generate pairing code | ✅ Pass | Dec 31, 2025 |
| Enter code in extension | ✅ Pass | Dec 31, 2025 |
| ESPN cookie capture | ✅ Pass | Dec 31, 2025 |
| Sync credentials | ✅ Pass | Dec 31, 2025 |
| Web UI shows "Connected" | ✅ Pass | Dec 31, 2025 |
| Data stored in Supabase | ✅ Pass | Dec 31, 2025 |

### Production Deployment ✅

| Component | Status | Date |
|-----------|--------|------|
| Auth worker deployed | ✅ Done | Dec 31, 2025 |
| Web app deployed (Vercel) | ✅ Done | Dec 31, 2025 |
| Production API verified | ✅ Done | Dec 31, 2025 |

### Production Testing ✅

Tested via curl against `flaim.app/api/extension/*`:

| Test | Result | Date |
|------|--------|------|
| Generate pairing code (web UI) | ✅ Pass | Dec 31, 2025 |
| Exchange code for token (API) | ✅ Pass | Dec 31, 2025 |
| Check status with token (API) | ✅ Pass | Dec 31, 2025 |

**Note**: Full end-to-end extension testing requires Chrome Web Store publication (unpacked extensions auto-detect as dev mode and route to localhost). Production APIs verified independently.

### Security Features ✅

- **Rate limiting**: 5 codes/hour per user, 10 pair attempts/10min per IP
- **Atomic pairing**: Race condition prevented via row-count verification
- **IP forwarding**: Client IP passed from Next.js proxy
- **Dev/prod detection**: Uses official `chrome.management.getSelf()` API

---

## Remaining Tasks

### 1. Edge Case Testing (Optional)

These edge cases can be tested if desired:

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Expired code | Wait 10+ min, try to pair | "Invalid or expired pairing code" |
| Invalid code | Enter "AAAAAA" | "Invalid or expired pairing code" |
| No ESPN session | Sync without ESPN login | "Please log into ESPN.com first" |
| Rate limit (pair) | 11 wrong codes in 10 min | 429 "Too many pairing attempts" |
| Rate limit (code) | Generate 6 codes in 1 hour | 429 "Too many code generation attempts" |
| Token rotation | Pair ext A, then pair ext B | Extension A gets 401 on next sync |

---

### 2. Chrome Web Store (When Ready for Users)

#### Prerequisites
- [ ] Chrome Developer account ($5 one-time fee)
- [ ] Privacy policy at `flaim.app/privacy`
- [ ] Remove localhost from manifest (see below)
- [ ] Screenshots (1280x800 or 640x400)
- [ ] Prepare CWS data disclosure answers (see below)

#### Policy Compliance Assessment

**Verdict: Should be approved** - Similar extensions exist (Sync Your Cookie, SyncMyCookie, password managers like Bitwarden) that read cookies and sync to external servers.

Our extension complies because:
- ✅ **Prominent disclosure** - Entire purpose is syncing ESPN credentials
- ✅ **User-initiated** - User clicks "Sync to Flaim", not automatic
- ✅ **HTTPS transmission** - All API calls encrypted in transit
- ✅ **Single purpose** - One clear function
- ✅ **No third-party sale** - Data stays with Flaim
- ✅ **Encryption at rest** - Supabase encrypts by default

**Policy exception that applies**: Chrome allows cookie collection "to the extent required for a user-facing feature described prominently in the Product's Chrome Web Store page."

#### Data the Extension Handles

| Data | Source | Destination | Retention |
|------|--------|-------------|-----------|
| SWID cookie | espn.com | flaim.app → Supabase | Until user disconnects |
| espn_s2 cookie | espn.com | flaim.app → Supabase | Until user disconnects |
| Extension token | flaim.app | chrome.storage.local | Until user disconnects |

#### CWS Data Use Certification Answers

| Question | Answer |
|----------|--------|
| Personally identifiable info? | Yes - ESPN cookies identify user's account |
| Authentication info? | Yes - ESPN session cookies |
| Sell user data? | No |
| Use for unrelated purposes? | No |
| Transfer to third parties? | No (Flaim servers are first-party) |

#### Permission Justifications

| Permission | Justification Text |
|------------|-------------------|
| `cookies` | "Read ESPN authentication cookies (SWID, espn_s2) to sync fantasy league access to Flaim. This is the extension's core and only purpose." |
| `storage` | "Store extension authentication token locally to maintain connection with Flaim." |
| `host_permissions: espn.com` | "Access ESPN.com cookies for user authentication. Required for core functionality." |
| `host_permissions: flaim.app` | "Communicate with Flaim API to sync credentials securely over HTTPS." |

#### Remove localhost from manifest

Before Web Store submission, create production manifest without localhost:

**Option A: Separate manifest**
```json
// extension/manifest.prod.json
{
  "host_permissions": [
    "https://*.espn.com/*",
    "https://flaim.app/api/extension/*"
  ]
}
```

**Option B: Build-time replacement**
Update `vite.config.ts` to strip localhost in production builds.

#### Privacy Policy Must Include
- What we collect: ESPN cookies (SWID, espn_s2) - session identifiers only
- Why: To fetch user's fantasy league data on their behalf
- How transmitted: HTTPS only, encrypted in transit
- Where stored: Supabase (encrypted at rest, row-level security)
- Retention: Until user disconnects from flaim.app/extension
- User rights: Disconnect anytime, which revokes extension access
- Third parties: No data sold or shared
- Not affiliated with ESPN (use their data with user's explicit consent)
- Contact info for privacy questions

#### Store Listing
- **Name**: Flaim - ESPN Fantasy Connector
- **Category**: Productivity
- **Description**: Automatically sync your ESPN fantasy credentials to Flaim without manual cookie extraction.
- **Note**: Add "Not affiliated with ESPN" disclaimer

#### Bug Fixes / Updates Process
1. Bump `version` in manifest.json (e.g., "1.0.0" → "1.0.1")
2. Run `npm run build` in extension/
3. Zip `extension/dist/` folder
4. Upload to CWS dashboard → Submit for review
5. Updates typically reviewed faster (~hours to 1 day)
6. Chrome auto-updates users within ~24 hours

---

## Architecture Reference

```
Chrome Extension → Next.js API Routes → Auth Worker → Supabase
     ↓                    ↓                  ↓            ↓
 ESPN cookies      IP forwarding      Rate limiting   Token storage
 Token storage     Clerk auth         Atomic updates  Credentials
```

### API Endpoints
| Endpoint | Auth | Rate Limit |
|----------|------|------------|
| `POST /extension/code` | Clerk | 5/hour per user |
| `POST /extension/pair` | Code | 10/10min per IP |
| `POST /extension/sync` | Bearer | None |
| `GET /extension/status` | Bearer | None |
| `GET /extension/connection` | Clerk | None |
| `DELETE /extension/token` | Clerk | None |

### File Locations
```
extension/                      # Chrome extension
├── dist/                       # Built output (load this in Chrome)
├── src/popup/Popup.tsx         # Main UI
├── src/lib/api.ts              # API client with dev/prod detection
├── src/lib/espn.ts             # Cookie capture
└── assets/icons/               # 16/48/128 PNG icons

workers/auth-worker/src/
├── extension-storage.ts        # DB operations
├── extension-handlers.ts       # Request handlers + rate limiting
└── index.ts                    # Routes

web/app/api/extension/          # Next.js proxy routes
web/app/(site)/extension/       # Setup page UI
docs/migrations/005_extension_tables.sql  # DB schema
```

---

## Future Enhancements

- **Auto-discovery**: Call ESPN v3 API to auto-discover user's leagues
- **Multi-browser**: Publish to Edge Add-ons (same Manifest V3)
- **Status badge**: Show icon badge when credentials need refresh
- **Background sync**: Periodic credential refresh without user action
