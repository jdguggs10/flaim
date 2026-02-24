# iOS App Research: On-Device Foundation Models + Flaim MCP

**Date:** 2026-02-22
**Last verified:** 2026-02-24
**Status:** Research complete, not started
**Decision (updated):** Proceed only with a timeboxed spike. Do not commit to MVP until the spike passes explicit go/no-go criteria.

---

## Summary

Investigated building a native iOS app that wraps Flaim's MCP gateway using Apple's on-device Foundation Models framework (~3B parameter LLM with tool calling). The approach is technically feasible but has significant constraints that shape the product design.

**Primary motivation:** App Store distribution as a discoverability channel (not AI superiority over Claude/ChatGPT).

---

## Key Technical Findings

### Apple Foundation Models Framework (Verified)

| Fact | Status | Source |
|------|--------|--------|
| ~3B param on-device model via Foundation Models framework | Confirmed | [Apple ML Research](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates) |
| Tool calling is first-class (`Tool` protocol) | Confirmed | [Apple Developer Docs](https://developer.apple.com/documentation/FoundationModels) |
| Guided generation (`@Generable` / `@Guide` macros) | Confirmed | [WWDC25 Session 286](https://developer.apple.com/videos/play/wwdc2025/286/) |
| 4096 token context window per session (input + output) | Confirmed | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window) |
| Free inference (no per-token billing) | Confirmed | [Apple Newsroom](https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/) |
| Requires iOS 26+ and Apple Intelligence-eligible hardware | Confirmed | A17 Pro+ iPhone, M1+ iPad/Mac |
| Shipping now (iOS 26.3 is current public release) | Confirmed | Shipped Sep 15, 2025 |

### MCP Swift SDK (Verified)

- **Official repo:** [modelcontextprotocol/swift-sdk](https://github.com/modelcontextprotocol/swift-sdk) (v0.11.0, Apache 2.0)
- **Maintained by:** Anthropic's MCP org + Loopwork AI
- **iOS support:** iOS 16.0+ via `HTTPClientTransport` (Streamable HTTP)
- **Maturity:** Pre-1.0, actively evolving, functional for client use
- SSE streaming works on iOS (Linux-only limitation does not apply to Apple platforms)
- Stdio transport is NOT viable on iOS (no subprocess APIs)

### Device Eligibility (~32% of active iPhones)

- **iPhones:** A17 Pro+ (iPhone 15 Pro/Max, all iPhone 16/17 models)
- **iPads:** M1+ or A17 Pro (iPad mini 7th gen)
- **Macs:** All Apple Silicon (M1+)
- ~7 GB storage required for on-device models
- Auto-enabled since iOS 18.3 (opt-out, not opt-in)
- Available in 16+ languages; not available in China mainland

### Corrections From Independent Verification

- The App Store fantasy + AI category is **not** greenfield. There is existing competition (for example, WalterPicks and RotoBot).
- Repository stars and "last pushed" metrics are point-in-time snapshots and should not be used as durable decision inputs.
- The strongest durable technical constraints remain token budget, device/region availability, and solo-maintenance cost.

---

## Critical Constraint: 4096-Token Budget for Flaim

The 4096 token limit is the biggest design challenge. Estimated per-query budget:

| Component | Estimated Tokens |
|-----------|-----------------|
| System instructions | ~100-200 |
| 7 tool definitions (schemas) | ~550+ |
| User prompt | ~50-100 |
| Tool call args + response (e.g., roster) | ~1000-2000+ |
| Model's final response | ~200-500 |
| **Total per round** | **~2000-3000** |

This means 1-2 turns per session before hitting the limit. No multi-turn follow-ups. Each question is essentially a fresh session. Compare to Claude/ChatGPT where users get 100K+ token contexts.

**Mitigation strategies:**
- Design as single-turn Q&A, not multi-turn chat
- Aggressive tool response summarization before returning to model
- Cache `get_user_session` locally so the model doesn't need to call it every time
- Consider composite "bundle" tools for common workflows
- Start new sessions per question (not per conversation)

---

## Strategic Rationale: App Store Distribution

The motivation is **discoverability**, not on-device AI superiority.

| Channel | Status | Control |
|---------|--------|---------|
| ChatGPT Actions directory | Pending submission | They decide |
| Anthropic connectors | Waiting on OAuth verification | They decide |
| GitHub MCP Servers registry | Published (`app.flaim/mcp`) | Done |
| Reddit/Threads/HN | Organic, slow burn | Indirect |
| **App Store** | **Not attempted** | **You ship, Apple reviews** |

App Store advantages:
- You control the submission
- Search is powerful ("fantasy football AI", "fantasy assistant")
- Direct distribution channel independent of connector directory approval timelines
- Ratings/reviews create a flywheel
- **Draft season (Aug-Sep)** is when fantasy app downloads spike massively

The app doesn't need to be better than Claude/ChatGPT. It needs to:
1. Be discoverable in the App Store
2. Introduce people to Flaim
3. Serve as a funnel to the full MCP experience via Claude/ChatGPT/Gemini

---

## AnyLanguageModel: Fallback Strategy

[AnyLanguageModel](https://github.com/mattt/AnyLanguageModel) (MIT, by Matt Thompson) provides an API-compatible drop-in replacement for Foundation Models with support for multiple backends:

- **On-device:** Foundation Models (A17 Pro+), Core ML, MLX, llama.cpp
- **Cloud:** OpenAI, Anthropic, Gemini, Hugging Face, Ollama

Same `@Generable`, `Tool` protocol, and session API. Write code once, swap backends based on device eligibility. Solves the 68% device ineligibility problem.

**Recommendation:** Start with Foundation Models directly for the spike. Add AnyLanguageModel later if device eligibility matters for App Store reach.

---

## Recommended Starting Repos

### Primary: Fork [Dimillian/FoundationChat](https://github.com/Dimillian/FoundationChat)

- MIT, by Thomas Ricouard (creator of IceCubesApp)
- Clean SwiftUI chat with streaming, multi-conversation, SwiftData persistence
- **Already has tool calling** via `Tool` protocol with working example
- Small enough to understand in an evening, clean enough to fork confidently
- Adaptation: swap example tools for 7 Flaim `Tool` protocol implementations that call MCP gateway via Swift SDK's `HTTPClientTransport`

### Reference: [rudrankriyam/Foundation-Models-Framework-Example](https://github.com/rudrankriyam/Foundation-Models-Framework-Example)

- MIT
- 9 tool implementations, RAG, voice, multi-language
- Best reference for Foundation Models patterns (not for forking — too large/demo-oriented)

### Alternative: [CherryHQ/hanlin-ai](https://github.com/CherryHQ/hanlin-ai)

- MIT
- 20+ LLM providers, tool calling, streaming, RAG, voice, vision
- Production-grade but large codebase — strip down rather than build up

### Other notable repos (reference only):

| Repo | Notes |
|------|-------|
| [mattt/chat-ui-swift](https://github.com/mattt/chat-ui-swift) | Designed for AnyLanguageModel; currently macOS only |
| [mi12labs/SwiftAI](https://github.com/mi12labs/SwiftAI) | Library (not app); AI orchestration layer |
| [exyte/Chat](https://github.com/exyte/Chat) | Pure chat UI framework; no AI integration |
| [indragiek/Context](https://github.com/indragiek/Context) | MCP debugging tool; extractable MCP client code |
| [jamesrochabrun/MCPSwiftWrapper](https://github.com/jamesrochabrun/MCPSwiftWrapper) | MCP + chat UI demo-style wrapper |

---

## Proposed Timeline

| Phase | When | What |
|-------|------|------|
| Spike | Mar 2026 (4 weeks) | Fork FoundationChat, connect Flaim MCP gateway, validate single-turn UX and token budget constraints on real prompts. |
| Go/No-Go Gate | End of Mar 2026 | Proceed only if quality bar is met and scope does not disrupt directory + marketing priorities. |
| MVP | Apr-May 2026 (only if Go) | Auth integration, 7 tool wrappers, local caching, polish |
| TestFlight | Jun-Jul 2026 | Family-and-friends beta |
| App Store | Late Jul 2026 | Ship before fantasy football draft season (Aug-Sep) |

**Important:** This is secondary to directory submissions and marketing. Don't let it crowd out the draft-season push.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| 4096-token context makes UX brittle | High | Single-turn design; aggressive summarization; local caching |
| Device eligibility reduces audience | Medium | AnyLanguageModel fallback (add later) |
| Maintenance burden for solo dev | Medium | Keep scope minimal; use standard Apple stack (SwiftUI + SwiftData) |
| iOS dev learning curve (new stack) | Medium | Fork a working repo; learn by modifying, not from scratch |
| Crowds out draft-season marketing | High | Treat as secondary; spike first, commit only if fun |
| Existing AI fantasy app competition | Medium | Position Flaim on verifiable league-context accuracy + MCP ecosystem interoperability |
| App Store review rejection | Low | Read-only, no user-generated content, standard auth patterns |

---

## Decision Criteria (Before Committing Past Spike)

Answer these after the spike:
1. Is the 4096-token limit workable for simple fantasy queries?
2. Is SwiftUI/iOS development fun or a chore?
3. Can you hit useful output quality in a single-turn workflow (start/sit, waivers, matchup summary)?
4. Can you realistically ship by late July without sacrificing marketing work?
5. Does the experience differentiate enough from existing AI fantasy apps to win installs?

If 4/5 are "yes," proceed to MVP. Otherwise, shelve and focus on directory submissions + Reddit/Threads ramp.

---

## References

- [Apple Foundation Models documentation](https://developer.apple.com/documentation/FoundationModels)
- [TN3193: Managing context window](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)
- [WWDC25: Meet the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2025/286/)
- [WWDC25: Deep dive into Foundation Models](https://developer.apple.com/videos/play/wwdc2025/301/)
- [Apple ML Research: 2025 Foundation Models updates](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)
- [How to get Apple Intelligence (requirements, languages, regions)](https://support.apple.com/en-us/121115)
- [MCP Swift SDK](https://github.com/modelcontextprotocol/swift-sdk)
- [AnyLanguageModel](https://github.com/mattt/AnyLanguageModel)
- [MCP Specification (Streamable HTTP)](https://modelcontextprotocol.io)
- [WalterPicks – AI Insights (App Store)](https://apps.apple.com/us/app/walterpicks-ai-insights/id1521523140)
- [RotoBot - AI Fantasy Advice (App Store)](https://apps.apple.com/us/app/annual-subscription/id6502530085)
- Deep research report: `/Users/ggugger/Code/deep-research-report.md`
