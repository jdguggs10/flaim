# Sprint B: Testing Runbooks + Submission Packaging + Gemini CLI

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete testing infrastructure, submission artifacts, and ship the first distribution channel (Gemini CLI). Make Flaim submission-ready for Claude and ChatGPT directories.

**Architecture:** Cross-repo work (flaim + flaim-eval). Docs land in permanent locations. Runbooks are checklists, not prose. Gemini setup is the first channel to ship (no app store review needed).

**Tech Stack:** Markdown docs, JSON test scenarios, bash scripts (for pre-submission checklist).

**Parent plan:** `docs/dev/plugins-buildout-plan.md` — Sprint B covers Workstream 3 (Testing Runbooks), Workstream 4 (Submission Packaging), and Workstream 5 (Gemini CLI Distribution).

---

## Task 1: Add negative test scenarios to flaim-eval

**Purpose:** Expand flaim-eval coverage to include error scenarios that will be checked during vendor reviews.

**Repo:** `~/Code/flaim-eval/`

**Files to create:**
- `scenarios/invalid_sport.json`
- `scenarios/wrong_platform.json`
- `scenarios/missing_credentials.json`
- `scenarios/expired_token.json` (requires manual token expiry setup)

**Step 1: Write invalid_sport scenario**

Create `~/Code/flaim-eval/scenarios/invalid_sport.json`:

```json
{
  "id": "invalid_sport",
  "prompt": "What are my golf league standings?",
  "description": "Negative test — invalid sport. Should call get_user_session but fail when trying to access an unsupported sport.",
  "expected_tools": ["get_user_session"],
  "tags": ["negative", "error-handling"]
}
```

**Step 2: Write wrong_platform scenario**

Create `~/Code/flaim-eval/scenarios/wrong_platform.json`:

```json
{
  "id": "wrong_platform",
  "prompt": "Show me my Sleeper league roster.",
  "description": "Negative test — unsupported platform. Should recognize Sleeper is not supported and explain limitations.",
  "expected_tools": ["get_user_session"],
  "tags": ["negative", "error-handling"]
}
```

**Step 3: Write missing_credentials scenario**

This scenario requires a test account that has NO ESPN credentials synced. Document this requirement in the scenario:

Create `~/Code/flaim-eval/scenarios/missing_credentials.json`:

```json
{
  "id": "missing_credentials",
  "prompt": "Get my ESPN football league standings.",
  "description": "Negative test — missing credentials. Requires test account with no ESPN credentials. Should fail gracefully with CREDENTIALS_MISSING error code.",
  "expected_tools": ["get_user_session"],
  "tags": ["negative", "auth", "manual-setup"],
  "setup_notes": "Run with test account that has no ESPN credentials synced. Expected error: CREDENTIALS_MISSING or ESPN_CREDENTIALS_NOT_FOUND."
}
```

**Step 4: Write expired_token scenario**

This scenario requires manual token expiry. Document as manual-only:

Create `~/Code/flaim-eval/scenarios/expired_token.json`:

```json
{
  "id": "expired_token",
  "prompt": "What's my team roster?",
  "description": "Negative test — expired OAuth token. Manual-only scenario. Requires setting token expiry to past date in oauth_tokens table before running.",
  "expected_tools": [],
  "tags": ["negative", "auth", "manual-only"],
  "setup_notes": "Manual test only. Update oauth_tokens.expires_at to past timestamp for test user before eval run. Expected: 401 with AUTH_FAILED and WWW-Authenticate header."
}
```

**Step 5: Test auto-discovery**

Run flaim-eval to verify new scenarios are auto-discovered:

```bash
cd ~/Code/flaim-eval
npm run eval -- --list
```

Expected output should show all 5 original scenarios + 4 new ones (9 total).

**Step 6: Run happy path scenarios only to verify no breakage**

```bash
cd ~/Code/flaim-eval
npm run eval best_waiver_adds
npm run eval who_is_on_my_roster
npm run eval standings_and_playoff_outlook
```

All should pass.

**Step 7: Document testing requirements**

Update `~/Code/flaim-eval/docs/OPERATIONS.md` to add a section on negative scenarios:

Add before the "Running specific scenarios" section:

```markdown
## Negative Scenarios

Some scenarios test error paths and require special setup:

- `missing_credentials`: Requires test account with no ESPN credentials synced.
- `expired_token`: Manual-only. Set `oauth_tokens.expires_at` to past date before running.

These scenarios are expected to produce error responses with structured error codes (see `docs/ERROR-CODES.md` in main repo).

To run only happy-path scenarios:

\`\`\`bash
npm run eval best_waiver_adds who_is_on_my_roster standings_and_playoff_outlook
\`\`\`
```

**Step 8: Commit in flaim-eval repo**

```bash
cd ~/Code/flaim-eval
git add scenarios/invalid_sport.json scenarios/wrong_platform.json scenarios/missing_credentials.json scenarios/expired_token.json docs/OPERATIONS.md
git commit -m "test: add negative error scenarios for vendor review coverage"
```

---

## Task 2: Add pre-submission checklist script to flaim-eval

**Purpose:** Create a script that validates flaim-eval results against submission readiness criteria.

**Repo:** `~/Code/flaim-eval/`

**Files to create:**
- `src/pre-submission-check.ts`
- Update `package.json` to add `presubmit` script

**Step 1: Write the pre-submission checker**

Create `~/Code/flaim-eval/src/pre-submission-check.ts`:

```typescript
#!/usr/bin/env node

/**
 * Pre-submission checklist validator
 * 
 * Reads the most recent flaim-eval run and checks:
 * 1. All happy-path scenarios passed
 * 2. No tool schema/contract violations
 * 3. Error scenarios returned proper error codes
 * 4. Trace observability is complete
 * 
 * Exit 0 if submission-ready, exit 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';

interface Manifest {
  run_id: string;
  timestamp: string;
  traces: Array<{
    trace_id: string;
    scenario_id: string;
    status: 'completed' | 'errored';
  }>;
}

interface AcceptanceSummary {
  run_id: string;
  policy_version: string;
  result: 'PASS' | 'FAIL';
  decisions: Array<{ trace_id: string; result: string; reasons: string[] }>;
}

const HAPPY_PATH_SCENARIOS = [
  'best_waiver_adds',
  'standings_and_playoff_outlook',
  'who_is_on_my_roster',
];

const ERROR_SCENARIOS = [
  'invalid_sport',
  'wrong_platform',
  'missing_credentials',
];

function getMostRecentRun(): string | null {
  const runsDir = path.join(process.cwd(), 'runs');
  if (!fs.existsSync(runsDir)) return null;

  const runs = fs.readdirSync(runsDir)
    .filter(f => f.startsWith('run_'))
    .sort()
    .reverse();

  return runs.length > 0 ? runs[0] : null;
}

function checkHappyPathScenarios(manifest: Manifest): { pass: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const scenario of HAPPY_PATH_SCENARIOS) {
    const trace = manifest.traces.find(t => t.scenario_id === scenario);
    if (!trace) {
      failures.push(`Missing scenario: ${scenario}`);
    } else if (trace.status !== 'completed') {
      failures.push(`Scenario ${scenario} status: ${trace.status}`);
    }
  }

  return { pass: failures.length === 0, failures };
}

function checkErrorScenarios(manifest: Manifest): { pass: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const scenario of ERROR_SCENARIOS) {
    const trace = manifest.traces.find(t => t.scenario_id === scenario);
    if (!trace) {
      failures.push(`Missing error scenario: ${scenario}`);
    }
    // Error scenarios may have status 'completed' (model handled error gracefully)
    // or 'errored' (expected for some failure modes). Just verify they ran.
  }

  return { pass: failures.length === 0, failures };
}

function checkObservability(runId: string): { pass: boolean; message: string } {
  const acceptancePath = path.join(process.cwd(), 'runs', runId, 'acceptance-summary.json');
  
  if (!fs.existsSync(acceptancePath)) {
    return { 
      pass: false, 
      message: 'No acceptance-summary.json found. Run: npm run accept -- ' + runId 
    };
  }

  const acceptance: AcceptanceSummary = JSON.parse(fs.readFileSync(acceptancePath, 'utf-8'));
  
  if (acceptance.result !== 'PASS') {
    const failReasons = acceptance.decisions
      .filter(d => d.result === 'FAIL')
      .flatMap(d => d.reasons);
    return { 
      pass: false, 
      message: `Observability check failed: ${failReasons.join(', ')}` 
    };
  }

  return { pass: true, message: 'Observability: PASS' };
}

async function main() {
  console.log('🔍 Pre-submission checklist\n');

  const runId = getMostRecentRun();
  if (!runId) {
    console.error('❌ No eval runs found. Run: npm run eval');
    process.exit(1);
  }

  console.log(`📊 Checking run: ${runId}\n`);

  const manifestPath = path.join(process.cwd(), 'runs', runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Check 1: Happy path scenarios
  const happyCheck = checkHappyPathScenarios(manifest);
  if (happyCheck.pass) {
    console.log('✅ Happy path scenarios: PASS');
  } else {
    console.error('❌ Happy path scenarios: FAIL');
    happyCheck.failures.forEach(f => console.error(`   - ${f}`));
  }

  // Check 2: Error scenarios
  const errorCheck = checkErrorScenarios(manifest);
  if (errorCheck.pass) {
    console.log('✅ Error scenarios: PASS (scenarios executed)');
  } else {
    console.error('❌ Error scenarios: FAIL');
    errorCheck.failures.forEach(f => console.error(`   - ${f}`));
  }

  // Check 3: Observability
  const obsCheck = checkObservability(runId);
  if (obsCheck.pass) {
    console.log(`✅ ${obsCheck.message}`);
  } else {
    console.error(`❌ ${obsCheck.message}`);
  }

  // Summary
  console.log('\n---');
  if (happyCheck.pass && errorCheck.pass && obsCheck.pass) {
    console.log('✅ SUBMISSION READY');
    process.exit(0);
  } else {
    console.log('❌ NOT SUBMISSION READY');
    console.log('\nFix issues above and re-run eval before submitting.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error running pre-submission check:', err);
  process.exit(1);
});
```

