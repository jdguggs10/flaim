# Context7 Documentation Index for FLAIM

> **Purpose**: Comprehensive reference guide for accessing relevant technical documentation via Context7 when developing, debugging, or extending the FLAIM platform.

## Quick Reference - Most Critical Documentation

| Technology | Primary Source | Library ID | Snippets | Trust Score | Use Case |
|------------|----------------|------------|----------|-------------|----------|
| **Next.js** | Official Docs | `/context7/nextjs` | 12,464 | 10 | All Next.js development |
| **React** | Official Docs | `/context7/react_dev` | 2,461 | 10 | Component development |
| **TypeScript** | Official Repo | `/microsoft/typescript` | 26,981 | 9.9 | Type definitions & advanced TS |
| **Tailwind CSS** | Comprehensive | `/context7/tailwindcss` | 3,114 | 10 | Styling & UI development |
| **Cloudflare Workers** | Complete Guide | `/llmstxt/developers_cloudflare_com-workers-llms-full.txt` | 10,777 | 8 | Worker development |
| **Clerk Auth** | Full Docs | `/context7/clerk` | 9,191 | 9 | Authentication implementation |
| **Hono Framework** | Official Docs | `/hono.dev-01d345b/llmstxt` | 2,737 | - | API framework usage |
| **MCP Protocol** | Complete Spec | `/modelcontextprotocol.io/llmstxt` | 4,128 | 7 | MCP server development |

---

## Frontend Technologies

### Next.js Framework
**Primary Sources**:
- **`/context7/nextjs`** (12,464 snippets, Trust: 10) - **RECOMMENDED**: Comprehensive Next.js documentation
- **`/vercel/next.js`** (3,916 snippets, Trust: 10) - Official repository with multiple versions
- `/nextjsargentina/next.js-docs` (1,516 snippets, Trust: 4.4) - Next.js v14 specific

**When to Use**:
- App Router patterns → `/context7/nextjs`
- Version-specific features → `/vercel/next.js`
- SSR/SSG implementation → `/context7/nextjs`
- Deployment configurations → `/context7/nextjs`

**Integration Examples**:
- `/clerk/nextjs-auth-starter-template` (3 snippets, Trust: 8.4) - Next.js + Clerk
- `/resend/resend-nextjs-app-router-example` (4 snippets, Trust: 9.5) - Email integration
- `/opennextjs/opennextjs-cloudflare` (29 snippets, Trust: 7.4) - Cloudflare deployment

### React Development
**Primary Sources**:
- **`/context7/react_dev`** (2,461 snippets, Trust: 10) - **RECOMMENDED**: Official React documentation
- `/reactjs/react.dev` (2,506 snippets, Trust: 9) - React documentation website

**When to Use**:
- Component patterns → `/context7/react_dev`
- Hooks implementation → `/context7/react_dev`
- React 19 features → `/context7/react_dev`
- Performance optimization → `/context7/react_dev`

### TypeScript
**Primary Sources**:
- **`/microsoft/typescript`** (26,981 snippets, Trust: 9.9) - **RECOMMENDED**: Official TypeScript
- `/typescript-eslint/typescript-eslint` (921 snippets, Trust: 8.6) - ESLint integration

**When to Use**:
- Advanced type definitions → `/microsoft/typescript`
- Compiler configuration → `/microsoft/typescript`
- ESLint rules → `/typescript-eslint/typescript-eslint`
- Type system deep-dives → `/microsoft/typescript`

### Styling & UI

#### Tailwind CSS
**Primary Sources**:
- **`/context7/tailwindcss`** (3,114 snippets, Trust: 10) - **RECOMMENDED**: Comprehensive guide
- `/tailwindlabs/tailwindcss.com` (1,868 snippets, Trust: 8) - Official website
- `/tailwindlabs/tailwindcss-typography` (24 snippets, Trust: 8) - Typography plugin

**When to Use**:
- Utility classes → `/context7/tailwindcss`
- Configuration → `/context7/tailwindcss`
- Plugin development → `/tailwindlabs/tailwindcss.com`
- Typography → `/tailwindlabs/tailwindcss-typography`

#### shadcn/ui Components
**Primary Sources**:
- **`/shadcn-ui/ui`** (1,083 snippets, Trust: 7.7) - **RECOMMENDED**: Official components
- `/flutter-shadcn-ui` (132 snippets, Trust: 9.8) - Flutter port (reference only)

**When to Use**:
- Component implementation → `/shadcn-ui/ui`
- Custom component creation → `/shadcn-ui/ui`
- Theming and variants → `/shadcn-ui/ui`

