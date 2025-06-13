import { JWTPayload } from '../auth/jwt-handler';

export interface AuthContext {
  props: JWTPayload;
}

export class SubscriptionValidator {
  static validateSubscription(ctx: AuthContext): void {
    if (!ctx.props) {
      throw new Response('Unauthorized - No authentication context', { status: 401 });
    }

    if (ctx.props.plan !== "pro") {
      throw new Response(JSON.stringify({
        error: 'Payment Required',
        message: 'This feature requires a Pro subscription',
        plan: ctx.props.plan
      }), { 
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  static validateSubscriptionSoft(ctx: AuthContext): boolean {
    return ctx.props?.plan === "pro";
  }

  static getUserPlan(ctx: AuthContext): "free" | "pro" {
    return ctx.props?.plan || "free";
  }

  static getUserId(ctx: AuthContext): string {
    if (!ctx.props?.sub) {
      throw new Response('Unauthorized - No user ID in context', { status: 401 });
    }
    return ctx.props.sub;
  }

  static createContext(payload: JWTPayload): AuthContext {
    return { props: payload };
  }
}