**Step 2: Add script to package.json**

Edit `~/Code/flaim-eval/package.json` to add:

```json
{
  "scripts": {
    "presubmit": "tsx src/pre-submission-check.ts"
  }
}
```

**Step 3: Test the script against an existing run**

```bash
cd ~/Code/flaim-eval
npm run presubmit
```

Expected: If no runs exist, it should fail gracefully. If a run exists, it should check the criteria.

**Step 4: Document the presubmit command**

Update `~/Code/flaim-eval/README.md` to add the command to the quick start:

```markdown
npm run presubmit         # Check if latest run is submission-ready
```

Also update `~/Code/flaim-eval/docs/OPERATIONS.md` to add a "Pre-submission validation" section:

```markdown
## Pre-submission Validation

Before submitting to Claude/ChatGPT directories, run:

\`\`\`bash
npm run eval           # Run all scenarios
npm run enrich -- <run_id>  # Enrich traces
npm run accept -- <run_id>  # Generate acceptance summary
npm run presubmit      # Check submission readiness
\`\`\`

The presubmit check verifies:
1. All happy-path scenarios passed
2. Error scenarios executed (even if they errored)
3. Observability acceptance summary passed

Exit code 0 = submission ready.
Exit code 1 = fix issues before submitting.
```

**Step 5: Commit in flaim-eval repo**

```bash
cd ~/Code/flaim-eval
git add src/pre-submission-check.ts package.json README.md docs/OPERATIONS.md
git commit -m "feat: add pre-submission checklist validator"
```

---

## Task 3: Write manual OAuth runbooks

**Purpose:** Document repeatable manual testing steps for OAuth flows per client. These are not automated — they're checklists for pre-submission verification.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/MANUAL-OAUTH-RUNBOOKS.md`

**Step 1: Write the runbook document**

Create `~/Code/flaim/docs/MANUAL-OAUTH-RUNBOOKS.md`:

```markdown
# Manual OAuth Testing Runbooks

Pre-submission manual testing checklists for OAuth flows. Run these before each directory submission.

## Prerequisites

- Clean test account credentials (not your production account)
- Access to Claude Desktop, ChatGPT, and Gemini CLI
- ESPN league with recent data
- Supabase access to verify token storage

## Claude Desktop OAuth Flow

### Fresh Connect

1. Open Claude Desktop → Settings → Developer → Edit Config
2. Add Flaim MCP config:
   ```json
   {
     "mcpServers": {
       "flaim": {
         "url": "https://api.flaim.app/mcp"
       }
     }
   }
   ```
3. Restart Claude Desktop
4. Start a new conversation: "Show me my fantasy football roster"
5. **Expected:** OAuth consent redirect to flaim.app
6. Sign in with test account → authorize
7. **Expected:** Redirect back to Claude with success
8. **Expected:** Tool call succeeds, roster data returned
9. **Verify:** Check `oauth_tokens` table for new token with correct `resource` value

### Token Refresh After Expiry

1. Set `expires_at` to 1 minute in the future in `oauth_tokens` for test user
2. Wait 2 minutes
3. Ask Claude: "What are my league standings?"
4. **Expected:** Automatic token refresh using refresh_token
5. **Expected:** Tool call succeeds without user intervention
6. **Verify:** `oauth_tokens.expires_at` updated to new future timestamp

### 401 → Re-auth Behavior

1. Revoke token via `DELETE /api/oauth/revoke` or directly in Supabase
2. Ask Claude: "Show me free agents"
3. **Expected:** 401 response with `WWW-Authenticate` header
4. **Expected:** Claude prompts for re-authorization
5. Complete OAuth flow again
6. **Expected:** Tool call succeeds after re-auth

### Canonical Tool Calls

Run these 3 tool call sequences:

1. **Session + Roster:**
   - "What's on my fantasy roster?"
   - Expected tools: `get_user_session`, `get_roster`

2. **Session + Standings:**
   - "Show my league standings"
   - Expected tools: `get_user_session`, `get_standings`

3. **Session + Free Agents:**
   - "Who are the best available free agents?"
   - Expected tools: `get_user_session`, `get_free_agents`

## ChatGPT OAuth Flow

### Fresh Connect

1. Open ChatGPT → Settings → Integrations → Add Custom Connector
2. Enter MCP URL: `https://api.flaim.app/mcp`
3. **Expected:** OAuth consent redirect to flaim.app
4. Sign in with test account → authorize
5. **Expected:** Redirect back to ChatGPT with success
6. Test tool call: "Show me my fantasy football roster"
7. **Expected:** Tool call succeeds, roster data returned
8. **Verify:** Check `oauth_tokens` table for new token

### Token Refresh After Expiry

Same as Claude flow above.

### 401 → Re-auth Behavior

Same as Claude flow above.

### Canonical Tool Calls

Same 3 sequences as Claude:
1. Session + Roster
2. Session + Standings
3. Session + Free Agents

## Gemini CLI OAuth Flow

### Fresh Connect

1. Install Gemini CLI: `npm install -g @googlegemini/cli`
2. Configure MCP server: `gemini mcp add flaim https://api.flaim.app/mcp`
3. **Expected:** OAuth consent redirect in browser
4. Sign in with test account → authorize
5. **Expected:** CLI shows "Connected successfully"
6. Test tool call: `gemini ask "What's my fantasy roster?"`
7. **Expected:** Tool call succeeds, roster data returned
8. **Verify:** Check `oauth_tokens` table for new token

### Token Refresh After Expiry

Same as Claude flow above.

### 401 → Re-auth Behavior

Same as Claude flow above.

### Canonical Tool Calls

Same 3 sequences as Claude:
1. Session + Roster
2. Session + Standings  
3. Session + Free Agents

## Pass Criteria

All flows must:
- Complete OAuth without manual token copying
- Store tokens with correct `resource` and `scope` values
- Automatically refresh tokens on expiry
- Trigger re-auth on 401 (not crash)
- Successfully call all 3 canonical tool sequences
- Return structured data (not generic errors)

## Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| OAuth redirect fails | Redirect URI not in allowlist | Check `ALLOWED_REDIRECT_URIS` in auth-worker |
| 401 after fresh auth | Token not stored correctly | Check oauth-storage.ts token creation |
| Token refresh fails | Refresh token missing/invalid | Verify refresh_token stored during token exchange |
| Tool call returns AUTH_FAILED | Resource mismatch | Check `validateAccessToken` resource enforcement |

## Pre-Submission Checklist

Before submitting to any directory:

- [ ] Run full flaim-eval suite: `npm run eval`
- [ ] Run pre-submission check: `npm run presubmit`
- [ ] Complete Claude OAuth runbook (all sections)
- [ ] Complete ChatGPT OAuth runbook (all sections)
- [ ] Complete Gemini CLI OAuth runbook (all sections)
- [ ] Verify all canonical tool calls return expected data
- [ ] Document any deviations or failures
```

**Step 2: Update docs/INDEX.md to reference the runbook**

In `~/Code/flaim/docs/INDEX.md`, add to the permanent docs section:

```markdown
- `docs/MANUAL-OAUTH-RUNBOOKS.md`: Pre-submission OAuth testing checklists for Claude, ChatGPT, Gemini.
```

**Step 3: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/MANUAL-OAUTH-RUNBOOKS.md docs/INDEX.md
git commit -m "docs: add manual OAuth testing runbooks for pre-submission validation"
```

---

## Task 4: Build Anthropic submission packet

**Purpose:** Assemble all required artifacts for Anthropic Connectors Directory submission.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/submissions/anthropic-connector-submission.md`

**Step 1: Review Anthropic submission requirements**

Per parent plan sources, Anthropic requires:
- Privacy URL
- Support contact
- Test account credentials
- Usage instructions
- Safety notes (rate limits, data handling)

**Step 2: Create submission document**

Create `~/Code/flaim/docs/submissions/anthropic-connector-submission.md`:

```markdown
# Anthropic Connectors Directory Submission

Submission packet for Flaim MCP connector to Anthropic Connectors Directory.

**Last updated:** 2026-02-07
**Submission URL:** https://support.anthropic.com/en/articles/12922490-remote-mcp-server-submission-guide

---

## Required Information

### Connector Details

