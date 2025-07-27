# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 CRITICAL PROJECT CONTEXT

**This is a SOLO DEVELOPER'S FIRST PRODUCTION PROJECT**

- 👤 **One person** managing everything (frontend, backend, devops, design)
- 🎓 **Learning project** - First time building production-grade software
- ⏰ **Part-time development** - Limited bandwidth, not a full-time job
- 🎯 **Goal: Ship working product** - Not winning architecture awards

**AI Assistant Mandate:**
- ✅ **Recommend proven, stable solutions** - Next.js, Vercel, Clerk
- ✅ **Prioritize "boring" technology** - Battle-tested over cutting-edge  
- ✅ **Start simple, scale when needed** - No premature optimization
- ✅ **Working over perfect** - Functional features beat elegant architecture
- ❌ **Avoid complex patterns** - No microservices, enterprise architectures
- ❌ **No experimental tech** - Stick to mainstream, well-documented tools
- ❌ **Don't over-engineer** - This is a learning project with bandwidth constraints

## Project Overview

FLAIM (Fantasy League AI Manager) is a modern microservices platform providing AI-powered fantasy sports management through MCP (Model Context Protocol) tools. The architecture uses Clerk authentication with usage-based access controls and Cloudflare infrastructure.

**Core Architecture**:
- **Next.js Frontend** (`/openai`) - AI assistant with 100 free messages/month, paid unlimited tier
- **Auth Module** (`/auth`) - Cross-platform authentication (web/iOS/workers) with usage tracking
- **Baseball MCP Worker** (`/workers/baseball-espn-mcp`) - ESPN fantasy baseball integration
- **Football MCP Worker** (`/workers/football-espn-mcp`) - ESPN fantasy football integration
- **Test Suite** (`/tests`) - Comprehensive testing infrastructure

## Development Commands

### Modern GitOps Workflow
```bash
# Start all services locally (recommended)
npm run dev

# Individual development commands
npm run dev:frontend                # Next.js development server only
npm run dev:workers                 # All workers via wrangler dev

# Production deployment
npm run deploy:workers:preview      # Deploy all workers to preview
npm run deploy:workers:prod         # Deploy all workers to production

# Build commands
npm run build                       # Build frontend for deployment
```

### Frontend (Next.js in `/openai`)
```bash
cd openai
npm run dev          # Development server (port 3000)
npm run build        # Production build
npm run lint         # ESLint check
```

### Auth Module (`/auth`)
```bash
cd auth
npm run build        # Build all targets (shared/workers/web)
npm run type-check   # Type check all configurations
npm test             # Run Jest tests
npm run test:coverage # Test coverage report
```

### Individual Worker Development (if needed)
```bash
# Auth Worker
cd workers/auth-worker
npm run type-check
wrangler dev --env dev --port 8786

# Baseball ESPN MCP
cd workers/baseball-espn-mcp  
npm run type-check
wrangler dev --env dev --port 8787

# Football ESPN MCP
cd workers/football-espn-mcp
npm run type-check
wrangler dev --env dev --port 8788
```

### Testing (`/tests`)
```bash
cd tests
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e           # Playwright e2e tests
npm run test:coverage      # Coverage report
```

## Architecture Guidelines

### Monorepo Structure
- **NPM workspaces** with dependency hoisting at root
- **Single Next.js installation** prevents type conflicts
- **Path aliases** avoid deep relative imports
- **Build target separation** (shared/workers/web in auth module)

### Security Model
- **Clerk authentication** with server-side verification
- **AES-GCM encryption** for ESPN credentials in CF KV
- **Per-user data isolation** with verified Clerk user IDs
- **Usage tracking** (100 free messages/month, unlimited paid)

### MCP Integration
Workers expose MCP tools for fantasy sports data:
- `get_espn_league_info` - League settings and metadata
- `get_espn_team_roster` - Team roster details  
- `get_espn_matchups` - Current week matchups

## Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Authentication**: Clerk v6.22.0 with @clerk/backend v2.1.0
- **Infrastructure**: Cloudflare Workers, Pages, KV
- **Testing**: Jest, Playwright
- **Linting**: ESLint v9 with typescript-eslint v8

## Development Workflow

1. **Environment Setup**: Use `npm run dev` for local development (all services)
2. **Local Development**: All services run on localhost (workers on 8786-8788, frontend on 3000)
3. **Testing**: Run tests before committing (`npm test` in respective directories)
4. **Type Checking**: Ensure all workers pass type-check before deployment
5. **Deployment**: Push to PR for preview, merge to main for production (GitOps)

