# Solo Developer Guidelines

> **Golden Rule**: You are one person. Simplicity is survival.
> **Mission**: Build robust MCP tools for fantasy sports. The web UI is a management console, not a consumer product.

## 1. Scope & Strategy
- **Product**: You build the **pipes** (MCP servers), not the **brain** (AI). Users bring their own AI (Claude, ChatGPT).
- **Frontend**: Keep it minimal. It exists to configure credentials and debug connections.
- **Monetization**: Don't build a billing system for chat. If you monetize, do it via API access or premium worker features, not token resale.

## 2. Technical Constraint: "Boring is Better"
- **Stack**: Next.js (UI), Cloudflare Workers (Backend/MCP), Supabase (DB).
- **No Fancy Ops**: If it requires a Kubernetes cluster or a custom VPS, don't do it.
- **No Complex State**: Workers are stateless. Auth is handled by Clerk + Supabase.
- **One Way to Do It**: Don't support multiple ways to fetch data. If `get_user_session` works, don't build `get_user_v2`.

## 3. Keeping AI Tools Aligned
As a solo dev maintaining AI tools, alignment drift is a major risk.
- **Unified Debugging**: Use your internal "Management & Debugging UI" (`/openai`) as the **source of truth**. If a tool fails there, it will fail in Claude. Fix it locally first.
- **Documentation as Code**: Keep `MCP_CONNECTOR_RESEARCH.md` and `ARCHITECTURE.md` updated *before* code changes. If the docs say the API does X, make the API do X.
- **Dogfooding**: Play your own fantasy leagues using your MCP connectors via Claude. If it's annoying for you, it's broken for users.
- **Automated Verification**: (Goal) Write simple integration tests that call your workers with a real (test) user token. Don't rely on manual chat testing for everything.

## 4. Workflows
- **Code Changes**:
  1. Update docs/plan.
  2. Implement in `dev`.
  3. Verify in Debug UI.
  4. Push to `preview` (PR).
  5. Deploy to `prod`.
- **Debugging**:
  - 400/500 errors? Check Worker logs in Cloudflare Dashboard.
  - "I don't know that"? Check the system prompt in `lib/prompts/system-prompt.ts`.
  - Auth fails? Check `auth-worker` logs and `oauth_tokens` table.

## 5. "YAGNI" (You Ain't Gonna Need It)
- Don't build a complex admin dashboard.
- Don't build a social network.
- Don't build a custom LLM training pipeline.
- **DO** build solid error messages that tell the user *exactly* what went wrong (e.g., "ESPN cookie expired").
