/**
 * Stripe Webhook Handler for Auth Service
 * Handles subscription lifecycle events and updates KV cache
 */

import Stripe from 'stripe';

export interface Env {
  STRIPE_API_KEY: string;
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
  private stripe: Stripe;

  constructor(private env: Env) {
    this.stripe = new Stripe(env.STRIPE_API_KEY, {
      apiVersion: '2023-10-16'
    });
  }

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
      
      // Use Stripe's constructEvent for proper signature verification
      let event: Stripe.Event;
      try {
        event = this.stripe.webhooks.constructEvent(
          body,
          signature,
          this.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        console.error('Webhook signature verification failed:', error);
        return new Response('Invalid signature', { 
          status: 400, 
          headers: corsHeaders 
        });
      }
      
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

  private async processEvent(event: Stripe.Event): Promise<void> {
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

  private async handleSubscriptionUpdate(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer.id;
    
    await this.updateSubscriptionCache(customerId, subscription);
    console.log(`Updated subscription for customer ${customerId}: ${subscription.status}`);
  }

  private async handleSubscriptionCancellation(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer.id;
    
    await this.updateSubscriptionCache(customerId, { 
      ...subscription, 
      status: 'canceled' // Stripe uses 'canceled' not 'cancelled'
    });
    console.log(`Cancelled subscription for customer ${customerId}`);
  }

  private async handlePaymentFailure(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === 'string' 
      ? invoice.customer 
      : invoice.customer?.id;

    if (!customerId) return;
    
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

  private async handlePaymentSuccess(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === 'string' 
      ? invoice.customer 
      : invoice.customer?.id;

    if (!customerId) return;
    
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

}