# TODO

## Features
- ~~Make the auto-pull league feature also automatically trigger the season pull feature as well.~~ *(Done in v1.1)*

## Bugs

### Active: ESPN `mUserLeagues` API endpoint returning no leagues

**Symptom**: Clicking "Re-sync & Discover Leagues" in the Chrome extension doesn't discover ANY leagues (not just league 24652). ESPN API returns 200 OK but the response contains only season metadata, no `leagues` array.

**Critical Finding**: Manual league add on the /leagues page WORKS. Auto-discovery does NOT. This proves credentials are valid but the specific API endpoint used for discovery is broken.

---

#### Investigation Summary (Jan 8, 2026)

**1. The Problem**

The `discoverLeaguesV3()` function in `league-discovery.ts` calls:
```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/{gameId}/seasons/{season}?view=mUserLeagues
```

ESPN returns 200 OK but the response is just season metadata:
```json
{
  "abbrev": "FFL 2025",
  "active": true,
  "gameId": 1,
  "id": 2025,
  "name": "Fantasy Football 2025",
  ...
}
```

**No `leagues` array is returned**, which is what we need to list user's leagues.

**2. What Works vs What Doesn't**

| Feature | Endpoint | Status |
|---------|----------|--------|
| Manual add (specific league) | `/seasons/{season}/segments/0/leagues/{leagueId}?view=mSettings` | WORKS |
| Auto-discovery (all leagues) | `/seasons/{season}?view=mUserLeagues` | BROKEN |

**3. What We Ruled Out**

- **Season calculation**: Confirmed correct (2025 for football in Jan 2026, rollover June 1)
- **SWID format**: Confirmed correct format `{BFA3386F-...}` with length 38
- **espn_s2 cookie**: Confirmed present and valid (length 346)
- **User-Agent header**: Tried both custom and browser-like UA - no difference
- **Credentials validity**: Manual add works with same credentials
- **Dev vs Prod**: Both environments have the same issue
- **Different Clerk accounts**: Same issue regardless of account

**4. Debug Logging Added**

Added to `league-discovery.ts` (lines 46-47, 82-83):
```typescript
// Line 46-47: Log credentials being used
console.log(`🔑 Using SWID: ${swid.substring(0, 10)}... (len=${swid.length}), s2: ${s2.substring(0, 10)}... (len=${s2.length})`);

// Line 82-83: Log raw ESPN response
console.log(`📦 ESPN raw response for ${sport}:`, JSON.stringify(json, null, 2).substring(0, 500));
```

**5. Sample Debug Output**

```
🔍 Querying football leagues for season 2025...
🔑 Using SWID: {BFA3386F-... (len=38), s2: AEAJ3Fy35W... (len=346)
📡 football API Response: 200 OK
📦 ESPN raw response for football: {
  "abbrev": "FFL 2025",
  "active": true,
  "currentScoringPeriod": { "id": 19 },
  "gameId": 1,
  "id": 2025,
  "name": "Fantasy Football 2025"
}
No leagues found for football
```

---

#### Root Cause Hypothesis

The ESPN `?view=mUserLeagues` endpoint appears to be:
1. **Deprecated or changed** by ESPN without notice
2. **Requires different authentication** than what we're sending
3. **Returns different data structure** than expected

The ESPN Fantasy API is **undocumented** and can change without warning. Community resources:
- https://github.com/cwendt94/espn-api
- https://stmorse.github.io/journal/espn-fantasy-v3.html

---

#### Potential Solutions

**Option A: Reverse-engineer ESPN's website**
1. Go to fantasy.espn.com while logged in
2. Open Chrome DevTools > Network tab
3. Navigate to your leagues list
4. Find what API call ESPN uses to list user leagues
5. Update our code to use that endpoint

**Option B: Try alternative endpoints**
- `fan-api.espn.com` - mentioned in some community docs
- Check if ESPN has a new dashboard/gambit API for league listing
- Look for `fantasyDashboard` or `configs` endpoints (referenced in `espn-types.ts`)

**Option C: Remove auto-discovery feature**
- Fall back to manual-only league entry
- Manual add works reliably with `/segments/0/leagues/{leagueId}?view=mSettings`
- Less convenient but functional

**Option D: Check if ESPN changed cookie requirements**
- Some ESPN endpoints now require being logged into the browser
- May need to pass additional cookies or headers
- Check ESPN's recent API changes (2025-2026)

---

#### Files Involved

- `workers/auth-worker/src/v3/league-discovery.ts` - **Main discovery logic (broken)**
  - `discoverLeaguesV3()` - calls mUserLeagues endpoint
  - Lines 50-60: The fetch call that's returning no leagues

- `workers/auth-worker/src/v3/get-league-info.ts` - **Manual add logic (works)**
  - `getLeagueInfo()` - calls specific league endpoint
  - Uses different URL pattern: `/segments/0/leagues/{leagueId}`

- `workers/auth-worker/src/espn-types.ts` - Type definitions
  - Contains `GambitDashboardResponse` with "New 2025 format" comment
  - May have clues about alternative API structures

- `extension/src/lib/espn.ts` - Cookie extraction (confirmed working)

---

#### Historical Context

- **v4.1.1**: Added automatic ESPN league discovery (this feature)
- **v1.1**: Auto-discovery worked at some point
- **Jan 2026**: Started failing - unclear exactly when

The user confirmed "this once worked in an older version of the extension" - suggests ESPN changed something server-side.

---

#### Next Steps

1. [ ] Check ESPN's website Network tab to find current league listing endpoint
2. [ ] Search for recent ESPN API changes or community reports of mUserLeagues breaking
3. [ ] Try calling ESPN's endpoint directly with curl to isolate the issue
4. [ ] Consider if ESPN requires browser session/additional cookies now
5. [ ] Decide whether to fix or remove auto-discovery feature

---

### Resolved

- ~~**League delete succeeds in UI but fails to delete from Supabase**: Fixed in `removeLeague()` - now uses `.select()` to verify rows were deleted and returns `false` if 0 rows matched. Added logging for debugging.~~

- ~~**Silent skip on missing teamId**: Original hypothesis was that leagues were being skipped due to missing teamId. Investigation showed the actual issue is that ESPN returns NO leagues at all, not that leagues are being skipped.~~
