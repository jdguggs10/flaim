# MCP Eval Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a manual eval harness that fires prompts at OpenAI with Flaim's MCP tools, captures the full tool-call chain, and writes unified trace artifacts. Doubles as a skill development workspace for iterating on instruction `.md` files before packaging as SKILL.md for Claude/ChatGPT/Gemini.

**Architecture:** Separate repo (`~/Code/flaim-eval/`). TypeScript CLI that treats Flaim as a black box — calls the public production MCP endpoint via OpenAI's Responses API. OAuth refresh token for auth. No Flaim code changes in Phase 1a.

**Tech Stack:** TypeScript, `openai` SDK, `dotenv`, Node.js built-in `http` (for OAuth bootstrap callback server), `open` (to launch browser for consent).

**Design doc:** `docs/dev/mcp-eval-observability-scope.md` (in Flaim repo)

**Separate repo rationale:** The harness doesn't import Flaim code — it's a public API consumer. Keeps Flaim's dependency tree clean, prevents accidental deployment of eval code, and works for any MCP server.

---

### Task 1: Create repo and scaffold package

**Files:**
- Create: `~/Code/flaim-eval/package.json`
- Create: `~/Code/flaim-eval/tsconfig.json`
- Create: `~/Code/flaim-eval/.env.example`
- Create: `~/Code/flaim-eval/.gitignore`
- Create: `~/Code/flaim-eval/README.md`

**Step 0: Create the repo**

```bash
mkdir ~/Code/flaim-eval && cd ~/Code/flaim-eval && git init
```

**Step 1: Create `package.json`**

```json
{
  "name": "flaim-eval",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "eval": "tsx src/run.ts",
    "bootstrap": "tsx src/bootstrap.ts"
  },
  "dependencies": {
    "dotenv": "^16.4.0",
    "open": "^10.1.0",
    "openai": "^5.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 3: Create `.env.example`**

```env
# OpenAI API key (required)
OPENAI_API_KEY=sk-...

# OAuth credentials (populated by bootstrap)
FLAIM_CLIENT_ID=
FLAIM_REFRESH_TOKEN=

# Target MCP server (default: production)
FLAIM_MCP_URL=https://api.flaim.app/mcp

# Auth endpoints
FLAIM_AUTH_BASE_URL=https://api.flaim.app

# Model override (default: gpt-5-mini-2025-08-07)
# FLAIM_EVAL_MODEL=gpt-5-mini-2025-08-07
```

**Step 4: Create `.gitignore`**

```
node_modules/
dist/
runs/
.env
```

**Step 5: Create `README.md`**

```markdown
# flaim-eval

