# FLAIM.app Domain Migration Plan

## Overview

This document outlines the strategy for migrating the FLAIM platform from the current development domains to the production `flaim.app` domain, with the chat interface living at `flaim.app/chat` and a dedicated landing page at the root.

## Current State Analysis

### Existing URL Configuration

**Local Development**
- Frontend: `localhost:3000`
- Workers: `localhost:878X`
- Status: Fully functional

**Remote Development**
- Frontend: `dev.flaim-frontend-dev.pages.dev`
- Workers: `*-dev.gerrygugger.workers.dev`
- Status: Functional but using temporary domains

**Remote Production**
- Frontend: `flaim-frontend-dev.pages.dev` (temporary)
- Workers: `*.gerrygugger.workers.dev` (temporary)
- Status: Needs migration to `flaim.app`

### Infrastructure Gaps Identified

1. **Environment Mapping Mismatch**
   - `start.sh` deploys with `--env dev` and `--env prod`
   - `wrangler.jsonc` only defines `preview` environment
   - Missing `dev` and `prod` environment configurations

2. **Production Domain Configuration**
   - No `flaim.app` domain configuration in any config files
   - Workers still pointing to `gerrygugger.workers.dev`
   - Frontend Pages project needs custom domain setup

3. **URL Structure Architecture**
   - Current: Single-page app at root domain
   - Target: Landing page at root, chat app at `/chat` path

## Target Architecture

### Domain Structure
```
flaim.app/                 → Landing page (marketing/intro)
flaim.app/chat/           → Chat interface (current app)
flaim.app/docs/           → Documentation (future)
flaim.app/api/            → API endpoints (if needed)
```

### Service URLs
```
# Production Workers
https://auth-worker.flaim.app
https://baseball-espn-mcp.flaim.app  
https://football-espn-mcp.flaim.app

# Development Workers (unchanged)
https://auth-worker-dev.gerrygugger.workers.dev
https://baseball-espn-mcp-dev.gerrygugger.workers.dev
https://football-espn-mcp-dev.gerrygugger.workers.dev
```

## Implementation Plan

### Phase 1: DNS & Cloudflare Setup
1. **Configure DNS**
   - Point `flaim.app` to Cloudflare nameservers
   - Add `flaim.app` zone to Cloudflare account

2. **Custom Domain Setup**
   - Add `flaim.app` custom domain to Cloudflare Pages project
   - Configure SSL/TLS certificates
   - Set up domain validation

3. **Worker Custom Domains**
   - Add custom domains for each worker:
     - `auth-worker.flaim.app`
     - `baseball-espn-mcp.flaim.app`
     - `football-espn-mcp.flaim.app`

### Phase 2: Configuration Updates

1. **Update wrangler.jsonc**
   ```jsonc
   {
     "vars": {
       // Production URLs (base environment)
       "NEXT_PUBLIC_AUTH_WORKER_URL": "https://auth-worker.flaim.app",
       "NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL": "https://baseball-espn-mcp.flaim.app",
       "NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL": "https://football-espn-mcp.flaim.app"
     },
     "env": {
       "dev": {
         "vars": {
           // Keep existing dev URLs
           "NEXT_PUBLIC_AUTH_WORKER_URL": "https://auth-worker-dev.gerrygugger.workers.dev",
           // ... other dev URLs
         }
       },
       "prod": {
         "vars": {
           // Explicit production configuration
           "NEXT_PUBLIC_AUTH_WORKER_URL": "https://auth-worker.flaim.app",
           // ... other prod URLs
         }
       }
     }
   }
   ```

2. **Update start.sh defaults**
   ```bash
   CF_PAGES_PROD_DOMAIN="${CF_PAGES_PROD_DOMAIN:-flaim.app}"
   CF_ACCOUNT_DOMAIN="${CF_ACCOUNT_DOMAIN:-flaim.app}"  # For prod workers
   CF_DEV_ACCOUNT_DOMAIN="${CF_DEV_ACCOUNT_DOMAIN:-gerrygugger.workers.dev}"  # For dev workers
   ```

3. **Update worker deployment configurations**
   - Add custom domain bindings to worker wrangler.toml files
   - Configure route patterns for custom domains

### Phase 3: Application Architecture Changes

1. **Landing Page Implementation**
   - Create new landing page at `/` route
   - Move current chat interface to `/chat` route
   - Implement navigation between landing and chat

2. **Routing Updates**
   ```typescript
   // app/layout.tsx - Update base routing
   // app/page.tsx - Landing page content
   // app/chat/page.tsx - Move current chat interface
   // app/chat/layout.tsx - Chat-specific layout
   ```

3. **URL Reference Updates**
   - Update all internal links to use `/chat` prefix
   - Update authentication redirects
   - Update any hardcoded URL references

### Phase 4: Deployment & Testing

1. **Staged Deployment**
   - Deploy to dev environment first with new configuration
   - Test all worker communications
   - Verify authentication flows
   - Test landing page → chat navigation

2. **Production Deployment**
   - Deploy workers with custom domains
   - Deploy frontend with new routing
   - Update DNS to point to production
   - Monitor for issues

3. **Fallback Strategy**
   - Keep old domains active during transition
   - Implement gradual DNS cutover if needed
   - Monitor error rates and performance

## Risk Mitigation

### DNS Propagation
- Plan for 24-48 hour DNS propagation period
- Test with manual DNS overrides before public DNS update
- Prepare rollback plan if DNS issues occur

### SSL Certificate Issues
- Pre-validate SSL certificates before traffic cutover
- Have Cloudflare support contact ready if certificate issues
- Test HTTPS redirect chains

### Application Breaking Changes
- Thoroughly test `/chat` routing in development
- Verify all authentication flows work with new paths
- Test MCP worker communication with new domains

### SEO Impact
- Implement proper redirects from old URLs if any are indexed
- Update any existing bookmarks/links in documentation
- Consider canonical URL tags if needed

## Success Criteria

1. **Functional Requirements**
   - Landing page loads at `flaim.app`
   - Chat interface fully functional at `flaim.app/chat`
   - All worker services accessible via custom domains
   - Authentication flow works end-to-end

2. **Performance Requirements**
   - Page load times equivalent to current performance
   - Worker response times unchanged
   - SSL handshake performance acceptable

3. **Reliability Requirements**
   - 99.9% uptime during and after migration
   - Zero data loss during transition
   - All existing user sessions preserved

## Timeline Estimate

- **Phase 1 (DNS/Cloudflare)**: 1-2 days
- **Phase 2 (Configuration)**: 1 day  
- **Phase 3 (Application)**: 2-3 days
- **Phase 4 (Deployment)**: 1-2 days
- **Total**: 5-8 days

*Note: Timeline assumes domain ownership is already established and no unexpected DNS/SSL issues occur.*

## Next Steps

1. Acquire `flaim.app` domain if not already owned
2. Add domain to Cloudflare account
3. Begin Phase 1 implementation
4. Create detailed technical implementation tickets for each phase

---

*This document should be updated as implementation progresses and any new requirements or constraints are discovered.*