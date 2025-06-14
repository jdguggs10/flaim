/**
 * Pre-configured Clerk UI components for FLAIM applications
 * Extracted and enhanced from openai components
 */

"use client";

import React from 'react';
import { 
  useUser, 
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
  SignedIn, 
  SignedOut, 
  UserButton as ClerkUserButton 
} from '@clerk/nextjs';

// Component props interfaces
export interface AuthButtonProps {
  className?: string;
  children?: React.ReactNode;
  mode?: 'modal' | 'redirect';
  redirectUrl?: string;
}

export interface UserButtonProps {
  className?: string;
  appearance?: any;
  showName?: boolean;
}

/**
 * Styled Sign In button with FLAIM branding
 */
export function SignInButton({ 
  className = "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700", 
  children,
  mode = "modal",
  redirectUrl
}: AuthButtonProps) {
  return (
    <ClerkSignInButton 
      mode={mode}
      redirectUrl={redirectUrl}
    >
      <button className={className}>
        {children || "Sign In"}
      </button>
    </ClerkSignInButton>
  );
}

/**
 * Styled Sign Up button with FLAIM branding
 */
export function SignUpButton({ 
  className = "px-4 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50", 
  children,
  mode = "modal",
  redirectUrl
}: AuthButtonProps) {
  return (
    <ClerkSignUpButton 
      mode={mode}
      redirectUrl={redirectUrl}
    >
      <button className={className}>
        {children || "Sign Up"}
      </button>
    </ClerkSignUpButton>
  );
}

/**
 * Enhanced User button with optional name display
 */
export function UserButton({ 
  className,
  appearance,
  showName = false
}: UserButtonProps) {
  const { user } = useUser();

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      {showName && user && (
        <span className="text-sm text-gray-600">
          {user.firstName || user.emailAddresses[0]?.emailAddress}
        </span>
      )}
      <ClerkUserButton 
        appearance={{
          elements: {
            avatarBox: 'w-8 h-8',
          },
          ...appearance
        }}
      />
    </div>
  );
}

/**
 * Complete authentication header component
 * Extracted from openai/app/layout.tsx
 */
export interface AuthHeaderProps {
  title?: string;
  className?: string;
  showUserName?: boolean;
}

export function AuthHeader({ 
  title = "FLAIM - Fantasy League AI Assistant",
  className = "flex justify-between items-center p-4 bg-white border-b",
  showUserName = false
}: AuthHeaderProps) {
  return (
    <header className={className}>
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="flex items-center gap-4">
        <SignedOut>
          <div className="flex gap-2">
            <SignInButton />
            <SignUpButton />
          </div>
        </SignedOut>
        <SignedIn>
          <UserButton showName={showUserName} />
        </SignedIn>
      </div>
    </header>
  );
}

/**
 * Authentication guard component
 * Shows sign-in prompt when user is not authenticated
 */
export interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAuth?: boolean;
}

export function AuthGuard({ 
  children, 
  fallback,
  requireAuth = true 
}: AuthGuardProps) {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (requireAuth && !isSignedIn) {
    return fallback || (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <h2 className="text-xl font-semibold mb-4">Sign in to continue</h2>
        <p className="text-gray-600 mb-6">
          Please sign in to access your fantasy league AI assistant.
        </p>
        <div className="flex gap-4">
          <SignInButton />
          <SignUpButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Hook for accessing user authentication state
 * Simplified interface for common use cases
 */
export function useAuth() {
  const { isSignedIn, isLoaded, user } = useUser();

  return {
    isAuthenticated: isSignedIn,
    isLoading: !isLoaded,
    user,
    userId: user?.id || null
  };
}

// Re-export Clerk components for convenience
export { SignedIn, SignedOut };