#### Radix UI Primitives
**Primary Sources**:
- **`/radix-ui/website`** (1,055 snippets, Trust: 8.7) - **RECOMMENDED**: Complete documentation
- `/radix-ui/primitives` (4 snippets, Trust: 8.7) - Core primitives
- `/radix-ui/themes` (8 snippets, Trust: 8.7) - Theme system

**When to Use**:
- Accessibility patterns → `/radix-ui/website`
- Primitive components → `/radix-ui/primitives`
- Theme customization → `/radix-ui/themes`

---

## Backend & Infrastructure

### Cloudflare Workers
**Primary Sources**:
- **`/llmstxt/developers_cloudflare_com-workers-llms-full.txt`** (10,777 snippets, Trust: 8) - **RECOMMENDED**: Complete guide
- `/cloudflare/workers-sdk` (297 snippets, Trust: 9.3) - Wrangler CLI & SDK
- `/cloudflare/templates` (93 snippets, Trust: 9.3) - Worker templates
- `/cloudflare/workerd` (193 snippets, Trust: 9.3) - Runtime documentation

**When to Use**:
- Worker development → Complete guide
- CLI operations → `/cloudflare/workers-sdk`
- Project templates → `/cloudflare/templates`
- Runtime features → `/cloudflare/workerd`

### Hono Framework
**Primary Sources**:
- **`/hono.dev-01d345b/llmstxt`** (2,737 snippets) - **RECOMMENDED**: Comprehensive docs
- `/honojs/website` (692 snippets, Trust: 7.3) - Official website
- `/honojs/middleware` (280 snippets, Trust: 7.3) - Middleware collection

**When to Use**:
- API development → Comprehensive docs
- Middleware usage → `/honojs/middleware`
- Framework concepts → `/honojs/website`

### Cloudflare Platform Services
**Primary Sources**:
- **`/cloudflare/cloudflare-docs`** (10,162 snippets, Trust: 9.3) - **RECOMMENDED**: Complete platform docs
- `/cloudflare/cloudflare-typescript` (29 snippets, Trust: 9.3) - TypeScript SDK
- `/llmstxt/developers_cloudflare_com-d1-llms-full.txt` (2,083 snippets, Trust: 8) - D1 database

**When to Use**:
- Platform features → Complete platform docs
- SDK usage → TypeScript SDK
- Database operations → D1 documentation

---

## Authentication & APIs

### Clerk Authentication
**Primary Sources**:
- **`/context7/clerk`** (9,191 snippets, Trust: 9) - **RECOMMENDED**: Comprehensive documentation
- `/llmstxt/clerk_com-docs-llms-full.txt` (8,002 snippets, Trust: 8) - Complete Clerk docs
- `/clerk/clerk-docs` (2,439 snippets, Trust: 8.4) - Official documentation
- `/clerk/javascript` (375 snippets, Trust: 8.4) - JavaScript SDK

**When to Use**:
- Implementation patterns → `/context7/clerk`
- Complete feature reference → LLMs full docs
- SDK methods → `/clerk/javascript`
- Advanced configurations → `/clerk/clerk-docs`

### OpenAI Integration
**Primary Sources**:
- **`/openai/openai-node`** (408 snippets, Trust: 9.1) - **RECOMMENDED**: Official Node.js SDK
- `/openai/openai-cookbook` (2,926 snippets, Trust: 9.1) - Examples and guides
- `/openai/openai-python` (142 snippets, Trust: 9.1) - Python SDK (reference)

**When to Use**:
- API integration → Node.js SDK
- Implementation examples → Cookbook
- Best practices → Cookbook

---

## Model Context Protocol (MCP)

### Core MCP Documentation
**Primary Sources**:
- **`/modelcontextprotocol.io/llmstxt`** (4,128 snippets, Trust: 7) - **RECOMMENDED**: Complete protocol spec
- `/context7/modelcontextprotocol_io-introduction` (590 snippets, Trust: 9) - Introduction & concepts
- `/modelcontextprotocol/docs` (161 snippets, Trust: 7.8) - Official documentation
- `/modelcontextprotocol/specification` (732 snippets, Trust: 7.8) - Technical specification

**When to Use**:
- Protocol understanding → Complete spec
- Getting started → Introduction & concepts
- Implementation details → Technical specification

### MCP SDKs & Implementation
**Primary Sources**:
- **`/modelcontextprotocol/typescript-sdk`** (0 snippets, Trust: 7.8) - **NOTE**: Limited snippets
- `/modelcontextprotocol/servers` (246 snippets, Trust: 7.8) - Server implementations
- `/modelcontextprotocol/python-sdk` (88 snippets, Trust: 7.8) - Python SDK

**When to Use**:
- TypeScript implementation → TypeScript SDK (may need supplementing)
- Server examples → Server implementations
- Multi-language reference → Python SDK

