/**
 * FLAIM Authentication Service
 * 
 * This is the main authentication gateway for the entire FLAIM platform.
 * It sits in front of all services (OpenAI frontend, ESPN MCP, future Yahoo MCP, etc.)
 * 
 * Flow:
 * 1. User hits /login → Stripe Checkout
 * 2. Stripe redirects to /callback → JWT minted
 * 3. User redirected to OpenAI frontend with JWT
 * 4. All other services validate JWTs through this service
 */

import { StripeAuthGate } from './stripe-gate.js';
import { StripeWebhookHandler } from './stripe-webhook.js';
import { JWTKeyRotation } from './key-rotation.js';

export interface Env {
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  SUBSCRIPTION_KV: KVNamespace;
  KEY_ROTATION_LOG?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      const stripeGate = new StripeAuthGate(env);
      
      // Authentication flow routes
      if (url.pathname === '/' || url.pathname === '/login') {
        return new Response(stripeGate.getLoginPageHtml(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders }
        });
      }
      
      if (url.pathname === '/checkout') {
        return stripeGate.createCheckoutSession(request);
      }
      
      if (url.pathname === '/callback') {
        return stripeGate.handleCallback(request);
      }
      
      // Stripe webhook for subscription updates
      if (url.pathname === '/webhook/stripe') {
        const webhookHandler = new StripeWebhookHandler(env);
        return webhookHandler.handleWebhook(request);
      }
      
      // JWT validation endpoint for other services
      if (url.pathname === '/validate') {
        return this.handleJWTValidation(request, stripeGate, corsHeaders);
      }
      
      // JWKS endpoint for public key distribution
      if (url.pathname === '/jwt/jwks') {
        return this.handleJWKS(request, stripeGate, corsHeaders);
      }
      
      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy',
          service: 'flaim-auth',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders
      });
      
    } catch (error) {
      console.error('Auth service error:', error);
      
      if (error instanceof Response) {
        return error;
      }
      
      return new Response(JSON.stringify({ 
        error: 'Authentication service error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },

  /**
   * Handle JWT validation requests from other services
   */
  async handleJWTValidation(request: Request, stripeGate: StripeAuthGate, corsHeaders: any): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const body = await request.json();
      const token = body.token;

      if (!token) {
        return new Response(JSON.stringify({
          valid: false,
          error: 'Missing token'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Validate the JWT
      const payload = await stripeGate.verifyJWT(token);
      
      // Check subscription status
      const hasActiveSubscription = await stripeGate.hasActiveSubscription(payload.sub);
      
      if (!hasActiveSubscription) {
        return new Response(JSON.stringify({
          valid: false,
          error: 'Subscription not active',
          code: 'SUBSCRIPTION_INACTIVE'
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response(JSON.stringify({
        valid: true,
        payload: {
          customerId: payload.sub,
          email: payload.email,
          plan: payload.plan
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('JWT validation error:', error);
      
      return new Response(JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },

  /**
   * Handle JWKS endpoint for public key distribution
   */
  async handleJWKS(request: Request, stripeGate: StripeAuthGate, corsHeaders: any): Promise<Response> {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const jwks = await stripeGate.getJWKS();
      
      return new Response(JSON.stringify(jwks), {
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          ...corsHeaders 
        }
      });

    } catch (error) {
      console.error('JWKS error:', error);
      
      return new Response(JSON.stringify({
        error: 'JWKS unavailable',
        message: error instanceof Error ? error.message : 'Failed to get signing keys'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },

  /**
   * Handle scheduled cron jobs (key rotation)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const keyRotation = new JWTKeyRotation(env);
    
    console.log('Running scheduled key rotation check...');
    
    if (keyRotation.shouldRotateKey()) {
      console.log('Rotating JWT signing key...');
      
      try {
        const { newSecret, keyId } = await keyRotation.rotateKey();
        
        // In production, you would update the JWT_SECRET environment variable
        // For now, just log the rotation event
        console.log(`Key rotated successfully. New key ID: ${keyId}`);
        console.log('IMPORTANT: Update JWT_SECRET environment variable with the new key');
        
      } catch (error) {
        console.error('Key rotation failed:', error);
      }
    } else {
      console.log('Key rotation not needed at this time');
    }
  }
};