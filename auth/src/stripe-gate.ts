/**
 * Stripe-First Authentication Gate
 * Handles Stripe Checkout sessions, subscription verification, and JWT minting
 * This is the main authentication service for the entire FLAIM platform
 */

import Stripe from 'stripe';
import { SignJWT, jwtVerify } from 'jose';
import { JWTKeyRotation } from './key-rotation.js';

export interface Env {
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string; // Fallback for initial setup
  SUBSCRIPTION_KV: KVNamespace;
  JWT_KEYS_KV: KVNamespace;
}

export interface JWTPayload {
  sub: string; // Stripe customer ID
  email: string;
  plan: 'pro';
  exp: number;
  iat: number;
  iss: 'flaim-auth';
  aud: 'flaim-platform';
}

export class StripeAuthGate {
  private stripe: Stripe;
  private keyRotation: JWTKeyRotation;

  constructor(private env: Env) {
    this.stripe = new Stripe(env.STRIPE_API_KEY, {
      apiVersion: '2023-10-16'
    });
    this.keyRotation = new JWTKeyRotation(env);
  }

  /**
   * Create Stripe Checkout session for Pro plan
   */
  async createCheckoutSession(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;

    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'FLAIM Fantasy Sports Pro',
                description: 'Premium access to fantasy sports tools, AI integration, and MCP services'
              },
              unit_amount: 999, // $9.99
              recurring: {
                interval: 'month'
              }
            },
            quantity: 1
          }
        ],
        mode: 'subscription',
        success_url: `${origin}/callback?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/login?cancelled=true`,
        customer_email: url.searchParams.get('email') || undefined,
        allow_promotion_codes: true,
        automatic_tax: { enabled: true },
        billing_address_collection: 'auto',
        customer_creation: 'always'
      });

      return Response.redirect(session.url!, 303);

    } catch (error) {
      console.error('Checkout session creation failed:', error);
      return new Response(JSON.stringify({
        error: 'Payment setup failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle Stripe Checkout callback - verify payment and mint JWT
   */
  async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');

    if (!sessionId) {
      return new Response('Missing session_id parameter', { status: 400 });
    }

    try {
      // Retrieve the checkout session with subscription details
      const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      });

      // Verify payment was successful and subscription is active
      if (session.payment_status !== 'paid') {
        return new Response('Payment not completed', { status: 402 });
      }

      if (!session.subscription || 
          typeof session.subscription === 'string' ||
          session.subscription.status !== 'active') {
        return new Response('Subscription not active', { status: 402 });
      }

      // Get customer details
      const customer = session.customer as Stripe.Customer;
      const email = session.customer_details?.email || customer.email;

      if (!email) {
        return new Response('Customer email not found', { status: 400 });
      }

      // Cache subscription status
      await this.cacheSubscriptionStatus(customer.id, session.subscription);

      // Mint JWT token for authenticated user
      const jwt = await this.mintJWT(customer.id, email);

      // Redirect to OpenAI frontend with JWT
      const frontendUrl = this.getFrontendUrl();
      
      return new Response(this.getRedirectPageHtml(frontendUrl, jwt), {
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': `Auth=${jwt}; HttpOnly; Secure; Path=/; Max-Age=900; SameSite=Lax`
        }
      });

    } catch (error) {
      console.error('Callback processing failed:', error);
      return new Response(JSON.stringify({
        error: 'Authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Mint a short-lived JWT token (15 minutes)
   */
  async mintJWT(customerId: string, email: string): Promise<string> {
    // Get current active key from KV
    const currentKey = await this.keyRotation.getCurrentJWTKey();
    let jwtSecret: Uint8Array;
    
    if (currentKey) {
      jwtSecret = new TextEncoder().encode(currentKey.secret);
    } else {
      // Fallback to env var for initial setup
      console.warn('No KV key found, using fallback JWT_SECRET');
      jwtSecret = new TextEncoder().encode(this.env.JWT_SECRET);
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    const payload: JWTPayload = {
      sub: customerId,
      email: email,
      plan: 'pro',
      exp: now + (15 * 60), // 15 minutes
      iat: now,
      iss: 'flaim-auth',
      aud: 'flaim-platform'
    };

    return await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(jwtSecret);
  }

  /**
   * Verify JWT token - used by other services
   */
  async verifyJWT(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        issuer: 'flaim-auth',
        audience: 'flaim-platform',
        clockTolerance: 60
      });

      return payload as JWTPayload;
    } catch (error) {
      throw new Response(JSON.stringify({
        error: 'Invalid token',
        message: error instanceof Error ? error.message : 'Token verification failed'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Extract JWT from Authorization header or cookie
   */
  extractToken(request: Request): string | null {
    // Check Authorization header first
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Check for HttpOnly cookie
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/Auth=([^;]+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Check subscription status from cache
   */
  async hasActiveSubscription(customerId: string): Promise<boolean> {
    const key = `subscription:${customerId}`;
    const cached = await this.env.SUBSCRIPTION_KV.get(key);
    
    if (!cached) {
      return false;
    }

    try {
      const status = JSON.parse(cached);
      const now = Math.floor(Date.now() / 1000);
      const isActive = status.status === 'active' || status.status === 'trialing';
      const notExpired = status.currentPeriodEnd > now;

      return isActive && notExpired;
    } catch (error) {
      console.error('Failed to parse cached subscription:', error);
      return false;
    }
  }

  /**
   * Cache subscription status for fast lookup
   */
  private async cacheSubscriptionStatus(customerId: string, subscription: any): Promise<void> {
    const status = {
      customerId,
      status: subscription.status,
      planId: subscription.items?.data[0]?.price?.id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      lastUpdated: Math.floor(Date.now() / 1000)
    };

    const key = `subscription:${customerId}`;
    await this.env.SUBSCRIPTION_KV.put(key, JSON.stringify(status), {
      expirationTtl: 24 * 60 * 60 // 24 hours
    });
  }

  /**
   * Get JWKS for public key distribution (includes grace period keys)
   */
  async getJWKS(): Promise<any> {
    const validKeys = await this.keyRotation.getValidKeysForJWKS();
    
    return {
      keys: validKeys.map(keyMeta => ({
        kty: 'oct', // Octet sequence (for HMAC)
        kid: keyMeta.id,
        use: 'sig',
        alg: 'HS256',
        // NOTE: Don't expose the actual secret in JWKS for HMAC
        // This provides key metadata for validation
        status: keyMeta.status,
        created: keyMeta.created,
        rotated: keyMeta.rotated
      }))
    };
  }

  /**
   * Get frontend URL based on environment
   */
  private getFrontendUrl(): string {
    // In production, this would be your OpenAI frontend domain
    // For now, redirect to a placeholder
    return 'https://flaim-frontend.gerrygugger.workers.dev';
  }

  /**
   * Generate login page HTML
   */
  getLoginPageHtml(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>FLAIM - Fantasy League AI Manager</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
            border-radius: 16px;
            backdrop-filter: blur(10px);
            max-width: 500px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .logo {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        .subscribe-button {
            display: inline-block;
            padding: 16px 32px;
            background: #6772e5;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            margin-top: 2rem;
            font-size: 1.1rem;
            font-weight: 600;
            transition: all 0.2s;
            box-shadow: 0 4px 16px rgba(103, 114, 229, 0.4);
        }
        .subscribe-button:hover {
            background: #5469d4;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(103, 114, 229, 0.6);
        }
        .features {
            margin-top: 2rem;
            text-align: left;
            opacity: 0.9;
        }
        .features li {
            margin: 0.8rem 0;
            padding-left: 0.5rem;
        }
        .price {
            font-size: 2.5rem;
            font-weight: bold;
            margin: 1rem 0;
            background: linear-gradient(45deg, #FFD700, #FFA500);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            margin-bottom: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🏆</div>
        <h1>FLAIM</h1>
        <div class="subtitle">Fantasy League AI Manager</div>
        <p>AI-powered fantasy sports management with premium ESPN integration</p>
        
        <div class="price">$9.99/month</div>
        
        <a href="/checkout" class="subscribe-button">
            🚀 Start Your Pro Journey
        </a>
        
        <ul class="features">
            <li>🏈 Full ESPN fantasy league access</li>
            <li>🤖 AI-powered roster optimization</li>
            <li>🔒 Encrypted credential storage</li>
            <li>⚡ Real-time fantasy insights</li>
            <li>🎯 MCP tools for AI assistants</li>
            <li>❌ Cancel anytime</li>
        </ul>
        
        <p style="margin-top: 2rem; opacity: 0.8; font-size: 0.9rem;">
            Powered by Stripe • Secure payment processing
        </p>
    </div>
</body>
</html>`;
  }

  /**
   * Generate redirect page that sends user to frontend with JWT
   */
  private getRedirectPageHtml(frontendUrl: string, jwt: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to FLAIM Pro!</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
            border-radius: 16px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .checkmark {
            font-size: 4rem;
            margin-bottom: 1rem;
            animation: bounce 0.6s ease-in-out;
        }
        @keyframes bounce {
            0%, 20%, 60%, 100% { transform: translateY(0); }
            40% { transform: translateY(-10px); }
            80% { transform: translateY(-5px); }
        }
        .loading {
            margin-top: 2rem;
            opacity: 0.8;
        }
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #ffffff40;
            border-top: 2px solid #ffffff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-right: 8px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">✅</div>
        <h1>Welcome to FLAIM Pro!</h1>
        <p>Your subscription is active. Redirecting to your dashboard...</p>
        
        <div class="loading">
            <div class="spinner"></div>
            Launching AI fantasy manager...
        </div>
    </div>
    
    <script>
        // Store JWT in localStorage for frontend access
        localStorage.setItem('flaim_jwt', '${jwt}');
        
        // Redirect to frontend
        setTimeout(() => {
            window.location.href = '${frontendUrl}?auth=success';
        }, 2000);
    </script>
</body>
</html>`;
  }
}