## Key Considerations

- **Node.js 22 required** (check engines in package.json files)
- **Wrangler CLI** needed for worker development and deployment
- **Environment variables** configured per service (see docs/ARCHITECTURE.md)
- **Clerk session verification** required for protected endpoints
- **ESPN credentials** encrypted in CF KV with user-specific keys

## File Structure Patterns

```
/openai          # Next.js frontend
/auth            # Cross-platform auth module
  /shared        # Platform-agnostic logic
  /clerk/web     # Next.js implementation
  /dist          # Built artifacts
/workers         # Cloudflare Workers
  /auth-worker   # Central auth service
  /baseball-*    # Sport-specific MCP
  /football-*    # Sport-specific MCP
/tests           # Test infrastructure
/docs            # Architecture documentation
```

## When to Use MCP Tools

Check `mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs` for up-to-date documentation before making changes to:
- OpenAI API integration patterns
- Clerk authentication flows
- Cloudflare Workers best practices
- Next.js 15 App Router features

## Technical Analysis Best Practices

When conducting technical assessments, architectural evaluations, or infrastructure migration analysis:

### **Balanced Assessment Approach**
- Present both benefits and challenges honestly
- Avoid advocacy for either option - remain neutral
- Acknowledge when current systems work well
- Focus on facts and measurable outcomes, not preferences
- Base analysis on current technology, not assumptions

### **Prototype-First Methodology**
- Recommend testing/validation before committing to major changes
- Emphasize validation of critical functionality over theoretical benefits
- Provide concrete validation steps and success criteria
- Use data-driven decision making approach

### **Risk-Based Framework**
- Categorize risks by severity (High/Medium/Low)
- Identify specific technical dependencies and compatibility issues
- Acknowledge operational complexity trade-offs
- Provide clear, objective decision criteria

### **Concise, Actionable Structure**
- Dramatically reduce verbosity while maintaining completeness
- Focus on essential information only
- Provide practical implementation guidance
- Include concrete next steps and validation methods

### **Respect for Working Systems**
- Don't recommend changes just for the sake of change
- Apply "if it ain't broke, don't fix it" principle appropriately
- Require compelling evidence for infrastructure migrations
- Consider opportunity cost of technical changes vs. product features
- Acknowledge technical debt vs. functional systems honestly

### **Verification Standards**
- Verify claims against actual codebase before making assertions
- Cross-reference version numbers and dependencies
- Check for file existence before referencing implementations
- Use web search to validate technology capabilities and limitations

## Solo Developer Decision Framework

### ✅ Good Recommendations
**Implementation Time:** 1-2 hours max
**Complexity:** Uses existing tools/patterns
**Documentation:** Clear, step-by-step guides available
**Reversibility:** Easy to undo if it doesn't work
**Learning:** Builds on current knowledge

### ❌ Bad Recommendations  
**Implementation Time:** Requires weekend project
**Complexity:** Introduces 3+ new concepts
**Documentation:** "Just read the advanced docs"
**Reversibility:** Major refactor to undo
**Learning:** Requires learning entirely new paradigms

### Decision Checklist
Before recommending any solution, ask:
1. **Can this be done in a 1-2 hour session?**
2. **Does this use tools already in the stack?**
3. **Is there official documentation with examples?**
4. **Can this be easily reverted if it breaks?**
5. **Does this solve an immediate problem vs future scaling?**

If any answer is "no", suggest a simpler alternative.

### Emergency Brake Principles
**When user seems overwhelmed:**
1. **Stop adding features** - Fix what's broken first
2. **Revert to working state** - Git is your safety net
3. **Ask for simpler alternatives** - There's usually an easier way
4. **Focus on user needs** - What do they actually want to accomplish?
5. **Take breaks** - Complex decisions need fresh perspective

### Technology Stack Constraints
**Current stack is intentionally simple - don't suggest adding:**
- Additional databases or storage systems
- Complex state management libraries
- Custom authentication or authorization
- Advanced caching or performance optimizations
- Sophisticated monitoring or observability
- Enterprise-grade deployment patterns

**Focus on mastering what's already there:**
- Next.js fundamentals and App Router
- React hooks and component patterns
- TypeScript basics and type safety
- Cloudflare Workers API and deployment
- Clerk authentication flows
- Basic debugging and troubleshooting