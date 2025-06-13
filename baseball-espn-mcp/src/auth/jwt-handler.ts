import { SignJWT, jwtVerify } from 'jose';

export interface JWTPayload {
  sub: string;        // User ID (Stripe customer ID)
  plan: "free" | "pro"; // Subscription tier
  exp: number;        // 15-minute expiry
  iat: number;        // Issued at
  iss: "fantasy-ai";  // Issuer
  aud: "fantasy-mcp"; // Audience
  email?: string;     // User email for display
}

export interface Env {
  JWT_SECRET: string;
}

export class JWTHandler {
  constructor(private env: Env) {}

  async validateToken(token: string): Promise<JWTPayload> {
    const secret = new TextEncoder().encode(this.env.JWT_SECRET);
    
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer: 'fantasy-ai',
        audience: 'fantasy-mcp',
        clockTolerance: 60 // 1 minute clock skew tolerance
      });
      
      return payload as JWTPayload;
    } catch (error) {
      console.error('JWT validation failed:', error);
      throw new Response('Unauthorized - Invalid token', { status: 401 });
    }
  }
  
  async generateToken(sub: string, plan: "free" | "pro", email?: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub,
      plan,
      exp: now + (15 * 60), // 15 minutes
      iat: now,
      iss: "fantasy-ai",
      aud: "fantasy-mcp",
      email
    };
    
    const secret = new TextEncoder().encode(this.env.JWT_SECRET);
    
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(payload.exp)
      .setIssuer('fantasy-ai')
      .setAudience('fantasy-mcp')
      .setSubject(sub)
      .sign(secret);
  }

  async refreshToken(currentToken: string): Promise<string> {
    const payload = await this.validateToken(currentToken);
    
    // Generate new token with same claims but fresh expiry
    return this.generateToken(payload.sub, payload.plan, payload.email);
  }

  extractTokenFromHeader(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    return authHeader.slice(7).trim();
  }
}