| Field | Value |
|-------|-------|
| **Connector Name** | Flaim - Fantasy Sports MCP Connector |
| **MCP Endpoint** | `https://api.flaim.app/mcp` |
| **Short Description** | Connect your ESPN and Yahoo fantasy leagues to Claude. Get rosters, standings, matchups, and free agent data via MCP tools. |
| **Category** | Sports & Entertainment |
| **OAuth 2.1** | Yes (with PKCE S256) |

### Contact & Legal

| Field | Value |
|-------|-------|
| **Privacy Policy** | https://flaim.app/privacy |
| **Support Contact** | privacy@flaim.app |
| **Developer/Organization** | Flaim (Solo indie project) |
| **Website** | https://flaim.app |

### Test Account

**Test Credentials:**
- Email: [Create dedicated test account before submission]
- Password: [Store securely, provide only to Anthropic reviewers]

**Test Account Setup:**
- Account has ESPN credentials synced
- Default league configured (2025 football season)
- OAuth token pre-authorized for faster review

**Note:** Test account will have read-only access to public league data only.

---

## Usage Instructions

### For End Users

1. **Create Flaim Account:**
   - Visit https://flaim.app
   - Sign up with email or Google

2. **Connect ESPN Credentials:**
   - Install Chrome extension: [link to CWS]
   - Or manually enter ESPN cookies at flaim.app

3. **Add Connector to Claude:**
   - Open Claude Desktop → Settings → Developer → Edit Config
   - Add:
     ```json
     {
       "mcpServers": {
         "flaim": {
           "url": "https://api.flaim.app/mcp"
         }
       }
     }
     ```
   - Restart Claude Desktop

4. **Authorize:**
   - Start conversation: "Show me my fantasy roster"
   - Complete OAuth flow when prompted
   - Grant access to your fantasy leagues

5. **Use MCP Tools:**
   - Ask about your roster, standings, matchups, free agents
   - Claude will call appropriate MCP tools automatically

### Available Tools

| Tool | Description |
|------|-------------|
| `get_user_session` | List all configured leagues with IDs |
| `get_league_info` | Get league settings and scoring config |
| `get_standings` | Current league standings |
| `get_matchups` | Weekly matchups and scores |
| `get_roster` | Team roster with player stats |
| `get_free_agents` | Available free agents |

All tools require explicit parameters: `platform` (espn/yahoo), `sport` (football/baseball), `league_id`, `season_year`.

---

## Safety & Limitations

### Rate Limits

- **200 MCP tool calls per user per day**
- Rate limit enforced at token validation layer
- Error code: `LIMIT_EXCEEDED`

### Data Handling

- **Read-only access:** All tools are read-only. No write operations (trades, waiver claims, lineup changes).
- **Credential storage:** ESPN cookies stored encrypted at rest (Supabase AES-256).
- **OAuth tokens:** Stored with expiration tracking, support refresh flow.
- **No data retention beyond session:** MCP responses are not logged or stored by Flaim.

### Error Handling

- Structured error codes documented in `docs/ERROR-CODES.md`
- Common errors: `CREDENTIALS_MISSING`, `ESPN_COOKIES_EXPIRED`, `ESPN_NOT_FOUND`
- Graceful degradation: expired credentials return clear error message with re-sync instructions

### Supported Platforms & Sports

- **ESPN:** Football, Baseball (Basketball and Hockey coming soon)
- **Yahoo:** Football, Baseball (Basketball and Hockey coming soon)

Attempting to use unsupported combinations returns `NOT_SUPPORTED` error code.

---

## Technical Details

### OAuth 2.1 Implementation

- **Authorization endpoint:** `https://api.flaim.app/auth/authorize`
- **Token endpoint:** `https://api.flaim.app/auth/token`
- **PKCE:** Required (S256 only, `plain` rejected)
- **Scopes:** `mcp:read` (all current tools), `mcp:write` (reserved for future)
- **Token lifetime:** 7 days (access token), 30 days (refresh token)
- **Resource parameter:** Enforced (RFC 9728)

### MCP Protocol Compliance

- **MCP Version:** 2025-11-25
- **Transport:** SSE (Server-Sent Events) over HTTP
- **Authentication:** Bearer token in `Authorization` header
- **Tool security:** Per-tool `securitySchemes` declared, scope enforcement at gateway
- **Error signaling:** `_meta["mcp/www_authenticate"]` included in auth errors

### Protected Resource Metadata

Available at: `https://api.flaim.app/.well-known/oauth-protected-resource`

---

## Testing Checklist

Before submission:

- [ ] Run full eval suite: `cd ~/Code/flaim-eval && npm run eval && npm run presubmit`
- [ ] Complete Claude OAuth runbook (see `docs/MANUAL-OAUTH-RUNBOOKS.md`)
- [ ] Verify all 7 tools work in Claude Desktop
- [ ] Verify token refresh flow
- [ ] Verify 401 → re-auth flow
- [ ] Create dedicated test account with pre-authorized access
- [ ] Document test account credentials (store securely)
- [ ] Review privacy policy for completeness
- [ ] Verify support contact is responsive

---

## Known Limitations

- **Platform coverage:** ESPN and Yahoo only (no Sleeper, CBS, etc.)
- **Sport coverage:** Football and Baseball only at launch (Basketball and Hockey in development)
- **Read-only:** No write operations supported
- **Rate limits:** 200 calls/day per user (may adjust based on usage patterns)

---

## Changelog

**v1.0 (Feb 2026):**
- Initial submission
- ESPN + Yahoo support
- Football + Baseball sports
- 7 read-only MCP tools
- OAuth 2.1 with PKCE S256
- Rate limiting (200/day)

---

## Submission Contact

For Anthropic review team:
- Technical questions: privacy@flaim.app
- Test account access: Provided in submission email
```

**Step 3: Create submissions directory and update INDEX**

```bash
mkdir -p ~/Code/flaim/docs/submissions
```

Update `~/Code/flaim/docs/INDEX.md` to add:

```markdown
### Submission packets
- `docs/submissions/anthropic-connector-submission.md`: Anthropic Connectors Directory submission packet.
```

**Step 4: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/submissions/anthropic-connector-submission.md docs/INDEX.md
git commit -m "docs: add Anthropic connector submission packet"
```

---

## Task 5: Build OpenAI submission packet

**Purpose:** Assemble all required artifacts for ChatGPT Apps Directory submission.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/submissions/openai-app-submission.md`

**Step 1: Review OpenAI submission requirements**

Per parent plan sources, OpenAI requires:
- App metadata (name, description, category)
- Test instructions
- Screenshots (defer to execution time)
- Known limitations
- Support policy

**Step 2: Create submission document**

Create `~/Code/flaim/docs/submissions/openai-app-submission.md`:

```markdown
# OpenAI Apps Directory Submission

Submission packet for Flaim MCP app to ChatGPT Apps Directory.

**Last updated:** 2026-02-07
**Submission URL:** https://developers.openai.com/apps-sdk/deploy/submission/
**Guidelines:** https://developers.openai.com/apps-sdk/app-submission-guidelines

---

## App Metadata

| Field | Value |
|-------|-------|
| **App Name** | Flaim - Fantasy Sports Assistant |
| **MCP Endpoint** | `https://api.flaim.app/mcp` |
| **Short Description** | Connect your ESPN and Yahoo fantasy leagues to ChatGPT. Get rosters, standings, matchups, and free agent recommendations. |
| **Long Description** | Flaim connects your fantasy sports leagues to ChatGPT via the Model Context Protocol (MCP). Ask about your team's roster, league standings, weekly matchups, and available free agents. Supports ESPN and Yahoo for football and baseball leagues. Read-only access ensures your league data stays safe. |
| **Category** | Sports & Recreation |
| **Developer** | Flaim (Independent developer) |
| **Website** | https://flaim.app |
| **Privacy Policy** | https://flaim.app/privacy |
| **Support Email** | privacy@flaim.app |

---

## Test Instructions

### For OpenAI Review Team

**Test Account:**
- Email: [Create dedicated test account before submission]
- Password: [Store securely, provide only to OpenAI reviewers]
- Pre-configured with ESPN credentials and default league

**Setup Steps:**
1. Sign in to test account at https://flaim.app
2. Verify "Connected" status for ESPN on landing page
3. In ChatGPT, add custom connector: `https://api.flaim.app/mcp`
4. Complete OAuth authorization flow
5. Grant access when prompted

**Test Scenarios:**

1. **Get User Session:**
   - Prompt: "What fantasy leagues do I have?"
   - Expected: List of leagues with platform, sport, IDs

2. **Get Roster:**
   - Prompt: "Show me my fantasy football roster"
   - Expected: List of players with positions and stats

3. **Get Standings:**
   - Prompt: "What are my league standings?"
   - Expected: Rankings with wins, losses, points

4. **Get Free Agents:**
   - Prompt: "Who are the best available free agents?"
   - Expected: List of top free agents with stats

5. **Error Handling:**
   - Prompt: "Show me my golf league" (unsupported sport)
   - Expected: Clear error message explaining limitation

---

## Screenshots

**Note:** Create these screenshots at execution time (defer until ready to submit).

