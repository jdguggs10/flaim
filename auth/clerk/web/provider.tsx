/**
 * Clerk provider wrapper for Next.js applications
 * Extracted from openai/app/layout.tsx
 */

"use client";

import React from 'react';
import { ClerkProvider as ClerkProviderBase } from '@clerk/nextjs';
import { authConfig } from '../../shared/config.js';

// Props for the Clerk provider
export interface ClerkProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  // Additional Clerk configuration options
  appearance?: any;
  localization?: any;
  telemetry?: {
    disabled?: boolean;
    debug?: boolean;
  };
}

/**
 * Configured Clerk provider for FLAIM applications
 * Handles environment-based configuration automatically
 */
export function ClerkProvider({ 
  children,
  publishableKey,
  ...props 
}: ClerkProviderProps) {
  // Use provided key or fall back to environment
  const clerkPublishableKey = publishableKey || 
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkPublishableKey) {
    if (process.env.ENVIRONMENT === 'dev') {
      console.warn('⚠️ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not found. Authentication will not work.');
      return <>{children}</>;
    }
    
    throw new Error('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
  }

  return (
    <ClerkProviderBase
      publishableKey={clerkPublishableKey}
      appearance={{
        // Default FLAIM appearance theme
        elements: {
          formButtonPrimary: 'bg-blue-600 hover:bg-blue-700',
          card: 'shadow-lg',
        },
        ...props.appearance
      }}
      {...props}
    >
      {children}
    </ClerkProviderBase>
  );
}

// Re-export Clerk components for convenience
export {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
  useClerk,
  SignIn,
  SignUp,
  UserProfile
} from '@clerk/nextjs';