# FLAIM Vercel Migration Assessment

_Status: Evaluation Document (2025-07-17)_

This document provides a balanced technical assessment of migrating the Next.js frontend from Cloudflare Pages to Vercel, while keeping backend workers on Cloudflare.

---

## Executive Summary

**Current State**: FLAIM runs successfully on Cloudflare Pages with a unified build/deployment system. All 15 API routes use edge runtime for OpenAI streaming, and the system works well without observed friction.

**Migration Consideration**: Moving to Vercel could provide developer experience improvements but requires careful validation of critical functionality, particularly OpenAI streaming and authentication.

**Recommendation**: **Prototype first** - Deploy current code to Vercel without changes to validate compatibility before committing to migration.

---

## Current Architecture

### Frontend (Cloudflare Pages)
- **Next.js 15.3.4** with React 19
- **All API routes** use `export const runtime = 'edge'`
- **OpenAI streaming** via `ReadableStream` for SSE responses
- **Clerk authentication** (@clerk/nextjs 6.22.0)
- **Build process** uses `@cloudflare/next-on-pages` adapter

### Backend (Cloudflare Workers)
- **3 workers**: auth-worker, baseball-espn-mcp, football-espn-mcp
- **CORS configured** for Cloudflare Pages domains
- **Unified deployment** via `build.sh` and `start.sh`

---

## Migration Benefits

### Developer Experience
- **Native Next.js support** - No adapter required
- **Automatic preview deployments** for every PR
- **Better logging/monitoring** built for Next.js
- **Environment variable management** via Vercel dashboard

### Technical Advantages
- **Full Next.js feature support** - No edge runtime limitations
- **Runtime flexibility** - Choose Node.js or edge per route
- **Simplified build process** - Standard `next build`
- **Integrated analytics** and performance monitoring

---

## Migration Challenges

### Critical Compatibility Risks
- **OpenAI streaming** - Current `ReadableStream` implementation needs validation
- **Clerk authentication** - Edge runtime patterns may behave differently
- **Environment variables** - Complex nested configuration requires migration
- **CORS coordination** - 3 workers need updates for `*.vercel.app` domains

### Operational Complexity
- **Split deployments** - Frontend (Vercel) + Workers (Cloudflare)
- **Build fragmentation** - Loss of unified `build.sh`/`start.sh` orchestration
- **DNS management** - Apex domain to Vercel, subdomains to Cloudflare
- **Cost implications** - Vercel execution limits vs Cloudflare Pages free tier

---

## Prototype-First Approach

### Phase 1: Compatibility Validation
```bash
# Test current code on Vercel without changes
vercel --cwd openai
vercel env pull
# Test critical paths: auth, streaming, worker communication
```

### Phase 2: Measure Impact
- **Latency comparison** - Vercel vs Cloudflare Pages
- **Bundle size analysis** - With/without @cloudflare/next-on-pages
- **Streaming performance** - OpenAI SSE compatibility
- **Authentication flow** - Clerk behavior on Vercel

### Phase 3: Decision Point
Proceed only if prototype demonstrates:
- ✅ OpenAI streaming works correctly
- ✅ Clerk authentication functions properly
- ✅ Worker communication maintains performance
- ✅ Developer experience improvements justify complexity

---

## Implementation Requirements

### Code Changes Required
1. **Remove Cloudflare adapter**
   ```bash
   npm uninstall @cloudflare/next-on-pages
   npm install -D vercel
   ```

2. **Update build configuration**
   - Remove `pages_build_output_dir` from `wrangler.jsonc`
   - Ensure `package.json` has `"build": "next build"`

3. **CORS updates** (3 workers)
   ```javascript
   const ALLOWED_ORIGINS = [
     'https://flaim.app',
     'https://*.vercel.app',  // Add for preview URLs
     'http://localhost:3000'
   ];
   ```

4. **Environment variable migration**
   - Migrate 10+ variables per environment to Vercel
   - Maintain build-time vs runtime distinction

### Infrastructure Changes
- **DNS**: Point apex domain to Vercel, keep worker subdomains on Cloudflare
- **SSL**: Vercel manages flaim.app, Cloudflare handles worker subdomains
- **CI/CD**: Separate workflows for frontend and workers

---

## Risk Assessment

### High Risk
- **OpenAI streaming breakage** - Core functionality depends on edge runtime
- **Authentication edge cases** - Clerk patterns may have platform differences

### Medium Risk
- **CORS coordination** - Dynamic preview URLs complicate worker configuration
- **Build process fragmentation** - Loss of unified deployment orchestration
- **Performance regression** - Additional network hops frontend↔workers

### Low Risk
- **Environment variable migration** - Tedious but straightforward
- **DNS configuration** - Standard domain pointing setup

---

## Decision Framework

### Proceed with migration if:
- Prototype validates all critical functionality
- Team values DX improvements over unified deployment
- Performance impact is acceptable
- Resources available for implementation and maintenance

### Stay with Cloudflare Pages if:
- Prototype reveals compatibility issues
- Current system meets all needs
- Team prefers unified deployment
- Risk tolerance is low

---

## Recommended Next Steps

1. **Create prototype branch** - Deploy current code to Vercel
2. **Run comprehensive tests** - Auth, streaming, worker communication
3. **Measure performance** - Latency, bundle size, user experience
4. **Assess DX improvements** - Preview URLs, logging, monitoring
5. **Make informed decision** - Based on concrete data, not assumptions

---

## Conclusion

The migration is **technically feasible** but requires careful validation. The current Cloudflare Pages setup works well, so any migration should be driven by concrete benefits validated through prototyping rather than theoretical improvements.

**Key Success Factors**:
- Prototype-first approach
- Comprehensive testing of critical paths
- Honest assessment of trade-offs
- Team consensus on priorities (DX vs simplicity)

The decision should be based on measured outcomes, not architectural preferences.