/**
 * Stripe Webhook Handler for Auth Service
 * Handles subscription lifecycle events and updates KV cache
 */

export interface Env {
  STRIPE_WEBHOOK_SECRET: string;
  SUBSCRIPTION_KV: KVNamespace;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
  created: number;
}

export class StripeWebhookHandler {
  constructor(private env: Env) {}

  async handleWebhook(request: Request): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405, 
        headers: corsHeaders 
      });
    }

    try {
      const signature = request.headers.get('Stripe-Signature');
      if (!signature) {
        return new Response('Missing Stripe signature', { 
          status: 400, 
          headers: corsHeaders 
        });
      }

      const body = await request.text();
      
      // Verify webhook signature
      if (!(await this.verifySignature(body, signature))) {
        return new Response('Invalid signature', { 
          status: 400, 
          headers: corsHeaders 
        });
      }

      const event: StripeEvent = JSON.parse(body);
      
      await this.processEvent(event);

      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Stripe webhook error:', error);
      return new Response(JSON.stringify({ 
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async processEvent(event: StripeEvent): Promise<void> {
    console.log(`Processing Stripe event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event);
        break;
      
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCancellation(event);
        break;
      
      case 'invoice.payment_failed':
        await this.handlePaymentFailure(event);
        break;
      
      case 'invoice.payment_succeeded':
        await this.handlePaymentSuccess(event);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionUpdate(event: StripeEvent): Promise<void> {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    
    await this.updateSubscriptionCache(customerId, subscription);
    console.log(`Updated subscription for customer ${customerId}: ${subscription.status}`);
  }

  private async handleSubscriptionCancellation(event: StripeEvent): Promise<void> {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    
    await this.updateSubscriptionCache(customerId, { 
      ...subscription, 
      status: 'cancelled' 
    });
    console.log(`Cancelled subscription for customer ${customerId}`);
  }

  private async handlePaymentFailure(event: StripeEvent): Promise<void> {
    const invoice = event.data.object;
    const customerId = invoice.customer;
    
    // Mark subscription as past due
    const key = `subscription:${customerId}`;
    const existing = await this.env.SUBSCRIPTION_KV.get(key);
    
    if (existing) {
      const status = JSON.parse(existing);
      status.status = 'past_due';
      status.lastUpdated = Math.floor(Date.now() / 1000);
      
      await this.env.SUBSCRIPTION_KV.put(key, JSON.stringify(status));
    }
    
    console.log(`Payment failed for customer ${customerId}`);
  }

  private async handlePaymentSuccess(event: StripeEvent): Promise<void> {
    const invoice = event.data.object;
    const customerId = invoice.customer;
    
    // Mark subscription as active
    const key = `subscription:${customerId}`;
    const existing = await this.env.SUBSCRIPTION_KV.get(key);
    
    if (existing) {
      const status = JSON.parse(existing);
      status.status = 'active';
      status.lastUpdated = Math.floor(Date.now() / 1000);
      
      await this.env.SUBSCRIPTION_KV.put(key, JSON.stringify(status));
    }
    
    console.log(`Payment succeeded for customer ${customerId}`);
  }

  private async updateSubscriptionCache(customerId: string, subscription: any): Promise<void> {
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

  private async verifySignature(body: string, signature: string): Promise<boolean> {
    const elements = signature.split(',');
    const timestamp = elements.find(el => el.startsWith('t='))?.split('=')[1];
    const sig = elements.find(el => el.startsWith('v1='))?.split('=')[1];

    if (!timestamp || !sig) {
      return false;
    }

    // Check timestamp (within 5 minutes)
    const webhookTimestamp = parseInt(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (now - webhookTimestamp > 300) {
      return false;
    }

    // Verify signature using HMAC-SHA256 with WebCrypto API
    try {
      const payload = `${timestamp}.${body}`;
      const expectedSig = await this.createSignature(payload, this.env.STRIPE_WEBHOOK_SECRET);
      return this.compareSignatures(sig, expectedSig);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  private async createSignature(payload: string, secret: string): Promise<string> {
    // Import key for HMAC-SHA256
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Create signature
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload)
    );

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private compareSignatures(sig1: string, sig2: string): boolean {
    // Constant-time comparison to prevent timing attacks
    if (sig1.length !== sig2.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < sig1.length; i++) {
      result |= sig1.charCodeAt(i) ^ sig2.charCodeAt(i);
    }

    return result === 0;
  }
}