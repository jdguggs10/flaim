# Multi‑MCP Server Routing Gameplan

**TL;DR –** One Cloudflare Worker per **(sport × platform)** pair; UI dropdowns pick that pair, and the gateway passes only that Worker’s tool list to the LLM.  
Naming pattern: `baseball-espn`, `baseball-yahoo`, `football-espn`, etc.  
Result: Each chat sees ≤10 domain‑specific tools, no cross‑domain hallucination, simpler CI/CD.

---

## 1. Naming convention

| Sport | Platform | Worker Route (example) |
|-------|----------|-------------------------|
| MLB   | ESPN     | `https://baseball-espn-mcp.<zone>.workers.dev` |
| MLB   | Yahoo    | `https://baseball-yahoo-mcp.<zone>.workers.dev` |
| NFL   | ESPN     | `https://football-espn-mcp.<zone>.workers.dev` |

*Pattern = `<sport>-<platform>-mcp>` (all lowercase, hyphen‑separated). Keep abbreviations obvious (`mlb`, `nfl`, …).

---

## 2. User selection → LLM tool exposure

1. **Front‑end**: two required `<Select>` controls (`sport`, `platform`). Disable **Send** until both are chosen.  
2. **Gateway route** (`/api/chat-turn.ts`):

   ```ts
   const map = {
     "mlb_espn": {
       mcp: "https://baseball-espn-mcp…",
       tools: ["getLeagueMeta","getRoster","getLineup"]
     },
     // …other pairs
   };

   const key = `${sport}_${platform}`;
   const cfg = map[key];

   const stream = await openai.responses.create({
     model: "gpt-4.1-mini",
     input: messages,
     tools: cfg.tools.map(name => ({
       type: "mcp",
       server_url: cfg.mcp,
       name
     })),
     previous_response_id: freshThread ? undefined : lastId
   });
   ```

3. **Isolation guarantee**: The LLM can only call the listed tools; no stray Yahoo calls while in ESPN mode.

---

## 3. Worker layout (per MCP server)

```
src/
  index.ts        // extends McpAgent
  espn.ts         // helper for ESPN private API
  kv.ts           // SWID / espn_s2 cookie vault
wrangler.toml
```

### 3.1 Lean tool set (≤10)

| Tool | Purpose |
|------|---------|
| `getLeagueMeta` | Basic league settings & scoring |
| `getRoster`     | Team roster for a scoring period |
| `getLineup`     | Current starting lineup |
| `tradeAnalyzer` | Evaluate proposed trade (write scope) |
| … | Add sparingly |

---

## 4. Auth & cookie handling

* Implement OAuth flow per Cloudflare **Remote MCP / Add authentication** guide.  
* Persist `swid` + `espn_s2` in **Workers KV** keyed by `sub` claim.  
* Each tool calls `fetchEspn()` which injects cookies:

  ```ts
  async function fetchEspn(path: string, init = {}) {
    const { swid, s2 } = await getCookiesForUser(this.props.sub);
    return fetch(`https://fantasy.espn.com/apis/v3${path}`, {
      headers: { Cookie: `SWID=${swid}; espn_s2=${s2}` },
      ...init,
      cf: { cacheEverything: false }
    }).then(r => r.json());
  }
  ```

---

## 5. CI/CD

| Step | Action |
|------|--------|
| **Test** | `pnpm test` + schema validation |
| **Publish** | `wrangler publish --env prod` |
| **Lock** | Fail CI if JSON‑schema diff vs repo lock‑file |
| **Tag** | `baseball-espn@YYYYMMDD` release tags |

Monorepo acceptable: `packages/baseball-espn/`, `packages/baseball-yahoo/`, etc.

---

## 6. Observability

| Metric | Reason |
|--------|--------|
| Tool execution time | Detect ESPN latency |
| Error rate per Worker | Spot cookie expiry & auth issues |
| Tokens per chat | Watch cost drift |

`wrangler tail` in dev, Logpush → Datadog in prod.

---

## 7. Edge cases & safeguards

1. **Sport/platform switch mid‑chat** → reset `messages` + `previous_response_id`.  
2. **Cookie expiry or 429** → return “Please re‑link ESPN” with retry advice.  
3. **>50 sub‑requests** (Cloudflare limit) → batch fetches or paginate.  

---

## 8. Road‑map

| Week | Deliverable |
|------|-------------|
| **1** | Scaffold `baseball-espn-mcp` Worker; stub `getLeagueMeta`, `getRoster`; deploy auth‑less for quick loop. |
| **2** | Add OAuth, cookie vault, Jest tests for each tool. |
| **3** | Ship gateway dropdown routing; e2e test chat → roster retrieval. |
| **4** | Harden error‑handling, set up Logpush dashboards, automate CI. |

---

### Mantra

> **Lean · Isolated · Deterministic.**  
> The moment you need an 11th endpoint, it’s time for another Worker. 