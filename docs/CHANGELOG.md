# Changelog

All notable changes to FLAIM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0-rc2] - 2024-12-XX

### 🚀 Interactive Development Launcher

#### Added
- **Interactive Deployment Wizard**: `start.sh` now prompts for each worker's deployment mode
- **Consolidated Build Script**: `build.sh` provides deterministic production builds for CI/CD
- **Mixed Deployment Support**: Run workers in local/remote/deployed combinations
- **Smart Environment Management**: Automatic `NEXT_PUBLIC_*` variable handling
- **CF_ACCOUNT_ID Validation**: Hard stop on deployment without proper configuration
- **Enhanced URL Capture**: 60-second retry with manual fallback for remote URLs
- **Configuration Confirmation**: Summary and confirmation before execution
- **Environment Cleanup**: Automatic cleanup of remote URLs when switching to local mode
- **CI-Friendly Build**: `build.sh --prod` for non-interactive builds with fail-fast behavior

#### Changed
- **Development Workflow**: `start-dev.sh` replaced with interactive `start.sh`
- **Build Process**: `build-prod.sh` replaced with consolidated `build.sh` (interactive + CI modes)
- **Deployment Flexibility**: Single script handles all deployment scenarios
- **Error Handling**: Comprehensive validation and user-friendly error messages
- **Documentation**: Updated README and deployment guides for new launcher and build script

## [6.0.0-rc1] - 2024-12-XX

### 🏗️ Major Infrastructure Overhaul