---

## Development Tools & Testing

### ESLint Configuration
**Primary Sources**:
- **`/eslint/eslint`** (3,075 snippets, Trust: 9.1) - **RECOMMENDED**: Official ESLint docs
- `/typescript-eslint/typescript-eslint` (921 snippets, Trust: 8.6) - TypeScript integration
- `/antfu/eslint-config` (60 snippets, Trust: 10) - Popular preset

**When to Use**:
- Rule configuration → Official ESLint docs
- TypeScript rules → TypeScript integration
- Modern presets → Popular preset

### Testing with Jest
**Primary Sources**:
- **`/context7/jestjs_io-docs-getting-started`** (2,062 snippets, Trust: 10) - **RECOMMENDED**: Complete Jest guide
- `/jestjs/jest` (3,058 snippets, Trust: 6.9) - Official repository
- `/kulshekhar/ts-jest` (588 snippets, Trust: 8.9) - TypeScript integration

**When to Use**:
- Test setup → Complete Jest guide
- TypeScript testing → TypeScript integration
- Advanced configurations → Official repository

### State Management
**Primary Sources**:
- **`/pmndrs/zustand`** (469 snippets, Trust: 9.6) - **RECOMMENDED**: Official Zustand docs
- `/udecode/zustand-x` (40 snippets, Trust: 8.3) - Enhanced store factory

**When to Use**:
- State management → Official Zustand docs
- Advanced patterns → Enhanced store factory

---

## Deployment & DevOps

### Wrangler & GitHub Actions
**Primary Sources**:
- **`/cloudflare/wrangler-action`** (21 snippets, Trust: 9.3) - **RECOMMENDED**: GitHub Actions integration
- `/prettier/eslint-config-prettier` (31 snippets, Trust: 9.2) - Code formatting

**When to Use**:
- CI/CD setup → GitHub Actions integration
- Code quality → Code formatting

---

## Usage Guidelines

### Trust Score Interpretation
- **9.0-10.0**: Highly authoritative, official sources - **USE FIRST**
- **8.0-8.9**: Well-maintained, reliable sources - **GOOD CHOICE**
- **7.0-7.9**: Community sources, use with validation - **VERIFY FIRST**
- **< 7.0**: Use only if no better alternatives exist - **LAST RESORT**

### Snippet Count Guidelines
- **2,000+**: Comprehensive documentation, good for deep dives
- **500-2,000**: Solid coverage, good for specific features
- **100-500**: Focused documentation, good for specific use cases
- **< 100**: Limited coverage, may need supplementing

### Context7 Access Pattern
```typescript
// Example usage in prompts
"use context7: /context7/nextjs for Next.js App Router implementation"
"use context7: /cloudflare/workers-sdk for Wrangler deployment commands"
"use context7: /context7/clerk for authentication setup patterns"
```

### Development Scenario Mapping

#### Setting up new Next.js features
1. **Primary**: `/context7/nextjs`
2. **Secondary**: `/vercel/next.js`
3. **Integration**: `/clerk/nextjs-auth-starter-template`

#### Implementing MCP servers
1. **Primary**: `/modelcontextprotocol.io/llmstxt`
2. **Secondary**: `/modelcontextprotocol/servers`
3. **Reference**: `/context7/modelcontextprotocol_io-introduction`

#### Cloudflare Workers development
1. **Primary**: `/llmstxt/developers_cloudflare_com-workers-llms-full.txt`
2. **Secondary**: `/cloudflare/workers-sdk`
3. **Templates**: `/cloudflare/templates`

#### Authentication implementation
1. **Primary**: `/context7/clerk`
2. **Secondary**: `/clerk/javascript`
3. **Examples**: `/clerk/nextjs-auth-starter-template`

#### Styling and UI components
1. **Primary**: `/context7/tailwindcss`
2. **Secondary**: `/shadcn-ui/ui`
3. **Primitives**: `/radix-ui/website`

---

## Maintenance Notes

### Keeping This Index Updated
- Review trust scores periodically for source quality changes
- Update snippet counts when new documentation versions are released
- Add new Context7 sources as they become available for FLAIM technologies
- Monitor for deprecated or superseded documentation sources

### Version Compatibility
- Most sources are version-agnostic or latest-version focused
- For specific version requirements, check the "Versions" field in Context7 results
- Cross-reference with FLAIM's `package.json` for version compatibility

---

**Last Updated**: 2025-07-10  
**Next Review**: When major framework versions change or new Context7 sources are added

*This document serves as the authoritative reference for accessing technical documentation when working on the FLAIM platform. Keep it updated as the technology stack evolves.*