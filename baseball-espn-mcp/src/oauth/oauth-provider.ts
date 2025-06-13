/**
 * OAuth Provider using @cloudflare/workers-oauth-provider
 * Implements proper OAuth 2.1 PKCE flow for GitHub authentication
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { JWTHandler } from '../auth/jwt-handler.js';

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
}

export class GitHubOAuthProvider {
  private oauthProvider: OAuthProvider;
  private jwtHandler: JWTHandler;

  constructor(private env: Env) {
    this.jwtHandler = new JWTHandler(env);
    
    this.oauthProvider = new OAuthProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      authorizeEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      userInfoEndpoint: 'https://api.github.com/user',
      scope: 'user:email',
      
      // OAuth 2.1 PKCE configuration
      usePKCE: true,
      
      // Callback handler
      onSuccess: async (accessToken: string, userInfo: any) => {
        return this.handleOAuthSuccess(accessToken, userInfo);
      },
      
      onError: (error: Error) => {
        console.error('OAuth error:', error);
        return new Response(`OAuth Error: ${error.message}`, { status: 400 });
      }
    });
  }

  /**
   * Handle OAuth authorization request
   */
  async handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Add state parameter for CSRF protection
    const state = crypto.randomUUID();
    url.searchParams.set('state', state);
    
    return this.oauthProvider.authorize(request);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(request: Request): Promise<Response> {
    return this.oauthProvider.callback(request);
  }

  /**
   * Process successful OAuth authentication
   */
  private async handleOAuthSuccess(accessToken: string, userInfo: any): Promise<Response> {
    try {
      // Extract user information from GitHub
      const userId = `github_${userInfo.id}`;
      const email = userInfo.email || userInfo.login;
      
      // Default to free plan for new users
      const plan = 'free';
      
      // Generate JWT token for the authenticated user
      const jwtToken = await this.jwtHandler.generateToken(userId, plan, email);
      
      // Return success page with JWT token
      const successHtml = this.getSuccessPageHtml(jwtToken, userInfo);
      
      return new Response(successHtml, {
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*'
        }
      });
      
    } catch (error) {
      console.error('OAuth success handler error:', error);
      return new Response('Authentication failed', { status: 500 });
    }
  }

  /**
   * Generate success page HTML that communicates with parent window
   */
  private getSuccessPageHtml(jwtToken: string, userInfo: any): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Successful</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        .checkmark {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        .details {
            margin-top: 1rem;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">✓</div>
        <h1>Authentication Successful!</h1>
        <p>Welcome, ${userInfo.name || userInfo.login}!</p>
        <div class="details">
            <p>Redirecting you back to the application...</p>
        </div>
    </div>
    
    <script>
        // Send JWT token to parent window
        if (window.opener) {
            window.opener.postMessage({
                type: 'oauth_success',
                jwt: '${jwtToken}',
                user: {
                    id: '${userInfo.id}',
                    login: '${userInfo.login}',
                    name: '${userInfo.name || ''}',
                    email: '${userInfo.email || ''}'
                }
            }, '*');
            window.close();
        } else {
            // Fallback for direct navigation
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        }
    </script>
</body>
</html>`;
  }

  /**
   * Create a simple landing page for the OAuth flow
   */
  getLandingPageHtml(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Fantasy Sports MCP - Secure Authentication</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
            max-width: 500px;
        }
        .logo {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        .auth-button {
            display: inline-block;
            padding: 12px 24px;
            background: #24292e;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin-top: 2rem;
            transition: background 0.2s;
        }
        .auth-button:hover {
            background: #1c2025;
        }
        .features {
            margin-top: 2rem;
            text-align: left;
            opacity: 0.9;
        }
        .features li {
            margin: 0.5rem 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🏈</div>
        <h1>Fantasy Sports MCP</h1>
        <p>Secure dual-layer authentication for your fantasy sports data</p>
        
        <a href="/authorize" class="auth-button">
            🔐 Login with GitHub
        </a>
        
        <ul class="features">
            <li>✓ OAuth 2.1 with PKCE security</li>
            <li>✓ Short-lived JWT tokens (15 min)</li>
            <li>✓ Encrypted credential storage</li>
            <li>✓ Per-user data isolation</li>
        </ul>
    </div>
</body>
</html>`;
  }
}