#### Added
- **CF KV Credential Storage**: Enterprise-grade credential storage with AES-GCM encryption
- **Key Rotation Support**: Future-proof encryption with keyId tracking in encrypted blobs
- **Manual League Entry Flow**: Alternative onboarding for complex setups (up to 10 leagues)
- **Eventual Consistency Handling**: Helpful error messages for KV propagation delays
- **Comprehensive Test Suite**: Jest tests with @miniflare/kv mocks for reliable testing
- **Path Aliases**: Clean import structure with @/auth/* and @/components/ui aliases
- **Worker Binding Detection**: Smart constructor for CF Workers vs Node.js environments

#### Changed
- **Security**: Replaced Durable Objects with encrypted CF KV for credential storage
- **Architecture**: Memoized KV storage utilities with shared context for better performance
- **UI/UX**: 200ms tooltip delays for improved accessibility
- **Build System**: Tailwind safelist with regex patterns for Radix data attributes
- **Developer Experience**: Enhanced error messages and runtime environment detection

#### Technical Improvements
- Worker health endpoints now return v1.1.0
- ESLint rules enforced with 100% clean codebase
- TypeScript strict mode compliance
- Consistent barrel exports across components

### Migration Notes
- CF KV namespace required for credential storage
- Encryption key must be set in CF Secrets
- See ENV_SAMPLE and DEPLOYMENT.md for setup details

## [Unreleased]

### Fixed
- **Next.js 15 Route Handler Signatures**: Updated onboarding route handlers to use Promise-based `params` destructuring for compatibility with `app/api` in Next.js 15.
- **TypeScript API DTOs**: Introduced reusable request/response interfaces in `types/api-responses.ts` and cast all JSON responses accordingly, eliminating `unknown` types during builds.
- **Build Failures**: Resolved compilation errors in `platform-selection`, `platform-credentials`, and `status` onboarding routes.

### Changed
- **React Upgrade**: Core platform migrated from React 18 to **React 19.1.0** with unified type definitions (`@types/react` 19.0.0) across all workspaces.
- **Next.js Upgrade**: Bumped framework to **Next.js 15.3.4** and aligned `eslint-config-next` accordingly.
- **Dependency Hygiene**: Removed workspace-local `@types/react*` declarations; root `overrides` now enforces a single version of React runtime and types, eliminating duplicate-types build errors.
- **Radix & ShadCN Primitives**: Refactored remaining UI primitives to the new `ComponentPropsWithoutRef` pattern required by React 19.
- **Docs**: Updated Architecture and Onboarding docs to reflect React 19 stack.

### Documentation
- Updated `docs/ONBOARDING.md` with new endpoints, DTO type location, and type safety notes.

## [4.1.1] - 2024-12-15

### Added
- **🎉 Automatic League Discovery**: ESPN Fantasy v3 dashboard integration for instant league detection
- **Multi-Sport Discovery**: Automatically finds leagues across baseball, football, basketball, and hockey
- **Enhanced UI**: Real-time league display after ESPN authentication
- **New API Endpoint**: `/discover-leagues` for programmatic league discovery
- **Comprehensive Testing**: Full test suite for league discovery functionality
- **Documentation**: Complete ESPN Fantasy v3 module documentation and integration guides

### Changed
- **User Experience**: No more manual league ID entry - leagues discovered automatically after ESPN login
- **Authentication Flow**: Enhanced ESPN auth component with automatic discovery integration
- **Error Handling**: Graceful fallbacks to manual entry if auto-discovery fails
- **Performance**: Single-call discovery using ESPN's internal Fantasy v3 endpoint (≤150ms response time)

### Security
- **Rate Limiting**: Respect ESPN API limits (~60 req/min per IP)
- **Credential Protection**: Discovery uses encrypted stored credentials
- **Session Verification**: All discovery endpoints require verified Clerk sessions

## [4.1.0] - 2024-12-14

### Added
- **Modular Authentication System**: Extracted `flaim/auth` module for cross-platform reuse
- **Multi-Sport Support**: Added football ESPN MCP worker alongside baseball
- **Cross-Platform Ready**: Auth system ready for iOS and additional platforms
- **Automated Testing**: Comprehensive test suite for auth module
- **Token Management**: Built-in token refresh and session lifecycle handling

### Changed
- **Worker Organization**: Moved workers to `flaim/workers/` directory
- **Authentication Architecture**: Centralized auth logic in shared module
- **Usage Limits**: Increased free tier from 15 to 100 messages per month
- **Import Structure**: Updated all auth imports to use modular system

### Removed
- **Parallel Auth Implementations**: Eliminated duplicate authentication code

### Security
- **Centralized Session Management**: Single source of truth for authentication
- **Cross-Platform Security**: Consistent security patterns across all platforms

## [4.0.0] - 2024-12-01

### Added
- **Production Security Hardening**: Server-side Clerk session verification for all credential endpoints
- **Anti-Spoofing Protection**: User ID extraction from verified sessions instead of trusting headers
- **Environment Isolation**: Development fallbacks automatically disabled in production
- **Comprehensive Error Handling**: User-friendly error messages with detailed troubleshooting
- **Toast Notification System**: Better UX for error and success states
- **Key Rotation Documentation**: Planning and implementation guide for encryption key rotation
- **Production Environment Configuration**: Explicit NODE_ENV settings in wrangler.toml
- **Enhanced Documentation**: Complete restructure with industry-standard organization

### Changed
- **Authentication Flow**: Replaced header-based auth with token-based server-side verification
- **ESPN Credential Storage**: Updated to use verified Clerk user IDs as primary keys
- **Error Messaging**: Transformed technical errors into actionable user guidance
- **Frontend API Calls**: Now include Authorization Bearer tokens for all credential operations
- **MCP Service Endpoints**: Simplified credential endpoints to use pure session verification

### Deprecated
- **Legacy OAuth Components**: `espn-auth-v2.tsx` and `espn-auth.tsx` replaced with `espn-auth-clerk.tsx`
- **Header-Based Authentication**: X-Clerk-User-ID headers no longer trusted for user identification

### Removed
- **GitHub OAuth Integration**: Completely removed in favor of Clerk-only authentication
- **JWT Token Handling**: Eliminated custom JWT processing in favor of Clerk sessions
- **Development Header Trust**: Removed ability to spoof user IDs via headers in production
- **Redundant Authentication Code**: Cleaned up duplicate and legacy authentication implementations

### Fixed
- **Header Spoofing Vulnerability**: Attackers can no longer access other users' ESPN credentials by spoofing headers
- **Production Credential Leakage**: Environment ESPN credentials no longer accessible in production mode
- **Silent Error Failures**: Users now receive clear feedback when credential operations fail
- **Session Validation**: All credential operations now properly validate user sessions

### Security
- **CRITICAL**: Fixed header spoofing vulnerability that allowed credential access impersonation
- **CRITICAL**: Implemented server-side Clerk verification for all sensitive operations
- **IMPORTANT**: Disabled development fallbacks in production to prevent credential exposure
- **IMPORTANT**: Added comprehensive audit logging for security event monitoring

## [3.0.0] - 2024-11-15

### Added
- **Clerk Authentication Integration**: Replaced custom JWT with industry-standard Clerk
- **Usage Tracking System**: 15 free messages per month with paid tier options
- **ESPN Credential Management**: Secure encrypted storage per user
- **MCP Tools Integration**: Open access Model Context Protocol tools for external AI assistants
- **Durable Objects Storage**: Scalable user data storage with Cloudflare

### Changed
- **Architecture Simplification**: Removed complex Stripe-first microservices architecture
- **Authentication Provider**: Migrated from custom JWT to Clerk for better security and UX
- **Deployment Process**: Streamlined with fewer moving parts and clearer documentation

### Removed
- **Complex Stripe Integration**: Simplified to focus on core functionality (can be re-added)
- **Custom JWT Implementation**: Replaced with Clerk for better security practices

## [2.0.0] - 2024-10-01

### Added
- **Stripe-First Microservices**: Complete payment and billing integration
- **JWT Authentication**: Custom token-based authentication system
- **ESPN API Integration**: Full fantasy baseball data access
- **OpenAI Chat Interface**: AI-powered fantasy sports assistant

### Changed
- **Microservices Architecture**: Split into multiple specialized services
- **Database Integration**: Added persistent storage for user data

## [1.0.0] - 2024-09-01

### Added
- **Initial Release**: Basic fantasy sports data fetching
- **ESPN Integration**: Read-only access to public league data
- **Simple Frontend**: Basic web interface for data display

---

## Version Support

| Version | Status | Support Until | Security Fixes |
|---------|--------|---------------|----------------|
| 4.x     | ✅ Active | TBD | ✅ Yes |
| 3.x     | ⚠️ Maintenance | 2025-06-01 | ✅ Critical Only |
| 2.x     | ❌ End of Life | 2024-12-01 | ❌ No |
| 1.x     | ❌ End of Life | 2024-10-01 | ❌ No |

## Migration Guides

### Migrating from v3.x to v4.0

**Breaking Changes:**
- ESPN credential endpoints now require `CLERK_SECRET_KEY` in production
- Header-based user identification no longer works
- Development ESPN fallbacks disabled in production

**Migration Steps:**
1. Set `CLERK_SECRET_KEY` secret in your MCP service deployment
2. Update frontend to use `espn-auth-clerk.tsx` component
3. Remove any header-based authentication logic
4. Test credential storage and retrieval flows
5. Verify error handling improvements

**Security Benefits:**
- Protection against header spoofing attacks
- Server-side session validation
- Enhanced user experience with better error messages

### Migrating from v2.x to v3.0

**Breaking Changes:**
- Replaced custom JWT with Clerk authentication
- Simplified architecture removed complex Stripe integration
- Updated deployment process

**Migration Steps:**
1. Create Clerk application and get API keys
2. Update environment variables for Clerk integration
3. Migrate user data from old JWT format
4. Update frontend authentication flow
5. Test complete user journey

## Security Advisories

### CVE-2024-FLAIM-001 (Fixed in v4.0.0)
- **Severity**: High
- **Description**: Header spoofing vulnerability in ESPN credential endpoints
- **Impact**: Attackers could access other users' ESPN credentials by spoofing X-Clerk-User-ID headers
- **Fix**: Server-side Clerk session verification implemented
- **Affected Versions**: 3.0.0 - 3.x.x
- **Recommendation**: Upgrade to v4.0.0 immediately

---

## Contributing to the Changelog

When contributing to FLAIM, please update this changelog:

1. **Add entries** under the `[Unreleased]` section
2. **Use the correct category**: Added, Changed, Deprecated, Removed, Fixed, Security
3. **Write clear descriptions** that help users understand the impact
4. **Include breaking changes** with migration guidance
5. **Reference issues/PRs** where applicable

**Example entry:**
```markdown
### Added
- **Feature Name**: Brief description of what was added and why it's useful (#123)
```

For more details, see our [Contributing Guide](contributing.md).