MCP eval harness and skill development workspace for [Flaim](https://github.com/jdguggs10/flaim).

Two purposes:
1. **Debugging** — Fire prompts at OpenAI with Flaim's MCP tools, capture the full tool-call chain in a single artifact.
2. **Skill development** — Iterate on instruction `.md` files and test how they change model behavior.

## Quick start

```bash
npm install
cp .env.example .env       # add OPENAI_API_KEY
npm run bootstrap           # one-time OAuth setup (opens browser)
npm run eval                # run all scenarios
npm run eval who_is_on_my_roster  # run one scenario
```

## Design doc

See `docs/dev/mcp-eval-observability-scope.md` in the Flaim repo.
```

**Step 6: Install dependencies**

Run: `cd ~/Code/flaim-eval && npm install`
Expected: `node_modules/` created, lockfile generated.

**Step 7: Commit**

```bash
git add package.json tsconfig.json .env.example .gitignore README.md
git commit -m "feat: scaffold flaim-eval repo"
```

---

### Task 2: OAuth bootstrap CLI

**Files:**
- Create: `src/auth.ts`
- Create: `src/bootstrap.ts`

**Step 1: Create `src/auth.ts` — token refresh + PKCE helpers**

```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ENV_PATH = path.resolve(import.meta.dirname, "../.env");

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Read refresh token and client_id from .env
 */
export function loadEnvCredentials(): {
  clientId: string;
  refreshToken: string;
  authBaseUrl: string;
} {
  const envContent = fs.readFileSync(ENV_PATH, "utf-8");
  const get = (key: string) =>
    envContent.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? "";

  return {
    clientId: get("FLAIM_CLIENT_ID"),
    refreshToken: get("FLAIM_REFRESH_TOKEN"),
    authBaseUrl: get("FLAIM_AUTH_BASE_URL") || "https://api.flaim.app",
  };
}

/**
 * Write/update a key in .env
 */
export function writeEnvKey(key: string, value: string): void {
  let content = "";
  try {
    content = fs.readFileSync(ENV_PATH, "utf-8");
  } catch {
    // File doesn't exist yet — will create from .env.example
    const examplePath = path.resolve(import.meta.dirname, "../.env.example");
    content = fs.readFileSync(examplePath, "utf-8");
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

/**
 * Refresh the access token using the stored refresh token.
 * Updates .env with the new refresh token if rotated.
 */
export async function refreshAccessToken(): Promise<string> {
  const { clientId, refreshToken, authBaseUrl } = loadEnvCredentials();

  if (!refreshToken) {
    throw new Error(
      "No refresh token found. Run `npm run bootstrap` first."
    );
  }

  const res = await fetch(`${authBaseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Token refresh failed (${res.status}): ${body}\nRun \`npm run bootstrap\` to re-authorize.`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  // If the server rotated the refresh token, save it
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    writeEnvKey("FLAIM_REFRESH_TOKEN", data.refresh_token);
  }

  return data.access_token;
}

/**
 * Generate PKCE code verifier and challenge (S256).
 */
export async function generatePkce(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const verifierBytes = crypto.randomBytes(32);
  const codeVerifier = verifierBytes
    .toString("base64url")
    .replace(/=/g, "");

  const challengeBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = Buffer.from(challengeBuffer)
    .toString("base64url")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}
```

**Step 2: Create `src/bootstrap.ts` — one-time OAuth setup**

```ts
import http from "node:http";
import { writeEnvKey, generatePkce } from "./auth.js";
import open from "open";

const AUTH_BASE_URL =
  process.env.FLAIM_AUTH_BASE_URL || "https://api.flaim.app";
const REDIRECT_URI = "http://localhost:3000/oauth/callback";

async function bootstrap() {
  console.log("=== Flaim Eval — OAuth Bootstrap ===\n");

  // Step 1: Register client via DCR
  console.log("1. Registering eval client...");
  const regRes = await fetch(`${AUTH_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Flaim Eval Harness",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });

  if (!regRes.ok) {
    console.error("DCR failed:", await regRes.text());
    process.exit(1);
  }

  const { client_id } = (await regRes.json()) as { client_id: string };
  console.log(`   Client registered: ${client_id}`);
  writeEnvKey("FLAIM_CLIENT_ID", client_id);

  // Step 2: Generate PKCE
  const { codeVerifier, codeChallenge } = await generatePkce();

  // Step 3: Build authorize URL
  const state = crypto.randomUUID();
  const authorizeUrl = new URL(`${AUTH_BASE_URL}/auth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client_id);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", "mcp:read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  // Step 4: Start local callback server
  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:3000`);
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1><p>You can close this tab.</p>");
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>State mismatch</h1><p>You can close this tab.</p>");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<h1>Success!</h1><p>Eval harness authorized. You can close this tab.</p>"
      );
      server.close();
      resolve(code!);
    });

    server.listen(3000, () => {
      console.log("   Callback server listening on port 3000");
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback"));
    }, 120_000);
  });

  // Step 5: Open browser
  console.log("2. Opening browser for consent...");
  await open(authorizeUrl.toString());
  console.log("   Waiting for you to approve in the browser...\n");

  // Step 6: Wait for callback
  const code = await codePromise;
  console.log("3. Got authorization code. Exchanging for tokens...");

  // Step 7: Exchange code for tokens
  const tokenRes = await fetch(`${AUTH_BASE_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: client_id,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    process.exit(1);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokens.refresh_token) {
    console.error("No refresh token returned. Check auth-worker config.");
    process.exit(1);
  }

  writeEnvKey("FLAIM_REFRESH_TOKEN", tokens.refresh_token);

  console.log("\n=== Bootstrap complete ===");
  console.log(`   Access token expires in: ${tokens.expires_in}s`);
  console.log(`   Refresh token saved to: .env`);
  console.log(`   Run scenarios with: npm run eval`);
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err.message);
  process.exit(1);
});
```

**Step 3: Verify bootstrap compiles**

Run: `npx tsx --version`
Expected: tsx version output (confirms toolchain works).

**Step 4: Commit**

```bash
git add src/auth.ts src/bootstrap.ts
git commit -m "feat: OAuth bootstrap CLI with PKCE + local callback"
```

---

### Task 3: Scenario loader and types

**Files:**
- Create: `src/types.ts`
- Create: `src/scenarios.ts`
- Create: `scenarios/who_is_on_my_roster.json`
- Create: `scenarios/standings_and_playoff_outlook.json`
- Create: `scenarios/best_waiver_adds.json`
- Create: `scenarios/cross_sport_confusion.json`
- Create: `scenarios/no_league_context.json`

**Step 1: Create `src/types.ts`**

```ts
/**
 * Scenario definition — loaded from scenarios/*.json
 */
export interface Scenario {
  id: string;
  prompt: string;
  description: string;
  expected_tools: string[];
  instructions?: string; // relative path to .md file in repo root
  tags: string[];
}

/**
 * Tool call captured from OpenAI response
 */
export interface CapturedToolCall {
  tool_name: string;
  args: Record<string, unknown>;
  result_preview: string;
}

/**
 * Per-scenario trace artifact — written to runs/<run_id>/<scenario_id>.json
 */
export interface TraceArtifact {
  schema_version: "1.0";
  run_id: string;
  scenario_id: string;
  timestamp_utc: string;
  model: string;
  prompt: string;
  instructions_file: string | null;
  expected_tools: string[];
  llm_response: {
    response_id: string;
    tool_calls: CapturedToolCall[];
    final_text: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  };
  duration_ms: number;
  notes: string[];
}

/**
 * Run manifest — written to runs/<run_id>/manifest.json
 */
export interface RunManifest {
  run_id: string;
  timestamp_utc: string;
  model: string;
  mcp_url: string;
  scenario_count: number;
  scenarios: string[];
  instructions_file: string | null;
}

/**
 * Run summary — written to runs/<run_id>/summary.json
 */
export interface RunSummary {
  run_id: string;
  model: string;
  total_scenarios: number;
  completed: number;
  errored: number;
  total_duration_ms: number;
  total_tokens: { input: number; output: number; total: number };
  scenarios: Array<{
    id: string;
    status: "ok" | "error";
    tool_calls: string[];
    expected_tools: string[];
    tools_match: boolean;
    duration_ms: number;
    error?: string;
  }>;
}
```

**Step 2: Create `src/scenarios.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import type { Scenario } from "./types.js";

const SCENARIOS_DIR = path.resolve(import.meta.dirname, "../scenarios");

/**
 * Load all scenario JSON files from scenarios/
 */
export function loadScenarios(filter?: string[]): Scenario[] {
  const files = fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"));

  const scenarios: Scenario[] = files.map((f) => {
    const raw = fs.readFileSync(path.join(SCENARIOS_DIR, f), "utf-8");
    return JSON.parse(raw) as Scenario;
  });

  if (filter && filter.length > 0) {
    return scenarios.filter((s) => filter.includes(s.id));
  }

  return scenarios;
}

/**
 * Load instruction file contents if specified by scenario.
 * Returns null if no instructions.
 */
export function loadInstructions(scenario: Scenario): string | null {
  if (!scenario.instructions) return null;

  const instrPath = path.resolve(import.meta.dirname, "..", scenario.instructions);
  if (!fs.existsSync(instrPath)) {
    console.warn(`  Warning: instructions file not found: ${instrPath}`);
    return null;
  }

  return fs.readFileSync(instrPath, "utf-8");
}
```

**Step 3: Create the 5 starter scenario files**

`scenarios/who_is_on_my_roster.json`:
```json
{
  "id": "who_is_on_my_roster",
  "prompt": "Who is on my roster?",
  "description": "Basic happy path — should call get_user_session then get_roster",
  "expected_tools": ["get_user_session", "get_roster"],
  "tags": ["espn", "happy-path"]
}
```

`scenarios/standings_and_playoff_outlook.json`:
```json
{
  "id": "standings_and_playoff_outlook",
  "prompt": "What are the current standings in my league? How is my team doing?",
  "description": "Should call get_user_session then get_standings",
  "expected_tools": ["get_user_session", "get_standings"],
  "tags": ["espn", "happy-path"]
}
```

`scenarios/best_waiver_adds.json`:
```json
{
  "id": "best_waiver_adds",
  "prompt": "Who are the best free agents available in my league right now?",
  "description": "Should call get_user_session then get_free_agents",
  "expected_tools": ["get_user_session", "get_free_agents"],
  "tags": ["espn", "happy-path"]
}
```

`scenarios/cross_sport_confusion.json`:
```json
{
  "id": "cross_sport_confusion",
  "prompt": "How many touchdowns did my quarterback throw last week?",
  "description": "Adversarial — football question. Model should identify the right sport or ask for clarification, not blindly use baseball defaults.",
  "expected_tools": ["get_user_session"],
  "tags": ["adversarial", "cross-sport"]
}
```

`scenarios/no_league_context.json`:
```json
{
  "id": "no_league_context",
  "prompt": "What should I do with my team?",
  "description": "Adversarial — vague question with no sport/league context. Model should call get_user_session to discover leagues before making assumptions.",
  "expected_tools": ["get_user_session"],
  "tags": ["adversarial", "vague"]
}
```

**Step 4: Commit**

```bash
git add src/types.ts src/scenarios.ts scenarios/
git commit -m "feat: scenario types, loader, and 5 starter scenarios"
```

---

### Task 4: Core runner — call OpenAI with MCP tools, capture response

**Files:**
- Create: `src/run.ts`
- Create: `src/runner.ts`

**Step 1: Create `src/runner.ts` — single scenario executor**

```ts
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type {
  Scenario,
  TraceArtifact,
  CapturedToolCall,
} from "./types.js";
import { loadInstructions } from "./scenarios.js";

const DEFAULT_MODEL = "gpt-5-mini-2025-08-07";

interface RunnerConfig {
  model?: string;
  mcpUrl: string;
  accessToken: string;
  runId: string;
}

/**
 * Truncate a string for artifact preview.
 */
function previewText(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Extract tool calls from the OpenAI response output items.
 */
function extractToolCalls(
  output: OpenAI.Responses.ResponseOutputItem[]
): CapturedToolCall[] {
  const calls: CapturedToolCall[] = [];

  for (const item of output) {
    if (item.type === "mcp_call") {
      calls.push({
        tool_name: item.name,
        args: JSON.parse(item.arguments ?? "{}"),
        result_preview: "",
      });
    }
    if (item.type === "mcp_call_result") {
      // Match back to the last call with same name
      const lastCall = [...calls].reverse().find(
        (c) => c.result_preview === ""
      );
      if (lastCall) {
        const outputText =
          typeof item.output === "string"
            ? item.output
            : JSON.stringify(item.output);
        lastCall.result_preview = previewText(outputText);
      }
    }
  }

  return calls;
}

/**
 * Extract final assistant text from response output.
 */
function extractFinalText(
  output: OpenAI.Responses.ResponseOutputItem[]
): string {
  const textItems = output.filter(
    (item): item is OpenAI.Responses.ResponseOutputMessage =>
      item.type === "message" && item.role === "assistant"
  );

  return textItems
    .flatMap((msg) =>
      msg.content
        .filter(
          (c): c is OpenAI.Responses.ResponseOutputText =>
            c.type === "output_text"
        )
        .map((c) => c.text)
    )
    .join("\n");
}

/**
 * Run a single scenario against OpenAI with Flaim MCP tools.
 */
export async function runScenario(
  scenario: Scenario,
  config: RunnerConfig
): Promise<TraceArtifact> {
  const model = config.model || DEFAULT_MODEL;
  const openai = new OpenAI();

  // Build input messages
  const input: OpenAI.Responses.ResponseInput = [];

  // Optionally prepend instructions from a skill file
  const instructions = loadInstructions(scenario);
  if (instructions) {
    input.push({ role: "developer", content: instructions });
  }

  input.push({ role: "user", content: scenario.prompt });

  const startTime = Date.now();

  const response = await openai.responses.create({
    model,
    input,
    tools: [
      {
        type: "mcp",
        server_url: config.mcpUrl,
        server_label: "flaim",
        headers: { Authorization: `Bearer ${config.accessToken}` },
        require_approval: "never",
      },
    ],
    store: true,
    parallel_tool_calls: false,
  });

  const durationMs = Date.now() - startTime;

  // Extract structured data from response
  const toolCalls = extractToolCalls(response.output);
  const finalText = extractFinalText(response.output);

  const artifact: TraceArtifact = {
    schema_version: "1.0",
    run_id: config.runId,
    scenario_id: scenario.id,
    timestamp_utc: new Date().toISOString(),
    model,
    prompt: scenario.prompt,
    instructions_file: scenario.instructions || null,
    expected_tools: scenario.expected_tools,
    llm_response: {
      response_id: response.id,
      tool_calls: toolCalls,
      final_text: finalText,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
    },
    duration_ms: durationMs,
    notes: [],
  };

  return artifact;
}
```

**Step 2: Create `src/run.ts` — CLI entry point**

```ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadScenarios } from "./scenarios.js";
import { runScenario } from "./runner.js";
import { refreshAccessToken } from "./auth.js";
import type { RunManifest, RunSummary, TraceArtifact } from "./types.js";

const MCP_URL = process.env.FLAIM_MCP_URL || "https://api.flaim.app/mcp";
const MODEL = process.env.FLAIM_EVAL_MODEL || "gpt-5-mini-2025-08-07";

async function main() {
  // Parse CLI args: optional scenario IDs to filter
  const filterIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  console.log("=== Flaim Eval Harness ===\n");
  console.log(`Model:  ${MODEL}`);
  console.log(`MCP:    ${MCP_URL}`);

  // Load scenarios
  const scenarios = loadScenarios(filterIds.length > 0 ? filterIds : undefined);
  console.log(`Scenarios: ${scenarios.length}\n`);

  if (scenarios.length === 0) {
    console.log("No scenarios found. Check scenarios/ directory.");
    process.exit(1);
  }

  // Get access token
  console.log("Refreshing access token...");
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken();
    console.log("Token refreshed.\n");
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // Create run directory
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
  const runDir = path.resolve(import.meta.dirname, "../runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Write manifest
  const manifest: RunManifest = {
    run_id: runId,
    timestamp_utc: new Date().toISOString(),
    model: MODEL,
    mcp_url: MCP_URL,
    scenario_count: scenarios.length,
    scenarios: scenarios.map((s) => s.id),
    instructions_file: scenarios[0]?.instructions || null,
  };
  fs.writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Run scenarios sequentially
  const results: TraceArtifact[] = [];
  const summaryScenarios: RunSummary["scenarios"] = [];
  let totalTokens = { input: 0, output: 0, total: 0 };

  for (const scenario of scenarios) {
    console.log(`--- ${scenario.id} ---`);
    console.log(`  Prompt: "${scenario.prompt}"`);
    if (scenario.instructions) {
      console.log(`  Instructions: ${scenario.instructions}`);
    }

    try {
      const artifact = await runScenario(scenario, {
        model: MODEL,
        mcpUrl: MCP_URL,
        accessToken,
        runId,
      });

      // Write artifact
      fs.writeFileSync(
        path.join(runDir, `${scenario.id}.json`),
        JSON.stringify(artifact, null, 2)
      );

      // Log summary
      const toolNames = artifact.llm_response.tool_calls.map(
        (tc) => tc.tool_name
      );
      const toolsMatch =
        JSON.stringify(toolNames) ===
        JSON.stringify(scenario.expected_tools);

      console.log(`  Tools called: ${toolNames.join(" → ") || "(none)"}`);
      console.log(`  Expected:     ${scenario.expected_tools.join(" → ")}`);
      console.log(`  Match: ${toolsMatch ? "✓" : "✗"}`);
      console.log(`  Tokens: ${artifact.llm_response.usage.total_tokens}`);
      console.log(`  Duration: ${artifact.duration_ms}ms`);
      console.log(`  Final: ${artifact.llm_response.final_text.slice(0, 100)}...`);
      console.log();

      results.push(artifact);
      summaryScenarios.push({
        id: scenario.id,
        status: "ok",
        tool_calls: toolNames,
        expected_tools: scenario.expected_tools,
        tools_match: toolsMatch,
        duration_ms: artifact.duration_ms,
      });

      totalTokens.input += artifact.llm_response.usage.input_tokens;
      totalTokens.output += artifact.llm_response.usage.output_tokens;
      totalTokens.total += artifact.llm_response.usage.total_tokens;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`  ERROR: ${msg}\n`);
      summaryScenarios.push({
        id: scenario.id,
        status: "error",
        tool_calls: [],
        expected_tools: scenario.expected_tools,
        tools_match: false,
        duration_ms: 0,
        error: msg,
      });
    }
  }

  // Write summary
  const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);
  const summary: RunSummary = {
    run_id: runId,
    model: MODEL,
    total_scenarios: scenarios.length,
    completed: summaryScenarios.filter((s) => s.status === "ok").length,
    errored: summaryScenarios.filter((s) => s.status === "error").length,
    total_duration_ms: totalDuration,
    total_tokens: totalTokens,
    scenarios: summaryScenarios,
  };
  fs.writeFileSync(
    path.join(runDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  // Final report
  console.log("=== Run Complete ===");
  console.log(`Run ID:    ${runId}`);
  console.log(`Artifacts: ${runDir}/`);
  console.log(`Completed: ${summary.completed}/${summary.total_scenarios}`);
  console.log(`Errored:   ${summary.errored}`);
  console.log(`Tokens:    ${totalTokens.total} (${totalTokens.input} in / ${totalTokens.output} out)`);
  console.log(`Duration:  ${totalDuration}ms`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

**Step 3: Verify it compiles**

Run: `npx tsx --check src/run.ts`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/runner.ts src/run.ts
git commit -m "feat: core runner — calls OpenAI with MCP tools, writes trace artifacts"
```

---

### Task 5: Instructions directory with starter skill file

**Files:**
- Create: `instructions/fantasy-analyst-v1.md`

**Step 1: Create starter skill file**

`instructions/fantasy-analyst-v1.md`:
```markdown
# Fantasy Sports Analyst

You are a fantasy sports analyst assistant. You have access to MCP tools that connect to a user's fantasy sports leagues.

## Workflow

1. Always start by calling `get_user_session` to discover the user's leagues, platforms, and defaults.
2. Use the league context from the session to determine the correct `platform`, `sport`, `league_id`, and `season_year` parameters for subsequent tool calls.
3. Never guess or assume sport, league, or platform — always derive from session data.

## Tool usage guidelines

- If the user has multiple leagues, ask which one they mean before making data calls (unless they have a clear default).
- If the user asks about a sport that doesn't match their configured leagues, let them know rather than making incorrect calls.
- Use `get_roster` for roster questions, `get_standings` for standings, `get_matchups` for matchup info, `get_free_agents` for waiver wire advice.
- Always pass explicit parameters — never omit required fields.

## Response style

- Be concise and direct.
- Lead with the answer, then provide supporting details.
- Use player names, not IDs.
```

**Step 2: Commit**

```bash
git add instructions/
git commit -m "feat: starter skill file for instruction A/B testing"
```

---

### Task 6: Add a "future direction" section to the design doc

**Files:**
- Modify: `docs/dev/mcp-eval-observability-scope.md`

**Step 1: Add future direction section before "Bottom line"**

Add the following section just before the `## Bottom line` section in the design doc:

```markdown
## Future direction: skills + MCP convergence

The eval harness's `instructions/` directory maps directly to an emerging industry standard. As of early 2026, all major AI platforms are converging on the same pattern: MCP provides tools, skill/instruction files tell the model how to use them.

### Current state of the ecosystem

- **Anthropic (Claude):** Plugins bundle `SKILL.md` files + `.mcp.json` into installable packages. Skills use YAML frontmatter + markdown body. Plugins ship to a directory.
- **OpenAI (ChatGPT/Codex):** Agent Skills use an identical `SKILL.md` format. Codex has official support; ChatGPT is subtly leveraging skills internally. Skills complement MCP — "one equips your agent with domain-specific workflows (Skills); the other facilitates connections to your services (MCP)."
- **Google (Gemini):** Conductor extension stores developer context as versioned Markdown. Gemini CLI supports MCP servers. Managed MCP servers cover Google Cloud services.
- **MCP spec itself:** MCP Apps (Jan 2026) extend tools beyond plain text into interactive UIs via sandboxed iframes.

### What this means for Flaim

The eval harness doubles as a **skill development and testing workflow**:

1. **Write** an instruction file in `instructions/`
2. **Test** it against scenarios with `npm run eval`
3. **Iterate** by comparing artifacts from different instruction versions
4. **Ship** the winning version as a formal `SKILL.md` (or Claude plugin, or OpenAI skill) alongside Flaim's MCP server

When the industry matures to the point where MCP servers bundle instructions, Flaim will already have battle-tested skill definitions ready to package.
```

**Step 2: Commit**

```bash
git add docs/dev/mcp-eval-observability-scope.md
git commit -m "docs: add skills/MCP convergence context to eval design doc"
```

---

### Task 7: First manual test run

This task validates the full chain. Requires a bootstrapped test account.

**Step 1: Bootstrap OAuth (one-time)**

Run: `npm run bootstrap`
Expected: Browser opens to flaim.app consent page. After clicking "Allow", terminal shows success and `.env` has `FLAIM_CLIENT_ID` and `FLAIM_REFRESH_TOKEN` populated.

**Step 2: Run a single scenario**

Run: `npm run eval who_is_on_my_roster`
Expected: Console output shows token refresh, tool calls, and final text. Artifact written to `runs/<timestamp>/who_is_on_my_roster.json`.

**Step 3: Verify artifact**

Run: `cat runs/*/who_is_on_my_roster.json | head -30`
Expected: Valid JSON with `schema_version`, `llm_response.tool_calls`, `llm_response.final_text`.

**Step 4: Run all scenarios**

Run: `npm run eval`
Expected: All 5 scenarios run, summary written. Check `runs/*/summary.json` for pass/fail.

**Step 5: Commit (if any tweaks were needed)**

```bash
git add -A .
git commit -m "feat: verified first manual test run"
```

---

### Task 8 (Optional): Surface correlation ID in worker logs

This is Phase 1b from the design doc. Small production code change.

**Files:**
- Modify: `workers/fantasy-mcp/src/index.ts`
- Modify: `workers/espn-client/src/index.ts`
- Modify: `workers/yahoo-client/src/index.ts`

**Step 1: Add structured log in `fantasy-mcp/src/index.ts`**

In the `/mcp` handler (line ~136), right after `const correlationId = getCorrelationId(c.req.raw);`, add:

```ts
console.log(JSON.stringify({ event: "mcp_request", correlationId }));
```

Apply the same to the `/mcp/*`, `/fantasy/mcp`, and `/fantasy/mcp/*` handlers.

**Step 2: Add structured log in `espn-client/src/index.ts`**

At the entry point of the `/execute` handler, after extracting the correlation ID, add:

```ts
console.log(JSON.stringify({ event: "espn_execute", correlationId, tool, sport, platform: "espn" }));
```

**Step 3: Add structured log in `yahoo-client/src/index.ts`**

Same pattern:

```ts
console.log(JSON.stringify({ event: "yahoo_execute", correlationId, tool, sport, platform: "yahoo" }));
```

**Step 4: Verify locally**

Run: `cd workers/fantasy-mcp && wrangler dev`
Expected: No build errors.

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/index.ts workers/espn-client/src/index.ts workers/yahoo-client/src/index.ts
git commit -m "feat: surface correlation ID as structured log for Cloudflare Observability"
```

Note: This pushes to main = auto-deploy. Consider doing on a branch if you want to test first.

---

Plan complete and saved to `docs/plans/2026-02-06-mcp-eval-harness.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?