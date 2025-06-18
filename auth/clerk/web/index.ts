// Re-export all web-specific functionality
export { ClerkProvider } from './provider';
export { getAuthenticatedUser, requireAuth, withAuth, withAuthAndUsage, getUserContext, hasPermission, auth } from './server-auth';
export { clerkMiddleware } from './middleware';

// Components - be explicit about what we export to avoid conflicts
export {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth
} from './components';