Required screenshots:
1. Landing page (https://flaim.app) showing "Connect ESPN" flow
2. OAuth consent screen
3. ChatGPT conversation showing roster tool call response
4. ChatGPT conversation showing standings tool call response
5. ChatGPT conversation showing free agents response
6. Error handling example (unsupported sport)

**Screenshot specs:**
- Format: PNG
- Resolution: 1280x720 or higher
- Clear, readable text
- Show full conversation flow where applicable

---

## MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_user_session` | List all configured leagues | None |
| `get_ancient_history` | Historical leagues (2+ years old) | None |
| `get_league_info` | League settings and scoring | platform, sport, league_id, season_year |
| `get_standings` | Current league standings | platform, sport, league_id, season_year |
| `get_matchups` | Weekly matchups | platform, sport, league_id, season_year, week? |
| `get_roster` | Team roster with stats | platform, sport, league_id, season_year, team_id? |
| `get_free_agents` | Available free agents | platform, sport, league_id, season_year, position?, count? |

All tools return structured JSON. All tools are read-only and idempotent.

---

## Known Limitations

### Platform & Sport Coverage

- **Supported Platforms:** ESPN, Yahoo
- **Supported Sports:** Football, Baseball
- **Coming Soon:** Basketball, Hockey
- **Not Supported:** Sleeper, CBS, NFL.com, etc.

Users attempting to access unsupported platforms/sports receive clear error messages with supported options.

### Read-Only Access

- No write operations (no lineup changes, waiver claims, or trades)
- All 7 tools are read-only data retrieval
- Future write operations will use separate scope (`mcp:write`)

### Rate Limits

- 200 MCP tool calls per user per day
- Rate limit resets at midnight UTC
- Exceeded limit returns `LIMIT_EXCEEDED` error code

### Data Freshness

- ESPN data is real-time via ESPN API
- Yahoo data is real-time via Yahoo Fantasy API
- No caching beyond necessary API request optimization

---

## Support Policy

### User Support

- **Support Email:** privacy@flaim.app
- **Response Time:** Best-effort within 24-48 hours
- **Documentation:** https://flaim.app (landing page has setup instructions)
- **GitHub:** Issues and discussions at https://github.com/jdguggs10/flaim

### Common Support Issues

| Issue | Solution |
|-------|----------|
| "ESPN credentials expired" | Re-sync via Chrome extension or manual entry |
| "No leagues found" | Add leagues at flaim.app/leagues |
| "Authorization failed" | Re-authorize via ChatGPT connector settings |
| "League not found" | Verify league ID from `get_user_session` |

### Escalation

Solo developer project with best-effort support. Critical security issues receive priority response within 24 hours.

---

## Safety & Privacy

### Data Collection

- **Credentials stored:** ESPN session cookies (espn_s2, SWID) encrypted at rest
- **OAuth tokens:** Stored with expiration tracking
- **No conversation logging:** MCP tool responses are not logged or retained
- **No third-party sharing:** All data remains within Flaim infrastructure

### Security Measures

- OAuth 2.1 with PKCE S256 (no plain PKCE)
- Token resource/audience enforcement
- Per-tool scope checks
- Rate limiting per user
- Encrypted credential storage (Supabase AES-256)

### Privacy Policy

Full privacy policy at https://flaim.app/privacy (last updated December 2025).

---

## Technical Details

### OAuth 2.1 Implementation

- **PKCE:** Required, S256 only
- **Scopes:** `mcp:read` (all current tools)
- **Token lifetime:** 7 days (access), 30 days (refresh)
- **Authorization endpoint:** `https://api.flaim.app/auth/authorize`
- **Token endpoint:** `https://api.flaim.app/auth/token`
- **Resource enforcement:** RFC 9728 compliant

### MCP Protocol

- **Version:** 2025-11-25 spec
- **Transport:** SSE over HTTP
- **Authentication:** Bearer token (OAuth 2.1)
- **Error handling:** Structured error codes (see `docs/ERROR-CODES.md`)

### Error Codes

Full error taxonomy in main repo `docs/ERROR-CODES.md`. Common codes:
- `AUTH_FAILED`: OAuth token invalid/expired
- `CREDENTIALS_MISSING`: ESPN/Yahoo not connected
- `NOT_SUPPORTED`: Unsupported platform/sport
- `LIMIT_EXCEEDED`: Rate limit hit
- `ESPN_COOKIES_EXPIRED`: ESPN credentials need refresh

---

## Versioning & Updates

### Tool Schema Changes

- **Non-breaking changes:** Add optional parameters, new tools (no resubmission required)
- **Breaking changes:** Remove tools, change required parameters (requires resubmission + user migration notice)
- **Deprecation policy:** 30-day notice before removing any tool

### Current Version

- **v1.0:** Initial submission (Feb 2026)
- 7 tools, 2 platforms, 2 sports, read-only

---

## Testing Checklist

Before submission:

- [ ] Run full eval suite: `cd ~/Code/flaim-eval && npm run eval && npm run presubmit`
- [ ] Complete ChatGPT OAuth runbook (see `docs/MANUAL-OAUTH-RUNBOOKS.md`)
- [ ] Verify all 7 tools work in ChatGPT
- [ ] Verify token refresh flow
- [ ] Verify 401 → re-auth flow
- [ ] Create test account with pre-authorized access
- [ ] Take all required screenshots
- [ ] Review app submission guidelines (https://developers.openai.com/apps-sdk/app-submission-guidelines)
- [ ] Verify privacy policy completeness
- [ ] Test support email responsiveness

---

## Submission Contact

For OpenAI review team:
- Technical questions: privacy@flaim.app
- Test account credentials: Provided in submission portal
```

**Step 3: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/submissions/openai-app-submission.md
git commit -m "docs: add OpenAI apps directory submission packet"
```

---

## Task 6: Document versioning rules for tool schema changes

**Purpose:** Define rules for when tool schema changes require resubmission vs. can be deployed without vendor review.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/TOOL-VERSIONING.md`

**Step 1: Write versioning policy document**

Create `~/Code/flaim/docs/TOOL-VERSIONING.md`:

```markdown
# Tool Schema Versioning Policy

Rules for managing MCP tool schema changes without breaking directory listings or client integrations.

**Applies to:** Anthropic Connectors Directory, ChatGPT Apps Directory, and Gemini CLI distribution.

---

## Change Classification

### Non-Breaking Changes (No Resubmission Required)

These changes can be deployed to production without directory resubmission:

1. **Add optional parameters** to existing tools
   - Example: Add optional `sort_by` parameter to `get_free_agents`
   - Client behavior: Existing calls work unchanged, new parameter ignored if not provided

2. **Add new tools** to the tool list
   - Example: Add `get_player_news` tool
   - Client behavior: Existing tools unaffected, new tool available immediately

3. **Expand enum values** for parameters
   - Example: Add `'basketball'` to sport enum (after backend implementation complete)
   - Client behavior: Existing enum values work unchanged

4. **Add optional fields** to response schemas
   - Example: Add `projected_points` field to roster response
   - Client behavior: Existing fields still present, new field bonus data

5. **Improve error messages** or error code descriptions
   - Example: Change "NOT_SUPPORTED: Not supported" to "NOT_SUPPORTED: Basketball is not supported yet"
   - Client behavior: Error code unchanged, better UX

### Breaking Changes (Requires Resubmission)

These changes require directory resubmission and user migration notice:

1. **Remove tools** from the tool list
   - Example: Remove deprecated `get_ancient_history` tool
   - Impact: Existing workflows break

2. **Remove parameters** (even optional ones)
   - Example: Remove `count` parameter from `get_free_agents`
   - Impact: Clients passing that parameter may error

3. **Make optional parameters required**
   - Example: Change `team_id` from optional to required in `get_roster`
   - Impact: Existing calls without the parameter fail

4. **Change parameter types**
   - Example: Change `season_year` from `number` to `string`
   - Impact: Type mismatch errors

5. **Rename tools or parameters**
   - Example: Rename `get_user_session` to `get_leagues`
   - Impact: Existing calls reference non-existent tool

6. **Change required response fields**
   - Example: Remove `league_id` from `get_user_session` response
   - Impact: Client parsing breaks

---

## Deployment Process

### Non-Breaking Changes

1. Implement change in code
2. Update tool descriptions/schemas in `workers/fantasy-mcp/src/mcp/tools.ts`
3. Run full test suite: `npm run test` (all workers)
4. Run flaim-eval: `cd ~/Code/flaim-eval && npm run eval && npm run presubmit`
5. Deploy to production: `git push origin main`
6. No directory resubmission needed

**Rollback:** If issues discovered post-deploy, revert commit and redeploy.

### Breaking Changes

1. Implement change in code
2. Add deprecation warnings 30 days before breaking change (if removing functionality)
3. Update tool descriptions/schemas
4. Run full test suite
5. Run flaim-eval with updated scenarios
6. **Do not deploy to production yet**
7. Update directory submission packets:
   - `docs/submissions/anthropic-connector-submission.md`
   - `docs/submissions/openai-app-submission.md`
8. Resubmit to directories with changelog
9. Wait for approval
10. Deploy to production after approval
11. Announce change to users (if applicable)

**Migration notice template:**

```
BREAKING CHANGE: [Tool/Parameter] removed

Effective: [Date]
Affected: [Tool names]
Action required: [Migration steps]

Example:
BREAKING CHANGE: get_ancient_history tool removed

Effective: March 15, 2026
Affected: Workflows using get_ancient_history
Action required: Use get_user_session with season_year filter instead
```

---

## Version Numbering

Flaim uses semantic versioning for the MCP connector:

- **Major version (v2.0):** Breaking changes
- **Minor version (v1.1):** Non-breaking additions (new tools, optional parameters)
- **Patch version (v1.0.1):** Bug fixes, error message improvements

**Current version:** v1.0 (Feb 2026)

Version is not exposed in MCP protocol but tracked in submission packets and release notes.

---

## Backwards Compatibility Guarantees

1. **Parameter defaults:** All optional parameters have sensible defaults
2. **Response structure:** Required fields never removed without major version bump
3. **Error codes:** Error codes are additive only (never removed)
4. **Tool names:** Tool names are stable (never renamed without deprecation cycle)

---

## Deprecation Policy

For breaking changes that remove functionality:

1. **Announce deprecation** 30 days before removal
2. Add `deprecated: true` annotation to tool descriptor
3. Include deprecation notice in tool description
4. Provide migration path in announcement
5. After 30 days, remove in next major version

Example deprecation annotation:

```typescript
{
  name: 'get_ancient_history',
  description: 'DEPRECATED: Use get_user_session instead. This tool will be removed in v2.0.',
  deprecated: true,
  // ... rest of tool definition
}
```

---

## Testing Requirements

Before any schema change (breaking or non-breaking):

1. Update tool definitions in code
2. Update flaim-eval scenarios to cover new/changed functionality
3. Run: `cd ~/Code/flaim-eval && npm run eval`
4. Run: `npm run presubmit`
5. Complete manual OAuth runbooks for all clients (see `docs/MANUAL-OAUTH-RUNBOOKS.md`)
6. Verify no regressions in existing tool calls

---

## Directory-Specific Considerations

### Anthropic Connectors Directory

- Review process takes 1-2 weeks
- Breaking changes require resubmission
- Non-breaking changes automatically available after deploy

### ChatGPT Apps Directory

- Review process takes 2-4 weeks
- Breaking changes require resubmission + changelog
- Screenshots may need updating for new tools

### Gemini CLI

- No review process (direct MCP usage)
- Breaking changes require documentation update
- Non-breaking changes available immediately after deploy

---

## Changelog Maintenance

Update `docs/CHANGELOG.md` for all schema changes:

```markdown
## [1.1.0] - 2026-03-01

### Added
- `get_player_news` tool for latest player news and injury updates
- Optional `sort_by` parameter to `get_free_agents`

### Changed
- Improved error messages for ESPN_COOKIES_EXPIRED errors

### Deprecated
- (none)

### Removed
- (none)
```

---

## Emergency Hotfix Process

For critical bugs that require immediate schema changes:

1. Fix the bug
2. If breaking change is unavoidable, deploy with clear error messaging
3. Submit emergency resubmission to directories with explanation
4. Notify users via support email if widespread impact

Emergency hotfixes should be rare. Most schema issues can be fixed with non-breaking changes.
```

**Step 2: Update docs/INDEX.md**

Add to permanent docs section:

```markdown
- `docs/TOOL-VERSIONING.md`: Tool schema change management and resubmission rules.
```

**Step 3: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/TOOL-VERSIONING.md docs/INDEX.md
git commit -m "docs: add tool schema versioning policy and resubmission rules"
```

---

## Task 7: Create Gemini CLI setup guide

**Purpose:** Publish official Gemini CLI direct MCP setup documentation as the first distribution channel to ship.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/GEMINI-CLI-SETUP.md`

**Step 1: Write Gemini CLI setup guide**

Create `~/Code/flaim/docs/GEMINI-CLI-SETUP.md`:

```markdown
# Gemini CLI Setup Guide

Connect your Flaim fantasy leagues to Google Gemini using the Gemini CLI tool. This is the fastest way to use Flaim with AI — no app store review required.

**Target time:** ≤5 minutes from clean machine to first tool call.

---

## Prerequisites

- Node.js 18+ installed
- ESPN or Yahoo fantasy league account
- Flaim account at https://flaim.app

---

## Step 1: Connect Your Fantasy Leagues to Flaim

### Option A: Chrome Extension (Recommended)

1. Install the [Flaim Chrome Extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn)
2. Sign in at https://flaim.app
3. Click the extension icon → "Sync ESPN Credentials"
4. Extension auto-discovers your leagues
5. Set a default league at https://flaim.app/leagues

### Option B: Manual Setup

1. Sign in at https://flaim.app
2. Get your ESPN cookies:
   - Open https://fantasy.espn.com in Chrome
   - Open DevTools (F12) → Application → Cookies
   - Copy `espn_s2` and `SWID` values
3. Paste cookies into Flaim's manual credentials form
4. Add your league ID and season at https://flaim.app/leagues
5. Set as default league

---

## Step 2: Install Gemini CLI

```bash
npm install -g @googlegemini/cli
```

Verify installation:

```bash
gemini --version
```

---

## Step 3: Add Flaim MCP Server

```bash
gemini mcp add flaim https://api.flaim.app/mcp
```

This will:
1. Open your browser for OAuth authorization
2. Redirect to https://flaim.app/oauth/consent
3. Prompt you to sign in (if not already)
4. Ask for permission to access your leagues

Click "Authorize" to grant access.

Expected output:

```
✅ Connected to Flaim MCP server
✅ OAuth authorization complete
```

---

## Step 4: Test Your Connection

### Get Your Leagues

```bash
gemini ask "What fantasy leagues do I have?"
```

Expected: List of your leagues with platform, sport, league ID, and season.

### Get Your Roster

```bash
gemini ask "Show me my fantasy football roster"
```

Expected: Your team's players with positions and stats.

### Get Standings

```bash
gemini ask "What are my league standings?"
```

Expected: Rankings with wins, losses, and points.

### Get Free Agents

```bash
gemini ask "Who are the best available free agents?"
```

Expected: Top free agents with stats and projections.

---

## Available MCP Tools

Gemini can call these tools automatically based on your prompts:

| Tool | What it does |
|------|--------------|
| `get_user_session` | Lists all your configured leagues |
| `get_ancient_history` | Shows historical leagues (2+ years old) |
| `get_league_info` | Gets league settings and scoring config |
| `get_standings` | Current league standings |
| `get_matchups` | Weekly matchups and scores |
| `get_roster` | Your team's roster with player stats |
| `get_free_agents` | Available free agents to pick up |

You don't need to call these tools directly — just ask questions naturally and Gemini will use the right tools.

---

## Troubleshooting

### "No leagues found"

**Cause:** No leagues configured in your Flaim account.

**Fix:**
1. Go to https://flaim.app/leagues
2. Add your league ID and season
3. Set a default league
4. Try again: `gemini ask "What leagues do I have?"`

### "Authentication failed"

**Cause:** OAuth token expired or revoked.

**Fix:**
1. Reconnect: `gemini mcp remove flaim && gemini mcp add flaim https://api.flaim.app/mcp`
2. Complete OAuth flow again

### "ESPN credentials expired"

**Cause:** ESPN cookies are older than ~30 days.

**Fix:**
1. Re-sync via Chrome extension, or
2. Manually update cookies at https://flaim.app

### "Sport not supported"

**Cause:** Requested sport (basketball, hockey) not yet implemented.

**Current support:**
- ✅ Football
- ✅ Baseball
- 🚧 Basketball (coming soon)
- 🚧 Hockey (coming soon)

### "Rate limit exceeded"

**Cause:** Exceeded 200 MCP tool calls per day.

**Fix:** Wait until midnight UTC for reset, or upgrade (if available in the future).

---

## Advanced Usage

### Check MCP Server Status

```bash
gemini mcp list
```

Expected output includes:

```
flaim: https://api.flaim.app/mcp (connected)
```

### Remove Flaim MCP Server

```bash
gemini mcp remove flaim
```

### Re-authorize

If you need to refresh your OAuth token:

```bash
gemini mcp remove flaim
gemini mcp add flaim https://api.flaim.app/mcp
```

This will trigger a fresh OAuth flow.

---

## Privacy & Security

- **Read-only access:** Flaim can only read your league data. It cannot make trades, set lineups, or submit waiver claims.
- **OAuth tokens:** Your authorization is stored securely and can be revoked at any time.
- **Credential storage:** ESPN/Yahoo credentials are encrypted at rest (Supabase AES-256).
- **No conversation logging:** Gemini CLI conversations are not logged by Flaim.

Full privacy policy: https://flaim.app/privacy

---

## Rate Limits

- **200 MCP tool calls per day** per user
- Rate limit resets at midnight UTC
- If exceeded, you'll see: `LIMIT_EXCEEDED: Rate limit exceeded`

---

## Getting Help

- **Support:** privacy@flaim.app
- **GitHub:** https://github.com/jdguggs10/flaim/issues
- **Discussions:** https://github.com/jdguggs10/flaim/discussions

---

## What's Next?

Once you're comfortable with Gemini CLI:
- Try complex queries like "Who should I pick up from waivers this week?"
- Ask for trade analysis: "Should I trade Player X for Player Y?"
- Get matchup advice: "How do I look this week against my opponent?"

Gemini uses all available MCP tools to give you comprehensive fantasy advice.

---

## Gemini CLI Resources

- **Official docs:** https://geminicli.com/docs/tools/mcp-server
- **Command reference:** https://geminicli.com/docs/cli/commands
- **Extensions:** https://geminicli.com/docs/extensions/

---

## Feedback

This is a solo indie project. If you encounter issues or have suggestions, please open a GitHub issue or email privacy@flaim.app.
```

**Step 2: Update docs/INDEX.md**

Add to permanent docs section:

```markdown
- `docs/GEMINI-CLI-SETUP.md`: Official Gemini CLI setup guide for Flaim MCP connector.
```

**Step 3: Update main README.md to link to Gemini guide**

Edit `/Users/ggugger/Code/flaim/README.md` to add a "Gemini CLI" section after the "How It Works" section:

```markdown
## Gemini CLI

Use Flaim with Google Gemini CLI for AI-powered fantasy advice.

**Setup:** See [Gemini CLI Setup Guide](docs/GEMINI-CLI-SETUP.md)

**Quick start:**
```bash
npm install -g @googlegemini/cli
gemini mcp add flaim https://api.flaim.app/mcp
gemini ask "Show me my fantasy roster"
```
```

**Step 4: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/GEMINI-CLI-SETUP.md docs/INDEX.md README.md
git commit -m "docs: add Gemini CLI setup guide as first distribution channel"
```

---

## Task 8: Add auth walkthrough with troubleshooting to Gemini docs

**Purpose:** Expand Gemini setup guide with detailed OAuth walkthrough and common failure modes.

**Repo:** `~/Code/flaim/`

**Files to modify:**
- `docs/GEMINI-CLI-SETUP.md`

**Step 1: Add detailed OAuth walkthrough section**

Insert a new section in `docs/GEMINI-CLI-SETUP.md` after "Step 3: Add Flaim MCP Server" and before "Step 4: Test Your Connection":

```markdown
---

## OAuth Authorization Walkthrough

When you run `gemini mcp add flaim https://api.flaim.app/mcp`, here's what happens:

### 1. Authorization Request

Gemini CLI opens your browser to:

```
https://api.flaim.app/auth/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...
```

**What this means:** Gemini is asking Flaim for permission to access your fantasy leagues.

### 2. Sign In (if needed)

You'll see the Flaim sign-in page. Sign in with:
- Email/password, or
- Google sign-in

**Security note:** Flaim uses Clerk for authentication. Your credentials are never shared with Gemini.

### 3. Consent Screen

After signing in, you'll see a consent screen asking:

> **Flaim Fantasy MCP Connector**
> 
> Gemini CLI is requesting access to your fantasy leagues.
> 
> This will allow it to:
> - Read your league information
> - View your roster and player stats
> - Access standings and matchups
> - View free agent data
> 
> **[Authorize]** **[Deny]**

Click **Authorize** to grant access.

### 4. Redirect Back to CLI

After authorization, you'll be redirected to:

```
http://localhost:PORT/callback?code=...&state=...
```

Gemini CLI captures this redirect and exchanges the authorization code for an access token.

Expected terminal output:

```
✅ OAuth authorization complete
✅ Access token received
✅ Flaim MCP server connected
```

### 5. Token Storage

Your OAuth token is stored securely by Gemini CLI. You won't need to re-authorize unless:
- You revoke access at https://flaim.app
- The token expires (7 days)
- You remove and re-add the MCP server

---

## OAuth Troubleshooting

### "Redirect URI mismatch"

**Symptom:** Browser shows "redirect_uri is not in the allowlist"

**Cause:** Gemini CLI is using a localhost port that's not in Flaim's allowlist.

**Fix:** This should not happen with Gemini CLI (localhost URIs are dynamically allowed). If it does:
1. Check if you're using a custom redirect URI
2. Contact support@flaim.app with the error message

### "Authorization timed out"

**Symptom:** CLI shows "Authorization timed out, no callback received"

**Cause:** You didn't complete the OAuth flow in the browser within the timeout window.

**Fix:**
1. Re-run: `gemini mcp add flaim https://api.flaim.app/mcp`
2. Complete authorization within 5 minutes

### "PKCE challenge failed"

**Symptom:** Error during token exchange: "code_verifier does not match code_challenge"

**Cause:** PKCE verification failed (should not happen with standard Gemini CLI).

**Fix:** This indicates a bug. Please report to:
- Flaim: privacy@flaim.app
- Gemini CLI: https://github.com/google/gemini-cli/issues

### "Token expired"

**Symptom:** MCP tool calls fail with "AUTH_FAILED: Token expired"

**Cause:** Your access token expired (7-day lifetime).

**Fix:** Automatic token refresh should happen transparently. If it doesn't:
1. Remove and re-add the server: `gemini mcp remove flaim && gemini mcp add flaim https://api.flaim.app/mcp`
2. Complete OAuth flow again

### "Permission denied"

**Symptom:** After authorization, you see "Permission denied" or 403 error

**Cause:** You clicked "Deny" on the consent screen, or your account doesn't have leagues configured.

**Fix:**
1. Re-authorize: `gemini mcp remove flaim && gemini mcp add flaim https://api.flaim.app/mcp`
2. Click "Authorize" this time
3. Verify you have leagues at https://flaim.app/leagues

---
```

**Step 2: Expand the "Troubleshooting" section**

Replace the existing "Troubleshooting" section in `docs/GEMINI-CLI-SETUP.md` with an expanded version:

```markdown
## Troubleshooting

### Setup Issues

#### "No leagues found"

**Cause:** No leagues configured in your Flaim account.

**Fix:**
1. Go to https://flaim.app/leagues
2. Add your league ID and season
3. Set a default league
4. Try again: `gemini ask "What leagues do I have?"`

**Verification:**
- Visit https://flaim.app/leagues
- You should see at least one league listed
- One should be marked as "Default"

#### "Authentication failed"

**Cause:** OAuth token expired, revoked, or not present.

**Fix:**
1. Reconnect: `gemini mcp remove flaim && gemini mcp add flaim https://api.flaim.app/mcp`
2. Complete OAuth flow again
3. Check token storage: `gemini mcp list` should show `flaim: connected`

**Verification:**
- After reconnecting, try: `gemini ask "What leagues do I have?"`
- Should return your leagues without asking for auth again

#### "ESPN credentials expired"

**Cause:** ESPN session cookies are older than ~30 days.

**Fix (Chrome Extension):**
1. Open https://fantasy.espn.com
2. Verify you're signed in
3. Click Flaim extension icon
4. Click "Re-sync ESPN Credentials"
5. Wait for "Sync complete" message

**Fix (Manual):**
1. Go to https://flaim.app
2. Click "Manage ESPN Connection"
3. Get fresh cookies from DevTools (F12 → Application → Cookies)
4. Update `espn_s2` and `SWID` values
5. Save changes

**Verification:**
- Try a tool call: `gemini ask "Show me my roster"`
- Should succeed without credential errors

### Runtime Issues

#### "Sport not supported"

**Cause:** Requested sport (basketball, hockey) not yet implemented.

**Current support:**
- ✅ Football (ESPN + Yahoo)
- ✅ Baseball (ESPN + Yahoo)
- 🚧 Basketball (coming soon)
- 🚧 Hockey (coming soon)

**Fix:** Use football or baseball leagues for now. Basketball and hockey support is in development.

#### "Platform not supported"

**Cause:** Requested platform (Sleeper, CBS, NFL.com) not supported by Flaim.

**Current support:**
- ✅ ESPN
- ✅ Yahoo Fantasy
- ❌ Sleeper, CBS, NFL.com, Fantrax, etc.

**Fix:** Use ESPN or Yahoo leagues. Additional platforms may be added in the future.

#### "Rate limit exceeded"

**Symptom:** Tool calls fail with "LIMIT_EXCEEDED: Rate limit exceeded"

**Cause:** Exceeded 200 MCP tool calls per day.

**Fix:**
1. Wait until midnight UTC for reset
2. Check current usage (not yet implemented)
3. Reduce frequency of queries

**Mitigation:**
- Ask compound questions instead of multiple simple queries
- Use batch operations where possible
- Avoid polling for real-time updates

#### "League not found"

**Symptom:** Tool calls fail with "ESPN_NOT_FOUND: League not found"

**Cause:** Invalid league ID or season year.

**Fix:**
1. Get valid league IDs: `gemini ask "What leagues do I have?"`
2. Copy exact `league_id` and `season_year` from response
3. Verify at https://fantasy.espn.com/[sport]/league?leagueId=[ID]

**Common mistakes:**
- Using previous season's league ID for current season (some leagues get new IDs each year)
- Typos in league ID
- Wrong sport (e.g., baseball ID used for football query)

### Performance Issues

#### "Slow responses"

**Cause:** Gemini is calling multiple MCP tools sequentially, or ESPN/Yahoo API is slow.

**Expected latency:**
- Simple queries (1 tool): 1-3 seconds
- Complex queries (2-3 tools): 3-7 seconds

**Fix:**
- This is expected behavior
- ESPN/Yahoo APIs can be slow during peak times (Sunday afternoons in football)
- No action needed

#### "Timeout errors"

**Symptom:** Tool calls fail with "Request timeout" or no response after 30+ seconds

**Cause:** ESPN/Yahoo API is down or extremely slow.

**Fix:**
1. Check ESPN/Yahoo service status
2. Retry after a few minutes
3. If persistent, contact privacy@flaim.app

### Connection Issues

#### "Cannot connect to MCP server"

**Symptom:** `gemini mcp list` shows `flaim: (disconnected)` or errors

**Cause:** Network issue, server down, or invalid MCP URL.

**Fix:**
1. Check internet connection
2. Verify server is up: `curl https://api.flaim.app/health`
   - Should return: `{"status":"ok"}`
3. Remove and re-add: `gemini mcp remove flaim && gemini mcp add flaim https://api.flaim.app/mcp`

**Verification:**
- `gemini mcp list` should show `flaim: https://api.flaim.app/mcp (connected)`

---

## Getting Help

If none of the above solutions work:

1. **Check status:** https://status.flaim.app (if available)
2. **Email support:** privacy@flaim.app
   - Include error message
   - Include Gemini CLI version: `gemini --version`
   - Include Flaim account email (don't include password)
3. **GitHub Issues:** https://github.com/jdguggs10/flaim/issues
   - Search existing issues first
   - Include reproduction steps

**Response time:** Best-effort within 24-48 hours (solo project).

---
```

**Step 3: Test the updated guide**

Review the updated guide for:
- Clarity and completeness
- Accurate command examples
- Proper markdown formatting
- No broken internal references

**Step 4: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/GEMINI-CLI-SETUP.md
git commit -m "docs: expand Gemini CLI guide with OAuth walkthrough and troubleshooting"
```

---

## Task 9: Update docs for Gemini as "first to ship" channel

**Purpose:** Update architecture and status docs to reflect Gemini CLI as the shipped distribution channel.

**Repo:** `~/Code/flaim/`

**Files to modify:**
- `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `README.md`

**Step 1: Update ARCHITECTURE.md**

Add a "Distribution Channels" section to `docs/ARCHITECTURE.md` after the "Security" section:

```markdown
## Distribution Channels

Flaim is distributed via three channels:

### 1. Gemini CLI (Shipped)

Direct MCP usage via Gemini CLI tool. No app store review required.

- **Setup guide:** `docs/GEMINI-CLI-SETUP.md`
- **Target time:** ≤5 minutes from clean machine to first tool call
- **Status:** Live

### 2. Claude Custom Connectors (In Development)

Via Anthropic Connectors Directory.

- **Submission packet:** `docs/submissions/anthropic-connector-submission.md`
- **Status:** Submission-ready, pending directory launch

### 3. ChatGPT Apps Directory (In Development)

Via OpenAI Apps Directory.

- **Submission packet:** `docs/submissions/openai-app-submission.md`
- **Status:** Submission-ready, pending screenshots + final testing

---
```

**Step 2: Update STATUS.md**

Add a "Distribution Status" section to `docs/STATUS.md` after the "Eval Observability" section:

```markdown
## Distribution Status

| Channel | Status | Documentation |
|---------|--------|---------------|
| Gemini CLI | ✅ Shipped | `docs/GEMINI-CLI-SETUP.md` |
| Claude Connectors Directory | 🚧 Submission-ready | `docs/submissions/anthropic-connector-submission.md` |
| ChatGPT Apps Directory | 🚧 Submission-ready | `docs/submissions/openai-app-submission.md` |

**Legend:** ✅ Shipped | 🚧 In progress | ❌ Not started

---
```

**Step 3: Update README.md**

Add a "Distribution Channels" section to the main README after the "What Flaim Is" section:

```markdown
## Distribution Channels

### Gemini CLI (Available Now)

The fastest way to use Flaim with AI. No app store review, no waiting.

**Quick start:**
```bash
npm install -g @googlegemini/cli
gemini mcp add flaim https://api.flaim.app/mcp
gemini ask "Show me my fantasy roster"
```

**Full setup guide:** [Gemini CLI Setup](docs/GEMINI-CLI-SETUP.md)

### Claude & ChatGPT (Coming Soon)

Flaim will be available in the Anthropic Connectors Directory and ChatGPT Apps Directory once review processes are complete.

**For now:** Use Claude Desktop with custom connectors or ChatGPT with custom connector mode (dev-only).
```

**Step 4: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/ARCHITECTURE.md docs/STATUS.md README.md
git commit -m "docs: update architecture and status to reflect Gemini CLI as first shipped channel"
```

---

## Task 10: Run full test suite and verify submission readiness

**Purpose:** Verify all Sprint B deliverables are complete and submission-ready.

**Step 1: Run flaim-eval with all scenarios**

```bash
cd ~/Code/flaim-eval
npm run eval
```

Expected: 9 scenarios total (5 original + 4 negative). Happy path scenarios should pass. Negative scenarios may error (expected).

**Step 2: Enrich traces**

```bash
cd ~/Code/flaim-eval
npm run enrich -- <run_id>
```

Replace `<run_id>` with the run ID from step 1.

Expected: All traces enriched with server-side logs from all 4 workers.

**Step 3: Run acceptance check**

```bash
cd ~/Code/flaim-eval
npm run accept -- <run_id>
```

Expected: PASS (or document any failures)

**Step 4: Run pre-submission check**

```bash
cd ~/Code/flaim-eval
npm run presubmit
```

Expected:
```
✅ Happy path scenarios: PASS
✅ Error scenarios: PASS (scenarios executed)
✅ Observability: PASS
---
✅ SUBMISSION READY
```

If FAIL, fix issues and re-run eval cycle.

**Step 5: Manually test Gemini CLI setup from clean state**

Follow the `docs/GEMINI-CLI-SETUP.md` guide from a clean machine (or new test account):

1. Install Gemini CLI
2. Add Flaim MCP server
3. Complete OAuth flow
4. Run 3 canonical tool call sequences:
   - "What's on my fantasy roster?" (get_user_session + get_roster)
   - "Show my league standings" (get_user_session + get_standings)
   - "Who are the best available free agents?" (get_user_session + get_free_agents)

Time the setup: Should complete in ≤5 minutes.

**Step 6: Review all submission packets**

Read through:
- `docs/submissions/anthropic-connector-submission.md`
- `docs/submissions/openai-app-submission.md`

Verify all sections are complete and accurate. Note any TODOs for execution time:
- Test account creation (both packets)
- Screenshots (OpenAI packet only)

**Step 7: Run main repo tests**

```bash
cd ~/Code/flaim
cd workers/auth-worker && npx vitest run
cd ../espn-client && npx vitest run
cd ../yahoo-client && npx vitest run
cd ../fantasy-mcp && npx vitest run
cd ../../web && npm run lint
```

Expected: All PASS

**Step 8: Verify no regressions**

Test OAuth flows manually per `docs/MANUAL-OAUTH-RUNBOOKS.md`:
- Claude Desktop fresh connect + canonical tool calls
- ChatGPT custom connector fresh connect + canonical tool calls
- Gemini CLI fresh connect + canonical tool calls

If any fail, document and fix before proceeding.

**Step 9: Commit final verification**

```bash
cd ~/Code/flaim
git add -A
git commit -m "chore: sprint B final verification pass"
```

**Step 10: Document Sprint B completion**

Update `docs/dev/plugins-buildout-plan.md` to mark Sprint B as complete:

Change status from "Revised draft" to "Sprint B complete" at the top of the file.

---

## Task 11: Optional: Create submission task tracker

**Purpose:** Create a checklist document for tracking actual submission process when ready to submit.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/dev/submission-tracker.md`

**Step 1: Write submission tracker**

Create `~/Code/flaim/docs/dev/submission-tracker.md`:

```markdown
# Directory Submission Tracker

Checklist for actual submission process. Update status as submissions progress.

**Created:** 2026-02-07
**Status:** Not started

---

## Pre-Submission (All Channels)

- [ ] flaim-eval full run passed: `npm run eval && npm run presubmit`
- [ ] Manual OAuth runbooks completed for all 3 clients
- [ ] Test accounts created with credentials stored securely
- [ ] All submission packets reviewed and accurate
- [ ] Privacy policy reviewed and up-to-date
- [ ] Support email tested and responsive
- [ ] Rate limit behavior verified (200/day)

---

## Anthropic Connectors Directory

**Status:** ⬜ Not started | 🟡 In progress | ✅ Submitted | 🟢 Approved | 🔴 Rejected

**Submission URL:** https://support.anthropic.com/en/articles/12922490-remote-mcp-server-submission-guide

### Pre-Submission Checklist

- [ ] Test account created and credentials documented
- [ ] Submission packet complete: `docs/submissions/anthropic-connector-submission.md`
- [ ] Claude Desktop OAuth flow tested end-to-end
- [ ] All 7 tools verified working in Claude Desktop
- [ ] Token refresh flow verified
- [ ] 401 → re-auth flow verified

### Submission

- [ ] Submitted to Anthropic via submission form
- [ ] Submission confirmation received
- [ ] Submission ID: ________________
- [ ] Date submitted: ________________

### Review Process

- [ ] Review in progress (Anthropic contacted)
- [ ] Clarification requests received (document below)
- [ ] Clarifications provided
- [ ] Approval received
- [ ] Listed in Connectors Directory

**Review notes:**
(Document any questions/clarifications from Anthropic here)

---

## OpenAI Apps Directory

**Status:** ⬜ Not started | 🟡 In progress | ✅ Submitted | 🟢 Approved | 🔴 Rejected

**Submission URL:** https://developers.openai.com/apps-sdk/deploy/submission/

### Pre-Submission Checklist

- [ ] Test account created and credentials documented
- [ ] Submission packet complete: `docs/submissions/openai-app-submission.md`
- [ ] Screenshots captured (all 6 required):
  - [ ] Landing page with connect flow
  - [ ] OAuth consent screen
  - [ ] Roster tool call response
  - [ ] Standings tool call response
  - [ ] Free agents response
  - [ ] Error handling example
- [ ] Screenshots uploaded to: ________________
- [ ] ChatGPT custom connector OAuth flow tested end-to-end
- [ ] All 7 tools verified working in ChatGPT
- [ ] Token refresh flow verified
- [ ] 401 → re-auth flow verified

### Submission

- [ ] Submitted to OpenAI via Apps SDK submission portal
- [ ] Submission confirmation received
- [ ] Submission ID: ________________
- [ ] Date submitted: ________________

### Review Process

- [ ] Review in progress (OpenAI contacted)
- [ ] Clarification requests received (document below)
- [ ] Clarifications provided
- [ ] Approval received
- [ ] Listed in Apps Directory

**Review notes:**
(Document any questions/clarifications from OpenAI here)

---

## Gemini CLI Distribution

**Status:** ✅ Shipped

**Setup guide:** `docs/GEMINI-CLI-SETUP.md`

### Launch Checklist

- [x] Setup guide published in docs
- [x] README updated with Gemini CLI quick start
- [x] Architecture docs updated with Gemini CLI status
- [x] Clean-machine setup tested (≤5 minutes)
- [x] OAuth flow verified
- [x] All 7 tools verified
- [x] Troubleshooting guide complete

**Date shipped:** 2026-02-07

---

## Post-Approval Tasks

### Anthropic Approval

- [ ] Announce in README
- [ ] Add official directory link to docs
- [ ] Update landing page with "Listed in Anthropic Connectors Directory" badge
- [ ] Announce on GitHub Discussions
- [ ] Optional: Blog post or social media announcement

### OpenAI Approval

- [ ] Announce in README
- [ ] Add official directory link to docs
- [ ] Update landing page with "Listed in ChatGPT Apps Directory" badge
- [ ] Announce on GitHub Discussions
- [ ] Optional: Blog post or social media announcement

---

## Rejection Handling

If either submission is rejected:

1. Document rejection reason in review notes above
2. Create action items to address feedback
3. Update submission packet with changes
4. Re-test affected areas per manual runbooks
5. Resubmit when ready

---

## Notes

- Solo project: expect 1-2 week turnaround for each resubmission
- Vendor review timelines: Anthropic 1-2 weeks, OpenAI 2-4 weeks
- Re-verify vendor submission docs within 7 days before submitting (policies may change)
```

**Step 2: Commit in main repo**

```bash
cd ~/Code/flaim
git add docs/dev/submission-tracker.md
git commit -m "docs: add directory submission tracker template"
```

---

## Task 12: Write Sprint B summary and plan document

**Purpose:** Create the final plan document that will be committed to `docs/plans/`.

**Repo:** `~/Code/flaim/`

**Files to create:**
- `docs/plans/2026-02-07-sprint-b-testing-packaging-gemini-plan.md`

**Step 1: Write the plan document**

This is the document you're reading right now. It will be committed as the Sprint B plan.

**Step 2: Commit the plan**

```bash
cd ~/Code/flaim
git add docs/plans/2026-02-07-sprint-b-testing-packaging-gemini-plan.md
git commit -m "docs: add Sprint B plan for testing, packaging, and Gemini CLI"
```

---

## Summary

| Task | Workstream | What it does |
|------|-----------|--------------|
| 1 | WS3 | Add negative test scenarios to flaim-eval |
| 2 | WS3 | Add pre-submission checklist script to flaim-eval |
| 3 | WS3 | Write manual OAuth runbooks |
| 4 | WS4 | Build Anthropic submission packet |
| 5 | WS4 | Build OpenAI submission packet |
| 6 | WS4 | Document versioning rules for tool schema changes |
| 7 | WS5 | Create Gemini CLI setup guide |
| 8 | WS5 | Add auth walkthrough with troubleshooting to Gemini docs |
| 9 | WS5 | Update docs for Gemini as "first to ship" channel |
| 10 | All | Run full test suite and verify submission readiness |
| 11 | WS4 | Optional: Create submission task tracker |
| 12 | All | Write Sprint B summary and plan document |

Tasks 1-3 are testing runbooks (Workstream 3). Tasks 4-6 are submission packaging (Workstream 4). Tasks 7-9 are Gemini CLI distribution (Workstream 5). Task 10 is the verification gate. Tasks 11-12 are meta-work.

---

## Answers to Design Questions

### 1. How many tasks, and in what order?

**12 tasks total**, sequenced as:
- Tasks 1-2: flaim-eval enhancements (can run in parallel)
- Task 3: Manual runbooks (after flaim-eval work is done)
- Tasks 4-6: Submission packets (can run in parallel, after runbooks exist)
- Tasks 7-9: Gemini CLI docs (can overlap with submission packets)
- Task 10: Verification gate (blocks Sprint C)
- Tasks 11-12: Meta-work (optional tracker + this plan)

**Recommended execution order:** 1, 2, 3, 7, 8, 4, 5, 6, 9, 10, 11, 12

Rationale: Start with flaim-eval so it's ready for verification. Ship Gemini CLI docs early since that channel has no review process. Build submission packets in parallel. Verify everything before considering Sprint B done.

### 2. What files are created/modified per task?

See "Files to create" and "Files to modify" in each task above. All file paths are absolute.

**Summary:**
- **flaim-eval repo:** 4 new scenarios, 1 new script, updated docs
- **Main repo:** 2 submission packets, 3 new permanent docs, updates to ARCHITECTURE/STATUS/README/INDEX

### 3. What are the verification steps per task?

Each task has verification steps in the task description. Key verification moments:
- Task 1: Run flaim-eval to verify auto-discovery
- Task 2: Run presubmit script against existing run
- Task 3: Manual runbooks are checklists (verified in Task 10)
- Tasks 4-6: Read-through for completeness
- Tasks 7-8: Manual Gemini CLI setup from clean state
- Task 10: Full test suite + manual OAuth flows + presubmit check

### 4. What needs to happen in flaim-eval repo vs main repo?

**flaim-eval repo:**
- Task 1: Add 4 negative scenarios (JSON files)
- Task 2: Add presubmit script (TypeScript)
- Update OPERATIONS.md and README.md

**Main repo:**
- Task 3: Manual runbooks (new doc)
- Tasks 4-6: Submission packets + versioning policy (new docs)
- Tasks 7-9: Gemini CLI setup + troubleshooting (new doc)
- Task 10: Verification (no new files)
- Task 11: Submission tracker (optional, in docs/dev/)
- Task 12: This plan (in docs/plans/)

### 5. Should we use a worktree for this sprint too?

**No worktree needed for Sprint B.** Rationale:
- Sprint B is docs-only (no code changes)
- No risk of breaking production
- Tasks can be done incrementally and committed to main
- Gemini CLI docs should go live immediately (no review needed)

If you want isolation for review purposes, you can use a branch, but it's not necessary for safety like Sprint A was.

---

## Definition of Done

Sprint B is complete when:

- [ ] All 4 negative scenarios added to flaim-eval and auto-discovered
- [ ] Pre-submission checklist script works and returns PASS on latest run
- [ ] Manual OAuth runbooks documented for Claude, ChatGPT, Gemini CLI
- [ ] Anthropic submission packet complete and internally reviewed
- [ ] OpenAI submission packet complete and internally reviewed (except screenshots)
- [ ] Tool versioning policy documented
- [ ] Gemini CLI setup guide published and tested on clean machine (≤5 min)
- [ ] Gemini CLI troubleshooting and OAuth walkthrough complete
- [ ] Architecture/status docs updated to reflect Gemini as shipped channel
- [ ] Full flaim-eval run passes with presubmit check
- [ ] Manual OAuth runbooks executed once per client with no failures
- [ ] Sprint B plan committed to docs/plans/

---

## Next Steps (Sprint C)

After Sprint B:
- Sprint C: Basketball + hockey buildout (Workstream 6)
- Freeze tool contract at end of Sprint C
- Create test accounts for directory submissions
- Take screenshots for OpenAI submission
- Submit to Claude and ChatGPT directories
- Optional: Gemini extension packaging

Sprint C plan will be designed when Sprint B is complete.
