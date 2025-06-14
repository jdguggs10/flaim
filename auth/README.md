# FLAIM Auth

Cross-platform authentication system for the FLAIM Fantasy Sports Platform.

## Overview

FLAIM Auth provides a unified authentication layer that works across web (Next.js), mobile (iOS), and server environments. Built on top of Clerk with extensible interfaces for other auth providers.

## Quick Start

### Installation

```bash
# Install the auth module
npm install @flaim/auth

# Install peer dependencies for web
npm install @clerk/nextjs next react react-dom
```

### Basic Usage

#### 1. Web Application Setup

```tsx
// app/layout.tsx
import { ClerkProvider } from '@flaim/auth/clerk/web';

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

#### 2. Client Components

```tsx
// components/MyComponent.tsx
import { 
  useAuth, 
  AuthGuard, 
  SignInButton, 
  UserButton 
} from '@flaim/auth/clerk/web';

export function MyComponent() {
  const { isAuthenticated, user } = useAuth();

  return (
    <AuthGuard>
      <div>
        <h1>Welcome {user?.firstName}!</h1>
        <UserButton />
      </div>
    </AuthGuard>
  );
}
```

#### 3. API Routes

```tsx
// app/api/protected/route.ts
import { requireAuth, withAuth } from '@flaim/auth/clerk/web';

// Simple auth check
export async function GET() {
  const authResult = await requireAuth();
  
  if (authResult instanceof Response) {
    return authResult; // 401 error
  }
  
  const { userId } = authResult;
  return Response.json({ message: `Hello ${userId}` });
}

// Or use the wrapper
export const POST = withAuth(async (userId, request) => {
  const data = await request.json();
  // Your authenticated logic here
  return Response.json({ success: true });
});
```

#### 4. Usage Tracking

```tsx
// API route with usage limits
import { withAuthAndUsage } from '@flaim/auth/clerk/web';

export const POST = withAuthAndUsage(async (userId, request) => {
  // Usage is automatically tracked and incremented
  return Response.json({ message: "API call successful" });
});
```

```tsx
// Frontend usage display
import { UsageDisplay } from '@flaim/auth/clerk/web';

export function MyApp() {
  return (
    <div>
      <UsageDisplay showDetails={true} />
      {/* Your app content */}
    </div>
  );
}
```

## Core Features

### ✅ Cross-Platform Ready
- **Web**: Full Next.js/React support
- **iOS**: Interface ready for Swift implementation
- **Workers**: Cloudflare Workers integration

### ✅ Usage Tracking
- Free tier limits (configurable)
- Paid plan support
- Automatic usage increment
- Frontend usage displays

### ✅ Token Management
- Automatic token refresh
- Session lifecycle events
- Expiration handling

### ✅ Type Safety
- Full TypeScript support
- Strict API boundaries
- Platform-agnostic interfaces

## Environment Setup

```bash
# Required for web applications
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional configuration
FREE_TIER_LIMIT=100
NODE_ENV=development
```

## Architecture

```
@flaim/auth/
├── shared/           # Core logic (platform-agnostic)
│   ├── index.ts     # Public API surface
│   ├── interfaces.ts # Type definitions
│   ├── config.ts    # Environment config
│   ├── auth-middleware.ts # Session validation
│   ├── usage-tracker.ts   # Usage management
│   └── tests/       # Automated tests
└── clerk/
    └── web/         # Next.js/React implementation
        ├── provider.tsx    # ClerkProvider wrapper
        ├── components.tsx  # UI components
        ├── server-auth.ts  # API route helpers
        └── middleware.ts   # Next.js middleware
```

## API Reference

### Core Functions

```tsx
import { 
  requireSession,
  requireSessionWithUsage,
  UsageTracker,
  AuthConfig 
} from '@flaim/auth';

// Session verification
const session = await requireSession(token);

// Usage-aware session check  
const result = await requireSessionWithUsage(token);

// Usage management
const stats = UsageTracker.getUsageStats(userId);
const canProceed = UsageTracker.canSendMessage(userId);
```

### Web Components

```tsx
import {
  ClerkProvider,
  AuthGuard,
  AuthHeader,
  SignInButton,
  SignUpButton,
  UserButton,
  UsageDisplay,
  UsageWarning,
  useAuth
} from '@flaim/auth/clerk/web';
```

### Server Utilities

```tsx
import {
  requireAuth,
  withAuth,
  withAuthAndUsage,
  getUserContext
} from '@flaim/auth/clerk/web';
```

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Migration Guide

### From Direct Clerk Usage

**Before:**
```tsx
import { useUser } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

const { isSignedIn, user } = useUser();
const { userId } = await auth();
```

**After:**
```tsx
import { useAuth, requireAuth } from '@flaim/auth/clerk/web';

const { isAuthenticated, user } = useAuth();
const { userId } = await requireAuth();
```

## Contributing

1. Make changes to the auth module
2. Run tests: `npm test`
3. Update version in `package.json`
4. Test integration with web app

## License

MIT

---

**FLAIM Auth v1.0.0** - Built for cross-platform fantasy sports applications.